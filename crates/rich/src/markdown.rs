use std::collections::{HashMap, HashSet};

use pulldown_cmark::{Alignment, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::Serialize;

pub const MAX_MARKDOWN_BYTES: usize = 200_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Node {
    Text {
        v: String,
    },
    El {
        tag: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        class: Option<&'static str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        start: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        align: Option<&'static str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        checked: Option<bool>,
        c: Vec<Node>,
    },
    Code {
        lang: String,
        v: String,
    },
    Icode {
        v: String,
    },
    Math {
        display: bool,
        v: String,
    },
    Link {
        href: String,
        #[serde(skip_serializing_if = "String::is_empty")]
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        c: Vec<Node>,
    },
    Img {
        src: String,
        alt: String,
        #[serde(skip_serializing_if = "String::is_empty")]
        title: String,
    },
    Br,
}

fn el(tag: &'static str, c: Vec<Node>) -> Node {
    Node::El { tag, id: None, class: None, start: None, align: None, checked: None, c }
}

enum Frame {
    Root,
    Block(&'static str),
    Heading(u8),
    List { start: Option<u64>, task: bool },
    Item { checked: Option<bool> },
    Code { lang: String, text: String },
    Html { text: String },
    Table { aligns: Vec<Alignment> },
    Head,
    Row,
    Cell,
    Link { href: String, title: String },
    Image { src: String, title: String },
    Footnote(String),
}

struct Builder {
    stack: Vec<(Frame, Vec<Node>)>,
    slugs: HashSet<String>,
    notes: HashMap<String, usize>,
    definitions: Vec<(String, Vec<Node>)>,
    in_head: bool,
    column: usize,
}

fn level(l: HeadingLevel) -> u8 {
    match l {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn plain(nodes: &[Node]) -> String {
    let mut out = String::new();
    for n in nodes {
        match n {
            Node::Text { v } | Node::Icode { v } | Node::Math { v, .. } | Node::Code { v, .. } => out.push_str(v),
            Node::El { c, .. } | Node::Link { c, .. } => out.push_str(&plain(c)),
            Node::Img { alt, .. } => out.push_str(alt),
            Node::Br => out.push(' '),
        }
    }
    out
}

fn slug(text: &str) -> String {
    let s: String = text
        .to_lowercase()
        .trim()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '_' || *c == '-')
        .map(|c| if c.is_whitespace() { '-' } else { c })
        .collect();
    if s.is_empty() {
        "section".into()
    } else {
        s
    }
}

fn note_id(label: &str) -> String {
    let s = slug(label);
    if s == "section" {
        "note".into()
    } else {
        s
    }
}

fn url_end(s: &str) -> usize {
    let mut end = s.find(|c: char| c.is_whitespace() || c == '<').unwrap_or(s.len());
    while let Some(last) = s[..end].chars().last() {
        let unbalanced = last == ')' && s[..end].matches('(').count() < s[..end].matches(')').count();
        if matches!(last, '.' | ',' | ';' | ':' | '!' | '?' | '\'' | '"' | '*' | '_' | '~') || unbalanced {
            end -= last.len_utf8();
        } else {
            break;
        }
    }
    end
}

fn autolink(text: &str, out: &mut Vec<Node>) {
    let mut rest = text;
    while let Some(at) = rest.find("http://").into_iter().chain(rest.find("https://")).min() {
        let boundary = rest[..at].chars().last().is_none_or(|c| !c.is_alphanumeric());
        let len = url_end(&rest[at..]);
        let scheme = if rest[at..].starts_with("https://") { 8 } else { 7 };
        if !boundary || len <= scheme {
            let skip = at + scheme;
            push_text(out, &rest[..skip]);
            rest = &rest[skip..];
            continue;
        }
        push_text(out, &rest[..at]);
        let url = &rest[at..at + len];
        out.push(Node::Link {
            href: url.into(),
            title: String::new(),
            id: None,
            c: vec![Node::Text { v: url.into() }],
        });
        rest = &rest[at + len..];
    }
    push_text(out, rest);
}

fn push_text(out: &mut Vec<Node>, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(Node::Text { v }) = out.last_mut() {
        v.push_str(text);
    } else {
        out.push(Node::Text { v: text.into() });
    }
}

impl Builder {
    fn children(&mut self) -> &mut Vec<Node> {
        &mut self.stack.last_mut().expect("root frame").1
    }

    fn in_link(&self) -> bool {
        self.stack.iter().any(|(f, _)| matches!(f, Frame::Link { .. } | Frame::Image { .. }))
    }

    fn text(&mut self, text: &str) {
        if let Some((Frame::Code { text: buf, .. } | Frame::Html { text: buf }, _)) = self.stack.last_mut() {
            buf.push_str(text);
        } else if self.in_link() {
            push_text(self.children(), text);
        } else {
            autolink(text, self.children());
        }
    }

    fn open(&mut self, tag: Tag) {
        let frame = match tag {
            Tag::Paragraph => Frame::Block("p"),
            Tag::Heading { level: l, .. } => Frame::Heading(level(l)),
            Tag::BlockQuote(_) => Frame::Block("blockquote"),
            Tag::CodeBlock(kind) => Frame::Code {
                lang: match kind {
                    CodeBlockKind::Fenced(info) => info.split_whitespace().next().unwrap_or("").to_string(),
                    CodeBlockKind::Indented => String::new(),
                },
                text: String::new(),
            },
            Tag::HtmlBlock => Frame::Html { text: String::new() },
            Tag::List(start) => Frame::List { start, task: false },
            Tag::Item => Frame::Item { checked: None },
            Tag::FootnoteDefinition(label) => Frame::Footnote(label.to_string()),
            Tag::Table(aligns) => Frame::Table { aligns },
            Tag::TableHead => {
                self.in_head = true;
                self.column = 0;
                Frame::Head
            }
            Tag::TableRow => {
                self.column = 0;
                Frame::Row
            }
            Tag::TableCell => Frame::Cell,
            Tag::Emphasis => Frame::Block("em"),
            Tag::Strong => Frame::Block("strong"),
            Tag::Strikethrough => Frame::Block("del"),
            Tag::Superscript => Frame::Block("sup"),
            Tag::Subscript => Frame::Block("sub"),
            Tag::Link { dest_url, title, .. } => Frame::Link { href: dest_url.to_string(), title: title.to_string() },
            Tag::Image { dest_url, title, .. } => Frame::Image { src: dest_url.to_string(), title: title.to_string() },
            _ => Frame::Block("div"),
        };
        self.stack.push((frame, Vec::new()));
    }

    fn close(&mut self, _end: TagEnd) {
        let Some((frame, c)) = self.stack.pop() else { return };
        let node = match frame {
            Frame::Root => return,
            Frame::Block(tag) => el(tag, c),
            Frame::Heading(n) => {
                let base = slug(&plain(&c));
                let mut id = base.clone();
                let mut suffix = 1;
                while self.slugs.contains(&id) {
                    id = format!("{base}-{suffix}");
                    suffix += 1;
                }
                self.slugs.insert(id.clone());
                let tag = ["h1", "h2", "h3", "h4", "h5", "h6"][(n as usize).clamp(1, 6) - 1];
                Node::El { tag, id: Some(id), class: None, start: None, align: None, checked: None, c }
            }
            Frame::List { start, task } => Node::El {
                tag: if start.is_some() { "ol" } else { "ul" },
                id: None,
                class: task.then_some("contains-task-list"),
                start: start.filter(|s| *s != 1),
                align: None,
                checked: None,
                c,
            },
            Frame::Item { checked } => {
                if checked.is_some() {
                    if let Some((Frame::List { task, .. }, _)) = self.stack.last_mut() {
                        *task = true;
                    }
                }
                Node::El {
                    tag: "li",
                    id: None,
                    class: checked.map(|_| "task-list-item"),
                    start: None,
                    align: None,
                    checked,
                    c,
                }
            }
            Frame::Code { lang, text } => Node::Code { lang, v: text.strip_suffix('\n').unwrap_or(&text).to_string() },
            Frame::Html { text } => Node::Code { lang: "xml".into(), v: text.trim_end_matches('\n').to_string() },
            Frame::Table { .. } => {
                let mut rows = c.into_iter();
                let head = rows.next().into_iter().collect::<Vec<_>>();
                let body: Vec<Node> = rows.collect();
                let mut parts = vec![el("thead", head)];
                if !body.is_empty() {
                    parts.push(el("tbody", body));
                }
                el("table", parts)
            }
            Frame::Head => {
                self.in_head = false;
                el("tr", c)
            }
            Frame::Row => el("tr", c),
            Frame::Cell => {
                let align = self.stack.iter().rev().find_map(|(f, _)| match f {
                    Frame::Table { aligns } => aligns.get(self.column).copied(),
                    _ => None,
                });
                self.column += 1;
                Node::El {
                    tag: if self.in_head { "th" } else { "td" },
                    id: None,
                    class: None,
                    start: None,
                    align: match align {
                        Some(Alignment::Left) => Some("left"),
                        Some(Alignment::Center) => Some("center"),
                        Some(Alignment::Right) => Some("right"),
                        _ => None,
                    },
                    checked: None,
                    c,
                }
            }
            Frame::Link { href, title } => Node::Link { href, title, id: None, c },
            Frame::Image { src, title } => Node::Img { src, alt: plain(&c), title },
            Frame::Footnote(label) => {
                self.definitions.push((label, c));
                return;
            }
        };
        self.children().push(node);
    }

    fn footnote_ref(&mut self, label: &str) {
        let next = self.notes.len() + 1;
        let n = *self.notes.entry(label.to_string()).or_insert(next);
        let id = note_id(label);
        let link = Node::Link {
            href: format!("#fn-{id}"),
            title: String::new(),
            id: Some(format!("fnref-{id}-{n}")),
            c: vec![Node::Text { v: n.to_string() }],
        };
        self.children().push(el("sup", vec![link]));
    }

    fn footnotes(&mut self) -> Option<Node> {
        if self.definitions.is_empty() {
            return None;
        }
        let mut defs = std::mem::take(&mut self.definitions);
        defs.sort_by_key(|(label, _)| self.notes.get(label).copied().unwrap_or(usize::MAX));
        let items = defs
            .into_iter()
            .map(|(label, mut c)| {
                let id = note_id(&label);
                if let Some(n) = self.notes.get(&label) {
                    let back = Node::Link {
                        href: format!("#fnref-{id}-{n}"),
                        title: "Back to reference".into(),
                        id: None,
                        c: vec![Node::Text { v: "↩".into() }],
                    };
                    match c.last_mut() {
                        Some(Node::El { tag: "p", c: inner, .. }) => {
                            inner.push(Node::Text { v: " ".into() });
                            inner.push(back);
                        }
                        _ => c.push(back),
                    }
                }
                Node::El {
                    tag: "li",
                    id: Some(format!("fn-{id}")),
                    class: None,
                    start: None,
                    align: None,
                    checked: None,
                    c,
                }
            })
            .collect();
        Some(Node::El {
            tag: "section",
            id: None,
            class: Some("footnotes"),
            start: None,
            align: None,
            checked: None,
            c: vec![el("ol", items)],
        })
    }
}

pub fn parse_markdown(text: &str) -> Option<Vec<Node>> {
    if text.len() > MAX_MARKDOWN_BYTES {
        return None;
    }
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH;
    let mut b = Builder {
        stack: vec![(Frame::Root, Vec::new())],
        slugs: HashSet::new(),
        notes: HashMap::new(),
        definitions: Vec::new(),
        in_head: false,
        column: 0,
    };
    let mut pending = String::new();
    for event in Parser::new_ext(text, options) {
        if let Event::Text(t) = &event {
            pending.push_str(t);
            continue;
        }
        if !pending.is_empty() {
            b.text(&std::mem::take(&mut pending));
        }
        match event {
            Event::Start(tag) => b.open(tag),
            Event::End(end) => b.close(end),
            Event::Text(_) => {}
            Event::Code(t) => b.children().push(Node::Icode { v: t.to_string() }),
            Event::InlineMath(t) => b.children().push(Node::Math { display: false, v: t.to_string() }),
            Event::DisplayMath(t) => b.children().push(Node::Math { display: true, v: t.trim().to_string() }),
            Event::Html(t) => match b.stack.last_mut() {
                Some((Frame::Html { text }, _)) => text.push_str(&t),
                _ => b.children().push(Node::Code { lang: "xml".into(), v: t.trim_end_matches('\n').to_string() }),
            },
            Event::InlineHtml(t) => b.children().push(Node::Icode { v: t.to_string() }),
            Event::FootnoteReference(label) => b.footnote_ref(&label),
            Event::SoftBreak => push_text(b.children(), "\n"),
            Event::HardBreak => b.children().push(Node::Br),
            Event::Rule => b.children().push(el("hr", vec![])),
            Event::TaskListMarker(done) => {
                if let Some((Frame::Item { checked }, _)) =
                    b.stack.iter_mut().rev().find(|(f, _)| matches!(f, Frame::Item { .. }))
                {
                    *checked = Some(done);
                }
            }
        }
    }
    if !pending.is_empty() {
        b.text(&pending);
    }
    let notes = b.footnotes();
    let mut root = b.stack.into_iter().next().map(|(_, c)| c).unwrap_or_default();
    root.extend(notes);
    Some(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(text: &str) -> String {
        serde_json::to_string(&parse_markdown(text).unwrap()).unwrap()
    }

    #[test]
    fn parses_gfm_tables_tasks_lists_links_strikeout_and_footnotes() {
        let out = json("# Title\n\n| Name | Value |\n| --- | ---: |\n| Test | 42 |\n\n- [x] Done\n- [ ] Pending\n  - Child\n\n~~removed~~ **strong** `inline` https://example.com.\n\nReference[^one].\n\n[^one]: Footnote text");
        for expected in [
            r#""tag":"h1","id":"title""#,
            r#""tag":"table""#,
            r#""tag":"thead""#,
            r#""tag":"tbody""#,
            r#""align":"right""#,
            r#""class":"contains-task-list""#,
            r#""checked":true"#,
            r#""checked":false"#,
            r#""tag":"del""#,
            r#""tag":"strong""#,
            r#"{"t":"icode","v":"inline"}"#,
            r#""href":"https://example.com""#,
            r##""href":"#fn-one""##,
            r#""id":"fn-one""#,
            "Footnote text",
        ] {
            assert!(out.contains(expected), "missing {expected} in {out}");
        }
    }

    #[test]
    fn parses_inline_and_display_math() {
        let out = json("Inline $x^2$.\n\n$$\n\\frac{a}{b}\n$$");
        assert!(out.contains(r#"{"t":"math","display":false,"v":"x^2"}"#), "{out}");
        assert!(out.contains(r#""display":true,"v":"\\frac{a}{b}""#), "{out}");
    }

    #[test]
    fn raw_html_becomes_inert_code() {
        let out = json("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\nText with <b>bold</b> tag");
        assert!(out.contains(r#"{"t":"code","lang":"xml","v":"<script>alert(1)</script>"}"#), "{out}");
        assert!(out.contains(r#"{"t":"icode","v":"<b>"}"#), "{out}");
        let xml = json("## Context\n\n<context version=\"1\">\n<goal>Continue</goal>\n</context>");
        assert!(xml.contains(r#""lang":"xml""#) && xml.contains("<goal>Continue</goal>"), "{xml}");
    }

    #[test]
    fn heading_ids_are_unique_and_slugged() {
        let out = json("# Same\n\n# Same\n\n## Hello, World!");
        assert!(
            out.contains(r#""id":"same""#) && out.contains(r#""id":"same-1""#) && out.contains(r#""id":"hello-world""#),
            "{out}"
        );
    }

    #[test]
    fn fenced_code_keeps_language_and_content() {
        let nodes = parse_markdown("```typescript title=x\nconst x = \"<script>\";\n```").unwrap();
        assert_eq!(nodes, vec![Node::Code { lang: "typescript".into(), v: "const x = \"<script>\";".into() }]);
    }

    #[test]
    fn autolinks_need_a_boundary_and_skip_trailing_punctuation() {
        let out = json("see (https://a.dev/x_(y)) and xhttps://no and https://b.dev/path?q=1, done");
        assert!(out.contains(r#""href":"https://a.dev/x_(y)""#), "{out}");
        assert!(out.contains(r#""href":"https://b.dev/path?q=1""#), "{out}");
        assert!(!out.contains(r#""href":"https://no""#), "{out}");
    }

    #[test]
    fn images_keep_alt_text_and_links_keep_raw_targets() {
        let nodes =
            parse_markdown("![tracking **pixel**](https://e.com/p.png \"t\") [bad](javascript:alert%281%29)").unwrap();
        let out = serde_json::to_string(&nodes).unwrap();
        assert!(out.contains(r#"{"t":"img","src":"https://e.com/p.png","alt":"tracking pixel","title":"t"}"#), "{out}");
        assert!(out.contains(r#""href":"javascript:alert%281%29""#), "{out}");
    }

    #[test]
    fn rejects_oversized_input() {
        assert!(parse_markdown(&"x".repeat(MAX_MARKDOWN_BYTES + 1)).is_none());
    }
}

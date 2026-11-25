use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Serialize;
use syntect::highlighting::{Color, FontStyle, Highlighter, Theme};
use syntect::parsing::{ParseState, ScopeStack, SyntaxReference, SyntaxSet};
use two_face::theme::EmbeddedThemeName;

pub const MAX_HIGHLIGHT_BYTES: usize = 40_000;
pub const MAX_HIGHLIGHT_LINES: usize = 1_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub content: String,
    pub html_style: BTreeMap<&'static str, String>,
}

struct Assets {
    syntaxes: SyntaxSet,
    light: Theme,
    dark: Theme,
}

fn assets() -> &'static Assets {
    static ASSETS: OnceLock<Assets> = OnceLock::new();
    ASSETS.get_or_init(|| {
        let themes = two_face::theme::extra();
        Assets {
            syntaxes: two_face::syntax::extra_newlines(),
            light: themes.get(EmbeddedThemeName::Github).clone(),
            dark: themes.get(EmbeddedThemeName::OneHalfDark).clone(),
        }
    })
}

const ALIASES: &[(&str, &str)] = &[
    ("sh", "bash"),
    ("shell", "bash"),
    ("shellscript", "bash"),
    ("console", "bash"),
    ("shellsession", "bash"),
    ("zsh", "bash"),
    ("javascript", "js"),
    ("mjs", "js"),
    ("cjs", "js"),
    ("typescript", "ts"),
    ("python", "py"),
    ("rust", "rs"),
    ("yml", "yaml"),
    ("csharp", "cs"),
    ("c#", "cs"),
    ("c++", "cpp"),
    ("docker", "dockerfile"),
    ("markdown", "md"),
    ("jsx", "tsx"),
    ("golang", "go"),
    ("kt", "kotlin"),
    ("rb", "ruby"),
    ("patch", "diff"),
    ("htm", "html"),
    ("svg", "xml"),
    ("jsonc", "json"),
    ("makefile", "make"),
];

fn syntax<'a>(set: &'a SyntaxSet, language: &str) -> Option<&'a SyntaxReference> {
    let lower = language.trim().to_ascii_lowercase();
    if lower.is_empty() || matches!(lower.as_str(), "text" | "txt" | "plain" | "plaintext") {
        return None;
    }
    let name = ALIASES.iter().find(|(from, _)| *from == lower).map_or(lower.as_str(), |(_, to)| to);
    set.find_syntax_by_token(name)
        .or_else(|| set.find_syntax_by_extension(name))
        .or_else(|| set.syntaxes().iter().find(|s| s.name.eq_ignore_ascii_case(name)))
        .filter(|s| s.name != "Plain Text")
}

fn hex(c: Color) -> String {
    if c.a == 255 {
        format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)
    } else {
        format!("#{:02x}{:02x}{:02x}{:02x}", c.r, c.g, c.b, c.a)
    }
}

const LIGHT: [&str; 4] =
    ["--syntax-light", "--syntax-light-font-style", "--syntax-light-font-weight", "--syntax-light-text-decoration"];
const DARK: [&str; 4] =
    ["--syntax-dark", "--syntax-dark-font-style", "--syntax-dark-font-weight", "--syntax-dark-text-decoration"];

#[derive(Clone, Copy, PartialEq, Eq)]
struct StyleKey {
    fg: Color,
    font: FontStyle,
}

impl StyleKey {
    fn from_style(hl: &Highlighter, stack: &ScopeStack) -> Self {
        let s = hl.style_for_stack(stack.as_slice());
        Self { fg: s.foreground, font: s.font_style }
    }

    fn apply_into(self, out: &mut BTreeMap<&'static str, String>, keys: [&'static str; 4]) {
        out.insert(keys[0], hex(self.fg));
        if self.font.contains(FontStyle::ITALIC) {
            out.insert(keys[1], "italic".into());
        }
        if self.font.contains(FontStyle::BOLD) {
            out.insert(keys[2], "bold".into());
        }
        if self.font.contains(FontStyle::UNDERLINE) {
            out.insert(keys[3], "underline".into());
        }
    }
}

pub fn highlight(code: &str, language: &str) -> Option<Vec<Vec<Token>>> {
    if code.len() > MAX_HIGHLIGHT_BYTES || code.bytes().filter(|&b| b == b'\n').count() + 1 > MAX_HIGHLIGHT_LINES {
        return None;
    }
    let assets = assets();
    let syntax = syntax(&assets.syntaxes, language)?;
    let light = Highlighter::new(&assets.light);
    let dark = Highlighter::new(&assets.dark);
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut lines = Vec::new();
    let mut line_buf = String::with_capacity(128);
    let mut runs: Vec<((StyleKey, StyleKey), String)> = Vec::new();
    for raw in code.split('\n') {
        line_buf.clear();
        line_buf.push_str(raw);
        line_buf.push('\n');
        let ops = state.parse_line(&line_buf, &assets.syntaxes).ok()?;
        runs.clear();
        let mut push = |text: &str, stack: &ScopeStack| {
            let text = text.strip_suffix('\n').unwrap_or(text);
            if text.is_empty() {
                return;
            }
            let key = (StyleKey::from_style(&light, stack), StyleKey::from_style(&dark, stack));
            match runs.last_mut() {
                Some((last_key, content)) if *last_key == key => content.push_str(text),
                _ => runs.push((key, text.to_string())),
            }
        };
        let mut pos = 0;
        for (at, op) in ops {
            let at = at.min(line_buf.len());
            if at > pos {
                push(&line_buf[pos..at], &stack);
                pos = at;
            }
            stack.apply(&op).ok()?;
        }
        push(&line_buf[pos..], &stack);
        let tokens = runs
            .drain(..)
            .map(|((lk, dk), content)| {
                let mut html_style = BTreeMap::new();
                lk.apply_into(&mut html_style, LIGHT);
                dk.apply_into(&mut html_style, DARK);
                Token { content, html_style }
            })
            .collect();
        lines.push(tokens);
    }
    Some(lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(lines: &[Vec<Token>]) -> String {
        lines.iter().map(|l| l.iter().map(|t| t.content.as_str()).collect::<String>()).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn highlights_common_languages_with_light_and_dark_colors() {
        for (lang, src) in [
            ("ts", "const answer: number = 42;"),
            ("typescript", "let x = 1;"),
            ("tsx", "const a = <div className=\"x\">{y}</div>;"),
            ("rs", "fn main() { println!(\"hello\"); }"),
            ("python", "def f(x):\n    return x + 1"),
            ("json", "{\"a\": [1, true, null]}"),
            ("bash", "echo \"$HOME\" | grep x"),
            ("xml", "<context version=\"1\">\n<goal>Continue</goal>\n</context>"),
            ("yaml", "a: 1\nb: [x, y]"),
            ("go", "package main\nfunc main() {}"),
            ("diff", "-old\n+new"),
            ("dockerfile", "FROM node:22\nRUN pnpm i"),
            ("toml", "[a]\nb = 1"),
            ("swift", "let x = 1"),
            ("kotlin", "val x = 1"),
            ("vue", "<template><div/></template>"),
            ("graphql", "query { a }"),
            ("jsx", "const a = <b>{c}</b>;"),
        ] {
            let lines = highlight(src, lang).unwrap_or_else(|| panic!("no grammar for {lang}"));
            assert_eq!(text(&lines), src, "{lang}");
            let colors: std::collections::HashSet<_> =
                lines.iter().flatten().map(|t| &t.html_style["--syntax-light"]).collect();
            assert!(colors.len() > 1, "{lang} produced a single color");
            assert!(lines.iter().flatten().all(|t| t.html_style.contains_key("--syntax-dark")));
        }
    }

    #[test]
    fn covers_previous_shiki_languages() {
        let missing: Vec<_> = [
            "bash",
            "javascript",
            "typescript",
            "tsx",
            "jsx",
            "json",
            "jsonc",
            "python",
            "rust",
            "go",
            "java",
            "kotlin",
            "swift",
            "c",
            "cpp",
            "csharp",
            "ruby",
            "php",
            "html",
            "css",
            "scss",
            "sql",
            "yaml",
            "toml",
            "xml",
            "markdown",
            "diff",
            "dockerfile",
            "makefile",
            "ini",
            "lua",
            "dart",
            "scala",
            "r",
            "vue",
            "svelte",
            "graphql",
        ]
        .into_iter()
        .chain([
            "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rs", "kt", "kts", "h", "cc", "hpp", "cs", "rb", "yml", "sh",
            "zsh", "gql", "patch",
        ])
        .filter(|l| syntax(&assets().syntaxes, l).is_none())
        .collect();
        assert!(missing.is_empty(), "missing grammars: {missing:?}");
    }

    #[test]
    fn keeps_empty_and_trailing_lines() {
        let lines = highlight("a = 1\n\nb = 2\n", "py").unwrap();
        assert_eq!(lines.len(), 4);
        assert!(lines[1].is_empty() && lines[3].is_empty());
    }

    #[test]
    fn falls_back_for_unknown_plain_and_oversized_input() {
        assert!(highlight("hello", "imaginary-language").is_none());
        assert!(highlight("hello", "text").is_none());
        assert!(highlight("Get-ChildItem", "powershell").is_none());
        assert!(highlight(&"x".repeat(MAX_HIGHLIGHT_BYTES + 1), "js").is_none());
        assert!(highlight(&"x\n".repeat(MAX_HIGHLIGHT_LINES), "js").is_none());
    }
}

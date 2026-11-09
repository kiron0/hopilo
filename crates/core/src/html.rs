use std::fmt::Write;

use crate::model::{Block, Message, Pack, Role};
use crate::render::{visible_messages, RenderOptions, ToolDetail};

pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + s.len() / 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

fn inline(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('`') {
        let (before, after) = rest.split_at(start);
        match after[1..].find('`') {
            Some(end) if end > 0 => {
                out.push_str(&bold(&escape(before)));
                let _ = write!(out, "<code>{}</code>", escape(&after[1..1 + end]));
                rest = &after[end + 2..];
            }
            _ => {
                out.push_str(&bold(&escape(before)));
                out.push('`');
                rest = &after[1..];
            }
        }
    }
    out.push_str(&bold(&escape(rest)));
    out
}

fn bold(escaped: &str) -> String {
    let parts: Vec<&str> = escaped.split("**").collect();
    if parts.len() < 3 {
        return escaped.to_string();
    }
    let mut out = String::new();
    for (i, p) in parts.iter().enumerate() {
        if i > 0 {
            let closing = i % 2 == 0;
            if i == parts.len() - 1 && i % 2 == 1 {
                out.push_str("**");
            } else {
                out.push_str(if closing { "</strong>" } else { "<strong>" });
            }
        }
        out.push_str(p);
    }
    out
}

fn fence_open(line: &str) -> Option<(usize, &str)> {
    let t = line.trim_start();
    let n = t.chars().take_while(|c| *c == '`').count();
    (n >= 3).then(|| (n, t[n..].trim()))
}

fn rich_text(text: &str) -> String {
    let mut out = String::new();
    let mut lines = text.lines().peekable();
    let mut para: Vec<&str> = Vec::new();
    let flush = |para: &mut Vec<&str>, out: &mut String| {
        if !para.is_empty() {
            let body: Vec<String> = para.iter().map(|l| inline(l)).collect();
            let _ = write!(out, "<p>{}</p>", body.join("<br>"));
            para.clear();
        }
    };
    while let Some(line) = lines.next() {
        if let Some((n, lang)) = fence_open(line) {
            flush(&mut para, &mut out);
            let mut code = Vec::new();
            for l in lines.by_ref() {
                if fence_open(l).is_some_and(|(m, rest)| m >= n && rest.is_empty()) {
                    break;
                }
                code.push(l);
            }
            out.push_str(&code_block(&code.join("\n"), lang));
        } else if line.trim().is_empty() {
            flush(&mut para, &mut out);
        } else if let Some(h) = line
            .strip_prefix("#")
            .filter(|_| line.starts_with("# ") || line.starts_with("## ") || line.starts_with("### "))
        {
            flush(&mut para, &mut out);
            let _ = write!(out, "<h4>{}</h4>", inline(h.trim_start_matches('#').trim()));
        } else {
            para.push(line);
        }
    }
    flush(&mut para, &mut out);
    out
}

fn code_block(code: &str, lang: &str) -> String {
    let lang = lang.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '+').collect::<String>();
    format!(
        "<div class=\"code\"><div class=\"code-bar\"><span>{}</span><button type=\"button\" class=\"copy\">Copy</button></div><pre><code data-lang=\"{}\">{}</code></pre></div>",
        if lang.is_empty() { "code".to_string() } else { escape(&lang) },
        escape(&lang),
        escape(code)
    )
}

fn tool_body(text: &str, opts: &RenderOptions) -> String {
    match opts.tool_detail {
        ToolDetail::Truncated { limit } if text.chars().count() > limit => {
            let head: String = text.chars().take(limit).collect();
            format!("{head}\n[… {} more characters not included]", text.chars().count() - limit)
        }
        _ => text.to_string(),
    }
}

fn role_name(r: Role) -> &'static str {
    match r {
        Role::User => "User",
        Role::Assistant => "Assistant",
        Role::System => "System",
        Role::Tool => "Tool",
    }
}

fn write_message(out: &mut String, m: &Message, opts: &RenderOptions) {
    let role = role_name(m.role);
    let _ = write!(out, "<article class=\"msg {}\" id=\"m-{}\">", role.to_lowercase(), escape(&m.id));
    let ts = m
        .created_at
        .as_deref()
        .map(|t| format!("<time>{}</time>", escape(t.replace('T', " ").trim_end_matches('Z'))))
        .unwrap_or_default();
    let _ = write!(out, "<header><span class=\"role\">{role}</span>{ts}</header>");
    for b in &m.blocks {
        match b {
            Block::Text { text } => {
                let _ = write!(out, "<div class=\"text\">{}</div>", rich_text(text));
            }
            Block::ToolCall { name, input } => {
                if matches!(opts.tool_detail, ToolDetail::Omit) {
                    continue;
                }
                let lang = if input.trim_start().starts_with('{') { "json" } else { "sh" };
                let _ = write!(
                    out,
                    "<details class=\"tool\"><summary><span class=\"tag\">Tool call</span> <code>{}</code></summary>{}</details>",
                    escape(name),
                    code_block(&tool_body(input, opts), lang)
                );
            }
            Block::ToolResult { name, output, is_error } => {
                if matches!(opts.tool_detail, ToolDetail::Omit) {
                    continue;
                }
                let label = if *is_error { "Tool error" } else { "Tool result" };
                let lines = output.lines().count();
                let _ = write!(
                    out,
                    "<details class=\"tool{}\"><summary><span class=\"tag\">{label}</span> <code>{}</code> <span class=\"dim\">{lines} line{}</span></summary>{}</details>",
                    if *is_error { " err" } else { "" },
                    escape(name.as_deref().unwrap_or("")),
                    if lines == 1 { "" } else { "s" },
                    code_block(&tool_body(output, opts), "")
                );
            }
            Block::Missing { description } => {
                let _ = write!(out, "<p class=\"note warn\">Referenced but not recovered: {}</p>", escape(description));
            }
            Block::File { name, media_type, size, .. } => {
                let _ = write!(
                    out,
                    "<p class=\"note\">Shared file: <code>{}</code> · {} · {} bytes</p>",
                    escape(name),
                    escape(media_type),
                    size
                );
            }
        }
    }
    out.push_str("</article>");
}

const STYLE: &str = r#"
:root{--bg:#0f1115;--panel:#161922;--panel2:#1d212c;--line:#2a2f3c;--ink:#e6e8ee;--muted:#9aa1b2;--faint:#6b7285;--accent:#8b7cf6;--user:#2b2557;--err:#f2777a;--warn:#e9b44c;--k:#c792ea;--s:#a5d6a7;--n:#f78c6c;--c:#6b7285}
:root[data-theme=light]{--bg:#f6f7f9;--panel:#fff;--panel2:#f0f2f5;--line:#e2e5eb;--ink:#1b1e27;--muted:#5b6274;--faint:#8a90a0;--accent:#5b4bdb;--user:#ece9ff;--err:#c4373b;--warn:#a86d00;--k:#7c3aed;--s:#2e7d32;--n:#c2410c;--c:#8a90a0}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:14.5px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:880px;margin:0 auto;padding:28px 18px 80px}
h1{font-size:22px;line-height:1.3;margin:0 0 6px}.sub{color:var(--muted);font-size:13px;margin-bottom:18px}
.bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 0;background:var(--bg);border-bottom:1px solid var(--line);margin-bottom:18px}
.bar input{flex:1;min-width:180px;background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 11px;font:inherit;font-size:13px}
button{background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px;cursor:pointer}button:hover{border-color:var(--accent)}
.sources{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:18px;font-size:13px;color:var(--muted)}
.sources b{color:var(--ink)}.sources li{margin:3px 0}.sources ul{margin:4px 0;padding-left:18px}
.msg{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 16px;margin:12px 0}
.msg.user{background:var(--user)}.msg.tool{background:transparent;border-style:dashed}
.msg header{display:flex;gap:10px;align-items:baseline;margin-bottom:4px}.role{font-weight:650;font-size:12.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--accent)}
time,.dim{color:var(--faint);font-size:11.5px}
.text p{margin:6px 0;overflow-wrap:anywhere}.text h4{margin:12px 0 4px;font-size:14.5px}
code{font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--panel2);border-radius:5px;padding:1px 5px}
.code{border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:8px 0;background:var(--panel2)}
.code-bar{display:flex;justify-content:space-between;align-items:center;padding:3px 6px 3px 12px;font-size:11px;color:var(--faint);border-bottom:1px solid var(--line)}
.code-bar button{padding:2px 8px;font-size:11px}
pre{margin:0;padding:10px 12px;overflow:auto;max-height:520px}pre code{background:none;padding:0;white-space:pre}
details.tool{margin:8px 0;border:1px solid var(--line);border-radius:10px;padding:6px 10px;background:var(--panel2)}
details.tool summary{cursor:pointer;font-size:12.5px;color:var(--muted)}details.tool.err{border-color:var(--err)}
.tag{font-weight:600;color:var(--ink)}details.err .tag{color:var(--err)}
.note{font-size:12.5px;color:var(--muted)}.note.warn{color:var(--warn)}
.tk{color:var(--k)}.ts{color:var(--s)}.tn{color:var(--n)}.tc{color:var(--c);font-style:italic}
.hide{display:none}mark{background:var(--warn);color:#000;border-radius:3px}
footer{margin-top:32px;color:var(--faint);font-size:12px;text-align:center}
@media print{.bar{display:none}}
"#;

const SCRIPT: &str = r#"
(function(){
var root=document.documentElement;try{var t=localStorage.getItem('hopilo-theme');if(t)root.dataset.theme=t}catch(e){}
document.getElementById('theme').onclick=function(){var n=root.dataset.theme==='light'?'dark':'light';root.dataset.theme=n;try{localStorage.setItem('hopilo-theme',n)}catch(e){}};
var open=false;document.getElementById('tools').onclick=function(){open=!open;document.querySelectorAll('details.tool').forEach(function(d){d.open=open});this.textContent=open?'Collapse tools':'Expand tools'};
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button.copy');if(!b)return;var c=b.closest('.code').querySelector('code').innerText;
var done=function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1200)};
if(navigator.clipboard)navigator.clipboard.writeText(c).then(done,function(){});else{var a=document.createElement('textarea');a.value=c;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();done()}});
var q=document.getElementById('q'),msgs=[].slice.call(document.querySelectorAll('.msg')),count=document.getElementById('count');
q.oninput=function(){var v=q.value.trim().toLowerCase(),n=0;msgs.forEach(function(m){var hit=!v||m.textContent.toLowerCase().indexOf(v)>=0;m.classList.toggle('hide',!hit);if(hit&&v){n++;m.querySelectorAll('details').forEach(function(d){if(d.textContent.toLowerCase().indexOf(v)>=0)d.open=true})}});count.textContent=v?n+' match'+(n===1?'':'es'):''};
var KW=/^(?:fn|let|mut|const|var|function|return|if|else|for|while|loop|match|import|from|export|default|class|struct|enum|impl|pub|use|mod|async|await|def|lambda|try|catch|except|finally|throw|raise|new|in|of|type|interface|true|false|null|None|True|False|self|this|package|func|go|defer|select|case|switch|break|continue|static|public|private|protected|void|int|string|bool|echo|then|fi|do|done|esac)$/;
document.querySelectorAll('pre code').forEach(function(el){var s=el.textContent;if(s.length>60000)return;var out='',i=0,L=s.length;
function esc(x){return x.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
while(i<L){var ch=s[i],rest=s.slice(i),m;
if((m=/^(\/\/[^\n]*|#(?![!{\[])[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest))&&(ch!=='#'||i===0||/\s/.test(s[i-1]))){out+='<span class="tc">'+esc(m[0])+'</span>';i+=m[0].length;continue}
if((m=/^("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/.exec(rest))){out+='<span class="ts">'+esc(m[0])+'</span>';i+=m[0].length;continue}
if((m=/^\d[\d_.xXa-fA-F]*/.exec(rest))&&(i===0||!/[\w]/.test(s[i-1]))){out+='<span class="tn">'+esc(m[0])+'</span>';i+=m[0].length;continue}
if((m=/^[A-Za-z_][\w]*/.exec(rest))){out+=KW.test(m[0])?'<span class="tk">'+m[0]+'</span>':esc(m[0]);i+=m[0].length;continue}
out+=esc(ch);i++}
el.innerHTML=out});
})();
"#;

pub fn render_html(pack: &Pack, opts: &RenderOptions) -> String {
    let mut out = String::new();
    out.push_str("<!doctype html><html lang=\"en\" data-theme=\"dark\"><head><meta charset=\"utf-8\">");
    out.push_str("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">");
    out.push_str("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:\">");
    let _ =
        write!(out, "<title>{}</title><style>{STYLE}</style></head><body><div class=\"wrap\">", escape(&pack.title));
    let _ = write!(out, "<h1>{}</h1>", escape(&pack.title));
    let msgs = visible_messages(pack, opts);
    let _ = write!(
        out,
        "<div class=\"sub\">{} messages · exported {} by Hopilo · works offline, no network</div>",
        msgs.len(),
        escape(pack.created_at.replace('T', " ").trim_end_matches('Z'))
    );
    out.push_str("<div class=\"bar\"><input id=\"q\" type=\"search\" placeholder=\"Search this transcript\"><span id=\"count\" class=\"dim\"></span><button id=\"tools\" type=\"button\">Expand tools</button><button id=\"theme\" type=\"button\">Theme</button></div>");
    if opts.level != crate::brief::ContextLevel::Full {
        let _ = write!(out, "<article class=\"msg\">{}</article><footer>Exported with Hopilo</footer></div><script>{SCRIPT}</script></body></html>", rich_text(&crate::render::render_markdown(pack, opts)));
        return out;
    }
    if !pack.sources.is_empty() {
        out.push_str("<div class=\"sources\"><ul>");
        for s in &pack.sources {
            let _ = write!(out, "<li><b>{}</b> · {}", escape(&s.title), escape(&s.provider));
            if let Some(m) = &s.model {
                let _ = write!(out, " · {}", escape(m));
            }
            for miss in &s.missing_items {
                let _ = write!(out, "<br><span class=\"note warn\">Missing: {}</span>", escape(miss));
            }
            out.push_str("</li>");
        }
        out.push_str("</ul></div>");
    }
    if let Some(note) = pack.context.note.as_deref().filter(|n| !n.trim().is_empty()) {
        let _ = write!(out, "<section class=\"sources\"><h4>Notes</h4>{}</section>", rich_text(note));
    }
    let multi = pack.sources.len() > 1;
    let mut current: Option<&str> = None;
    for m in msgs {
        if multi && current != Some(m.source_id.as_str()) {
            if let Some(s) = pack.sources.iter().find(|s| s.source_id == m.source_id) {
                let _ = write!(out, "<h4 class=\"dim\">From: {} ({})</h4>", escape(&s.title), escape(&s.provider));
            }
            current = Some(m.source_id.as_str());
        }
        write_message(&mut out, m, opts);
    }
    if pack.attachments.iter().any(|a| a.text.is_some()) {
        out.push_str("<h4>Attachments</h4>");
        for a in &pack.attachments {
            if let Some(t) = &a.text {
                let lang = a.file_name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
                let _ = write!(
                    out,
                    "<details class=\"tool\"><summary><span class=\"tag\">{}</span></summary>{}</details>",
                    escape(&a.file_name),
                    code_block(t, lang)
                );
            }
        }
    }
    let _ = write!(out, "<footer>Exported with Hopilo</footer></div><script>{SCRIPT}</script></body></html>");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    #[test]
    fn escapes_and_collapses_tools() {
        let src = Source {
            source_id: "s".into(),
            kind: SourceKind::LocalAgent,
            provider: "claude-code".into(),
            title: "<script>alert(1)</script>".into(),
            origin: None,
            project: None,
            model: None,
            captured_at: "2026-01-01T00:00:00Z".into(),
            capture_status: CaptureStatus::Complete,
            missing_items: vec![],
            omitted: vec![],
        };
        let pack = Pack {
            schema_version: SCHEMA_VERSION.into(),
            pack_id: "p".into(),
            title: "<b>t</b>".into(),
            version: 0,
            created_at: "2026-01-01T00:00:00Z".into(),
            mode: Mode::Full,
            sources: vec![src],
            messages: vec![
                Message {
                    id: "1".into(),
                    source_id: "s".into(),
                    role: Role::User,
                    created_at: None,
                    blocks: vec![Block::text("Run `ls` **now**\n\n```rust\nfn main() {}\n```")],
                },
                Message {
                    id: "2".into(),
                    source_id: "s".into(),
                    role: Role::Assistant,
                    created_at: None,
                    blocks: vec![Block::ToolCall { name: "Bash".into(), input: "<img src=x onerror=alert(1)>".into() }],
                },
            ],
            context: ContextBrief::default(),
            attachments: vec![],
            tags: vec![],
            integrity: Integrity::default(),
        };
        let html = render_html(&pack, &RenderOptions::default());
        assert!(!html.contains("<script>alert(1)"));
        assert!(!html.contains("<img src=x"));
        assert!(html.contains("&lt;img src=x"));
        assert!(html.contains("<code>ls</code>"));
        assert!(html.contains("<strong>now</strong>"));
        assert!(html.contains("data-lang=\"rust\""));
        assert!(html.contains("<details class=\"tool\">"));
        assert!(html.contains("Content-Security-Policy"));
        let mut pack = pack;
        pack.context.note = Some("Project note <script>bad()</script>".into());
        let mut intermediate = pack.messages[0].clone();
        intermediate.id = "middle".into();
        intermediate.role = Role::Assistant;
        intermediate.blocks = vec![Block::text("intermediate sentinel")];
        pack.messages.push(intermediate);
        let mut latest = pack.messages[0].clone();
        latest.id = "latest".into();
        latest.blocks = vec![Block::text("latest request")];
        pack.messages.push(latest);
        let mut reply = pack.messages[0].clone();
        reply.id = "reply".into();
        reply.role = Role::Assistant;
        reply.blocks = vec![Block::text("final reply")];
        pack.messages.push(reply);
        let html = render_html(&pack, &RenderOptions::default());
        assert!(html.contains("intermediate sentinel"));
        assert!(html.contains("Project note &lt;script&gt;bad()&lt;/script&gt;"));
        let minimal =
            render_html(&pack, &RenderOptions { level: crate::brief::ContextLevel::Minimal, ..Default::default() });
        assert!(!minimal.contains("intermediate sentinel"));
        assert!(minimal.contains("latest request") && minimal.contains("Project note"));
    }
}

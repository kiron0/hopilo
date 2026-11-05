use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use crate::model::Pack;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub kind: &'static str,

    pub preview: String,

    pub location: String,
}

fn patterns() -> &'static [(&'static str, Regex)] {
    static P: OnceLock<Vec<(&'static str, Regex)>> = OnceLock::new();
    P.get_or_init(|| {
        [
            ("Private key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
            ("Anthropic API key", r"sk-ant-[A-Za-z0-9_\-]{20,}"),
            ("OpenAI-style API key", r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}"),
            ("GitHub token", r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
            ("AWS access key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
            ("Google API key", r"\bAIza[0-9A-Za-z_\-]{35}\b"),
            ("Slack token", r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
            ("JWT", r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
            (
                "Secret assignment",
                r#"(?i)\b(?:password|passwd|secret|api_key|apikey|token)\s*[:=]\s*["']?[^\s"']{8,}"#,
            ),
            ("Email address", r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
        ]
        .into_iter()
        .map(|(k, p)| (k, Regex::new(p).expect("valid pattern")))
        .collect()
    })
}

fn mask(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= 8 {
        return "•".repeat(chars.len());
    }
    let head: String = chars[..4].iter().collect();
    format!("{head}{}", "•".repeat(8))
}

pub fn scan_text(text: &str, location: &str, out: &mut Vec<Finding>) {
    for (kind, re) in patterns() {
        for m in re.find_iter(text).take(5) {
            out.push(Finding { kind, preview: mask(m.as_str()), location: location.to_string() });
        }
    }
}

pub fn scan_pack(pack: &Pack, only: Option<&std::collections::HashSet<String>>) -> Vec<Finding> {
    const LIMIT: usize = 100;
    let mut out = Vec::new();
    'messages: for m in &pack.messages {
        if only.is_some_and(|sel| !sel.contains(&m.id)) {
            continue;
        }
        for b in &m.blocks {
            if out.len() >= LIMIT {
                break 'messages;
            }
            scan_text(b.plain_text(), &m.id, &mut out);
        }
    }
    if out.len() < LIMIT {
        if let Some(n) = &pack.context.note {
            scan_text(n, "note", &mut out);
        }
    }
    for a in &pack.attachments {
        if out.len() >= LIMIT {
            break;
        }
        if let Some(t) = &a.text {
            scan_text(t, &format!("attachment:{}", a.id), &mut out);
        }
    }
    out.truncate(LIMIT);
    out
}

pub fn redact_text(text: &str) -> String {
    let mut out = text.to_string();
    for (kind, re) in patterns() {
        out = re.replace_all(&out, |_: &regex::Captures| format!("[REDACTED: {kind}]")).to_string();
    }
    out
}

pub fn redact_pack(pack: &mut Pack) {
    for m in &mut pack.messages {
        for b in &mut m.blocks {
            match b {
                crate::model::Block::Text { text } => *text = redact_text(text),
                crate::model::Block::ToolCall { input, .. } => *input = redact_text(input),
                crate::model::Block::ToolResult { output, .. } => *output = redact_text(output),
                _ => {}
            }
        }
    }
    if let Some(note) = &mut pack.context.note {
        *note = redact_text(note);
    }
    for a in &mut pack.attachments {
        if let Some(t) = &mut a.text {
            *t = redact_text(t);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_and_masks_keys() {
        let mut f = Vec::new();
        scan_text("key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz", "m1", &mut f);
        assert!(f.iter().any(|x| x.kind == "Anthropic API key"));
        assert!(f.iter().all(|x| !x.preview.contains("abcdefghij")));
    }

    #[test]
    fn plain_code_is_clean() {
        let mut f = Vec::new();
        scan_text("fn main() { println!(\"hi\"); }", "m1", &mut f);
        assert!(f.is_empty());
    }

    #[test]
    fn redacts_secrets() {
        let raw = "Use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz or contact admin@example.com";
        let cleaned = redact_text(raw);
        assert!(!cleaned.contains("sk-ant"));
        assert!(!cleaned.contains("admin@example.com"));
        assert!(cleaned.contains("[REDACTED: Anthropic API key]"));
        assert!(cleaned.contains("[REDACTED: Email address]"));
    }
}

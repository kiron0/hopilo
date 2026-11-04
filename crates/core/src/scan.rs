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
    let mut out = Vec::new();
    for m in &pack.messages {
        if only.is_some_and(|sel| !sel.contains(&m.id)) {
            continue;
        }
        for b in &m.blocks {
            scan_text(b.plain_text(), &m.id, &mut out);
        }
    }
    if let Some(n) = &pack.context.note {
        scan_text(n, "note", &mut out);
    }
    for a in &pack.attachments {
        if let Some(t) = &a.text {
            scan_text(t, &format!("attachment:{}", a.id), &mut out);
        }
    }
    out.truncate(100);
    out
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
}

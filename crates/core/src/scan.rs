use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::{Attachment, Pack};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub kind: String,

    pub preview: String,

    pub location: String,

    pub fingerprint: String,

    pub count: usize,

    pub custom: bool,
}

pub const BUILTIN_KINDS: &[&str] = &[
    "Private key",
    "Anthropic API key",
    "OpenAI-style API key",
    "GitHub token",
    "AWS access key",
    "Google API key",
    "Slack token",
    "JWT",
    "Connection string",
    "Secret assignment",
    "Email address",
];

fn builtin_patterns() -> &'static [(&'static str, Regex)] {
    static P: OnceLock<Vec<(&'static str, Regex)>> = OnceLock::new();
    P.get_or_init(|| {
        [
            ("Private key", r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\z)"),
            ("Anthropic API key", r"sk-ant-[A-Za-z0-9_\-]{20,}"),
            ("OpenAI-style API key", r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}"),
            ("GitHub token", r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
            ("AWS access key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
            ("Google API key", r"\bAIza[0-9A-Za-z_\-]{35}\b"),
            ("Slack token", r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
            ("JWT", r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
            (
                "Connection string",
                r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver)://[^\s:/@]+:[^\s@/]+@[^\s'`]+",
            ),
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomPattern {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub pattern: String,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedactionRules {
    #[serde(default)]
    pub patterns: Vec<CustomPattern>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub exclude_paths: Vec<String>,
    #[serde(default)]
    pub disabled_builtins: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuleError {
    pub name: String,
    pub error: String,
}

pub fn compile_pattern(pattern: &str) -> Result<Regex, String> {
    if pattern.trim().is_empty() {
        return Err("The pattern is empty".into());
    }
    let re = RegexBuilder::new(pattern)
        .size_limit(1 << 20)
        .dfa_size_limit(1 << 20)
        .build()
        .map_err(|e| e.to_string().lines().last().unwrap_or("Invalid pattern").trim().to_string())?;
    if re.is_match("") {
        return Err("The pattern matches empty text, so it would match everywhere".into());
    }
    Ok(re)
}

fn keyword_regex(word: &str) -> Option<Regex> {
    let w = word.trim();
    if w.chars().count() < 2 {
        return None;
    }
    let escaped = regex::escape(w);
    let starts = w.chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_');
    let ends = w.chars().last().is_some_and(|c| c.is_alphanumeric() || c == '_');
    let pat = format!("(?i){}{}{}", if starts { r"\b" } else { "" }, escaped, if ends { r"\b" } else { "" });
    Regex::new(&pat).ok()
}

pub fn fingerprint(matched: &str) -> String {
    hex::encode(&Sha256::digest(matched.as_bytes())[..8])
}

fn mask(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= 8 {
        return "•".repeat(chars.len());
    }
    let head: String = chars[..4].iter().collect();
    format!("{head}{}", "•".repeat(8))
}

struct Rule {
    kind: String,
    re: Regex,
    custom: bool,
}

pub struct Redactor {
    rules: Vec<Rule>,
    ignore: HashSet<String>,
    excludes: Vec<String>,
}

impl Default for Redactor {
    fn default() -> Self {
        Self::builtin()
    }
}

impl Redactor {
    pub fn builtin() -> Self {
        Self::new(&RedactionRules::default(), std::iter::empty()).0
    }

    pub fn new(rules: &RedactionRules, ignore: impl IntoIterator<Item = String>) -> (Self, Vec<RuleError>) {
        let disabled: HashSet<&str> = rules.disabled_builtins.iter().map(String::as_str).collect();
        let mut out: Vec<Rule> = builtin_patterns()
            .iter()
            .filter(|(k, _)| !disabled.contains(k))
            .map(|(k, re)| Rule { kind: (*k).to_string(), re: re.clone(), custom: false })
            .collect();
        let mut errors = Vec::new();
        for p in rules.patterns.iter().filter(|p| p.enabled) {
            let name = if p.name.trim().is_empty() { "Custom pattern".to_string() } else { p.name.trim().to_string() };
            match compile_pattern(&p.pattern) {
                Ok(re) => out.push(Rule { kind: name, re, custom: true }),
                Err(error) => errors.push(RuleError { name, error }),
            }
        }
        for w in &rules.keywords {
            if let Some(re) = keyword_regex(w) {
                out.push(Rule { kind: "Blocked keyword".into(), re, custom: true });
            }
        }
        let excludes = rules.exclude_paths.iter().map(|g| g.trim().to_string()).filter(|g| !g.is_empty()).collect();
        (Self { rules: out, ignore: ignore.into_iter().collect(), excludes }, errors)
    }

    pub fn scan_text(&self, text: &str, location: &str, out: &mut Vec<Finding>) {
        for rule in &self.rules {
            for m in rule.re.find_iter(text).take(20) {
                let fp = fingerprint(m.as_str());
                if let Some(f) = out.iter_mut().find(|f| f.fingerprint == fp && f.kind == rule.kind) {
                    f.count += 1;
                    continue;
                }
                out.push(Finding {
                    kind: rule.kind.clone(),
                    preview: mask(m.as_str()),
                    location: location.to_string(),
                    fingerprint: fp,
                    count: 1,
                    custom: rule.custom,
                });
            }
        }
    }

    pub fn scan_pack(&self, pack: &Pack, only: Option<&HashSet<String>>) -> Vec<Finding> {
        const LIMIT: usize = 200;
        let mut out = Vec::new();
        'messages: for m in &pack.messages {
            if only.is_some_and(|sel| !sel.contains(&m.id)) {
                continue;
            }
            for b in &m.blocks {
                if out.len() >= LIMIT {
                    break 'messages;
                }
                self.scan_text(b.plain_text(), &m.id, &mut out);
            }
        }
        let context = &pack.context;
        for text in std::iter::once(pack.title.as_str())
            .chain(context.note.as_deref())
            .chain(context.goal.as_deref())
            .chain(context.current_state.as_deref())
            .chain(context.decisions.iter().map(String::as_str))
            .chain(context.constraints.iter().map(String::as_str))
            .chain(context.next_steps.iter().map(String::as_str))
            .chain(pack.tags.iter().map(String::as_str))
            .chain(pack.sources.iter().flat_map(|s| {
                std::iter::once(s.title.as_str())
                    .chain(s.origin.as_deref())
                    .chain(s.project.as_deref())
                    .chain(s.model.as_deref())
                    .chain(s.missing_items.iter().map(String::as_str))
            }))
        {
            if out.len() >= LIMIT {
                break;
            }
            self.scan_text(text, "context", &mut out);
        }
        for a in &pack.attachments {
            if out.len() >= LIMIT {
                break;
            }
            if let Some(t) = &a.text {
                self.scan_text(t, &format!("attachment:{}", a.id), &mut out);
            }
            self.scan_text(&a.file_name, &format!("attachment:{}", a.id), &mut out);
        }
        out.truncate(LIMIT);
        out
    }

    pub fn redact_text(&self, text: &str) -> String {
        self.redact_cow(text).into_owned()
    }

    pub fn redact_cow<'t>(&self, text: &'t str) -> std::borrow::Cow<'t, str> {
        let mut out = std::borrow::Cow::Borrowed(text);
        for rule in &self.rules {
            if !rule.re.is_match(&out) {
                continue;
            }
            let replaced = rule.re.replace_all(&out, |c: &regex::Captures| {
                let m = &c[0];
                if self.ignore.contains(&fingerprint(m)) {
                    m.to_string()
                } else {
                    format!("[REDACTED: {}]", rule.kind)
                }
            });
            if let std::borrow::Cow::Owned(next) = replaced {
                if next != *out {
                    out = std::borrow::Cow::Owned(next);
                }
            }
        }
        out
    }

    fn redact_in_place(&self, text: &mut String) {
        if let std::borrow::Cow::Owned(next) = self.redact_cow(text) {
            *text = next;
        }
    }

    pub fn redact_pack(&self, pack: &mut Pack) {
        for m in &mut pack.messages {
            for b in &mut m.blocks {
                match b {
                    crate::model::Block::Text { text } => self.redact_in_place(text),
                    crate::model::Block::ToolCall { name, input } => {
                        self.redact_in_place(name);
                        self.redact_in_place(input);
                    }
                    crate::model::Block::ToolResult { name, output, .. } => {
                        if let Some(name) = name {
                            self.redact_in_place(name);
                        }
                        self.redact_in_place(output);
                    }
                    crate::model::Block::Missing { description } => self.redact_in_place(description),
                    crate::model::Block::File { name, .. } => self.redact_in_place(name),
                }
            }
        }
        self.redact_in_place(&mut pack.title);
        let context = &mut pack.context;
        for text in context
            .note
            .iter_mut()
            .chain(context.goal.iter_mut())
            .chain(context.current_state.iter_mut())
            .chain(context.decisions.iter_mut())
            .chain(context.constraints.iter_mut())
            .chain(context.next_steps.iter_mut())
            .chain(pack.tags.iter_mut())
        {
            self.redact_in_place(text);
        }
        for source in &mut pack.sources {
            self.redact_in_place(&mut source.title);
            for text in source
                .origin
                .iter_mut()
                .chain(source.project.iter_mut())
                .chain(source.model.iter_mut())
                .chain(source.missing_items.iter_mut())
            {
                self.redact_in_place(text);
            }
        }
        for a in &mut pack.attachments {
            self.redact_in_place(&mut a.file_name);
            if let Some(path) = &mut a.origin_path {
                self.redact_in_place(path);
            }
            if let Some(t) = &mut a.text {
                self.redact_in_place(t);
            }
        }
    }

    pub fn is_excluded(&self, a: &Attachment) -> bool {
        self.excludes
            .iter()
            .any(|g| glob_match(g, &a.file_name) || a.origin_path.as_deref().is_some_and(|p| path_matches(g, p)))
    }

    pub fn drop_excluded(&self, pack: &mut Pack) -> Vec<String> {
        if self.excludes.is_empty() {
            return Vec::new();
        }
        let (dropped, kept): (Vec<_>, Vec<_>) =
            std::mem::take(&mut pack.attachments).into_iter().partition(|a| self.is_excluded(a));
        pack.attachments = kept;
        let gone: HashSet<&str> = dropped.iter().map(|a| a.sha256.as_str()).collect();
        for m in &mut pack.messages {
            for b in &mut m.blocks {
                if let crate::model::Block::File { name, sha256, .. } = b {
                    if gone.contains(sha256.as_str()) {
                        *b = crate::model::Block::Missing {
                            description: format!("{name} (left out by your exclusion rules)"),
                        };
                    }
                }
            }
        }
        dropped.into_iter().map(|a| a.file_name).collect()
    }
}

fn path_matches(glob: &str, path: &str) -> bool {
    let path = path.replace('\\', "/");
    if glob_match(glob, &path) {
        return true;
    }
    let parts: Vec<&str> = path.split('/').collect();
    (1..parts.len()).any(|i| glob_match(glob, &parts[i..].join("/")))
}

pub fn glob_match(glob: &str, text: &str) -> bool {
    let g: Vec<char> = glob.to_lowercase().replace('\\', "/").chars().collect();
    let t: Vec<char> = text.to_lowercase().replace('\\', "/").chars().collect();
    let mut memo: HashMap<(usize, usize), bool> = HashMap::new();
    fn go(g: &[char], t: &[char], gi: usize, ti: usize, memo: &mut HashMap<(usize, usize), bool>) -> bool {
        if let Some(v) = memo.get(&(gi, ti)) {
            return *v;
        }
        let r = if gi == g.len() {
            ti == t.len()
        } else if g[gi] == '*' {
            let double = g.get(gi + 1) == Some(&'*');
            let next = if double { gi + 2 } else { gi + 1 };
            let next = if double && g.get(next) == Some(&'/') { next + 1 } else { next };
            (ti..=t.len()).take_while(|&k| double || k == ti || t[k - 1] != '/').any(|k| go(g, t, next, k, memo))
        } else if ti < t.len() && (g[gi] == '?' && t[ti] != '/' || g[gi] == t[ti]) {
            go(g, t, gi + 1, ti + 1, memo)
        } else {
            false
        };
        memo.insert((gi, ti), r);
        r
    }
    go(&g, &t, 0, 0, &mut memo)
}

pub fn scan_text(text: &str, location: &str, out: &mut Vec<Finding>) {
    Redactor::builtin().scan_text(text, location, out)
}

pub fn scan_pack(pack: &Pack, only: Option<&HashSet<String>>) -> Vec<Finding> {
    Redactor::builtin().scan_pack(pack, only)
}

pub fn redact_text(text: &str) -> String {
    Redactor::builtin().redact_text(text)
}

pub fn redact_pack(pack: &mut Pack) {
    Redactor::builtin().redact_pack(pack)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuleTest {
    pub matches: Vec<String>,
    pub error: Option<String>,
}

pub fn test_rule(pattern: &str, keyword: bool, sample: &str) -> RuleTest {
    let re = if keyword {
        keyword_regex(pattern).ok_or_else(|| "Keywords need at least 2 characters".to_string())
    } else {
        compile_pattern(pattern)
    };
    match re {
        Ok(re) => {
            RuleTest { matches: re.find_iter(sample).take(20).map(|m| m.as_str().to_string()).collect(), error: None }
        }
        Err(e) => RuleTest { matches: vec![], error: Some(e) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redaction_only_allocates_when_text_changes() {
        let red = Redactor::builtin();
        assert!(matches!(red.redact_cow("plain words"), std::borrow::Cow::Borrowed(_)));
        let changed = red.redact_cow("mail admin@example.com now");
        assert!(matches!(changed, std::borrow::Cow::Owned(_)));
        assert_eq!(changed, "mail [REDACTED: Email address] now");
        let (kept, _) = Redactor::new(&RedactionRules::default(), [fingerprint("admin@example.com")]);
        assert!(matches!(kept.redact_cow("mail admin@example.com"), std::borrow::Cow::Borrowed(_)));
    }

    #[test]
    fn redacts_private_key_body_including_truncated_pem() {
        for kind in ["", "RSA ", "EC ", "OPENSSH ", "ENCRYPTED "] {
            let header = format!("-----BEGIN {kind}PRIVATE KEY-----");
            let complete = format!("before\n{header}\nSENSITIVE_BASE64\n-----END {kind}PRIVATE KEY-----\nafter");
            assert_eq!(redact_text(&complete), "before\n[REDACTED: Private key]\nafter");
            assert_eq!(redact_text(&format!("{header}\nSENSITIVE_BASE64")), "[REDACTED: Private key]");
        }
    }

    #[test]
    fn scans_and_redacts_metadata_missing_blocks_and_context() {
        let mut pack: Pack = serde_json::from_value(serde_json::json!({
            "schemaVersion": "1.0.0", "packId": "p", "title": "admin@example.com", "version": 0,
            "createdAt": "", "mode": "full", "sources": [],
            "messages": [{ "id": "m", "sourceId": "s", "role": "user", "blocks": [
                { "type": "missing", "description": "admin@example.com" },
                { "type": "file", "name": "admin@example.com", "mediaType": "text/plain", "size": 0, "sha256": "a".repeat(64) }
            ] }],
            "context": { "goal": "admin@example.com", "decisions": ["admin@example.com"], "nextSteps": ["admin@example.com"] },
            "tags": ["admin@example.com"]
        })).unwrap();
        let redactor = Redactor::builtin();
        assert!(!redactor.scan_pack(&pack, None).is_empty());
        redactor.redact_pack(&mut pack);
        assert!(!serde_json::to_string(&pack).unwrap().contains("admin@example.com"));
        assert!(redactor.scan_pack(&pack, None).is_empty());
    }

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

    #[test]
    fn repeated_values_collapse_into_one_finding() {
        let mut f = Vec::new();
        let r = Redactor::builtin();
        r.scan_text("a@b.io and a@b.io and c@d.io", "m1", &mut f);
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].count, 2);
    }

    #[test]
    fn custom_rules_keywords_and_ignore() {
        let rules = RedactionRules {
            patterns: vec![
                CustomPattern {
                    id: "1".into(),
                    name: "Internal token".into(),
                    pattern: r"acme_[a-z0-9]{8}".into(),
                    enabled: true,
                },
                CustomPattern { id: "2".into(), name: "Broken".into(), pattern: "(".into(), enabled: true },
            ],
            keywords: vec!["Project Falcon".into()],
            exclude_paths: vec![],
            disabled_builtins: vec!["Email address".into()],
        };
        let keep = fingerprint("acme_zzzz9999");
        let (r, errors) = Redactor::new(&rules, [keep]);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].name, "Broken");
        let out = r.redact_text("project falcon uses acme_abcd1234 and acme_zzzz9999, mail me@x.io");
        assert!(out.contains("[REDACTED: Blocked keyword]"));
        assert!(out.contains("[REDACTED: Internal token]"));
        assert!(out.contains("acme_zzzz9999"), "ignored value kept");
        assert!(out.contains("me@x.io"), "disabled builtin skipped");
    }

    #[test]
    fn connection_strings_are_caught() {
        assert!(redact_text("DATABASE_URL=postgres://app:hunter22@db.internal:5432/app")
            .contains("[REDACTED: Connection string]"));
    }

    #[test]
    fn empty_matching_patterns_are_rejected() {
        assert!(compile_pattern("a*").is_err());
        assert!(compile_pattern("").is_err());
        assert!(compile_pattern("x+").is_ok());
    }

    #[test]
    fn globs() {
        assert!(glob_match("*.pem", "server.pem"));
        assert!(glob_match("*.env*", ".env.local"));
        assert!(!glob_match("*.pem", "keys/server.pem"));
        assert!(path_matches("*.pem", "/home/u/keys/server.pem"));
        assert!(path_matches("deploy/config.json", "/repo/deploy/config.json"));
        assert!(glob_match("**/secrets/*", "a/b/secrets/x.txt"));
        assert!(!glob_match("deploy/*.json", "deploy/x/config.json"));
    }
}

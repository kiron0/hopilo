use std::borrow::Cow;
use std::collections::HashSet;
use std::sync::OnceLock;

use regex::{Regex, RegexBuilder, RegexSet, RegexSetBuilder};
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
    "Auth header",
    "Secret assignment",
    "Email address",
];

fn builtin_patterns() -> &'static [(&'static str, Regex)] {
    static P: OnceLock<Vec<(&'static str, Regex)>> = OnceLock::new();
    P.get_or_init(|| {
        [
            (
                "Private key",
                r"(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----.*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|\z)",
            ),
            ("Anthropic API key", r"sk-ant-[A-Za-z0-9_\-]{20,}"),
            ("OpenAI-style API key", r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}"),
            ("GitHub token", r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
            ("AWS access key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
            ("Google API key", r"\bAIza[0-9A-Za-z_\-]{35}\b"),
            ("Slack token", r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
            ("JWT", r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
            (
                "Connection string",
                r#"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver)://[^\s:/@]*:[^\s@/]+@[^\s'`"]+"#,
            ),
            (
                "Auth header",
                r"(?i)\b(?:Authorization\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,})",
            ),
            (
                "Secret assignment",
                r#"(?i)\b(?:password|passwd|secret|api_?key|access_?token|auth_?token|token)["']?\s*[:=]\s*["']?[^\[\s"',}\]]{8,}"#,
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
    let mut chars = s.chars();
    let mut head = String::with_capacity(4);
    let mut count = 0usize;
    for c in chars.by_ref().take(9) {
        if count < 4 {
            head.push(c);
        }
        count += 1;
    }
    if count <= 8 {
        return "•".repeat(count);
    }
    format!("{head}••••••••")
}

#[derive(Clone)]
struct Rule {
    kind: String,
    re: Regex,
    custom: bool,
}

#[derive(Clone)]
pub struct Redactor {
    rules: Vec<Rule>,
    set: Option<RegexSet>,
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
        Self::builtin_ref().clone()
    }

    pub fn builtin_ref() -> &'static Self {
        static BUILTIN: OnceLock<Redactor> = OnceLock::new();
        BUILTIN.get_or_init(|| Self::new(&RedactionRules::default(), std::iter::empty()).0)
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
        let set = RegexSetBuilder::new(out.iter().map(|r| r.re.as_str()))
            .size_limit(4 << 20)
            .dfa_size_limit(4 << 20)
            .build()
            .ok();
        let excludes = rules.exclude_paths.iter().map(|g| g.trim().to_string()).filter(|g| !g.is_empty()).collect();
        (Self { rules: out, set, ignore: ignore.into_iter().collect(), excludes }, errors)
    }

    pub fn with_ignore(mut self, ignore: impl IntoIterator<Item = String>) -> Self {
        self.ignore = ignore.into_iter().collect();
        self
    }

    pub fn scan_text(&self, text: &str, location: &str, out: &mut Vec<Finding>) {
        if text.is_empty() || self.rules.is_empty() {
            return;
        }
        let matches = self.set.as_ref().map(|s| s.matches(text));
        if matches.as_ref().is_some_and(|m| !m.matched_any()) {
            return;
        }
        for (idx, rule) in self.rules.iter().enumerate() {
            if matches.as_ref().is_some_and(|m| !m.matched(idx)) {
                continue;
            }
            for m in rule.re.find_iter(text).take(20) {
                let fp = fingerprint(m.as_str());
                if !self.ignore.is_empty() && self.ignore.contains(&fp) {
                    continue;
                }
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
            let loc = format!("attachment:{}", a.id);
            if let Some(t) = &a.text {
                self.scan_text(t, &loc, &mut out);
            }
            self.scan_text(&a.file_name, &loc, &mut out);
        }
        out.truncate(LIMIT);
        out
    }

    pub fn redact_text(&self, text: &str) -> String {
        self.redact_cow(text).into_owned()
    }

    pub fn redact_cow<'t>(&self, text: &'t str) -> Cow<'t, str> {
        self.redact_cow_counted(text).0
    }

    pub fn redact_cow_counted<'t>(&self, text: &'t str) -> (Cow<'t, str>, usize) {
        if text.is_empty() || self.rules.is_empty() {
            return (Cow::Borrowed(text), 0);
        }
        let matches = self.set.as_ref().map(|s| s.matches(text));
        if matches.as_ref().is_some_and(|m| !m.matched_any()) {
            return (Cow::Borrowed(text), 0);
        }

        #[derive(Clone, Copy)]
        struct Span {
            start: usize,
            end: usize,
            rule_idx: usize,
        }

        let mut spans = Vec::new();
        for (rule_idx, rule) in self.rules.iter().enumerate() {
            if matches.as_ref().is_some_and(|m| !m.matched(rule_idx)) {
                continue;
            }
            for m in rule.re.find_iter(text) {
                if m.start() == m.end() {
                    continue;
                }
                if !self.ignore.is_empty() && self.ignore.contains(&fingerprint(m.as_str())) {
                    continue;
                }
                spans.push(Span { start: m.start(), end: m.end(), rule_idx });
            }
        }
        if spans.is_empty() {
            return (Cow::Borrowed(text), 0);
        }

        spans.sort_unstable_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)).then(a.rule_idx.cmp(&b.rule_idx)));
        let mut merged: Vec<Span> = Vec::with_capacity(spans.len());
        for s in spans {
            if let Some(last) = merged.last_mut() {
                if s.start < last.end {
                    if s.end > last.end {
                        last.end = s.end;
                    }
                    if s.rule_idx < last.rule_idx {
                        last.rule_idx = s.rule_idx;
                    }
                    continue;
                }
            }
            merged.push(s);
        }

        let count = merged.len();
        let mut out = String::with_capacity(text.len());
        let mut cursor = 0;
        for s in merged {
            out.push_str(&text[cursor..s.start]);
            out.push_str("[REDACTED: ");
            out.push_str(&self.rules[s.rule_idx].kind);
            out.push(']');
            cursor = s.end;
        }
        out.push_str(&text[cursor..]);
        (Cow::Owned(out), count)
    }

    fn redact_in_place(&self, text: &mut String) -> usize {
        let (cow, count) = self.redact_cow_counted(text);
        if let Cow::Owned(next) = cow {
            *text = next;
        }
        count
    }

    pub fn redact_pack(&self, pack: &mut Pack) -> usize {
        let mut total = 0;
        for m in &mut pack.messages {
            for b in &mut m.blocks {
                match b {
                    crate::model::Block::Text { text } => total += self.redact_in_place(text),
                    crate::model::Block::ToolCall { name, input } => {
                        total += self.redact_in_place(name);
                        total += self.redact_in_place(input);
                    }
                    crate::model::Block::ToolResult { name, output, .. } => {
                        if let Some(name) = name {
                            total += self.redact_in_place(name);
                        }
                        total += self.redact_in_place(output);
                    }
                    crate::model::Block::Missing { description } => total += self.redact_in_place(description),
                    crate::model::Block::File { name, .. } => total += self.redact_in_place(name),
                }
            }
        }
        total += self.redact_in_place(&mut pack.title);
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
            total += self.redact_in_place(text);
        }
        for source in &mut pack.sources {
            total += self.redact_in_place(&mut source.title);
            for text in source
                .origin
                .iter_mut()
                .chain(source.project.iter_mut())
                .chain(source.model.iter_mut())
                .chain(source.missing_items.iter_mut())
            {
                total += self.redact_in_place(text);
            }
        }
        for a in &mut pack.attachments {
            total += self.redact_in_place(&mut a.file_name);
            if let Some(path) = &mut a.origin_path {
                total += self.redact_in_place(path);
            }
            if let Some(t) = &mut a.text {
                total += self.redact_in_place(t);
            }
        }
        total
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
        let kept_shas: HashSet<String> = pack.attachments.iter().map(|a| a.sha256.to_ascii_lowercase()).collect();
        let gone_pairs: HashSet<(String, &str)> =
            dropped.iter().map(|a| (a.sha256.to_ascii_lowercase(), a.file_name.as_str())).collect();
        let gone_shas: HashSet<String> =
            dropped.iter().map(|a| a.sha256.to_ascii_lowercase()).filter(|s| !kept_shas.contains(s)).collect();
        for m in &mut pack.messages {
            for b in &mut m.blocks {
                if let crate::model::Block::File { name, sha256, .. } = b {
                    let sha_lower = sha256.to_ascii_lowercase();
                    if gone_pairs.contains(&(sha_lower.clone(), name.as_str())) || gone_shas.contains(&sha_lower) {
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
    let owned;
    let path = if path.contains('\\') {
        owned = path.replace('\\', "/");
        owned.as_str()
    } else {
        path
    };
    if glob_match(glob, path) {
        return true;
    }
    path.match_indices('/').any(|(idx, _)| glob_match(glob, &path[idx + 1..]))
}

#[inline]
fn norm_glob_ascii(b: u8) -> u8 {
    if b == b'\\' {
        b'/'
    } else {
        b.to_ascii_lowercase()
    }
}

pub fn glob_match(glob: &str, text: &str) -> bool {
    if glob.is_ascii() && text.is_ascii() {
        return glob_match_slice(glob.as_bytes(), text.as_bytes(), |&b| norm_glob_ascii(b), b'*', b'?', b'/');
    }
    let g: Vec<char> = glob.to_lowercase().chars().map(|c| if c == '\\' { '/' } else { c }).collect();
    let t: Vec<char> = text.to_lowercase().chars().map(|c| if c == '\\' { '/' } else { c }).collect();
    glob_match_slice(&g, &t, |&c| c, '*', '?', '/')
}

fn glob_match_slice<T: PartialEq>(g: &[T], t: &[T], norm: impl Fn(&T) -> T, star: T, qmark: T, slash: T) -> bool {
    let tn = t.len();
    let mut rows = [vec![false; tn + 1], vec![false; tn + 1], vec![false; tn + 1], vec![false; tn + 1]];
    rows[g.len() % 4][tn] = true;
    for gi in (0..g.len()).rev() {
        let cur_idx = gi % 4;
        if norm(&g[gi]) == star {
            let double = g.get(gi + 1).is_some_and(|c| norm(c) == star);
            let mut next = if double { gi + 2 } else { gi + 1 };
            if double && g.get(next).is_some_and(|c| norm(c) == slash) {
                next += 1;
            }
            let next_idx = next % 4;
            rows[cur_idx][tn] = rows[next_idx][tn];
            for ti in (0..tn).rev() {
                rows[cur_idx][ti] = rows[next_idx][ti] || ((double || norm(&t[ti]) != slash) && rows[cur_idx][ti + 1]);
            }
        } else {
            let next_idx = (gi + 1) % 4;
            rows[cur_idx][tn] = false;
            let gc = norm(&g[gi]);
            for ti in 0..tn {
                let tc = norm(&t[ti]);
                rows[cur_idx][ti] = (gc == qmark && tc != slash || gc == tc) && rows[next_idx][ti + 1];
            }
        }
    }
    rows[0][0]
}

pub fn scan_text(text: &str, location: &str, out: &mut Vec<Finding>) {
    Redactor::builtin_ref().scan_text(text, location, out)
}

pub fn scan_pack(pack: &Pack, only: Option<&HashSet<String>>) -> Vec<Finding> {
    Redactor::builtin_ref().scan_pack(pack, only)
}

pub fn redact_text(text: &str) -> String {
    Redactor::builtin_ref().redact_text(text)
}

pub fn redact_pack(pack: &mut Pack) -> usize {
    Redactor::builtin_ref().redact_pack(pack)
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
        assert!(glob_match("**/foo/*.pem", "foo/bar/foo/x.pem"));
        assert!(path_matches("*.pem", r"C:\repo\keys\server.pem"));
    }

    #[test]
    fn ignored_findings_are_omitted_and_redacted_tags_not_double_scanned() {
        let keep = fingerprint("admin@example.com");
        let rules = RedactionRules { keywords: vec!["Email address".into(), "Anthropic".into()], ..Default::default() };
        let (r, errors) = Redactor::new(&rules, [keep]);
        assert!(errors.is_empty());
        let mut f = Vec::new();
        r.scan_text("mail admin@example.com and other@example.com", "m1", &mut f);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].count, 1);

        let redacted = r.redact_text("use sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
        assert_eq!(redacted, "use [REDACTED: Anthropic API key]");
    }

    #[test]
    fn catches_pgp_json_auth_header_and_password_only_url() {
        assert_eq!(
            redact_text("-----BEGIN PGP PRIVATE KEY BLOCK-----\nabc\n-----END PGP PRIVATE KEY BLOCK-----"),
            "[REDACTED: Private key]"
        );
        assert!(redact_text(r#"{"api_key": "super_secret_key_123"}"#).contains("[REDACTED: Secret assignment]"));
        assert!(redact_text("Authorization: Bearer abcdefghijkl").contains("[REDACTED: Auth header]"));
        assert!(redact_text("REDIS=REDIS://:hunter22@cache.internal:6379").contains("[REDACTED: Connection string]"));
    }

    #[test]
    fn drop_excluded_preserves_kept_attachment_with_same_sha() {
        let mut pack: Pack = serde_json::from_value(serde_json::json!({
            "schemaVersion": "1.0.0", "packId": "p", "title": "t", "version": 0,
            "createdAt": "", "mode": "full", "sources": [],
            "messages": [{ "id": "m", "sourceId": "s", "role": "user", "blocks": [
                { "type": "file", "name": ".env.local", "mediaType": "text/plain", "size": 5, "sha256": "abc" },
                { "type": "file", "name": "public.txt", "mediaType": "text/plain", "size": 5, "sha256": "abc" }
            ] }],
            "attachments": [
                { "id": "1", "fileName": ".env.local", "mediaType": "text/plain", "size": 5, "sha256": "ABC" },
                { "id": "2", "fileName": "public.txt", "mediaType": "text/plain", "size": 5, "sha256": "abc" }
            ]
        }))
        .unwrap();
        let (r, _) = Redactor::new(&RedactionRules { exclude_paths: vec!["*.env*".into()], ..Default::default() }, []);
        let dropped = r.drop_excluded(&mut pack);
        assert_eq!(dropped, vec![".env.local"]);
        assert!(matches!(pack.messages[0].blocks[0], crate::model::Block::Missing { .. }));
        assert!(
            matches!(pack.messages[0].blocks[1], crate::model::Block::File { ref name, .. } if name == "public.txt")
        );
        assert_eq!(redact_pack(&mut pack), 0);
    }
}

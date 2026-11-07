use std::collections::HashSet;
use std::fmt::Write;
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use crate::model::{Block, Message, Role};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContextLevel {

    #[default]
    Full,

    Balanced,

    Minimal,
}

pub const BALANCED_RECENT: usize = 12;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyReferences {
    pub files: Vec<String>,
    pub commands: Vec<String>,
    pub errors: Vec<String>,
}

const SHELL_TOOLS: &[&str] = &["bash", "shell", "run_shell_command", "exec", "exec_command", "terminal", "local_shell"];

fn path_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(
            r"(?:^|[\s`'(\[])((?:\.{0,2}/)?(?:[A-Za-z0-9_@.\-]+/)+[A-Za-z0-9_@.\-]+\.[A-Za-z0-9]{1,8}|[A-Za-z0-9_\-]+\.(?:rs|ts|tsx|js|jsx|mjs|py|go|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|md|json|jsonl|toml|yaml|yml|css|scss|html|sql|sh|lock|env))(?:[\s`'),:\]]|$)",
        )
        .expect("valid path pattern")
    })
}

fn error_line_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)^\s*(?:error\b|error\[|fatal:|panic|exception|traceback|\w*Error:|FAIL\b)").expect("valid error pattern"))
}

fn push_unique(list: &mut Vec<String>, seen: &mut HashSet<String>, v: String, cap: usize) {
    if list.len() < cap && !v.is_empty() && seen.insert(v.clone()) {
        list.push(v);
    }
}

fn command_from_input(input: &str) -> Option<String> {
    match serde_json::from_str::<serde_json::Value>(input) {
        Ok(v) => match v.get("command").or_else(|| v.get("cmd")) {
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            Some(serde_json::Value::Array(parts)) => {
                let words: Vec<&str> = parts.iter().filter_map(|p| p.as_str()).collect();

                if words.len() == 3 && words[1] == "-lc" {
                    Some(words[2].to_string())
                } else {
                    Some(words.join(" "))
                }
            }
            _ => None,
        },
        Err(_) => Some(input.trim().to_string()).filter(|s| !s.is_empty() && !s.contains('\n')),
    }
}

pub fn key_references(messages: &[&Message]) -> KeyReferences {
    let mut refs = KeyReferences::default();
    let (mut seen_f, mut seen_c, mut seen_e) = (HashSet::new(), HashSet::new(), HashSet::new());
    let mut commands = Vec::new();
    let mut errors = Vec::new();
    for m in messages {
        for b in &m.blocks {
            for cap in path_re().captures_iter(b.plain_text()) {
                let p = cap[1].trim_matches(|c| c == '.' || c == ',').to_string();
                if p.contains("://") || p.starts_with("www.") {
                    continue;
                }
                push_unique(&mut refs.files, &mut seen_f, p, 25);
            }
            match b {
                Block::ToolCall { name, input } if SHELL_TOOLS.contains(&name.to_lowercase().as_str()) => {
                    if let Some(c) = command_from_input(input) {
                        commands.push(c.trim().to_string());
                    }
                }
                Block::ToolResult { output, is_error, .. } => {
                    if *is_error {
                        if let Some(first) = output.lines().find(|l| !l.trim().is_empty()) {
                            errors.push(first.trim().to_string());
                        }
                    }
                    for l in output.lines().filter(|l| error_line_re().is_match(l)).take(3) {
                        errors.push(l.trim().to_string());
                    }
                }
                _ => {}
            }
        }
    }
    for c in commands.into_iter().rev() {
        push_unique(&mut refs.commands, &mut seen_c, c, 15);
    }
    refs.commands.reverse();
    for e in errors.into_iter().rev() {
        let e: String = e.chars().take(300).collect();
        push_unique(&mut refs.errors, &mut seen_e, e, 10);
    }
    refs.errors.reverse();
    refs
}

const EDIT_HINTS: &[&str] = &["edit", "write", "patch", "create", "replace", "insert", "multiedit", "str_replace"];

pub fn edited_files(messages: &[&Message]) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for m in messages {
        for b in &m.blocks {
            let Block::ToolCall { name, input } = b else { continue };
            let lower = name.to_lowercase();
            if !EDIT_HINTS.iter().any(|h| lower.contains(h)) {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(input) {
                for key in ["file_path", "filePath", "path", "target_file", "targetFile", "filename", "file"] {
                    if let Some(p) = v.get(key).and_then(|p| p.as_str()) {
                        push_unique(&mut out, &mut seen, p.trim().to_string(), 200);
                    }
                }
                if let Some(arr) = v.get("edits").and_then(|e| e.as_array()) {
                    for e in arr {
                        if let Some(p) = e.get("file_path").or_else(|| e.get("path")).and_then(|p| p.as_str()) {
                            push_unique(&mut out, &mut seen, p.trim().to_string(), 200);
                        }
                    }
                }
            }
            for line in input.lines() {
                for prefix in ["*** Update File: ", "*** Add File: ", "*** Delete File: "] {
                    if let Some(p) = line.trim().strip_prefix(prefix) {
                        push_unique(&mut out, &mut seen, p.trim().to_string(), 200);
                    }
                }
            }
        }
    }
    out
}

pub fn write_key_references(out: &mut String, refs: &KeyReferences) {
    if refs.files.is_empty() && refs.commands.is_empty() && refs.errors.is_empty() {
        return;
    }
    out.push_str("## Key references\n\n_Extracted verbatim from the conversation._\n\n");
    if !refs.files.is_empty() {
        out.push_str("**Files mentioned**\n\n");
        for f in &refs.files {
            let _ = writeln!(out, "- `{f}`");
        }
        out.push('\n');
    }
    if !refs.commands.is_empty() {
        out.push_str("**Commands run (most recent last)**\n\n");
        for c in &refs.commands {
            let _ = writeln!(out, "- `{}`", c.replace('`', "'"));
        }
        out.push('\n');
    }
    if !refs.errors.is_empty() {
        out.push_str("**Errors seen (most recent last)**\n\n");
        for e in &refs.errors {
            let _ = writeln!(out, "- `{}`", e.replace('`', "'"));
        }
        out.push('\n');
    }
}

pub fn excerpt(m: &Message, limit: usize) -> Option<String> {
    let text: String = m
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let para = text.split("\n\n").next().unwrap_or(text);
    let total = text.chars().count();
    let mut cut: String = para.chars().take(limit).collect();
    if cut.chars().count() < total {
        let _ = write!(cut, " [… {} more characters in the full transcript]", total - cut.chars().count());
    }
    Some(cut)
}

pub fn first_user<'a>(messages: &[&'a Message]) -> Option<&'a Message> {
    messages.iter().copied().find(|m| m.role == Role::User && m.has_text())
}

pub fn last_with<'a>(messages: &[&'a Message], role: Role) -> Option<&'a Message> {
    messages.iter().rev().copied().find(|m| m.role == role && m.has_text())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: Role, blocks: Vec<Block>) -> Message {
        Message { id: "x".into(), source_id: "s".into(), role, created_at: None, blocks }
    }

    #[test]
    fn extracts_paths_commands_and_errors_verbatim() {
        let a = msg(Role::User, vec![Block::text("Fix `src/auth/login.ts` and check Cargo.toml please")]);
        let b = msg(Role::Assistant, vec![Block::ToolCall { name: "Bash".into(), input: r#"{"command":"npm test -- login"}"#.into() }]);
        let c = msg(
            Role::Tool,
            vec![Block::ToolResult { name: None, output: "ok\nTypeError: x is undefined\n".into(), is_error: true }],
        );
        let d = msg(Role::Assistant, vec![Block::ToolCall { name: "shell".into(), input: r#"{"command":["bash","-lc","cargo build"]}"#.into() }]);
        let refs = key_references(&[&a, &b, &c, &d]);
        assert_eq!(refs.files, vec!["src/auth/login.ts", "Cargo.toml"]);
        assert_eq!(refs.commands, vec!["npm test -- login", "cargo build"]);
        assert!(refs.errors.contains(&"TypeError: x is undefined".to_string()));
        assert!(refs.errors.contains(&"ok".to_string()));
    }

    #[test]
    fn finds_edited_files_from_tool_calls() {
        let a = msg(Role::Assistant, vec![Block::ToolCall { name: "Edit".into(), input: r#"{"file_path":"/r/src/a.rs","old_string":"x"}"#.into() }]);
        let b = msg(Role::Assistant, vec![Block::ToolCall { name: "apply_patch".into(), input: "*** Begin Patch\n*** Update File: src/b.rs\n*** End Patch".into() }]);
        let c = msg(Role::Assistant, vec![Block::ToolCall { name: "Read".into(), input: r#"{"file_path":"/r/src/c.rs"}"#.into() }]);
        assert_eq!(edited_files(&[&a, &b, &c]), vec!["/r/src/a.rs", "src/b.rs"]);
    }

    #[test]
    fn urls_are_not_files() {
        let a = msg(Role::User, vec![Block::text("see https://example.com/docs/page.html now")]);
        assert!(key_references(&[&a]).files.is_empty());
    }

    #[test]
    fn excerpt_marks_cuts() {
        let a = msg(Role::Assistant, vec![Block::text("First para.\n\nSecond para.")]);
        let e = excerpt(&a, 400).unwrap();
        assert!(e.starts_with("First para."));
        assert!(e.contains("more characters in the full transcript"));
        assert_eq!(excerpt(&msg(Role::Assistant, vec![Block::text("short")]), 400).unwrap(), "short");
    }
}

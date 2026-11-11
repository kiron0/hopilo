use std::collections::BTreeSet;

use hopilo_core::brief::{edited_files, excerpt, first_user, key_references, last_with};
use hopilo_core::render::estimate_tokens;
use hopilo_core::{Block, Message, Role};
use serde::Serialize;
use tauri::AppHandle;

use crate::commands::{blocking, err, with_store, CmdResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Side {
    id: String,
    title: String,
    provider: String,
    model: Option<String>,
    project: Option<String>,
    message_count: usize,
    user_turns: usize,
    assistant_turns: usize,
    tool_calls: usize,
    tool_errors: usize,
    token_estimate: usize,
    started_at: Option<String>,
    ended_at: Option<String>,
    edited_files: Vec<String>,
    mentioned_files: Vec<String>,
    commands: Vec<String>,
    errors: Vec<String>,
    first_request: Option<String>,
    final_reply: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    a: Side,
    b: Side,
    same_project: bool,
    shared_edits: Vec<String>,
    only_a_edits: Vec<String>,
    only_b_edits: Vec<String>,
    shared_commands: Vec<String>,
    common_prompts: usize,
    diverge_at: Option<usize>,
    a_prompt_at_diverge: Option<String>,
    b_prompt_at_diverge: Option<String>,
}

fn user_texts(messages: &[&Message]) -> Vec<String> {
    messages
        .iter()
        .filter(|m| m.role == Role::User && m.has_text())
        .map(|m| {
            m.blocks
                .iter()
                .filter_map(|b| match b {
                    Block::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join(" ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

fn short(s: &str, n: usize) -> String {
    let total = s.chars().count();
    if total <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n).collect::<String>())
    }
}

fn side(id: &str, row: &hopilo_database::SessionRow, messages: &[Message]) -> Side {
    let refs: Vec<&Message> = messages.iter().collect();
    let keys = key_references(&refs);
    let mut tool_calls = 0;
    let mut tool_errors = 0;
    let mut text = String::new();
    for m in messages {
        for b in &m.blocks {
            match b {
                Block::ToolCall { .. } => tool_calls += 1,
                Block::ToolResult { is_error: true, .. } => tool_errors += 1,
                _ => {}
            }
            text.push_str(b.plain_text());
            text.push('\n');
        }
    }
    let times: Vec<&str> = messages.iter().filter_map(|m| m.created_at.as_deref()).collect();
    Side {
        id: id.to_string(),
        title: row.title.clone(),
        provider: row.provider.clone(),
        model: row.model.clone(),
        project: row.project.clone(),
        message_count: messages.len(),
        user_turns: messages.iter().filter(|m| m.role == Role::User && m.has_text()).count(),
        assistant_turns: messages.iter().filter(|m| m.role == Role::Assistant && m.has_text()).count(),
        tool_calls,
        tool_errors,
        token_estimate: estimate_tokens(&text),
        started_at: times.iter().min().map(|s| s.to_string()),
        ended_at: times.iter().max().map(|s| s.to_string()),
        edited_files: edited_files(&refs),
        mentioned_files: keys.files,
        commands: keys.commands,
        errors: keys.errors,
        first_request: first_user(&refs).and_then(|m| excerpt(m, 600)),
        final_reply: last_with(&refs, Role::Assistant).and_then(|m| excerpt(m, 900)),
    }
}

fn normalize_path(p: &str, project: Option<&str>) -> String {
    let p = p.replace('\\', "/");
    if let Some(root) = project.map(|r| r.replace('\\', "/")) {
        let root = root.trim_end_matches('/');
        if let Some(rest) = p.strip_prefix(root) {
            return rest.trim_start_matches('/').to_string();
        }
    }
    p.trim_start_matches("./").to_string()
}

fn compare(a: Side, b: Side, a_msgs: &[Message], b_msgs: &[Message]) -> Comparison {
    let norm = |s: &Side| -> BTreeSet<String> {
        s.edited_files.iter().map(|p| normalize_path(p, s.project.as_deref())).collect()
    };
    let (ea, eb) = (norm(&a), norm(&b));
    let ca: BTreeSet<&String> = a.commands.iter().collect();
    let cb: BTreeSet<&String> = b.commands.iter().collect();
    let ua = user_texts(&a_msgs.iter().collect::<Vec<_>>());
    let ub = user_texts(&b_msgs.iter().collect::<Vec<_>>());
    let common = ua.iter().zip(ub.iter()).take_while(|(x, y)| x == y).count();
    let diverge_at = (common < ua.len().max(ub.len())).then_some(common);
    Comparison {
        same_project: a.project.is_some() && a.project == b.project,
        shared_edits: ea.intersection(&eb).cloned().collect(),
        only_a_edits: ea.difference(&eb).cloned().collect(),
        only_b_edits: eb.difference(&ea).cloned().collect(),
        shared_commands: ca.intersection(&cb).map(|s| (*s).clone()).collect(),
        common_prompts: common,
        diverge_at,
        a_prompt_at_diverge: diverge_at.and_then(|i| ua.get(i)).map(|s| short(s, 400)),
        b_prompt_at_diverge: diverge_at.and_then(|i| ub.get(i)).map(|s| short(s, 400)),
        a,
        b,
    }
}

#[tauri::command]
pub async fn compare_sessions(app: AppHandle, a: String, b: String) -> CmdResult<Comparison> {
    if a == b {
        return Err("Pick two different sessions to compare".into());
    }
    blocking(app, move |_, state| {
        let ((ra, ma), (rb, mb)) = with_store(&state, |s| {
            let ra = s.session_row(&a).map_err(err)?;
            let ma = s.get_source_shared(&a).map_err(err)?;
            let rb = s.session_row(&b).map_err(err)?;
            let mb = s.get_source_shared(&b).map_err(err)?;
            Ok(((ra, ma), (rb, mb)))
        })?;
        let sa = side(&a, &ra, &ma.1);
        let sb = side(&b, &rb, &mb.1);
        Ok(compare(sa, sb, &ma.1, &mb.1))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_paths_against_project() {
        assert_eq!(normalize_path("/r/app/src/a.rs", Some("/r/app")), "src/a.rs");
        assert_eq!(normalize_path("./src/a.rs", None), "src/a.rs");
        assert_eq!(normalize_path("C:\\r\\app\\x.ts", Some("C:\\r\\app")), "x.ts");
    }
}

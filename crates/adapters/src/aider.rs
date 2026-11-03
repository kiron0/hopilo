//! Aider chat history: `.aider.chat.history.md` in each project folder.
//! Aider has no central session store, so this is imported from a file the
//! user picks. In the file, `#### ` lines are the user's prompts, `> ` lines
//! are Aider's own status output, and everything else is the model's reply.

use std::path::Path;

use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, OmittedCount, Role, Source, SourceKind};

use crate::text::title_from;
use crate::{omitted, AdapterError, Capture, Result};

const MAX_BYTES: u64 = 64 * 1024 * 1024;

pub fn read_history(path: &Path) -> Result<Capture> {
    let size = std::fs::metadata(path).map_err(|source| AdapterError::Io { path: path.display().to_string(), source })?.len();
    if size > MAX_BYTES {
        return Err(AdapterError::Unrecognized(format!("{} (file is too large)", path.display())));
    }
    let text = std::fs::read_to_string(path).map_err(|source| AdapterError::Io { path: path.display().to_string(), source })?;
    if !text.contains("# aider chat started at") && !text.contains("\n#### ") && !text.starts_with("#### ") {
        return Err(AdapterError::Unrecognized(format!("{} (not an Aider chat history)", path.display())));
    }
    let source_id = new_id();
    let mut messages: Vec<Message> = Vec::new();
    let mut status_lines = 0;
    let mut current: Option<(Role, Vec<String>)> = None;
    let mut started: Option<String> = None;

    let flush = |cur: &mut Option<(Role, Vec<String>)>, messages: &mut Vec<Message>, when: &Option<String>| {
        if let Some((role, lines)) = cur.take() {
            let body = lines.join("\n").trim().to_string();
            if !body.is_empty() {
                messages.push(Message { id: new_id(), source_id: source_id.clone(), role, created_at: when.clone(), blocks: vec![Block::text(body)] });
            }
        }
    };

    for line in text.lines() {
        if let Some(ts) = line.strip_prefix("# aider chat started at ") {
            flush(&mut current, &mut messages, &started);
            started = Some(ts.trim().replace(' ', "T"));
            continue;
        }
        if let Some(prompt) = line.strip_prefix("#### ") {
            match &mut current {
                Some((Role::User, lines)) => lines.push(prompt.to_string()),
                _ => {
                    flush(&mut current, &mut messages, &started);
                    current = Some((Role::User, vec![prompt.to_string()]));
                }
            }
            continue;
        }
        if line.starts_with("> ") || line == ">" {
            status_lines += 1;
            continue;
        }
        match &mut current {
            Some((Role::Assistant, lines)) => lines.push(line.to_string()),
            _ => {
                if line.trim().is_empty() && !matches!(current, Some((Role::User, _))) {
                    continue;
                }
                if matches!(current, Some((Role::User, _))) && line.trim().is_empty() {
                    // Blank line after a prompt: the reply starts next.
                    flush(&mut current, &mut messages, &started);
                    current = Some((Role::Assistant, vec![]));
                    continue;
                }
                flush(&mut current, &mut messages, &started);
                current = Some((Role::Assistant, vec![line.to_string()]));
            }
        }
    }
    flush(&mut current, &mut messages, &started);
    if messages.is_empty() {
        return Err(AdapterError::Unrecognized(format!("{} (no messages found)", path.display())));
    }
    let title = messages
        .iter()
        .find(|m| m.role == Role::User)
        .map(|m| title_from(m.blocks[0].plain_text()))
        .unwrap_or_else(|| "Aider session".into());
    let mut om: Vec<OmittedCount> = Vec::new();
    omitted(&mut om, "Aider status lines (token counts, file edits, commits)", status_lines);
    let project = path.parent().map(|p| p.display().to_string());
    Ok(Capture {
        source: Source {
            source_id,
            kind: SourceKind::LocalAgent,
            provider: "aider".into(),
            title,
            origin: Some(path.display().to_string()),
            project,
            model: None,
            captured_at: now_rfc3339(),
            capture_status: CaptureStatus::Complete,
            missing_items: vec![],
            omitted: om,
        },
        messages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_prompts_replies_and_skips_status() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(".aider.chat.history.md");
        std::fs::write(
            &p,
            "\n# aider chat started at 2026-10-01 10:00:00\n\n> Aider v0.80\n> Model: sonnet\n\n#### add a /health route\n#### return 200\n\nAdd it in `src/server.ts`:\n\n```ts\napp.get('/health', ...)\n```\n\n> Applied edit to src/server.ts\n\n#### now add a test\n\nAdded `test/health.test.ts`.\n",
        )
        .unwrap();
        let cap = read_history(&p).unwrap();
        let roles: Vec<Role> = cap.messages.iter().map(|m| m.role).collect();
        assert_eq!(roles, vec![Role::User, Role::Assistant, Role::User, Role::Assistant]);
        assert_eq!(cap.messages[0].blocks[0].plain_text(), "add a /health route\nreturn 200");
        assert!(cap.messages[1].blocks[0].plain_text().contains("```ts\napp.get('/health', ...)\n```"));
        assert_eq!(cap.source.title, "add a /health route return 200");
        assert_eq!(cap.source.omitted[0].count, 3);
        assert_eq!(cap.messages[0].created_at.as_deref(), Some("2026-10-01T10:00:00"));
    }

    #[test]
    fn rejects_other_markdown() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("notes.md");
        std::fs::write(&p, "# Notes\n\nhello").unwrap();
        assert!(read_history(&p).is_err());
    }
}

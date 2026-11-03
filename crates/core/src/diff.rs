//! Compare two pack versions (LIB-05): which messages, sources, files and
//! notes were added, removed or changed. Messages match by source and id,
//! with content compared exactly.

use std::collections::HashMap;

use serde::Serialize;

use crate::model::{Message, Pack, Role};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageChange {
    pub id: String,
    pub role: Role,
    /// First line of the message, for display.
    pub preview: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackDiff {
    pub from_version: u32,
    pub to_version: u32,
    pub added: Vec<MessageChange>,
    pub removed: Vec<MessageChange>,
    pub changed: Vec<MessageChange>,
    pub unchanged: usize,
    pub sources_added: Vec<String>,
    pub sources_removed: Vec<String>,
    pub files_added: Vec<String>,
    pub files_removed: Vec<String>,
    pub note_before: Option<String>,
    pub note_after: Option<String>,
    pub title_before: Option<String>,
    pub title_after: Option<String>,
}

fn preview(m: &Message) -> String {
    let text = m.blocks.first().map(|b| b.plain_text()).unwrap_or("");
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    if line.chars().count() > 120 { format!("{}…", line.chars().take(119).collect::<String>()) } else { line.to_string() }
}

fn change(m: &Message) -> MessageChange {
    MessageChange { id: m.id.clone(), role: m.role, preview: preview(m) }
}

pub fn diff_packs(a: &Pack, b: &Pack) -> PackDiff {
    let key = |m: &Message| (m.source_id.clone(), m.id.clone());
    let before: HashMap<_, &Message> = a.messages.iter().map(|m| (key(m), m)).collect();
    let after: HashMap<_, &Message> = b.messages.iter().map(|m| (key(m), m)).collect();
    let mut d = PackDiff { from_version: a.version, to_version: b.version, ..Default::default() };
    for m in &b.messages {
        match before.get(&key(m)) {
            None => d.added.push(change(m)),
            Some(old) if old.blocks != m.blocks || old.role != m.role => d.changed.push(change(m)),
            Some(_) => d.unchanged += 1,
        }
    }
    for m in &a.messages {
        if !after.contains_key(&key(m)) {
            d.removed.push(change(m));
        }
    }
    let titles = |p: &Pack| p.sources.iter().map(|s| (s.source_id.clone(), s.title.clone())).collect::<HashMap<_, _>>();
    let (sa, sb) = (titles(a), titles(b));
    d.sources_added = sb.iter().filter(|(k, _)| !sa.contains_key(*k)).map(|(_, t)| t.clone()).collect();
    d.sources_removed = sa.iter().filter(|(k, _)| !sb.contains_key(*k)).map(|(_, t)| t.clone()).collect();
    let files = |p: &Pack| p.attachments.iter().map(|x| (x.sha256.clone(), x.file_name.clone())).collect::<HashMap<_, _>>();
    let (fa, fb) = (files(a), files(b));
    d.files_added = fb.iter().filter(|(k, _)| !fa.contains_key(*k)).map(|(_, t)| t.clone()).collect();
    d.files_removed = fa.iter().filter(|(k, _)| !fb.contains_key(*k)).map(|(_, t)| t.clone()).collect();
    if a.context.note != b.context.note {
        d.note_before = a.context.note.clone();
        d.note_after = b.context.note.clone();
    }
    if a.title != b.title {
        d.title_before = Some(a.title.clone());
        d.title_after = Some(b.title.clone());
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn msg(id: &str, text: &str) -> Message {
        Message { id: id.into(), source_id: "s".into(), role: Role::User, created_at: None, blocks: vec![Block::text(text)] }
    }

    fn pack(v: u32, msgs: Vec<Message>, note: Option<&str>) -> Pack {
        Pack {
            schema_version: SCHEMA_VERSION.into(),
            pack_id: "p".into(),
            title: "T".into(),
            version: v,
            created_at: String::new(),
            mode: Mode::Full,
            sources: vec![],
            messages: msgs,
            context: ContextBrief { note: note.map(str::to_string), ..Default::default() },
            attachments: vec![],
            tags: vec![],
            integrity: Integrity::default(),
        }
    }

    #[test]
    fn finds_added_removed_changed_and_note() {
        let a = pack(1, vec![msg("1", "keep"), msg("2", "old text"), msg("3", "gone")], None);
        let b = pack(2, vec![msg("1", "keep"), msg("2", "new text"), msg("4", "fresh")], Some("note"));
        let d = diff_packs(&a, &b);
        assert_eq!(d.unchanged, 1);
        assert_eq!(d.changed.iter().map(|c| c.preview.as_str()).collect::<Vec<_>>(), vec!["new text"]);
        assert_eq!(d.added[0].preview, "fresh");
        assert_eq!(d.removed[0].preview, "gone");
        assert_eq!(d.note_after.as_deref(), Some("note"));
    }
}

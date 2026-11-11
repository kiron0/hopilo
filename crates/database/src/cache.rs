use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::Arc;

use hopilo_core::{Message, Source};
use rusqlite::Connection;

use crate::sessions::SessionRow;

type MetadataKey = (i64, Option<String>);
type Metadata = Arc<crate::session_query::QueryMetadata>;

const SOURCE_SLOTS: usize = 8;

pub(crate) type Stamp = (u64, i64);
pub type Transcript = Arc<(Source, Vec<Message>)>;

#[derive(Default)]
pub(crate) struct Cache {
    stamp: Option<Stamp>,
    sessions: Option<Arc<Vec<SessionRow>>>,
    sources: VecDeque<(String, Transcript)>,
    metadata: VecDeque<(MetadataKey, Metadata)>,
}

pub(crate) fn stamp(conn: &Connection) -> Stamp {
    let dv = conn.query_row("PRAGMA data_version", [], |r| r.get::<_, i64>(0)).unwrap_or(-1);
    (conn.total_changes(), dv)
}

impl Cache {
    fn sync(&mut self, now: Stamp) {
        if self.stamp != Some(now) {
            self.sessions = None;
            self.sources.clear();
            self.metadata.clear();
            self.stamp = Some(now);
        }
    }

    pub(crate) fn metadata(cell: &RefCell<Self>, now: Stamp, key: &MetadataKey) -> Option<Metadata> {
        let mut c = cell.borrow_mut();
        c.sync(now);
        c.metadata.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }
    pub(crate) fn put_metadata(cell: &RefCell<Self>, now: Stamp, key: MetadataKey, value: Metadata) {
        let mut c = cell.borrow_mut();
        c.sync(now);
        c.metadata.retain(|(k, _)| k != &key);
        c.metadata.push_front((key, value));
        c.metadata.truncate(4);
    }

    pub(crate) fn sessions(cell: &RefCell<Self>, now: Stamp) -> Option<Arc<Vec<SessionRow>>> {
        let mut c = cell.borrow_mut();
        c.sync(now);
        c.sessions.clone()
    }

    pub(crate) fn put_sessions(cell: &RefCell<Self>, now: Stamp, rows: Arc<Vec<SessionRow>>) {
        let mut c = cell.borrow_mut();
        c.sync(now);
        c.sessions = Some(rows);
    }

    pub(crate) fn source(cell: &RefCell<Self>, now: Stamp, id: &str) -> Option<Transcript> {
        let mut c = cell.borrow_mut();
        c.sync(now);
        let pos = c.sources.iter().position(|(k, _)| k == id)?;
        let hit = c.sources.remove(pos)?;
        let out = hit.1.clone();
        c.sources.push_front(hit);
        Some(out)
    }

    pub(crate) fn put_source(cell: &RefCell<Self>, now: Stamp, id: &str, t: Transcript) {
        let mut c = cell.borrow_mut();
        c.sync(now);
        c.sources.retain(|(k, _)| k != id);
        c.sources.push_front((id.to_string(), t));
        c.sources.truncate(SOURCE_SLOTS);
    }
}

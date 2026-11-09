use crate::sessions::{row_from, ROW_COLUMNS};
use crate::{Result, SessionRow, Store};
use rusqlite::{params_from_iter, types::Value};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionQuery {
    pub q: String,
    pub filter: String,
    pub provider: String,
    pub model: String,
    pub folder: String,
    pub resource: String,
    pub hide_unanswered: bool,
    pub offset: usize,
    pub limit: usize,
    pub ids: Option<Vec<String>>,
    pub exclude: Vec<String>,
    pub search_providers: Vec<String>,
    pub since: Option<String>,
}

impl Default for SessionQuery {
    fn default() -> Self {
        Self {
            q: String::new(),
            filter: "all".into(),
            provider: "all".into(),
            model: "all".into(),
            folder: "all".into(),
            resource: "all".into(),
            hide_unanswered: false,
            offset: 0,
            limit: 50,
            ids: None,
            exclude: vec![],
            search_providers: vec![],
            since: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCounts {
    pub total: usize,
    pub hidden: usize,
    pub pinned: usize,
    pub agents: usize,
    pub web: usize,
    pub web_today: usize,
    pub unanswered: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPage {
    pub provider_counts: std::collections::BTreeMap<String, usize>,
    pub rows: Vec<SessionRow>,
    pub total: usize,
    pub offset: usize,
    pub providers: Vec<String>,
    pub models: Vec<String>,
    pub folders: Vec<String>,
    pub counts: LibraryCounts,
}

#[derive(Clone)]
pub(crate) struct QueryMetadata {
    pub provider_counts: std::collections::BTreeMap<String, usize>,
    pub providers: Vec<String>,
    pub models: Vec<String>,
    pub folders: Vec<String>,
    pub counts: LibraryCounts,
}

fn bind(values: &mut Vec<Value>, value: impl Into<Value>) -> String {
    values.push(value.into());
    format!("?{}", values.len())
}

impl Store {
    /// Filter and page before decoding rows or crossing IPC. Values are always bound.
    pub fn query_sessions(&self, query: &SessionQuery) -> Result<SessionPage> {
        let hidden = i64::from(query.filter == "hidden");
        let mut values = vec![Value::Integer(hidden)];
        let mut predicates = vec!["hidden = ?1".to_string()];
        match query.filter.as_str() {
            "agents" => predicates.push("kind = 'local-agent'".into()),
            "web" => predicates.push("kind = 'browser-chat'".into()),
            "added" => predicates.push("kind NOT IN ('local-agent', 'browser-chat')".into()),
            "pinned" => predicates.push("pinned = 1".into()),
            _ => {}
        }
        if query.provider != "all" {
            predicates.push(format!("provider = {}", bind(&mut values, query.provider.clone())));
        }
        if query.model != "all" {
            predicates.push(format!(
                "COALESCE(NULLIF(trim(model), ''), '__unknown') = {}",
                bind(&mut values, query.model.clone())
            ));
        }
        if query.folder != "all" {
            predicates.push(format!("trim(project) = {}", bind(&mut values, query.folder.clone())));
        }
        match query.resource.as_str() {
            "with-files" => predicates.push("file_count > 0".into()),
            "without-files" => predicates.push("file_count = 0".into()),
            _ => {}
        }
        if query.hide_unanswered {
            predicates.push("NOT (kind = 'local-agent' AND reply_count = 0)".into());
        }
        if let Some(ids) = &query.ids {
            predicates.push(format!(
                "id IN (SELECT value FROM json_each({}))",
                bind(&mut values, serde_json::to_string(ids)?)
            ));
        }
        if !query.exclude.is_empty() {
            predicates.push(format!(
                "id NOT IN (SELECT value FROM json_each({}))",
                bind(&mut values, serde_json::to_string(&query.exclude)?)
            ));
        }
        let needle = query.q.trim().to_lowercase();
        if !needle.is_empty() {
            let q = bind(&mut values, needle);
            let providers = bind(&mut values, serde_json::to_string(&query.search_providers)?);
            predicates.push(format!(
                "(instr(hopilo_lower(title), {q}) > 0 OR instr(hopilo_lower(COALESCE(project, '')), {q}) > 0
                OR instr(hopilo_lower(COALESCE(model, '')), {q}) > 0 OR instr(hopilo_lower(provider), {q}) > 0
                OR provider IN (SELECT value FROM json_each({providers}))
                OR EXISTS(SELECT 1 FROM json_each(tags) WHERE instr(hopilo_lower(value), {q}) > 0))"
            ));
        }
        let where_sql = predicates.join(" AND ");
        let total: usize = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM sources WHERE {where_sql}"),
            params_from_iter(&values),
            |r| r.get(0),
        )?;
        let limit = query.limit.clamp(1, 200);
        let offset = query.offset.min(total.saturating_sub(1) / limit * limit);
        let limit_bind = bind(&mut values, limit as i64);
        let offset_bind = bind(&mut values, offset as i64);
        let mut stmt = self.conn.prepare_cached(&format!("SELECT {ROW_COLUMNS} FROM sources WHERE {where_sql}
            ORDER BY pinned DESC, COALESCE(updated_at, captured_at) DESC, rowid DESC LIMIT {limit_bind} OFFSET {offset_bind}"))?;
        let rows = stmt.query_map(params_from_iter(&values), row_from)?.collect::<std::result::Result<Vec<_>, _>>()?;
        let stamp = crate::cache::stamp(&self.conn);
        let meta_key = (hidden, query.since.clone());
        let metadata = if let Some(metadata) = crate::cache::Cache::metadata(&self.cache, stamp, &meta_key) {
            metadata
        } else {
            let distinct = |expr: &str| -> Result<Vec<String>> {
                let mut stmt = self
                    .conn
                    .prepare_cached(&format!("SELECT DISTINCT {expr} FROM sources WHERE hidden = ?1 ORDER BY 1"))?;
                let rows = stmt.query_map([hidden], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
                Ok(rows)
            };
            let counts = self.conn.query_row("SELECT COUNT(*), COALESCE(SUM(pinned),0), COALESCE(SUM(kind='local-agent'),0),
            COALESCE(SUM(kind='browser-chat'),0), COALESCE(SUM(kind='browser-chat' AND julianday(COALESCE(updated_at,captured_at)) >= julianday(?2)),0),
            COALESCE(SUM(kind='local-agent' AND reply_count=0),0), (SELECT COUNT(*) FROM sources WHERE hidden=1) FROM sources WHERE hidden=?1", rusqlite::params![hidden, query.since],
            |r| Ok(LibraryCounts { total:r.get(0)?, pinned:r.get(1)?, agents:r.get(2)?, web:r.get(3)?, web_today:r.get(4)?, unanswered:r.get(5)?, hidden:r.get(6)? }))?;
            let provider_counts: std::collections::BTreeMap<String, usize> = self
                .conn
                .prepare_cached("SELECT provider, COUNT(*) FROM sources WHERE hidden=?1 GROUP BY provider")?
                .query_map([hidden], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<std::result::Result<_, _>>()?;
            let metadata = std::sync::Arc::new(QueryMetadata {
                providers: provider_counts.keys().cloned().collect(),
                provider_counts,
                models: distinct("COALESCE(NULLIF(trim(model), ''), '__unknown')")?,
                folders: distinct("COALESCE(project, '')")?.into_iter().filter(|s| !s.is_empty()).collect(),
                counts,
            });
            crate::cache::Cache::put_metadata(&self.cache, stamp, meta_key, metadata.clone());
            metadata
        };
        Ok(SessionPage {
            provider_counts: metadata.provider_counts.clone(),
            rows,
            total,
            offset,
            providers: metadata.providers.clone(),
            models: metadata.models.clone(),
            folders: metadata.folders.clone(),
            counts: metadata.counts.clone(),
        })
    }
}

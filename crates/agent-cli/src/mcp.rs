use hopilo_database::Store;
use serde_json::{json, Value};

use crate::{handoff, parse_level, search, AgentError, MAX_IDS, MAX_LIMIT};

pub const PROTOCOL_VERSION: &str = "2025-06-18";
pub const MAX_LINE: usize = 1024 * 1024;

const INSTRUCTIONS: &str = "Hopilo holds the user's earlier AI chat and coding-agent sessions. Use search_sessions to find sessions from the current project, then prepare_handoff to read a redacted handoff of the ones that matter. Only sessions the user allows for agents in Hopilo are visible.";

fn reply(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn failure(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_text(text: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

pub fn tools() -> Value {
    json!([
        {
            "name": "search_sessions",
            "title": "Search Hopilo sessions",
            "description": "List earlier sessions available to agents, newest first. Filter by project folder and by text in the title, project, model, provider or tags.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "Absolute project folder; sessions in its subfolders are included. Omit to search every session agents may see." },
                    "query": { "type": "string", "description": "Text to match. Omit to list the most recent sessions." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "description": "Maximum sessions to return. Default 20." }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        },
        {
            "name": "prepare_handoff",
            "title": "Prepare Hopilo handoff",
            "description": "Render a handoff of one or more sessions, with the user's redaction rules applied. Use ids from search_sessions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": MAX_IDS, "description": "Session ids from search_sessions." },
                    "level": { "type": "string", "enum": ["minimal", "balanced", "full"], "description": "How much detail to include. Default balanced." }
                },
                "required": ["ids"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }
    ])
}

fn optional_str<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, AgentError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(_) => Err(AgentError::new("bad_request", format!("{key} must be a string"))),
    }
}

fn call_tool(name: &str, args: &Value, open: &dyn Fn() -> Result<Store, AgentError>) -> Result<Value, AgentError> {
    if !args.is_object() {
        return Err(AgentError::new("bad_request", "arguments must be an object"));
    }
    match name {
        "search_sessions" => {
            let project = optional_str(args, "project")?;
            let query = optional_str(args, "query")?.unwrap_or("");
            let limit = match args.get("limit") {
                None | Some(Value::Null) => None,
                Some(v) => {
                    Some(v.as_u64().ok_or_else(|| AgentError::new("bad_request", "limit must be a positive integer"))?
                        as usize)
                }
            };
            let store = open()?;
            let sessions = search(&store, project, query, limit)?;
            let text = serde_json::to_string_pretty(&json!({ "sessions": sessions }))
                .map_err(|e| AgentError::new("library", e.to_string()))?;
            Ok(tool_text(text, false))
        }
        "prepare_handoff" => {
            let ids: Vec<String> = match args.get("ids") {
                Some(Value::Array(a)) => a
                    .iter()
                    .map(|v| {
                        v.as_str()
                            .map(str::to_string)
                            .ok_or_else(|| AgentError::new("bad_request", "ids must be strings"))
                    })
                    .collect::<Result<_, _>>()?,
                _ => return Err(AgentError::new("bad_request", "ids must be an array of session ids")),
            };
            let level = parse_level(optional_str(args, "level")?)?;
            let store = open()?;
            let h = handoff(&store, &ids, level)?;
            let mut content = vec![json!({ "type": "text", "text": h.text })];
            let mut notes = vec![format!(
                "Hopilo handoff “{}” · about {} tokens · {} sensitive item(s) redacted.",
                h.title, h.token_estimate, h.findings_redacted
            )];
            if !h.attach_manually.is_empty() {
                notes.push(format!(
                    "Binary files not included; ask the user to attach them if needed: {}",
                    h.attach_manually.join(", ")
                ));
            }
            content.push(json!({ "type": "text", "text": notes.join("\n") }));
            Ok(json!({ "content": content, "isError": false }))
        }
        _ => Err(AgentError::new("unknown_tool", format!("Unknown tool {name}"))),
    }
}

pub fn handle_line(line: &str, open: &dyn Fn() -> Result<Store, AgentError>) -> Option<Value> {
    if line.len() > MAX_LINE {
        return Some(failure(Value::Null, -32600, "Request too large"));
    }
    if line.trim().is_empty() {
        return None;
    }
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Some(failure(Value::Null, -32700, "Parse error")),
    };
    let Some(obj) = msg.as_object() else {
        return Some(failure(Value::Null, -32600, "Invalid request"));
    };
    let method = obj.get("method").and_then(Value::as_str);
    let id = match obj.get("id") {
        None => {
            return None;
        }
        Some(id @ (Value::String(_) | Value::Number(_))) => id.clone(),
        Some(_) => return Some(failure(Value::Null, -32600, "Invalid request id")),
    };
    let Some(method) = method else {
        return if obj.contains_key("result") || obj.contains_key("error") {
            None
        } else {
            Some(failure(id, -32600, "Invalid request"))
        };
    };
    let params = obj.get("params").cloned().unwrap_or_else(|| json!({}));
    Some(match method {
        "initialize" => reply(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "hopilo", "title": "Hopilo", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }),
        ),
        "ping" => reply(id, json!({})),
        "tools/list" => reply(id, json!({ "tools": tools() })),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Some(failure(id, -32602, "Missing tool name"));
            };
            if !matches!(name, "search_sessions" | "prepare_handoff") {
                return Some(failure(id, -32602, &format!("Unknown tool: {name}")));
            }
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match call_tool(name, &args, open) {
                Ok(result) => reply(id, result),
                Err(e) => reply(id, tool_text(e.to_string(), true)),
            }
        }
        _ => failure(id, -32601, "Method not found"),
    })
}

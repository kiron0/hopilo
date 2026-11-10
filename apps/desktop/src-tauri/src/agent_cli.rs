use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliInfo {
    pub path: Option<String>,
    pub installed: bool,
}

#[tauri::command]
pub fn agent_cli_info() -> AgentCliInfo {
    let path = crate::browser::agent_cli_binary();
    AgentCliInfo { installed: path.as_ref().is_some_and(|p| p.is_file()), path: path.map(|p| p.display().to_string()) }
}

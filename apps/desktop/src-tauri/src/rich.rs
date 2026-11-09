use crate::commands::{err, CmdResult};
use hopilo_rich::{Node, Token};

#[tauri::command]
pub async fn parse_markdown(text: String) -> CmdResult<Option<Vec<Node>>> {
    tauri::async_runtime::spawn_blocking(move || hopilo_rich::parse_markdown(&text)).await.map_err(err)
}

#[tauri::command]
pub async fn highlight_code(code: String, language: String) -> CmdResult<Option<Vec<Vec<Token>>>> {
    tauri::async_runtime::spawn_blocking(move || hopilo_rich::highlight(&code, &language)).await.map_err(err)
}

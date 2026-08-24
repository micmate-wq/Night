use tauri::Manager;
use serde::{Deserialize, Serialize};
use base64::prelude::*;

#[derive(Serialize, Deserialize)]
pub struct LoadProjectResponse {
    pub path: String,
    pub filename: String,
    pub content: String,
}

#[tauri::command]
async fn save_project_dialog(content: String, default_name: Option<String>) -> Result<Option<String>, String> {
    let name = default_name.unwrap_or_else(|| "Project.aether".to_string());
    
    let file = rfd::AsyncFileDialog::new()
        .set_title("Save Aether Project")
        .set_file_name(&name)
        .add_filter("Aether Project (*.aether, *.json)", &["aether", "json"])
        .save_file()
        .await;

    if let Some(handle) = file {
        let path = handle.path().to_path_buf();
        std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn load_project_dialog() -> Result<Option<LoadProjectResponse>, String> {
    let file = rfd::AsyncFileDialog::new()
        .set_title("Open Aether Project")
        .add_filter("Aether Project (*.aether, *.json)", &["aether", "json"])
        .pick_file()
        .await;

    if let Some(handle) = file {
        let path = handle.path().to_path_buf();
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let filename = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "project.aether".to_string());
        
        Ok(Some(LoadProjectResponse {
            path: path.to_string_lossy().to_string(),
            filename,
            content,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn read_audio_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read audio file at {}: {}", path, e))?;
    Ok(BASE64_STANDARD.encode(bytes))
}

#[tauri::command]
async fn write_file_at_path(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_project_dialog,
            load_project_dialog,
            read_audio_file,
            write_file_at_path
        ])
        .setup(|app| {
            let webview = app.get_webview_window("main").expect("no main window");
            webview.with_webview(|_wv| {
                // WKWebView host configuration
            }).ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


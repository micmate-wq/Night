use tauri::Manager;
use serde::{Deserialize, Serialize};
use base64::prelude::*;
use std::io::Read;

mod icecast;
mod project_write;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LoadedNodeBundle {
    pub file_path: String,
    pub file_name: String,
    pub manifest_raw: String,
    pub manifest: serde_json::Value,
    pub ui_html: Option<String>,
    pub dsp_wasm_base64: Option<String>,
    pub dsp_js: Option<String>,
}

fn unpack_node_bundle_bytes(bytes: &[u8], file_name: &str, file_path: &str) -> Result<LoadedNodeBundle, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    let mut manifest_raw: Option<String> = None;
    let mut ui_html: Option<String> = None;
    let mut dsp_wasm_base64: Option<String> = None;
    let mut dsp_js: Option<String> = None;

    for i in 0..archive.len() {
        let mut zip_file = archive.by_index(i)
            .map_err(|e| format!("Failed to read entry from bundle: {}", e))?;
        
        let raw_name = zip_file.name().to_string();
        let normalized = raw_name.rsplit('/').next().unwrap_or(&raw_name).to_lowercase();

        if normalized == "manifest.json" {
            let mut content = String::new();
            zip_file.read_to_string(&mut content)
                .map_err(|e| format!("Failed to read manifest.json: {}", e))?;
            manifest_raw = Some(content);
        } else if normalized == "ui.html" {
            let mut content = String::new();
            zip_file.read_to_string(&mut content)
                .map_err(|e| format!("Failed to read ui.html: {}", e))?;
            ui_html = Some(content);
        } else if normalized == "dsp.wasm" {
            let mut b = Vec::new();
            zip_file.read_to_end(&mut b)
                .map_err(|e| format!("Failed to read dsp.wasm: {}", e))?;
            dsp_wasm_base64 = Some(BASE64_STANDARD.encode(b));
        } else if normalized == "dsp.js" {
            let mut content = String::new();
            zip_file.read_to_string(&mut content)
                .map_err(|e| format!("Failed to read dsp.js: {}", e))?;
            dsp_js = Some(content);
        }
    }

    let manifest_str = manifest_raw.ok_or_else(|| "Missing manifest.json in .aethernode bundle".to_string())?;
    let manifest_json: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Invalid manifest.json format: {}", e))?;

    Ok(LoadedNodeBundle {
        file_path: file_path.to_string(),
        file_name: file_name.to_string(),
        manifest_raw: manifest_str,
        manifest: manifest_json,
        ui_html,
        dsp_wasm_base64,
        dsp_js,
    })
}

fn unpack_node_bundle(path: &std::path::Path) -> Result<LoadedNodeBundle, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Failed to open node bundle: {}", e))?;
    let file_name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown.aethernode".to_string());
    unpack_node_bundle_bytes(&bytes, &file_name, &path.to_string_lossy())
}

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
        project_write::replace_project(&path, content.as_bytes()).map_err(|e| e.to_string())?;
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
async fn load_node_bundle_dialog() -> Result<Option<LoadedNodeBundle>, String> {
    let file = rfd::AsyncFileDialog::new()
        .set_title("Load Aether Node Bundle")
        .add_filter("Aether Node (*.aethernode, *.zip)", &["aethernode", "zip"])
        .pick_file()
        .await;

    if let Some(handle) = file {
        let path = handle.path().to_path_buf();
        let bundle = unpack_node_bundle(&path)?;
        Ok(Some(bundle))
    } else {
        Ok(None)
    }
}

fn resolve_candidate_path(path: &str) -> std::path::PathBuf {
    let p = std::path::PathBuf::from(path);
    if p.exists() {
        return p;
    }
    let filename = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string());
    let candidates = [
        format!("nodes-v2/{}", filename),
        format!("../nodes-v2/{}", filename),
        format!("../../nodes-v2/{}", filename),
        format!("nodes/{}", filename),
        format!("../nodes/{}", filename),
        format!("../../nodes/{}", filename),
        format!("Aether 4.0 UI/nodes/{}", filename),
        format!("../Aether 4.0 UI/nodes/{}", filename),
        format!("../../Aether 4.0 UI/nodes/{}", filename),
    ];
    for cand in &candidates {
        let cp = std::path::PathBuf::from(cand);
        if cp.exists() {
            return cp;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            if let Some(contents_dir) = macos_dir.parent() {
                let res = contents_dir.join("Resources");
                let res_candidates = [
                    res.join("nodes").join(&filename),
                    res.join("_up_/_up_/nodes").join(&filename),
                    res.join("_up_/_up_/default_library/nodes").join(&filename),
                    res.join("_up_/_up_/_up_/nodes").join(&filename),
                    res.join("_up_/_up_/_up_/default_library/nodes").join(&filename),
                    res.join("default_library/nodes").join(&filename),
                ];
                for rc in &res_candidates {
                    if rc.exists() {
                        return rc.clone();
                    }
                }
            }
        }
    }
    p
}

#[tauri::command]
async fn load_node_bundle_from_path(path: String) -> Result<LoadedNodeBundle, String> {
    let file_path = resolve_candidate_path(&path);
    unpack_node_bundle(&file_path)
}

#[tauri::command]
async fn load_node_bundle_from_base64(base64: String, filename: Option<String>) -> Result<LoadedNodeBundle, String> {
    let bytes = BASE64_STANDARD.decode(&base64)
        .map_err(|e| format!("Failed to decode base64 bundle data: {}", e))?;
    let name = filename.unwrap_or_else(|| "custom.aethernode".to_string());
    unpack_node_bundle_bytes(&bytes, &name, "")
}

#[tauri::command]
async fn read_audio_file(path: String) -> Result<String, String> {
    let file_path = resolve_candidate_path(&path);
    let bytes = std::fs::read(&file_path).map_err(|e| format!("Failed to read audio file at {:?}: {}", file_path, e))?;
    Ok(BASE64_STANDARD.encode(bytes))
}

#[tauri::command]
async fn write_file_at_path(path: String, content: String) -> Result<(), String> {
    project_write::replace_project(std::path::Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(icecast::IcecastState::new())
        .invoke_handler(tauri::generate_handler![
            save_project_dialog,
            load_project_dialog,
            load_node_bundle_dialog,
            load_node_bundle_from_path,
            load_node_bundle_from_base64,
            read_audio_file,
            write_file_at_path,
            icecast::icecast_connect,
            icecast::icecast_disconnect,
            icecast::icecast_push_pcm,
            icecast::icecast_status
        ])
        .setup(|app| {
            if let Ok(menu) = tauri::menu::Menu::default(app.handle()) {
                // The default macOS View menu contains a fullscreen action that
                // would bypass the fixed-size instrument window.
                #[cfg(target_os = "macos")]
                for item in menu.items()? {
                    if let tauri::menu::MenuItemKind::Submenu(submenu) = item {
                        if submenu.text()? == "View" {
                            menu.remove(&submenu)?;
                        } else if submenu.text()? == "Window" {
                            // Default order: Minimize, Zoom, separator, Close.
                            submenu.remove_at(1)?;
                        }
                    }
                }
                let _ = app.set_menu(menu);
            }
            let webview = app.get_webview_window("main").expect("no main window");
            webview.with_webview(|_wv| {
                // WKWebView host configuration
            }).ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

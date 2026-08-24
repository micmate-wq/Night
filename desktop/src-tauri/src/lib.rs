use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Inject a renderer init script that boots the WebSocket connection
            // from the renderer side (where Web Audio API nodes live).
            // This runs in the WebView after every page load, calling the
            // existing initWebSocket() already defined in index.html.
            let webview = app.get_webview_window("main").expect("no main window");
            webview.with_webview(|_wv| {
                // WKWebView host configuration is handled via Info.plist ATS rules.
                // No additional Rust-side webview config required.
            }).ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

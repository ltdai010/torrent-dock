mod rqbit_sidecar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(rqbit_sidecar::RqbitSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            rqbit_sidecar::ensure_rqbit_sidecar,
            rqbit_sidecar::get_rqbit_endpoint,
            rqbit_sidecar::stop_rqbit_sidecar
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TorrentDock");
}

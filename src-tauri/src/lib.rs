mod open_subtitles;
mod rqbit_sidecar;
mod stream_proxy;
mod subsource;
mod torrent_sources;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .register_asynchronous_uri_scheme_protocol("stream", |_context, request, responder| {
            stream_proxy::handle_stream_request(request, responder);
        })
        .manage(rqbit_sidecar::RqbitSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            open_subtitles::open_subtitles_org_download,
            open_subtitles::open_subtitles_org_request,
            rqbit_sidecar::ensure_rqbit_sidecar,
            rqbit_sidecar::get_rqbit_endpoint,
            rqbit_sidecar::rqbit_api_request,
            rqbit_sidecar::stop_rqbit_sidecar,
            stream_proxy::stream_probe_log,
            subsource::subsource_api_get,
            subsource::subsource_download,
            torrent_sources::search_movie_titles,
            torrent_sources::search_torrent_source_provider,
            torrent_sources::search_torrent_sources
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TorrentDock");
}

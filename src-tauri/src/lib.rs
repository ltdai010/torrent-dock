mod open_subtitles;
mod playback;
mod rqbit_sidecar;
mod stream_proxy;
mod subsource;
mod torrent_sources;

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
struct CursorPosition {
    x: i32,
    y: i32,
}

#[tauri::command]
fn get_cursor_position() -> Option<CursorPosition> {
    #[cfg(windows)]
    {
        let mut point = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
        let ok = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) };
        if ok == 0 {
            return None;
        }
        Some(CursorPosition {
            x: point.x,
            y: point.y,
        })
    }

    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            playback::maybe_start_native_smoke_test(app);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let state = window.state::<rqbit_sidecar::RqbitSidecarState>();
                if let Err(error) = rqbit_sidecar::stop_tracked_rqbit_sidecar(&state) {
                    eprintln!("[rqbit] failed to stop sidecar on window close: {error}");
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol("stream", |_context, request, responder| {
            stream_proxy::handle_stream_request(request, responder);
        })
        .manage(playback::PlaybackService::default())
        .manage(rqbit_sidecar::RqbitSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            get_cursor_position,
            open_subtitles::open_subtitles_org_download,
            open_subtitles::open_subtitles_org_request,
            playback::player_add_subtitle_text,
            playback::player_get_capabilities,
            playback::player_initialize,
            playback::player_load,
            playback::player_pause,
            playback::player_play,
            playback::player_seek,
            playback::player_select_audio,
            playback::player_select_subtitle,
            playback::player_set_muted,
            playback::player_set_rate,
            playback::player_set_fullscreen,
            playback::player_set_subtitle_delay,
            playback::player_set_subtitle_scale,
            playback::player_set_surface_bounds,
            playback::player_set_volume,
            playback::player_stop,
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
        .build(tauri::generate_context!())
        .expect("failed to build TorrentDock");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            let state = app_handle.state::<rqbit_sidecar::RqbitSidecarState>();
            if let Err(error) = rqbit_sidecar::stop_tracked_rqbit_sidecar(&state) {
                eprintln!("[rqbit] failed to stop sidecar on app exit: {error}");
            }
        }
    });
}

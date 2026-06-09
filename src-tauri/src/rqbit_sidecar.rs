use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const RQBIT_ENDPOINT: &str = "http://127.0.0.1:3030";
const RQBIT_LISTEN_ADDR: &str = "127.0.0.1:3030";

#[derive(Default)]
pub struct RqbitSidecarState {
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
pub async fn ensure_rqbit_sidecar(
    app: AppHandle,
    state: tauri::State<'_, RqbitSidecarState>,
) -> Result<String, String> {
    if state
        .child
        .lock()
        .map_err(|_| "rqbit sidecar state is poisoned".to_string())?
        .is_some()
    {
        return Ok(RQBIT_ENDPOINT.to_string());
    }

    start_rqbit_sidecar(app, state).await
}

#[tauri::command]
pub async fn get_rqbit_endpoint() -> String {
    RQBIT_ENDPOINT.to_string()
}

#[tauri::command]
pub async fn stop_rqbit_sidecar(state: tauri::State<'_, RqbitSidecarState>) -> Result<(), String> {
    let child = state
        .child
        .lock()
        .map_err(|_| "rqbit sidecar state is poisoned".to_string())?
        .take();

    if let Some(child) = child {
        child
            .kill()
            .map_err(|error| format!("failed to stop rqbit sidecar: {error}"))?;
    }

    Ok(())
}

async fn start_rqbit_sidecar(
    app: AppHandle,
    state: tauri::State<'_, RqbitSidecarState>,
) -> Result<String, String> {
    let downloads_dir = rqbit_downloads_dir(&app)?;
    std::fs::create_dir_all(&downloads_dir)
        .map_err(|error| format!("failed to create rqbit download directory: {error}"))?;

    let sidecar = app
        .shell()
        .sidecar("rqbit")
        .map_err(|error| format!("rqbit sidecar is not bundled or cannot be resolved: {error}"))?
        .env("RQBIT_HTTP_API_LISTEN_ADDR", RQBIT_LISTEN_ADDR)
        .args([
            "server",
            "start",
            downloads_dir
                .to_str()
                .ok_or_else(|| "rqbit download directory is not valid UTF-8".to_string())?,
        ]);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|error| format!("failed to start rqbit sidecar: {error}"))?;

    {
        let mut child_slot = state
            .child
            .lock()
            .map_err(|_| "rqbit sidecar state is poisoned".to_string())?;
        *child_slot = Some(child);
    }

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    println!("[rqbit] {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[rqbit] {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Error(message) => {
                    eprintln!("[rqbit] {message}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[rqbit] terminated: {payload:?}");
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(RQBIT_ENDPOINT.to_string())
}

fn rqbit_downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join("rqbit").join("downloads"))
}

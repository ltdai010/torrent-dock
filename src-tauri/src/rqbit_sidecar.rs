use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const RQBIT_ENDPOINT: &str = "http://127.0.0.1:3030";
const RQBIT_LISTEN_ADDR: &str = "127.0.0.1:3030";
const RQBIT_STARTUP_ATTEMPTS: usize = 60;
const RQBIT_STARTUP_DELAY: Duration = Duration::from_millis(250);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RqbitApiResponse {
    pub status: u16,
    pub ok: bool,
    pub body: String,
}

/// Proxies a request to the local rqbit HTTP API from the Rust side.
///
/// The bundled webview is served from `http://tauri.localhost`, so calling the
/// rqbit API directly from the frontend is blocked by CORS (rqbit does not send
/// `Access-Control-Allow-Origin` for that origin). Running the request here
/// avoids the browser CORS check entirely, matching how the torrent source and
/// subtitle integrations already talk to remote hosts.
#[tauri::command]
pub async fn rqbit_api_request(
    method: String,
    path: String,
    body: Option<String>,
    content_type: Option<String>,
) -> Result<RqbitApiResponse, String> {
    if !path.starts_with('/') {
        return Err("rqbit API path must start with '/'".to_string());
    }

    let request_method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("invalid rqbit API method '{method}': {error}"))?;
    let url = format!("{RQBIT_ENDPOINT}{path}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("failed to create rqbit API client: {error}"))?;

    let mut request = client.request(request_method, &url);

    if let Some(content_type) = content_type {
        request = request.header(reqwest::header::CONTENT_TYPE, content_type);
    }

    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("rqbit API request failed: {error}"))?;
    let status = response.status();
    let response_body = response
        .text()
        .await
        .map_err(|error| format!("rqbit API response could not be read: {error}"))?;

    Ok(RqbitApiResponse {
        status: status.as_u16(),
        ok: status.is_success(),
        body: response_body,
    })
}

#[derive(Default)]
pub struct RqbitSidecarState {
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
pub async fn ensure_rqbit_sidecar(
    app: AppHandle,
    state: tauri::State<'_, RqbitSidecarState>,
) -> Result<String, String> {
    let has_child = state
        .child
        .lock()
        .map_err(|_| "rqbit sidecar state is poisoned".to_string())?
        .is_some();

    if has_child {
        if wait_for_rqbit().await.is_ok() {
            return Ok(RQBIT_ENDPOINT.to_string());
        }

        if let Ok(mut child_slot) = state.child.lock() {
            if let Some(child) = child_slot.take() {
                let _ = child.kill();
            }
        }
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

    if let Err(error) = wait_for_rqbit().await {
        if let Ok(mut child_slot) = state.child.lock() {
            if let Some(child) = child_slot.take() {
                let _ = child.kill();
            }
        }

        return Err(error);
    }

    Ok(RQBIT_ENDPOINT.to_string())
}

fn rqbit_downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join("rqbit").join("downloads"))
}

async fn wait_for_rqbit() -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .map_err(|error| format!("failed to create rqbit readiness client: {error}"))?;
    let readiness_url = format!("{RQBIT_ENDPOINT}/torrents");
    let mut last_error = "rqbit did not answer".to_string();

    for _ in 0..RQBIT_STARTUP_ATTEMPTS {
        match client.get(&readiness_url).send().await {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => {
                last_error = format!("rqbit returned HTTP {}", response.status());
            }
            Err(error) => {
                last_error = error.to_string();
            }
        }

        let _ = tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(RQBIT_STARTUP_DELAY);
        })
        .await;
    }

    Err(format!(
        "rqbit sidecar did not become ready at {RQBIT_ENDPOINT}: {last_error}"
    ))
}

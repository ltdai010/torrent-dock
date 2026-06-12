use std::time::Duration;

use serde::Serialize;

const SUBSOURCE_API_BASE: &str = "https://api.subsource.net";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubSourceApiResponse {
    pub status: u16,
    pub ok: bool,
    pub body: String,
}

fn subsource_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("failed to create SubSource client: {error}"))
}

/// Performs an authenticated SubSource JSON GET from the Rust side.
///
/// The packaged webview cannot call api.subsource.net directly: it is a
/// cross-origin request and the required `X-API-Key` header triggers a CORS
/// preflight that the site does not allow. Running it here avoids CORS, the
/// same approach already used for torrent sources and OpenSubtitles.
#[tauri::command]
pub async fn subsource_api_get(
    path: String,
    api_key: String,
) -> Result<SubSourceApiResponse, String> {
    if !path.starts_with("/api/") {
        return Err("invalid SubSource API path".to_string());
    }

    let url = format!("{SUBSOURCE_API_BASE}{path}");
    let response = subsource_client()?
        .get(&url)
        .header("X-API-Key", api_key)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("SubSource request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("SubSource response could not be read: {error}"))?;

    Ok(SubSourceApiResponse {
        status: status.as_u16(),
        ok: status.is_success(),
        body,
    })
}

#[tauri::command]
pub async fn subsource_download(subtitle_id: u64, api_key: String) -> Result<Vec<u8>, String> {
    let url = format!("{SUBSOURCE_API_BASE}/api/v1/subtitles/{subtitle_id}/download");
    let response = subsource_client()?
        .get(&url)
        .header("X-API-Key", api_key)
        .header(
            reqwest::header::ACCEPT,
            "application/octet-stream,application/zip,text/plain,*/*",
        )
        .send()
        .await
        .map_err(|error| format!("SubSource download failed: {error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("SubSource download could not be read: {error}"))?;

    if !status.is_success() {
        return Err(format!("SubSource download returned HTTP {status}"));
    }

    Ok(bytes.to_vec())
}

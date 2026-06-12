use std::time::Duration;

const OPEN_SUBTITLES_XML_RPC_URL: &str = "https://api.opensubtitles.org/xml-rpc";
const OPEN_SUBTITLES_USER_AGENT: &str = "Popcorn Time v1";
const OPEN_SUBTITLES_DOWNLOAD_HOSTS: &[&str] = &[
    "dl.opensubtitles.org",
    "www.opensubtitles.org",
    "opensubtitles.org",
];

#[tauri::command]
pub async fn open_subtitles_org_request(body: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(OPEN_SUBTITLES_USER_AGENT)
        .build()
        .map_err(|error| format!("failed to create OpenSubtitles.org client: {error}"))?;
    let response = client
        .post(OPEN_SUBTITLES_XML_RPC_URL)
        .header(reqwest::header::CONTENT_TYPE, "text/xml")
        .body(body)
        .send()
        .await
        .map_err(|error| format!("OpenSubtitles.org request failed: {error}"))?;
    let status = response.status();
    let response_body = response
        .text()
        .await
        .map_err(|error| format!("OpenSubtitles.org response could not be read: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "OpenSubtitles.org returned HTTP {status}: {}",
            response_body.chars().take(180).collect::<String>()
        ));
    }

    Ok(response_body)
}

#[tauri::command]
pub async fn open_subtitles_org_download(url: String) -> Result<Vec<u8>, String> {
    let url = reqwest::Url::parse(&url)
        .map_err(|error| format!("invalid OpenSubtitles.org download URL: {error}"))?;
    let host = url
        .host_str()
        .ok_or_else(|| "invalid OpenSubtitles.org download URL: missing host".to_string())?;

    if !OPEN_SUBTITLES_DOWNLOAD_HOSTS.contains(&host) {
        return Err(format!(
            "refusing unexpected OpenSubtitles.org download host: {host}"
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(OPEN_SUBTITLES_USER_AGENT)
        .build()
        .map_err(|error| format!("failed to create OpenSubtitles.org download client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("OpenSubtitles.org direct download failed: {error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("OpenSubtitles.org direct download could not be read: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "OpenSubtitles.org direct download returned HTTP {status}"
        ));
    }

    Ok(bytes.to_vec())
}

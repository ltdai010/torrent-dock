use std::io::Write;
use std::sync::OnceLock;

use tauri::http::{Request, Response, StatusCode};
use tauri::UriSchemeResponder;

const RQBIT_ENDPOINT: &str = "http://127.0.0.1:3030";

// Release builds run as a Windows GUI subsystem app, so stdout/stderr are not
// visible. Append diagnostics to a log file we can read instead.
fn log_line(message: &str) {
    eprintln!("{message}");
    let mut targets = vec![std::env::temp_dir().join("torrentdock-stream.log")];
    if let Ok(appdata) = std::env::var("APPDATA") {
        targets.push(
            std::path::Path::new(&appdata)
                .join("app.torrentdock.desktop")
                .join("torrentdock-stream.log"),
        );
    }
    for path in targets {
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(file, "{message}");
        }
    }
}

/// Frontend diagnostic hook so we can confirm from logs whether the custom
/// `stream` protocol request reached this process at all.
#[tauri::command]
pub fn stream_probe_log(message: String) {
    log_line(&format!("[probe] {message}"));
}
// Each upstream request is bounded so we never buffer a whole movie in memory.
// The media element keeps requesting subsequent ranges as it plays/seeks.
const STREAM_CHUNK_SIZE: u64 = 4 * 1024 * 1024;

fn shared_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder().build().unwrap_or_default())
}

/// Handles requests to the custom `stream` protocol and proxies them to the
/// local rqbit HTTP API.
///
/// The packaged webview origin (`http://tauri.localhost`) cannot load media
/// directly from `http://127.0.0.1:3030` because Chromium blocks the
/// cross-address-space request (Private Network Access). Serving the stream
/// through this in-process protocol keeps the `<video>` source same-origin and
/// preserves HTTP Range semantics so seeking still works.
pub fn handle_stream_request(request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let uri = request.uri().to_string();
    let range = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("<none>")
        .to_string();
    log_line(&format!("[stream] request uri={uri} range={range}"));

    tauri::async_runtime::spawn(async move {
        let response = match build_stream_response(&request).await {
            Ok(response) => {
                log_line(&format!("[stream] responding status={}", response.status()));
                response
            }
            Err(message) => {
                log_line(&format!("[stream] error: {message}"));
                error_response(&message)
            }
        };

        responder.respond(response);
    });
}

async fn build_stream_response(request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, String> {
    let path = request.uri().path();
    let mut segments = path.trim_matches('/').split('/');
    let torrent_id = segments
        .next()
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| "missing torrent id".to_string())?
        .parse::<u64>()
        .map_err(|_| "invalid torrent id".to_string())?;
    let file_index = segments
        .next()
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| "missing file index".to_string())?
        .parse::<u64>()
        .map_err(|_| "invalid file index".to_string())?;

    let target = format!("{RQBIT_ENDPOINT}/torrents/{torrent_id}/stream/{file_index}");

    let requested_range = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let start = parse_range_start(requested_range.as_deref()).unwrap_or(0);
    let end = start.saturating_add(STREAM_CHUNK_SIZE).saturating_sub(1);

    let upstream = shared_client()
        .get(&target)
        .header(reqwest::header::RANGE, format!("bytes={start}-{end}"))
        .send()
        .await
        .map_err(|error| format!("stream request failed: {error}"))?;

    let upstream_status = upstream.status();
    let content_type = header_string(
        upstream.headers(),
        reqwest::header::CONTENT_TYPE,
        "video/mp4",
    );
    let content_range = upstream
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    log_line(&format!(
        "[stream] upstream {target} -> status={upstream_status} type={content_type} content-range={content_range:?}"
    ));

    let bytes = upstream
        .bytes()
        .await
        .map_err(|error| format!("stream read failed: {error}"))?
        .to_vec();
    if !upstream_status.is_success() {
        log_line(&format!(
            "[stream] upstream error body={}",
            String::from_utf8_lossy(&bytes)
        ));
    }

    // Present partial content whenever the client asked for a range, even if
    // rqbit happened to answer with 200 for an open-ended request.
    let status = if requested_range.is_some() && upstream_status == StatusCode::OK {
        StatusCode::PARTIAL_CONTENT
    } else {
        upstream_status
    };

    let mut builder = Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, content_type)
        .header(tauri::http::header::ACCEPT_RANGES, "bytes")
        .header(tauri::http::header::CACHE_CONTROL, "no-store")
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(tauri::http::header::CONTENT_LENGTH, bytes.len().to_string());

    if let Some(content_range) = content_range {
        builder = builder.header(tauri::http::header::CONTENT_RANGE, content_range);
    }

    builder
        .body(bytes)
        .map_err(|error| format!("failed to build stream response: {error}"))
}

fn error_response(message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::BAD_GATEWAY)
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn header_string(
    headers: &reqwest::header::HeaderMap,
    name: reqwest::header::HeaderName,
    fallback: &str,
) -> String {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or(fallback)
        .to_string()
}

fn parse_range_start(range: Option<&str>) -> Option<u64> {
    range?
        .strip_prefix("bytes=")?
        .split('-')
        .next()?
        .trim()
        .parse::<u64>()
        .ok()
}

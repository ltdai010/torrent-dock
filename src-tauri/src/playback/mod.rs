mod backend;
mod mpv;
mod surface;

use self::{
    backend::PlayerBackend,
    mpv::{
        MpvEventSnapshot, MPV_EVENT_AUDIO_RECONFIG, MPV_EVENT_END_FILE, MPV_EVENT_FILE_LOADED,
        MPV_EVENT_NONE, MPV_EVENT_PLAYBACK_RESTART, MPV_EVENT_SEEK, MPV_EVENT_SHUTDOWN,
        MPV_EVENT_TRACKS_CHANGED, MPV_EVENT_VIDEO_RECONFIG,
    },
    surface::{NativeSurface, SurfaceBounds},
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender, TryRecvError},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use url::Url;

pub(super) const PLAYER_STATE_EVENT: &str = "player://state";
pub(super) const PLAYER_TIME_EVENT: &str = "player://time";
const PLAYER_DURATION_EVENT: &str = "player://duration";
const PLAYER_BUFFERING_EVENT: &str = "player://buffering";
const PLAYER_TRACKS_EVENT: &str = "player://tracks";
const PLAYER_VIDEO_EVENT: &str = "player://video-params";
const PLAYER_AUDIO_EVENT: &str = "player://audio-params";
const PLAYER_SEEK_EVENT: &str = "player://seek-complete";
pub(super) const PLAYER_END_EVENT: &str = "player://end";
pub(super) const PLAYER_WARNING_EVENT: &str = "player://warning";
const PLAYER_ERROR_EVENT: &str = "player://error";

static SUBTITLE_SEQUENCE: AtomicU64 = AtomicU64::new(1);
const PLAYER_COMMAND_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerCapabilities {
    available: bool,
    backend: String,
    platform: String,
    library_path: Option<String>,
    reason: Option<String>,
    supports_native_surface: bool,
    supports_embedded_tracks: bool,
    supports_external_subtitles: bool,
}

impl Default for PlayerCapabilities {
    fn default() -> Self {
        Self {
            available: false,
            backend: "html".into(),
            platform: std::env::consts::OS.into(),
            library_path: None,
            reason: Some("Native playback has not been initialized.".into()),
            supports_native_surface: cfg!(windows),
            supports_embedded_tracks: false,
            supports_external_subtitles: false,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StatePayload {
    pub(super) state: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ValuePayload {
    pub(super) value: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BufferingPayload {
    buffering: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MessagePayload {
    pub(super) message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackInfo {
    id: i64,
    kind: String,
    title: String,
    language: Option<String>,
    selected: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TracksPayload {
    tracks: Vec<TrackInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoParamsPayload {
    width: Option<i64>,
    height: Option<i64>,
    format: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioParamsPayload {
    format: Option<String>,
    channels: Option<String>,
    sample_rate: Option<i64>,
}

enum PlayerCommand {
    Load {
        url: String,
        title: String,
        start_position: f64,
    },
    SetProperty {
        name: &'static str,
        value: String,
    },
    Command(Vec<String>),
    AddSubtitle {
        path: PathBuf,
        title: String,
    },
    SetSurface {
        rect: SurfaceBounds,
        scale_factor: f64,
        visible: bool,
    },
    SetFullscreen(bool),
    Stop,
    Shutdown,
}

struct WorkerMessage {
    command: PlayerCommand,
    response: Sender<Result<(), String>>,
}

struct ServiceInner {
    sender: Option<Sender<WorkerMessage>>,
    capabilities: PlayerCapabilities,
}

pub struct PlaybackService {
    inner: Mutex<ServiceInner>,
}

pub fn maybe_start_native_smoke_test(app: &mut tauri::App) {
    let Ok(url) = std::env::var("TORRENTDOCK_NATIVE_TEST_URL") else {
        return;
    };

    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[mpv-smoke] main window was not available");
        return;
    };

    let app_handle = app.handle().clone();
    thread::Builder::new()
        .name("torrentdock-mpv-smoke".into())
        .spawn(move || {
            thread::sleep(Duration::from_secs(2));
            if let Err(error) = run_native_smoke_test(app_handle, window, url) {
                eprintln!("[mpv-smoke] {error}");
            }
        })
        .ok();
}

impl Default for PlaybackService {
    fn default() -> Self {
        Self {
            inner: Mutex::new(ServiceInner {
                sender: None,
                capabilities: PlayerCapabilities::default(),
            }),
        }
    }
}

impl Drop for PlaybackService {
    fn drop(&mut self) {
        let sender = self
            .inner
            .get_mut()
            .ok()
            .and_then(|inner| inner.sender.take());
        if let Some(sender) = sender {
            let (response, _) = mpsc::channel();
            let _ = sender.send(WorkerMessage {
                command: PlayerCommand::Shutdown,
                response,
            });
        }
    }
}

impl PlaybackService {
    fn send(&self, command: PlayerCommand) -> Result<(), String> {
        let sender = self
            .inner
            .lock()
            .map_err(|_| "Playback service lock was poisoned.".to_string())?
            .sender
            .clone()
            .ok_or_else(|| "Native playback is unavailable; using the HTML player.".to_string())?;
        let (response_tx, response_rx) = mpsc::channel();
        sender
            .send(WorkerMessage {
                command,
                response: response_tx,
            })
            .map_err(|_| "The native player thread has stopped.".to_string())?;
        response_rx
            .recv_timeout(PLAYER_COMMAND_TIMEOUT)
            .map_err(|_| {
                "The native player did not answer before the command timed out.".to_string()
            })?
    }
}

#[tauri::command]
pub fn player_initialize(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, PlaybackService>,
) -> PlayerCapabilities {
    let mut inner = match service.inner.lock() {
        Ok(inner) => inner,
        Err(_) => return PlayerCapabilities::default(),
    };

    if inner.sender.is_some() {
        return inner.capabilities.clone();
    }

    let prepared_backend = match backend::prepare(&app, &window) {
        Ok(prepared_backend) => prepared_backend,
        Err(error) => {
            inner.capabilities = PlayerCapabilities {
                reason: Some(error),
                ..PlayerCapabilities::default()
            };
            let _ = app.emit(
                PLAYER_WARNING_EVENT,
                MessagePayload {
                    message: inner
                        .capabilities
                        .reason
                        .clone()
                        .unwrap_or_else(|| "Native surface creation failed.".into()),
                },
            );
            return inner.capabilities.clone();
        }
    };

    let (command_tx, command_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let worker_app = app.clone();
    let runtime_description = prepared_backend.runtime_description;
    let backend_name = prepared_backend.backend_name;
    let supports_native_surface = prepared_backend.supports_native_surface;
    let supports_embedded_tracks = prepared_backend.supports_embedded_tracks;
    let supports_external_subtitles = prepared_backend.supports_external_subtitles;
    let spawn_result = thread::Builder::new()
        .name(format!("torrentdock-{backend_name}"))
        .spawn(move || {
            let mut worker = PlayerWorker::new(
                prepared_backend.backend,
                prepared_backend.surface,
                worker_app,
            );
            let _ = ready_tx.send(Ok(()));
            if let Err(error) = worker.run(command_rx) {
                let _ = ready_tx.send(Err(error));
            }
        });

    if let Err(error) = spawn_result {
        inner.capabilities = PlayerCapabilities {
            library_path: Some(runtime_description),
            reason: Some(format!("Could not start the native player thread: {error}")),
            ..PlayerCapabilities::default()
        };
        return inner.capabilities.clone();
    }

    match ready_rx.recv_timeout(Duration::from_secs(4)) {
        Ok(Ok(())) => {
            inner.sender = Some(command_tx);
            inner.capabilities = PlayerCapabilities {
                available: true,
                backend: backend_name,
                platform: std::env::consts::OS.into(),
                library_path: Some(runtime_description),
                reason: None,
                supports_native_surface,
                supports_embedded_tracks,
                supports_external_subtitles,
            };
        }
        Ok(Err(error)) => {
            inner.capabilities = PlayerCapabilities {
                library_path: Some(runtime_description),
                reason: Some(error),
                ..PlayerCapabilities::default()
            };
        }
        Err(_) => {
            inner.capabilities = PlayerCapabilities {
                library_path: Some(runtime_description),
                reason: Some("Native mpv initialization timed out; using HTML fallback.".into()),
                ..PlayerCapabilities::default()
            };
        }
    }

    inner.capabilities.clone()
}

#[tauri::command]
pub fn player_get_capabilities(service: State<'_, PlaybackService>) -> PlayerCapabilities {
    service
        .inner
        .lock()
        .map(|inner| inner.capabilities.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn player_load(
    torrent_id: i64,
    file_index: i64,
    title: String,
    start_position: f64,
    service: State<'_, PlaybackService>,
) -> Result<(), String> {
    if torrent_id < 0 || file_index < 0 {
        return Err("Torrent and file ids must be non-negative.".into());
    }
    let url = format!("http://127.0.0.1:3030/torrents/{torrent_id}/stream/{file_index}");
    validate_stream_url(&url)?;
    service.send(PlayerCommand::Load {
        url,
        title,
        start_position: start_position.max(0.0),
    })
}

#[tauri::command]
pub fn player_play(service: State<'_, PlaybackService>) -> Result<(), String> {
    service.send(PlayerCommand::SetProperty {
        name: "pause",
        value: "no".into(),
    })
}

#[tauri::command]
pub fn player_pause(service: State<'_, PlaybackService>) -> Result<(), String> {
    service.send(PlayerCommand::SetProperty {
        name: "pause",
        value: "yes".into(),
    })
}

#[tauri::command]
pub fn player_stop(service: State<'_, PlaybackService>) -> Result<(), String> {
    service.send(PlayerCommand::Stop)
}

#[tauri::command]
pub fn player_seek(seconds: f64, service: State<'_, PlaybackService>) -> Result<(), String> {
    service.send(PlayerCommand::Command(vec![
        "seek".into(),
        seconds.max(0.0).to_string(),
        "absolute+exact".into(),
    ]))
}

#[tauri::command]
pub fn player_set_volume(value: f64, service: State<'_, PlaybackService>) -> Result<(), String> {
    service.send(PlayerCommand::SetProperty {
        name: "volume",
        value: value.clamp(0.0, 100.0).to_string(),
    })
}

#[tauri::command]
pub fn player_set_muted(value: bool, service: State<'_, PlaybackService>) -> Result<(), String> {
    service.send(PlayerCommand::SetProperty {
        name: "mute",
        value: if value { "yes" } else { "no" }.into(),
    })
}

#[tauri::command]
pub fn player_set_rate(value: f64, service: State<'_, PlaybackService>) -> Result<(), String> {
    service.send(PlayerCommand::SetProperty {
        name: "speed",
        value: value.clamp(0.25, 4.0).to_string(),
    })
}

#[tauri::command]
pub fn player_set_fullscreen(
    value: bool,
    service: State<'_, PlaybackService>,
) -> Result<(), String> {
    service.send(PlayerCommand::SetFullscreen(value))
}

#[tauri::command]
pub fn player_select_audio(
    track_id: i64,
    service: State<'_, PlaybackService>,
) -> Result<(), String> {
    service.send(PlayerCommand::SetProperty {
        name: "aid",
        value: track_id.to_string(),
    })
}

#[tauri::command]
pub fn player_select_subtitle(
    track_id: i64,
    service: State<'_, PlaybackService>,
) -> Result<(), String> {
    service.send(PlayerCommand::SetProperty {
        name: "sid",
        value: if track_id < 0 {
            "no".into()
        } else {
            track_id.to_string()
        },
    })
}

#[tauri::command]
pub fn player_add_subtitle_text(
    name: String,
    content: String,
    service: State<'_, PlaybackService>,
) -> Result<(), String> {
    if content.len() > 10 * 1024 * 1024 {
        return Err("Subtitle text is larger than 10 MB.".into());
    }

    let path = write_temporary_subtitle(&name, &content)?;
    service.send(PlayerCommand::AddSubtitle { path, title: name })
}

#[tauri::command]
pub fn player_set_subtitle_delay(
    seconds: f64,
    service: State<'_, PlaybackService>,
) -> Result<(), String> {
    service.send(PlayerCommand::SetProperty {
        name: "sub-delay",
        value: seconds.clamp(-600.0, 600.0).to_string(),
    })
}

#[tauri::command]
pub fn player_set_subtitle_scale(
    value: f64,
    service: State<'_, PlaybackService>,
) -> Result<(), String> {
    service.send(PlayerCommand::SetProperty {
        name: "sub-scale",
        value: value.clamp(0.5, 3.0).to_string(),
    })
}

#[tauri::command]
pub fn player_set_surface_bounds(
    rect: SurfaceBounds,
    scale_factor: f64,
    visible: bool,
    service: State<'_, PlaybackService>,
) -> Result<(), String> {
    service.send(PlayerCommand::SetSurface {
        rect,
        scale_factor,
        visible,
    })
}

struct PlayerWorker {
    backend: PlayerBackend,
    surface: Option<NativeSurface>,
    app: AppHandle,
    subtitle_paths: Vec<PathBuf>,
}

impl PlayerWorker {
    fn new(backend: PlayerBackend, surface: Option<NativeSurface>, app: AppHandle) -> Self {
        Self {
            backend,
            surface,
            app,
            subtitle_paths: Vec::new(),
        }
    }

    fn run(&mut self, receiver: Receiver<WorkerMessage>) -> Result<(), String> {
        let mut last_metrics_emit = Instant::now();
        let native_smoke_log = std::env::var_os("TORRENTDOCK_NATIVE_TEST_URL").is_some();
        let mut native_smoke_time_reported = false;

        loop {
            loop {
                match receiver.try_recv() {
                    Ok(message) => {
                        let shutdown = matches!(message.command, PlayerCommand::Shutdown);
                        let result = self.handle_command(message.command);
                        if let Err(error) = &result {
                            let _ = self.app.emit(
                                PLAYER_ERROR_EVENT,
                                MessagePayload {
                                    message: error.clone(),
                                },
                            );
                        }
                        let _ = message.response.send(result);
                        if shutdown {
                            return Ok(());
                        }
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => return Ok(()),
                }
            }

            match &mut self.backend {
                PlayerBackend::LibMpv { api, handle } => match api.wait_event(*handle, 0.05) {
                    MpvEventSnapshot::None => {}
                    MpvEventSnapshot::Double(name, value) if name == "time-pos" => {
                        let _ = self.app.emit(PLAYER_TIME_EVENT, ValuePayload { value });
                    }
                    MpvEventSnapshot::Double(name, value)
                        if name == "duration" && value.is_finite() && value > 0.0 =>
                    {
                        let _ = self.app.emit(PLAYER_DURATION_EVENT, ValuePayload { value });
                    }
                    MpvEventSnapshot::Flag(name, paused) if name == "pause" => {
                        let _ = self.app.emit(
                            PLAYER_STATE_EVENT,
                            StatePayload {
                                state: if paused { "paused" } else { "playing" },
                            },
                        );
                    }
                    MpvEventSnapshot::Flag(name, buffering) if name == "paused-for-cache" => {
                        let _ = self
                            .app
                            .emit(PLAYER_BUFFERING_EVENT, BufferingPayload { buffering });
                    }
                    MpvEventSnapshot::Event(MPV_EVENT_FILE_LOADED) => {
                        if native_smoke_log {
                            eprintln!("[mpv-smoke] file-loaded");
                        }
                        let _ = self
                            .app
                            .emit(PLAYER_STATE_EVENT, StatePayload { state: "playing" });
                        self.emit_duration();
                        self.emit_tracks();
                        self.emit_media_params();
                    }
                    MpvEventSnapshot::Event(MPV_EVENT_TRACKS_CHANGED) => self.emit_tracks(),
                    MpvEventSnapshot::Event(MPV_EVENT_VIDEO_RECONFIG)
                    | MpvEventSnapshot::Event(MPV_EVENT_AUDIO_RECONFIG) => {
                        if native_smoke_log {
                            eprintln!("[mpv-smoke] media-reconfig");
                        }
                        self.emit_duration();
                        self.emit_media_params();
                    }
                    MpvEventSnapshot::Event(MPV_EVENT_SEEK)
                    | MpvEventSnapshot::Event(MPV_EVENT_PLAYBACK_RESTART) => {
                        if native_smoke_log {
                            eprintln!("[mpv-smoke] playback-restart");
                        }
                        self.emit_duration();
                        let _ = self.app.emit(PLAYER_SEEK_EVENT, ());
                    }
                    MpvEventSnapshot::Event(MPV_EVENT_END_FILE) => {
                        if native_smoke_log {
                            eprintln!("[mpv-smoke] end-file");
                        }
                        let _ = self.app.emit(PLAYER_END_EVENT, ());
                        self.cleanup_subtitles();
                    }
                    MpvEventSnapshot::Event(MPV_EVENT_SHUTDOWN) => return Ok(()),
                    MpvEventSnapshot::Event(MPV_EVENT_NONE) => {}
                    _ => {}
                },
                _ => {
                    self.backend.poll_external(&self.app);
                    thread::sleep(Duration::from_millis(50));
                }
            }

            if matches!(self.backend, PlayerBackend::LibMpv { .. })
                && last_metrics_emit.elapsed() >= Duration::from_millis(250)
            {
                self.emit_playback_metrics();
                if native_smoke_log && !native_smoke_time_reported {
                    if let Some(time) = self.read_f64_property("time-pos") {
                        if time > 0.2 {
                            eprintln!("[mpv-smoke] time-pos={time:.2}");
                            native_smoke_time_reported = true;
                        }
                    }
                }
                last_metrics_emit = Instant::now();
            }
        }
    }

    fn handle_command(&mut self, command: PlayerCommand) -> Result<(), String> {
        match command {
            PlayerCommand::Load {
                url,
                title,
                start_position,
            } => {
                self.cleanup_subtitles();
                self.backend.load(&self.app, url, title, start_position)
            }
            PlayerCommand::SetProperty { name, value } => {
                self.backend.set_property(&self.app, name, value)
            }
            PlayerCommand::Command(args) => self.backend.command(&self.app, args),
            PlayerCommand::AddSubtitle { path, title } => {
                let added = self.backend.add_subtitle(path.clone(), title)?;
                if added {
                    self.subtitle_paths.push(path);
                    self.emit_tracks();
                }
                Ok(())
            }
            PlayerCommand::SetSurface {
                rect,
                scale_factor,
                visible,
            } => {
                if let Some(surface) = &self.surface {
                    surface.set_bounds_on_main(&self.app, rect, scale_factor, visible)?;
                }
                Ok(())
            }
            PlayerCommand::SetFullscreen(value) => {
                if let Some(surface) = &self.surface {
                    surface.set_fullscreen_on_main(&self.app, value)?;
                }
                self.backend.set_fullscreen(&self.app, value)
            }
            PlayerCommand::Stop => {
                if let Some(surface) = &self.surface {
                    surface.set_bounds_on_main(
                        &self.app,
                        SurfaceBounds {
                            x: 0.0,
                            y: 0.0,
                            width: 1.0,
                            height: 1.0,
                        },
                        1.0,
                        false,
                    )?;
                }
                self.cleanup_subtitles();
                self.backend.stop(&self.app)
            }
            PlayerCommand::Shutdown => {
                self.backend.shutdown();
                Ok(())
            }
        }
    }

    fn emit_tracks(&self) {
        let PlayerBackend::LibMpv { api, handle } = &self.backend else {
            return;
        };
        let handle = *handle;
        let count = api
            .get_property(handle, "track-list/count")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let mut tracks = Vec::new();

        for index in 0..count {
            let prefix = format!("track-list/{index}");
            let kind = api
                .get_property(handle, &format!("{prefix}/type"))
                .unwrap_or_default();
            if kind != "audio" && kind != "sub" {
                continue;
            }
            let Some(id) = api
                .get_property(handle, &format!("{prefix}/id"))
                .and_then(|value| value.parse::<i64>().ok())
            else {
                continue;
            };
            let title = api
                .get_property(handle, &format!("{prefix}/title"))
                .filter(|value| !value.is_empty())
                .or_else(|| api.get_property(handle, &format!("{prefix}/lang")))
                .unwrap_or_else(|| {
                    format!(
                        "{} {id}",
                        if kind == "audio" { "Audio" } else { "Subtitle" }
                    )
                });
            let language = api
                .get_property(handle, &format!("{prefix}/lang"))
                .filter(|value| !value.is_empty());
            let selected = api
                .get_property(handle, &format!("{prefix}/selected"))
                .is_some_and(|value| value == "yes");
            tracks.push(TrackInfo {
                id,
                kind: if kind == "sub" {
                    "subtitle".into()
                } else {
                    kind
                },
                title,
                language,
                selected,
            });
        }

        let _ = self.app.emit(PLAYER_TRACKS_EVENT, TracksPayload { tracks });
    }

    fn emit_media_params(&self) {
        let PlayerBackend::LibMpv { api, handle } = &self.backend else {
            return;
        };
        let handle = *handle;
        let parse_i64 = |name: &str| {
            api.get_property(handle, name)
                .and_then(|value| value.parse::<i64>().ok())
        };
        let _ = self.app.emit(
            PLAYER_VIDEO_EVENT,
            VideoParamsPayload {
                width: parse_i64("video-params/w"),
                height: parse_i64("video-params/h"),
                format: api.get_property(handle, "video-format"),
            },
        );
        let _ = self.app.emit(
            PLAYER_AUDIO_EVENT,
            AudioParamsPayload {
                format: api.get_property(handle, "audio-codec-name"),
                channels: api.get_property(handle, "audio-params/hr-channels"),
                sample_rate: parse_i64("audio-params/samplerate"),
            },
        );
    }

    fn emit_duration(&self) {
        let Some(value) = self
            .read_f64_property("duration")
            .or_else(|| self.read_f64_property("duration/full"))
            .or_else(|| self.read_remaining_duration())
            .or_else(|| self.read_duration_metadata())
            .or_else(|| self.read_estimated_duration())
            .filter(|value| value.is_finite() && *value > 0.0)
        else {
            return;
        };

        let _ = self.app.emit(PLAYER_DURATION_EVENT, ValuePayload { value });
    }

    fn emit_playback_metrics(&self) {
        if let Some(value) = self
            .read_f64_property("time-pos")
            .or_else(|| self.read_f64_property("playback-time"))
            .filter(|value| value.is_finite() && *value >= 0.0)
        {
            let _ = self.app.emit(PLAYER_TIME_EVENT, ValuePayload { value });
        }

        self.emit_duration();
    }

    fn read_f64_property(&self, name: &str) -> Option<f64> {
        let PlayerBackend::LibMpv { api, handle } = &self.backend else {
            return None;
        };
        api.get_property(*handle, name)
            .and_then(|value| value.parse::<f64>().ok())
    }

    fn read_duration_metadata(&self) -> Option<f64> {
        let PlayerBackend::LibMpv { api, handle } = &self.backend else {
            return None;
        };
        let handle = *handle;
        [
            "metadata/by-key/DURATION",
            "metadata/by-key/duration",
            "metadata/by-key/TIMELENGTH",
        ]
        .into_iter()
        .find_map(|name| {
            api.get_property(handle, name)
                .and_then(|value| parse_duration_seconds(&value))
        })
    }

    fn read_remaining_duration(&self) -> Option<f64> {
        let position = self
            .read_f64_property("time-pos")
            .or_else(|| self.read_f64_property("playback-time"))?;
        let remaining = self.read_f64_property("playtime-remaining")?;

        (position.is_finite() && position >= 0.0 && remaining.is_finite() && remaining > 0.0)
            .then_some(position + remaining)
    }

    fn read_estimated_duration(&self) -> Option<f64> {
        if let (Some(frames), Some(fps)) = (
            self.read_f64_property("estimated-frame-count"),
            self.read_f64_property("container-fps")
                .or_else(|| self.read_f64_property("estimated-vf-fps")),
        ) {
            if frames.is_finite() && frames > 0.0 && fps.is_finite() && fps > 0.0 {
                return Some(frames / fps);
            }
        }

        let position = self
            .read_f64_property("time-pos")
            .or_else(|| self.read_f64_property("playback-time"))?;
        let percent = self.read_f64_property("percent-pos")?;

        (position.is_finite() && position > 0.0 && percent.is_finite() && percent > 0.0)
            .then_some(position * 100.0 / percent)
    }

    fn cleanup_subtitles(&mut self) {
        for path in self.subtitle_paths.drain(..) {
            let _ = fs::remove_file(path);
        }
    }
}

impl Drop for PlayerWorker {
    fn drop(&mut self) {
        self.cleanup_subtitles();
        self.backend.terminate();
        if let Some(surface) = &self.surface {
            surface.destroy_on_main(&self.app);
        }
    }
}

fn run_native_smoke_test(app: AppHandle, window: WebviewWindow, url: String) -> Result<(), String> {
    let fullscreen_smoke = std::env::var_os("TORRENTDOCK_NATIVE_TEST_FULLSCREEN").is_some();
    let prepared_backend = backend::prepare(&app, &window)?;
    if let Some(surface) = prepared_backend.surface.as_ref() {
        let smoke_bounds = if fullscreen_smoke {
            SurfaceBounds {
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
            }
        } else {
            SurfaceBounds {
                x: 80.0,
                y: 220.0,
                width: 920.0,
                height: 520.0,
            }
        };
        surface.set_bounds_on_main(&app, smoke_bounds, 1.0, true)?;
    }

    eprintln!(
        "[mpv-smoke] started {} backend using {}",
        prepared_backend.backend_name, prepared_backend.runtime_description
    );

    let mut worker = PlayerWorker::new(
        prepared_backend.backend,
        prepared_backend.surface,
        app.clone(),
    );
    let (command_tx, command_rx) = mpsc::channel();
    let (response_tx, _response_rx) = mpsc::channel();
    command_tx
        .send(WorkerMessage {
            command: PlayerCommand::Load {
                url,
                title: "TorrentDock native playback smoke test".into(),
                start_position: 0.0,
            },
            response: response_tx,
        })
        .map_err(|_| "Could not queue native smoke load command.".to_string())?;

    if let Ok(subtitle_text) = std::env::var("TORRENTDOCK_NATIVE_TEST_SUBTITLE_TEXT") {
        let subtitle_path = write_temporary_subtitle("smoke.srt", &subtitle_text)?;
        let subtitle_tx = command_tx.clone();
        thread::Builder::new()
            .name("torrentdock-mpv-smoke-subtitle".into())
            .spawn(move || {
                thread::sleep(Duration::from_secs(2));
                let (response_tx, response_rx) = mpsc::channel();
                if subtitle_tx
                    .send(WorkerMessage {
                        command: PlayerCommand::AddSubtitle {
                            path: subtitle_path,
                            title: "TorrentDock smoke subtitle".into(),
                        },
                        response: response_tx,
                    })
                    .is_err()
                {
                    eprintln!("[mpv-smoke] could not queue subtitle command");
                    return;
                }
                match response_rx.recv_timeout(PLAYER_COMMAND_TIMEOUT) {
                    Ok(Ok(())) => eprintln!("[mpv-smoke] subtitle-added"),
                    Ok(Err(error)) => eprintln!("[mpv-smoke] subtitle-error={error}"),
                    Err(_) => eprintln!("[mpv-smoke] subtitle-timeout"),
                }
            })
            .ok();
    }

    if std::env::var_os("TORRENTDOCK_NATIVE_TEST_CLOSE_RESUME").is_some() {
        let resume_tx = command_tx.clone();
        thread::Builder::new()
            .name("torrentdock-mpv-smoke-close-resume".into())
            .spawn(move || {
                thread::sleep(Duration::from_secs(4));
                let _ = std::process::Command::new("pkill")
                    .args(["-x", "mpv"])
                    .status();
                eprintln!("[mpv-smoke] external-close-sent");
                thread::sleep(Duration::from_secs(2));

                let (response_tx, response_rx) = mpsc::channel();
                if resume_tx
                    .send(WorkerMessage {
                        command: PlayerCommand::SetProperty {
                            name: "pause",
                            value: "no".into(),
                        },
                        response: response_tx,
                    })
                    .is_err()
                {
                    eprintln!("[mpv-smoke] could not queue resume command");
                    return;
                }
                match response_rx.recv_timeout(PLAYER_COMMAND_TIMEOUT) {
                    Ok(Ok(())) => eprintln!("[mpv-smoke] resume-after-close-ok"),
                    Ok(Err(error)) => eprintln!("[mpv-smoke] resume-after-close-error={error}"),
                    Err(_) => eprintln!("[mpv-smoke] resume-after-close-timeout"),
                }
            })
            .ok();
    }

    let shutdown_tx = command_tx.clone();
    thread::Builder::new()
        .name("torrentdock-mpv-smoke-timeout".into())
        .spawn(move || {
            thread::sleep(Duration::from_secs(60));
            let (response, _) = mpsc::channel();
            let _ = shutdown_tx.send(WorkerMessage {
                command: PlayerCommand::Shutdown,
                response,
            });
        })
        .ok();

    worker.run(command_rx)
}

fn validate_stream_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "The player stream URL is invalid.".to_string())?;
    let valid_host = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"));
    let valid_path = url.path().starts_with("/torrents/") && url.path().contains("/stream/");
    if url.scheme() != "http"
        || !valid_host
        || url.port_or_known_default() != Some(3030)
        || !valid_path
    {
        return Err("Only rqbit loopback stream URLs are allowed.".into());
    }
    Ok(())
}

fn write_temporary_subtitle(name: &str, content: &str) -> Result<PathBuf, String> {
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| matches!(value.to_ascii_lowercase().as_str(), "srt" | "vtt" | "ass"))
        .unwrap_or("srt");
    let directory = std::env::temp_dir().join("TorrentDock").join("subtitles");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the subtitle cache: {error}"))?;
    let sequence = SUBTITLE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let path = directory.join(format!("{}-{sequence}.{extension}", std::process::id()));
    fs::write(&path, content.as_bytes())
        .map_err(|error| format!("Could not write the temporary subtitle: {error}"))?;
    Ok(path)
}

fn parse_duration_seconds(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(seconds) = trimmed.parse::<f64>() {
        return (seconds.is_finite() && seconds > 0.0).then_some(seconds);
    }

    let parts = trimmed.split(':').collect::<Vec<_>>();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }

    let parse_part = |part: &str| part.trim().parse::<f64>().ok();
    let seconds = match parts.as_slice() {
        [minutes, seconds] => parse_part(minutes)? * 60.0 + parse_part(seconds)?,
        [hours, minutes, seconds] => {
            parse_part(hours)? * 3600.0 + parse_part(minutes)? * 60.0 + parse_part(seconds)?
        }
        _ => return None,
    };

    (seconds.is_finite() && seconds > 0.0).then_some(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_rqbit_loopback_stream_urls() {
        assert!(validate_stream_url("http://127.0.0.1:3030/torrents/3/stream/7").is_ok());
        assert!(validate_stream_url("https://example.com/video.mkv").is_err());
        assert!(validate_stream_url("http://127.0.0.1:3031/torrents/3/stream/7").is_err());
    }

    #[test]
    fn writes_utf8_subtitle_files() {
        let path = write_temporary_subtitle("movie.srt", "1\n00:00:00,000 --> 00:00:01,000\nHello")
            .expect("subtitle should be written");
        assert_eq!(
            fs::read_to_string(&path).expect("subtitle should be readable"),
            "1\n00:00:00,000 --> 00:00:01,000\nHello"
        );
        fs::remove_file(path).expect("subtitle should be removable");
    }

    #[test]
    fn parses_duration_metadata() {
        assert_eq!(parse_duration_seconds("90.5"), Some(90.5));
        assert_eq!(parse_duration_seconds("01:02:03.500000000"), Some(3723.5));
        assert_eq!(parse_duration_seconds("12:34.25"), Some(754.25));
        assert_eq!(parse_duration_seconds("inf"), None);
        assert_eq!(parse_duration_seconds(""), None);
    }
}

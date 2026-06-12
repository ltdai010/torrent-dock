use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use super::{PlayerBackend, PreparedBackend};
use crate::playback::{
    StatePayload, ValuePayload, PLAYER_END_EVENT, PLAYER_STATE_EVENT, PLAYER_TIME_EVENT,
};

static IPC_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct ExternalPlayback {
    url: String,
    title: String,
    start_position: f64,
}

#[derive(Clone)]
struct ExternalSubtitle {
    path: PathBuf,
}

pub(in crate::playback) struct ExternalMpvState {
    executable: PathBuf,
    child: Option<Child>,
    ipc_path: Option<PathBuf>,
    current: Option<ExternalPlayback>,
    subtitles: Vec<ExternalSubtitle>,
    last_position: f64,
    paused: bool,
    volume: f64,
    muted: bool,
    speed: f64,
    subtitle_delay: f64,
    subtitle_scale: f64,
    last_position_poll: Instant,
}

pub(super) fn prepare_external_process(
    app: &AppHandle,
    surface_error: String,
) -> Result<PreparedBackend, String> {
    let executable_candidates = executable_candidates(app);
    let Some(executable) = executable_candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
    else {
        return Err(format!(
            "{surface_error} Also could not find an mpv executable. Checked: {}.",
            executable_candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    };

    Ok(PreparedBackend {
        runtime_description: executable.display().to_string(),
        backend: PlayerBackend::ExternalMpv(ExternalMpvState::new(executable)),
        surface: None,
        backend_name: "mpv-process".into(),
        supports_native_surface: false,
        supports_embedded_tracks: false,
        supports_external_subtitles: true,
    })
}

impl ExternalMpvState {
    fn new(executable: PathBuf) -> Self {
        Self {
            executable,
            child: None,
            ipc_path: None,
            current: None,
            subtitles: Vec::new(),
            last_position: 0.0,
            paused: false,
            volume: 100.0,
            muted: false,
            speed: 1.0,
            subtitle_delay: 0.0,
            subtitle_scale: 1.0,
            last_position_poll: Instant::now(),
        }
    }

    pub(super) fn load(
        &mut self,
        app: &AppHandle,
        url: String,
        title: String,
        start_position: f64,
    ) -> Result<(), String> {
        self.stop();
        self.current = Some(ExternalPlayback {
            url,
            title,
            start_position,
        });
        self.last_position = start_position.max(0.0);
        self.paused = false;
        self.subtitles.clear();
        self.launch_current(app)
    }

    pub(super) fn add_subtitle(&mut self, path: PathBuf, title: String) -> Result<bool, String> {
        self.subtitles.push(ExternalSubtitle { path: path.clone() });

        if self.child.is_some() {
            let path_value = path
                .to_str()
                .ok_or_else(|| "Subtitle path is not valid UTF-8.".to_string())?;
            let result = self.send_command(json!(["sub-add", path_value, "select", title]));
            self.apply_subtitle_settings();
            result?;
        }

        Ok(true)
    }

    pub(super) fn set_property(
        &mut self,
        app: &AppHandle,
        name: &'static str,
        value: String,
    ) -> Result<(), String> {
        self.remember_property(name, &value);

        if self.child.is_none() {
            if name == "pause" && value == "no" && self.current.is_some() {
                self.paused = false;
                return self.launch_current(app);
            }
            return Ok(());
        }

        self.send_command(json!(["set_property", name, parse_property_value(name, &value)]))
    }

    pub(super) fn command(&mut self, app: &AppHandle, args: Vec<String>) -> Result<(), String> {
        if args.is_empty() {
            return Ok(());
        }

        if args[0] == "seek" {
            if let Some(seconds) = args.get(1).and_then(|value| value.parse::<f64>().ok()) {
                self.last_position = seconds.max(0.0);
            }
        }

        if self.child.is_none() {
            return if self.current.is_some() {
                self.launch_current(app)
            } else {
                Ok(())
            };
        }

        self.send_command(Value::Array(args.into_iter().map(Value::String).collect()))
    }

    pub(super) fn poll(&mut self, app: &AppHandle) {
        self.poll_position(app);

        if let Some(process) = &mut self.child {
            if matches!(process.try_wait(), Ok(Some(_))) {
                self.child = None;
                self.cleanup_ipc_socket();
                let _ = app.emit(PLAYER_END_EVENT, ());
                let _ = app.emit(PLAYER_STATE_EVENT, StatePayload { state: "stopped" });
            }
        }
    }

    pub(super) fn stop(&mut self) {
        if let Some(mut process) = self.child.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
        self.cleanup_ipc_socket();
    }

    fn launch_current(&mut self, app: &AppHandle) -> Result<(), String> {
        let Some(playback) = self.current.clone() else {
            return Ok(());
        };

        self.stop();
        let ipc_path = next_ipc_path();
        if let Some(parent) = ipc_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create mpv IPC directory: {error}"))?;
        }

        let start_position = self.last_position.max(playback.start_position).max(0.0);
        let mut command = Command::new(&self.executable);
        command
            .arg("--force-window=yes")
            .arg("--keep-open=yes")
            .arg("--really-quiet")
            .arg(format!("--input-ipc-server={}", ipc_path.display()))
            .arg(format!("--force-media-title={}", playback.title))
            .arg(format!("--volume={}", self.volume.clamp(0.0, 100.0)))
            .arg(format!("--mute={}", if self.muted { "yes" } else { "no" }))
            .arg(format!("--speed={}", self.speed.clamp(0.25, 4.0)))
            .arg(format!(
                "--sub-delay={}",
                self.subtitle_delay.clamp(-600.0, 600.0)
            ))
            .arg(format!(
                "--sub-scale={}",
                self.subtitle_scale.clamp(0.5, 3.0)
            ))
            .arg("--sid=auto");

        if start_position > 0.0 {
            command.arg(format!("--start={start_position}"));
        }
        for subtitle in &self.subtitles {
            command.arg(format!("--sub-file={}", subtitle.path.display()));
        }
        command
            .arg(playback.url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        self.ipc_path = Some(ipc_path);
        self.child = Some(
            command
                .spawn()
                .map_err(|error| format!("Could not start external mpv player: {error}"))?,
        );
        self.wait_for_ipc_socket();
        let _ = app.emit(PLAYER_STATE_EVENT, StatePayload { state: "playing" });
        Ok(())
    }

    fn remember_property(&mut self, name: &str, value: &str) {
        match name {
            "pause" => self.paused = value == "yes",
            "volume" => {
                if let Ok(next) = value.parse::<f64>() {
                    self.volume = next.clamp(0.0, 100.0);
                }
            }
            "mute" => self.muted = value == "yes",
            "speed" => {
                if let Ok(next) = value.parse::<f64>() {
                    self.speed = next.clamp(0.25, 4.0);
                }
            }
            "sub-delay" => {
                if let Ok(next) = value.parse::<f64>() {
                    self.subtitle_delay = next.clamp(-600.0, 600.0);
                }
            }
            "sub-scale" => {
                if let Ok(next) = value.parse::<f64>() {
                    self.subtitle_scale = next.clamp(0.5, 3.0);
                }
            }
            _ => {}
        }
    }

    fn poll_position(&mut self, app: &AppHandle) {
        if self.child.is_none() || self.last_position_poll.elapsed() < Duration::from_millis(500) {
            return;
        }
        self.last_position_poll = Instant::now();

        if let Ok(Some(position)) = self.get_f64_property("time-pos") {
            self.last_position = position.max(0.0);
            let _ = app.emit(PLAYER_TIME_EVENT, ValuePayload { value: position });
        }
    }

    fn apply_subtitle_settings(&self) {
        let _ = self.send_command(json!([
            "set_property",
            "sub-delay",
            self.subtitle_delay.clamp(-600.0, 600.0)
        ]));
        let _ = self.send_command(json!([
            "set_property",
            "sub-scale",
            self.subtitle_scale.clamp(0.5, 3.0)
        ]));
    }

    fn get_f64_property(&self, name: &str) -> Result<Option<f64>, String> {
        let response = self.send_command_with_response(json!(["get_property", name]))?;
        Ok(response.get("data").and_then(Value::as_f64))
    }

    fn send_command(&self, command: Value) -> Result<(), String> {
        let response = self.send_command_with_response(command)?;
        match response.get("error").and_then(Value::as_str) {
            Some("success") | None => Ok(()),
            Some(error) => Err(format!("mpv command failed: {error}")),
        }
    }

    fn send_command_with_response(&self, command: Value) -> Result<Value, String> {
        let Some(ipc_path) = &self.ipc_path else {
            return Ok(json!({ "error": "success" }));
        };

        let mut stream = UnixStream::connect(ipc_path)
            .map_err(|error| format!("Could not connect to mpv IPC socket: {error}"))?;
        stream
            .set_read_timeout(Some(Duration::from_millis(500)))
            .map_err(|error| format!("Could not configure mpv IPC timeout: {error}"))?;
        stream
            .write_all(format!("{}\n", json!({ "command": command })).as_bytes())
            .map_err(|error| format!("Could not send mpv IPC command: {error}"))?;

        let mut response = String::new();
        BufReader::new(stream)
            .read_line(&mut response)
            .map_err(|error| format!("Could not read mpv IPC response: {error}"))?;
        serde_json::from_str(&response)
            .map_err(|error| format!("Could not parse mpv IPC response: {error}"))
    }

    fn wait_for_ipc_socket(&self) {
        let Some(ipc_path) = &self.ipc_path else {
            return;
        };

        for _ in 0..20 {
            if ipc_path.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn cleanup_ipc_socket(&mut self) {
        if let Some(path) = self.ipc_path.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn parse_property_value(name: &str, value: &str) -> Value {
    match name {
        "pause" | "mute" | "fullscreen" => Value::Bool(value == "yes"),
        "volume" | "speed" | "sub-delay" | "sub-scale" => value
            .parse::<f64>()
            .map(Value::from)
            .unwrap_or_else(|_| Value::String(value.into())),
        "aid" | "sid" if value != "no" => value
            .parse::<i64>()
            .map(Value::from)
            .unwrap_or_else(|_| Value::String(value.into())),
        _ => Value::String(value.into()),
    }
}

fn next_ipc_path() -> PathBuf {
    std::env::temp_dir().join("TorrentDock").join("mpv-ipc").join(format!(
        "{}-{}.sock",
        std::process::id(),
        IPC_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ))
}

fn executable_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path) = std::env::var_os("TORRENTDOCK_MPV_EXECUTABLE") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("mpv").join("mpv"));
        candidates.push(resource_dir.join("mpv"));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(directory.join("mpv"));
            candidates.push(directory.join("mpv").join("mpv"));
        }
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/mpv"));
    candidates.push(PathBuf::from("/usr/local/bin/mpv"));

    candidates
}

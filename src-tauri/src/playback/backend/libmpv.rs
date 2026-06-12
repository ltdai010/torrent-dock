use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::{PlayerBackend, PreparedBackend};
use crate::playback::{
    mpv::{MpvApi, MpvHandle, MPV_FORMAT_DOUBLE, MPV_FORMAT_FLAG},
    surface::NativeSurface,
};

pub(in crate::playback) fn prepare_embedded(
    app: &AppHandle,
    surface: NativeSurface,
) -> Result<PreparedBackend, String> {
    let library_candidates = library_candidates(app);
    let Some((library_path, api)) = load_first(app) else {
        return Err(format!(
            "libmpv was not found. Checked libraries: {}.",
            library_candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    };

    let handle = create_handle(&api, &surface)?;
    Ok(PreparedBackend {
        backend: PlayerBackend::LibMpv { api, handle },
        surface: Some(surface),
        runtime_description: library_path.display().to_string(),
        backend_name: "libmpv".into(),
        supports_native_surface: true,
        supports_embedded_tracks: true,
        supports_external_subtitles: true,
    })
}

pub(super) fn load_first(app: &AppHandle) -> Option<(PathBuf, MpvApi)> {
    library_candidates(app)
        .into_iter()
        .find_map(|path| MpvApi::load(&path).ok().map(|api| (path, api)))
}

pub(super) fn create_handle(
    api: &MpvApi,
    surface: &NativeSurface,
) -> Result<*mut MpvHandle, String> {
    let handle = api.create_handle()?;
    let configure = (|| {
        set_option(&api, handle, "wid", &surface.native_id().to_string())?;
        set_option(&api, handle, "force-window", "no")?;
        set_option(&api, handle, "terminal", "no")?;
        set_option(&api, handle, "idle", "yes")?;
        set_option(&api, handle, "keep-open", "yes")?;
        set_option(&api, handle, "hwdec", "auto-safe")?;
        set_option(&api, handle, "vo", "gpu-next")?;
        set_option(&api, handle, "tone-mapping", "bt.2390")?;
        set_option(&api, handle, "hdr-compute-peak", "yes")?;
        #[cfg(windows)]
        set_option(&api, handle, "gpu-api", "d3d11")?;
        api.initialize(handle)
            .map_err(|error| format!("Could not initialize libmpv: {error}"))?;
        api.observe(handle, 1, "time-pos", MPV_FORMAT_DOUBLE)
            .map_err(|error| format!("Could not observe libmpv time-pos: {error}"))?;
        api.observe(handle, 2, "duration", MPV_FORMAT_DOUBLE)
            .map_err(|error| format!("Could not observe libmpv duration: {error}"))?;
        api.observe(handle, 3, "pause", MPV_FORMAT_FLAG)
            .map_err(|error| format!("Could not observe libmpv pause: {error}"))?;
        api.observe(handle, 4, "paused-for-cache", MPV_FORMAT_FLAG)
            .map_err(|error| format!("Could not observe libmpv paused-for-cache: {error}"))?;
        Ok(())
    })();

    if let Err(error) = configure {
        api.terminate_destroy(handle);
        return Err(error);
    }

    Ok(handle)
}

pub(super) fn load(
    api: &MpvApi,
    handle: *mut MpvHandle,
    url: String,
    title: String,
    start_position: f64,
) -> Result<(), String> {
    api.set_property(handle, "force-media-title", &title)?;
    let mut args = vec!["loadfile".into(), url, "replace".into()];
    if start_position > 0.0 {
        args.push(format!("start={start_position}"));
    }
    api.command(handle, &args)
        .map_err(|error| format!("Could not load media in libmpv: {error}"))
}

pub(super) fn add_subtitle(
    api: &MpvApi,
    handle: *mut MpvHandle,
    path: PathBuf,
    title: String,
) -> Result<bool, String> {
    let result = api.command(
        handle,
        &[
            "sub-add".into(),
            path.display().to_string(),
            "select".into(),
            title,
        ],
    );
    if result.is_err() {
        let _ = std::fs::remove_file(path);
    }
    result.map(|_| true)
}

fn set_option(
    api: &MpvApi,
    handle: *mut MpvHandle,
    name: &'static str,
    value: &str,
) -> Result<(), String> {
    api.set_option(handle, name, value)
        .map_err(|error| format!("Could not set libmpv option {name}={value}: {error}"))
}

fn library_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let file_name = if cfg!(windows) {
        "libmpv-2.dll"
    } else if cfg!(target_os = "macos") {
        "libmpv.2.dylib"
    } else {
        "libmpv.so.2"
    };
    let mut candidates = Vec::new();

    if let Some(path) = std::env::var_os("TORRENTDOCK_MPV_LIBRARY") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("mpv").join(file_name));
        candidates.push(resource_dir.join(file_name));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(directory.join(file_name));
            candidates.push(directory.join("mpv").join(file_name));
        }
    }
    candidates.push(PathBuf::from(file_name));
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/opt/homebrew/lib/libmpv.dylib"));
        candidates.push(PathBuf::from("/usr/local/lib/libmpv.dylib"));
    } else if cfg!(target_os = "linux") {
        candidates.push(PathBuf::from("/usr/lib/x86_64-linux-gnu/libmpv.so.2"));
        candidates.push(PathBuf::from("/usr/lib/libmpv.so.2"));
    }

    candidates
}

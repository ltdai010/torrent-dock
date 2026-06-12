pub(super) mod libmpv;

#[cfg(target_os = "macos")]
pub(super) mod macos;

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, WebviewWindow};

use super::{
    mpv::{MpvApi, MpvHandle},
    surface::NativeSurface,
    MessagePayload, StatePayload, PLAYER_STATE_EVENT, PLAYER_WARNING_EVENT,
};

pub(super) enum PlayerBackend {
    LibMpv {
        api: MpvApi,
        handle: *mut MpvHandle,
    },
    #[cfg(target_os = "macos")]
    ExternalMpv(macos::ExternalMpvState),
}

unsafe impl Send for PlayerBackend {}

pub(super) struct PreparedBackend {
    pub backend: PlayerBackend,
    pub surface: Option<NativeSurface>,
    pub runtime_description: String,
    pub backend_name: String,
    pub supports_native_surface: bool,
    pub supports_embedded_tracks: bool,
    pub supports_external_subtitles: bool,
}

impl PlayerBackend {
    pub fn load(
        &mut self,
        app: &AppHandle,
        url: String,
        title: String,
        start_position: f64,
    ) -> Result<(), String> {
        match self {
            PlayerBackend::LibMpv { api, handle } => {
                libmpv::load(api, *handle, url, title, start_position)
            }
            #[cfg(target_os = "macos")]
            PlayerBackend::ExternalMpv(state) => state.load(app, url, title, start_position),
        }
    }

    pub fn set_property(
        &mut self,
        app: &AppHandle,
        name: &'static str,
        value: String,
    ) -> Result<(), String> {
        match self {
            PlayerBackend::LibMpv { api, handle } => api.set_property(*handle, name, &value),
            #[cfg(target_os = "macos")]
            PlayerBackend::ExternalMpv(state) => state.set_property(app, name, value),
        }
    }

    pub fn command(&mut self, app: &AppHandle, args: Vec<String>) -> Result<(), String> {
        match self {
            PlayerBackend::LibMpv { api, handle } => api.command(*handle, &args),
            #[cfg(target_os = "macos")]
            PlayerBackend::ExternalMpv(state) => state.command(app, args),
        }
    }

    pub fn add_subtitle(&mut self, path: PathBuf, title: String) -> Result<bool, String> {
        match self {
            PlayerBackend::LibMpv { api, handle } => {
                libmpv::add_subtitle(api, *handle, path, title)
            }
            #[cfg(target_os = "macos")]
            PlayerBackend::ExternalMpv(state) => state.add_subtitle(path, title),
        }
    }

    pub fn set_fullscreen(&mut self, app: &AppHandle, value: bool) -> Result<(), String> {
        match self {
            PlayerBackend::LibMpv { api, handle } => {
                api.set_property(*handle, "fullscreen", if value { "yes" } else { "no" })
            }
            #[cfg(target_os = "macos")]
            PlayerBackend::ExternalMpv(state) => {
                state.set_property(app, "fullscreen", if value { "yes" } else { "no" }.into())
            }
        }
    }

    pub fn stop(&mut self, app: &AppHandle) -> Result<(), String> {
        match self {
            PlayerBackend::LibMpv { api, handle } => api.command(*handle, &["stop".into()]),
            #[cfg(target_os = "macos")]
            PlayerBackend::ExternalMpv(state) => {
                state.stop();
                let _ = app.emit(PLAYER_STATE_EVENT, StatePayload { state: "stopped" });
                Ok(())
            }
        }
    }

    pub fn shutdown(&mut self) {
        match self {
            PlayerBackend::LibMpv { .. } => {}
            #[cfg(target_os = "macos")]
            PlayerBackend::ExternalMpv(state) => state.stop(),
        }
    }

    pub fn poll_external(&mut self, app: &AppHandle) {
        #[cfg(target_os = "macos")]
        if let PlayerBackend::ExternalMpv(state) = self {
            state.poll(app);
        }
    }

    pub fn terminate(&mut self) {
        match self {
            PlayerBackend::LibMpv { api, handle } => api.terminate_destroy(*handle),
            #[cfg(target_os = "macos")]
            PlayerBackend::ExternalMpv(state) => state.stop(),
        }
    }
}

pub(super) fn prepare(app: &AppHandle, window: &WebviewWindow) -> Result<PreparedBackend, String> {
    match NativeSurface::create_on_main(window.clone()) {
        Ok(surface) => libmpv::prepare_embedded(app, surface),
        Err(error) => prepare_without_surface(app, error),
    }
}

#[cfg(target_os = "macos")]
fn prepare_without_surface(
    app: &AppHandle,
    surface_error: String,
) -> Result<PreparedBackend, String> {
    let prepared = macos::prepare_external_process(app, surface_error.clone())?;
    let _ = app.emit(
        PLAYER_WARNING_EVENT,
        MessagePayload {
            message: format!("{surface_error} Opening video in a separate mpv window on macOS."),
        },
    );
    Ok(prepared)
}

#[cfg(not(target_os = "macos"))]
fn prepare_without_surface(
    _app: &AppHandle,
    surface_error: String,
) -> Result<PreparedBackend, String> {
    Err(surface_error)
}

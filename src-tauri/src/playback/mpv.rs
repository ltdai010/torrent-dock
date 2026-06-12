use libloading::Library;
use std::{
    ffi::{c_char, c_double, c_int, c_void, CStr, CString},
    path::Path,
    ptr,
};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

pub const MPV_EVENT_NONE: c_int = 0;
pub const MPV_EVENT_SHUTDOWN: c_int = 1;
pub const MPV_EVENT_END_FILE: c_int = 7;
pub const MPV_EVENT_FILE_LOADED: c_int = 8;
pub const MPV_EVENT_TRACKS_CHANGED: c_int = 9;
pub const MPV_EVENT_VIDEO_RECONFIG: c_int = 17;
pub const MPV_EVENT_AUDIO_RECONFIG: c_int = 18;
pub const MPV_EVENT_SEEK: c_int = 20;
pub const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
pub const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

pub const MPV_FORMAT_FLAG: c_int = 3;
pub const MPV_FORMAT_DOUBLE: c_int = 5;

#[repr(C)]
pub struct MpvHandle {
    _private: [u8; 0],
}

#[repr(C)]
pub struct MpvEvent {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvEventProperty {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}

type MpvCreate = unsafe extern "C" fn() -> *mut MpvHandle;
type MpvInitialize = unsafe extern "C" fn(*mut MpvHandle) -> c_int;
type MpvTerminateDestroy = unsafe extern "C" fn(*mut MpvHandle);
type MpvSetOptionString =
    unsafe extern "C" fn(*mut MpvHandle, *const c_char, *const c_char) -> c_int;
type MpvSetPropertyString =
    unsafe extern "C" fn(*mut MpvHandle, *const c_char, *const c_char) -> c_int;
type MpvGetPropertyString = unsafe extern "C" fn(*mut MpvHandle, *const c_char) -> *mut c_char;
type MpvCommand = unsafe extern "C" fn(*mut MpvHandle, *const *const c_char) -> c_int;
type MpvObserveProperty = unsafe extern "C" fn(*mut MpvHandle, u64, *const c_char, c_int) -> c_int;
type MpvWaitEvent = unsafe extern "C" fn(*mut MpvHandle, c_double) -> *const MpvEvent;
type MpvFree = unsafe extern "C" fn(*mut c_void);
type MpvErrorString = unsafe extern "C" fn(c_int) -> *const c_char;

pub struct MpvApi {
    _library: Library,
    create: MpvCreate,
    initialize: MpvInitialize,
    terminate_destroy: MpvTerminateDestroy,
    set_option_string: MpvSetOptionString,
    set_property_string: MpvSetPropertyString,
    get_property_string: MpvGetPropertyString,
    command: MpvCommand,
    observe_property: MpvObserveProperty,
    wait_event: MpvWaitEvent,
    free: MpvFree,
    error_string: MpvErrorString,
}

impl MpvApi {
    pub fn load(path: &Path) -> Result<Self, String> {
        configure_dll_search_path(path);

        let library = unsafe { Library::new(path) }
            .map_err(|error| format!("Could not load {}: {error}", path.display()))?;

        unsafe {
            Ok(Self {
                create: *library
                    .get(b"mpv_create\0")
                    .map_err(|error| format!("libmpv is missing mpv_create: {error}"))?,
                initialize: *library
                    .get(b"mpv_initialize\0")
                    .map_err(|error| format!("libmpv is missing mpv_initialize: {error}"))?,
                terminate_destroy: *library
                    .get(b"mpv_terminate_destroy\0")
                    .map_err(|error| format!("libmpv is missing mpv_terminate_destroy: {error}"))?,
                set_option_string: *library
                    .get(b"mpv_set_option_string\0")
                    .map_err(|error| format!("libmpv is missing mpv_set_option_string: {error}"))?,
                set_property_string: *library.get(b"mpv_set_property_string\0").map_err(
                    |error| format!("libmpv is missing mpv_set_property_string: {error}"),
                )?,
                get_property_string: *library.get(b"mpv_get_property_string\0").map_err(
                    |error| format!("libmpv is missing mpv_get_property_string: {error}"),
                )?,
                command: *library
                    .get(b"mpv_command\0")
                    .map_err(|error| format!("libmpv is missing mpv_command: {error}"))?,
                observe_property: *library
                    .get(b"mpv_observe_property\0")
                    .map_err(|error| format!("libmpv is missing mpv_observe_property: {error}"))?,
                wait_event: *library
                    .get(b"mpv_wait_event\0")
                    .map_err(|error| format!("libmpv is missing mpv_wait_event: {error}"))?,
                free: *library
                    .get(b"mpv_free\0")
                    .map_err(|error| format!("libmpv is missing mpv_free: {error}"))?,
                error_string: *library
                    .get(b"mpv_error_string\0")
                    .map_err(|error| format!("libmpv is missing mpv_error_string: {error}"))?,
                _library: library,
            })
        }
    }

    pub fn create_handle(&self) -> Result<*mut MpvHandle, String> {
        let handle = unsafe { (self.create)() };
        if handle.is_null() {
            Err("libmpv could not allocate a playback context.".into())
        } else {
            Ok(handle)
        }
    }

    pub fn initialize(&self, handle: *mut MpvHandle) -> Result<(), String> {
        self.result(unsafe { (self.initialize)(handle) })
    }

    pub fn terminate_destroy(&self, handle: *mut MpvHandle) {
        if !handle.is_null() {
            unsafe { (self.terminate_destroy)(handle) };
        }
    }

    pub fn set_option(
        &self,
        handle: *mut MpvHandle,
        name: &str,
        value: &str,
    ) -> Result<(), String> {
        let name = c_string(name)?;
        let value = c_string(value)?;
        self.result(unsafe { (self.set_option_string)(handle, name.as_ptr(), value.as_ptr()) })
    }

    pub fn set_property(
        &self,
        handle: *mut MpvHandle,
        name: &str,
        value: &str,
    ) -> Result<(), String> {
        let name = c_string(name)?;
        let value = c_string(value)?;
        self.result(unsafe { (self.set_property_string)(handle, name.as_ptr(), value.as_ptr()) })
    }

    pub fn get_property(&self, handle: *mut MpvHandle, name: &str) -> Option<String> {
        let name = c_string(name).ok()?;
        let value = unsafe { (self.get_property_string)(handle, name.as_ptr()) };
        if value.is_null() {
            return None;
        }

        let text = unsafe { CStr::from_ptr(value) }
            .to_string_lossy()
            .into_owned();
        unsafe { (self.free)(value.cast()) };
        Some(text)
    }

    pub fn command(&self, handle: *mut MpvHandle, args: &[String]) -> Result<(), String> {
        let values = args
            .iter()
            .map(|value| c_string(value))
            .collect::<Result<Vec<_>, _>>()?;
        let mut pointers = values
            .iter()
            .map(|value| value.as_ptr())
            .collect::<Vec<_>>();
        pointers.push(ptr::null());
        self.result(unsafe { (self.command)(handle, pointers.as_ptr()) })
    }

    pub fn observe(
        &self,
        handle: *mut MpvHandle,
        id: u64,
        name: &str,
        format: c_int,
    ) -> Result<(), String> {
        let name = c_string(name)?;
        self.result(unsafe { (self.observe_property)(handle, id, name.as_ptr(), format) })
    }

    pub fn wait_event(&self, handle: *mut MpvHandle, timeout: f64) -> MpvEventSnapshot {
        let event = unsafe { (self.wait_event)(handle, timeout) };
        if event.is_null() {
            return MpvEventSnapshot::None;
        }

        let event = unsafe { &*event };
        if event.event_id != MPV_EVENT_PROPERTY_CHANGE || event.data.is_null() {
            return MpvEventSnapshot::Event(event.event_id);
        }

        let property = unsafe { &*(event.data as *const MpvEventProperty) };
        let name = if property.name.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(property.name) }
                .to_string_lossy()
                .into_owned()
        };

        match property.format {
            MPV_FORMAT_FLAG if !property.data.is_null() => {
                MpvEventSnapshot::Flag(name, unsafe { *(property.data as *const c_int) != 0 })
            }
            MPV_FORMAT_DOUBLE if !property.data.is_null() => {
                MpvEventSnapshot::Double(name, unsafe { *(property.data as *const c_double) })
            }
            _ => MpvEventSnapshot::Event(event.event_id),
        }
    }

    fn result(&self, code: c_int) -> Result<(), String> {
        if code >= 0 {
            return Ok(());
        }

        let text = unsafe { (self.error_string)(code) };
        if text.is_null() {
            Err(format!("libmpv error {code}"))
        } else {
            Err(unsafe { CStr::from_ptr(text) }
                .to_string_lossy()
                .into_owned())
        }
    }
}

#[cfg(windows)]
fn configure_dll_search_path(path: &Path) {
    let Some(directory) = path.parent() else {
        return;
    };

    let directory = directory
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        windows_sys::Win32::System::LibraryLoader::SetDllDirectoryW(directory.as_ptr());
    }
}

#[cfg(not(windows))]
fn configure_dll_search_path(_path: &Path) {}

pub enum MpvEventSnapshot {
    None,
    Event(c_int),
    Flag(String, bool),
    Double(String, f64),
}

fn c_string(value: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| "A player value contained an invalid null byte.".into())
}

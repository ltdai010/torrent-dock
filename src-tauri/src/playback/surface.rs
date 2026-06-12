use serde::{Deserialize, Serialize};
use std::{sync::mpsc, time::Duration};
use tauri::{AppHandle, WebviewWindow};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy)]
pub struct NativeSurface {
    #[cfg(windows)]
    hwnd: isize,
    #[cfg(windows)]
    parent: isize,
    #[cfg(windows)]
    normal_style: isize,
}

unsafe impl Send for NativeSurface {}

impl NativeSurface {
    pub fn create_on_main(window: WebviewWindow) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel();
        let main_window = window.clone();

        window
            .run_on_main_thread(move || {
                let _ = tx.send(Self::create(&main_window));
            })
            .map_err(|error| format!("Could not schedule native surface creation: {error}"))?;

        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Timed out creating the native video surface.".to_string())?
    }

    pub fn create(window: &WebviewWindow) -> Result<Self, String> {
        #[cfg(windows)]
        {
            use std::ptr;
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                CreateWindowExW, GetWindowLongPtrW, ShowWindow, GWL_STYLE, SW_HIDE, WS_CHILD,
                WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
            };

            let parent = window
                .hwnd()
                .map_err(|error| format!("Could not access the TorrentDock window: {error}"))?
                .0;
            let class_name = "STATIC\0".encode_utf16().collect::<Vec<_>>();
            let hwnd = unsafe {
                CreateWindowExW(
                    0,
                    class_name.as_ptr(),
                    ptr::null(),
                    WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                    0,
                    0,
                    1,
                    1,
                    parent,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null(),
                )
            };

            if hwnd.is_null() {
                return Err("Could not create the native video child window.".into());
            }

            unsafe { ShowWindow(hwnd, SW_HIDE) };
            return Ok(Self {
                hwnd: hwnd as isize,
                parent: parent as isize,
                normal_style: unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) },
            });
        }

        #[cfg(not(windows))]
        {
            let _ = window;
            Err("The native surface adapter is not available on this platform yet.".into())
        }
    }

    pub fn native_id(&self) -> i64 {
        #[cfg(windows)]
        {
            self.hwnd as i64
        }

        #[cfg(not(windows))]
        {
            0
        }
    }

    pub fn set_bounds_on_main(
        &self,
        app: &AppHandle,
        rect: SurfaceBounds,
        scale_factor: f64,
        visible: bool,
    ) -> Result<(), String> {
        #[cfg(windows)]
        {
            let surface = *self;
            app.run_on_main_thread(move || {
                let _ = surface.set_bounds_direct(rect, scale_factor, visible);
            })
            .map_err(|error| format!("Could not schedule native surface positioning: {error}"))?;
        }

        #[cfg(not(windows))]
        {
            let _ = (app, rect, scale_factor, visible);
        }

        Ok(())
    }

    pub fn destroy_on_main(&self, app: &AppHandle) {
        #[cfg(windows)]
        {
            let hwnd = self.hwnd;
            let _ = app.run_on_main_thread(move || unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow(hwnd as _);
            });
        }

        #[cfg(not(windows))]
        {
            let _ = app;
        }
    }

    pub fn set_fullscreen_on_main(&self, app: &AppHandle, value: bool) -> Result<(), String> {
        #[cfg(windows)]
        {
            let surface = *self;
            app.run_on_main_thread(move || {
                let _ = surface.set_fullscreen_direct(value);
            })
            .map_err(|error| format!("Could not schedule native fullscreen change: {error}"))?;
        }

        #[cfg(not(windows))]
        {
            let _ = (app, value);
        }

        Ok(())
    }

    #[cfg(windows)]
    fn set_bounds_direct(
        &self,
        rect: SurfaceBounds,
        _scale_factor: f64,
        visible: bool,
    ) -> Result<(), String> {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNA,
        };
        let hwnd = self.hwnd as _;

        // Child HWND coordinates are relative to the parent window's client
        // area in logical pixels here. The DOM rectangle already arrives in
        // that coordinate space, so applying devicePixelRatio pushes the
        // mpv surface away from the visible player area on scaled displays.
        let scale = 1.0;
        let x = (rect.x * scale).round() as i32;
        let y = (rect.y * scale).round() as i32;
        let width = (rect.width * scale).round().max(1.0) as i32;
        let height = (rect.height * scale).round().max(1.0) as i32;
        let positioned =
            unsafe { SetWindowPos(hwnd, HWND_TOP, x, y, width, height, SWP_NOACTIVATE) };

        if positioned == 0 {
            return Err("Could not position the native video surface.".into());
        }

        unsafe { ShowWindow(hwnd, if visible { SW_SHOWNA } else { SW_HIDE }) };

        Ok(())
    }

    #[cfg(windows)]
    fn set_fullscreen_direct(&self, value: bool) -> Result<(), String> {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetParent, SetWindowLongPtrW, GWL_STYLE,
        };

        let hwnd = self.hwnd as _;
        if !value {
            unsafe {
                SetParent(hwnd, self.parent as _);
                SetWindowLongPtrW(hwnd, GWL_STYLE, self.normal_style);
            }
        }

        Ok(())
    }
}

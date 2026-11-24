//! 无边框窗口的圆角与描边交给 DWM 处理。
//!
//! 窗口是透明 + Mica 材质，材质由系统按「整块矩形」绘制，而界面只在 CSS 里
//! 做了 8px 圆角，于是四个角落会露出材质底色（深色主题下接近纯黑），
//! 看起来就是四道黑边。让 DWM 按圆角裁剪窗口本身，材质和阴影会一起跟着曲线走。
//!
//! 另外 Windows 11 会给无边框窗口加 1px 的深色描边，正好压在那道圆弧上，
//! 这里一并交给 `DWMWA_BORDER_COLOR` 关掉，描边改用 CSS 的内阴影。

/// 按窗口状态同步圆角：最大化时必须是直角，否则四角会被裁掉内容。
#[cfg(windows)]
pub fn sync_round_corners(window: &tauri::WebviewWindow, maximized: bool) {
    use raw_window_handle::HasWindowHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
        DWM_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DWMWCP_ROUND,
    };

    let Ok(handle) = window.window_handle() else {
        return;
    };
    let raw = handle.as_raw();
    let raw_window_handle::RawWindowHandle::Win32(win32) = raw else {
        return;
    };
    let hwnd = HWND(win32.hwnd.get() as *mut std::ffi::c_void);

    let preference: DWM_WINDOW_CORNER_PREFERENCE = if maximized {
        DWMWCP_DONOTROUND
    } else {
        DWMWCP_ROUND
    };
    // DWMWA_COLOR_NONE：告诉 DWM 不要画窗口描边。
    let no_border: u32 = 0xFFFF_FFFE;

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &no_border as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg(not(windows))]
pub fn sync_round_corners(_window: &tauri::WebviewWindow, _maximized: bool) {}

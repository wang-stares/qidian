//! 无边框窗口的圆角交给 DWM 裁切，描边交回系统默认。
//!
//! 窗口是透明 + Mica 材质，系统按「整块矩形」绘制材质，而界面只在 CSS 里
//! 画了圆角，四个角落于是没有任何不透明像素覆盖，被 DWM 补成黑色楔形。
//! 让 DWM 按圆角裁剪窗口本身，再让 html 铺一层不透明底色兜住四角，
//! 两者叠加后窗口内不存在「既没被裁掉、又不透明」的区域。
//!
//! 不要再把 `DWMWA_BORDER_COLOR` 设成 `DWMWA_COLOR_NONE`：透明窗口上没有
//! 描边时，系统会用不透明深色填充边角，正好加重四角的黑楔。保持默认即可，
//! 系统描边会沿 DWM 自己的裁切曲线绘制，不会与 CSS 圆弧错位。

use std::sync::atomic::{AtomicBool, Ordering};

/// DWM 是否支持 `DWMWA_WINDOW_CORNER_PREFERENCE`（Windows 11 build 22000+）。
///
/// Windows 10 上该属性无效，DWM 不会裁圆角，窗口保持直角。前端据此把 CSS
/// 圆角回落到 8px，避免直角窗口里叠一圈 12px 弧线产生错位观感。
static DWM_ROUND_SUPPORTED: AtomicBool = AtomicBool::new(true);

/// 供前端查询：窗口四角是否由 DWM 裁切。
pub fn dwm_round_supported() -> bool {
    DWM_ROUND_SUPPORTED.load(Ordering::Relaxed)
}

/// 按窗口状态同步圆角：最大化时必须是直角，否则四角会被裁掉内容。
#[cfg(windows)]
pub fn sync_round_corners(window: &tauri::WebviewWindow, maximized: bool) {
    use raw_window_handle::HasWindowHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWM_WINDOW_CORNER_PREFERENCE,
        DWMWCP_DONOTROUND, DWMWCP_ROUND,
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

    unsafe {
        // 不设 `DWMWA_BORDER_COLOR`，保留系统沿圆角轮廓绘制的默认描边。
        let result = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
        // 只在还原态探测：Win10 不认识该属性，返回 E_INVALIDARG。
        if !maximized {
            DWM_ROUND_SUPPORTED.store(result.is_ok(), Ordering::Relaxed);
        }
    }
}

#[cfg(not(windows))]
pub fn sync_round_corners(_window: &tauri::WebviewWindow, _maximized: bool) {}

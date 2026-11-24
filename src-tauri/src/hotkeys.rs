//! 全局快捷键注册状态，以及「双击 Ctrl 唤出窗口」的低级键盘钩子。
//! 钩子只在 Windows 生效，其他平台保持空实现以便跨平台编译。

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_global_shortcut::Shortcut;

/// 双击判定的时间窗口：两次 Ctrl 按下之间的最大间隔。
#[cfg_attr(not(windows), allow(dead_code))]
pub const DOUBLE_CTRL_WINDOW: Duration = Duration::from_millis(400);

/// 一次热键注册的结果，供前端展示。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    /// `"toggle"` 或 `"app:<应用 id>"`。
    pub id: String,
    pub accelerator: String,
    pub ok: bool,
    /// 失败原因；成功时为 `None`。
    pub reason: Option<String>,
}

/// 最近一次注册结果。
static STATUS: Mutex<Vec<HotkeyStatus>> = Mutex::new(Vec::new());

pub fn status() -> Vec<HotkeyStatus> {
    STATUS.lock().map(|items| items.clone()).unwrap_or_default()
}

pub fn set_status(items: Vec<HotkeyStatus>) {
    if let Ok(mut slot) = STATUS.lock() {
        *slot = items;
    }
}

/// 双击 Ctrl 的判定状态机；与平台无关，便于单测。
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug)]
struct DoubleCtrlTracker {
    ctrl_down: bool,
    /// 本次 Ctrl 按下期间没有夹带其他键，才算「干净」的单击。
    clean: bool,
    /// 上一次干净 Ctrl 抬起的时刻。
    last_up: Option<Instant>,
    /// 触发后忽略紧随其后的 Ctrl 抬起，避免第三次按下再次触发。
    suppress_up: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl DoubleCtrlTracker {
    const fn new() -> Self {
        Self {
            ctrl_down: false,
            clean: false,
            last_up: None,
            suppress_up: false,
        }
    }

    /// 返回 `true` 表示达成一次「干净的双击 Ctrl」。
    fn on_key(&mut self, is_ctrl: bool, down: bool, now: Instant) -> bool {
        if is_ctrl {
            if down {
                // 长按产生的自动重复不算新的一次按下。
                if self.ctrl_down {
                    return false;
                }
                self.ctrl_down = true;
                self.clean = true;
                if let Some(up) = self.last_up.take() {
                    if now.saturating_duration_since(up) <= DOUBLE_CTRL_WINDOW {
                        self.suppress_up = true;
                        return true;
                    }
                }
            } else if self.ctrl_down {
                self.ctrl_down = false;
                if self.suppress_up {
                    self.suppress_up = false;
                    self.last_up = None;
                } else if self.clean {
                    self.last_up = Some(now);
                } else {
                    self.last_up = None;
                }
            }
        } else if down {
            // 任何其他键按下都会打断候选；按住 Ctrl 时也说明不是干净单击。
            self.last_up = None;
            if self.ctrl_down {
                self.clean = false;
            }
        }
        false
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::sync::mpsc;
    use std::thread::JoinHandle;
    use tauri_plugin_global_shortcut::{Code, Modifiers};
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
        MOD_SHIFT, MOD_WIN, VK_CONTROL, VK_LCONTROL, VK_RCONTROL,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, KBDLLHOOKSTRUCT, MSG, PM_NOREMOVE, PeekMessageW,
        PostThreadMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    struct HookHandle {
        thread_id: u32,
        thread: JoinHandle<()>,
    }

    static HOOK: Mutex<Option<HookHandle>> = Mutex::new(None);
    static HOOK_APP: Mutex<Option<AppHandle>> = Mutex::new(None);
    static TRACKER: Mutex<DoubleCtrlTracker> = Mutex::new(DoubleCtrlTracker::new());

    /// 用一次临时注册探测组合键是否已被其他程序占用；注册成功立即注销。
    pub fn hotkey_occupied(shortcut: &Shortcut) -> bool {
        let Some(vk) = key_to_vk(&shortcut.key) else {
            return false;
        };
        let mut bits = MOD_NOREPEAT.0;
        if shortcut.mods.contains(Modifiers::SHIFT) {
            bits |= MOD_SHIFT.0;
        }
        if shortcut.mods.contains(Modifiers::CONTROL) {
            bits |= MOD_CONTROL.0;
        }
        if shortcut.mods.contains(Modifiers::ALT) {
            bits |= MOD_ALT.0;
        }
        if shortcut.mods.intersects(Modifiers::SUPER | Modifiers::META) {
            bits |= MOD_WIN.0;
        }
        let mods = HOT_KEY_MODIFIERS(bits);
        const PROBE_ID: i32 = 0x6D31;
        match unsafe { RegisterHotKey(None, PROBE_ID, mods, u32::from(vk.0)) } {
            Ok(()) => {
                let _ = unsafe { UnregisterHotKey(None, PROBE_ID) };
                false
            }
            Err(_) => true,
        }
    }

    pub fn install(app: &AppHandle) -> Result<(), String> {
        let mut slot = HOOK
            .lock()
            .map_err(|_| "双击 Ctrl 钩子状态不可用".to_string())?;
        if slot.is_some() {
            return Ok(());
        }
        if let Ok(mut tracker) = TRACKER.lock() {
            *tracker = DoubleCtrlTracker::new();
        }
        if let Ok(mut cached) = HOOK_APP.lock() {
            *cached = Some(app.clone());
        }

        let (tx, rx) = mpsc::channel::<Result<u32, String>>();
        let thread = std::thread::Builder::new()
            .name("qidian-double-ctrl".to_string())
            .spawn(move || hook_thread(tx))
            .map_err(|error| format!("无法启动双击 Ctrl 钩子线程: {error}"))?;

        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(thread_id)) => {
                *slot = Some(HookHandle { thread_id, thread });
                Ok(())
            }
            Ok(Err(error)) => {
                drop(slot);
                let _ = thread.join();
                if let Ok(mut cached) = HOOK_APP.lock() {
                    *cached = None;
                }
                Err(error)
            }
            Err(_) => {
                drop(slot);
                let _ = thread.join();
                if let Ok(mut cached) = HOOK_APP.lock() {
                    *cached = None;
                }
                Err("双击 Ctrl 钩子启动超时".to_string())
            }
        }
    }

    pub fn uninstall() {
        let handle = HOOK.lock().ok().and_then(|mut slot| slot.take());
        let Some(handle) = handle else {
            return;
        };
        let _ = unsafe {
            PostThreadMessageW(handle.thread_id, WM_QUIT, WPARAM(0), LPARAM(0))
        };
        let _ = handle.thread.join();
        if let Ok(mut cached) = HOOK_APP.lock() {
            *cached = None;
        }
    }

    /// 独立线程：安装钩子后跑消息循环，收到 WM_QUIT 时卸载钩子再退出。
    fn hook_thread(ready: mpsc::Sender<Result<u32, String>>) {
        unsafe {
            let module = match GetModuleHandleW(None) {
                Ok(module) => module,
                Err(error) => {
                    let _ = ready.send(Err(format!("获取模块句柄失败: {error}")));
                    return;
                }
            };
            let hook = match SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_proc),
                HINSTANCE(module.0),
                0,
            ) {
                Ok(hook) => hook,
                Err(error) => {
                    let _ = ready.send(Err(format!("安装键盘钩子失败: {error}")));
                    return;
                }
            };
            // 先创建消息队列，确保停止时 PostThreadMessageW 能命中该线程。
            let mut msg = MSG::default();
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            if ready.send(Ok(GetCurrentThreadId())).is_err() {
                let _ = UnhookWindowsHookEx(hook);
                return;
            }
            loop {
                let result = GetMessageW(&mut msg, None, 0, 0);
                if result.0 <= 0 {
                    break;
                }
            }
            let _ = UnhookWindowsHookEx(hook);
        }
    }

    /// 钩子回调：只维护状态机，窗口操作交给主线程；始终把按键交给下一个钩子。
    unsafe extern "system" fn keyboard_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code == HC_ACTION as i32 {
            let message = wparam.0 as u32;
            if matches!(
                message,
                WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP
            ) {
                let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
                let vk = info.vkCode as u16;
                let is_ctrl =
                    vk == VK_CONTROL.0 || vk == VK_LCONTROL.0 || vk == VK_RCONTROL.0;
                let down = matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN);
                let triggered = TRACKER
                    .lock()
                    .map(|mut tracker| tracker.on_key(is_ctrl, down, Instant::now()))
                    .unwrap_or(false);
                if triggered {
                    let app = HOOK_APP.lock().ok().and_then(|slot| slot.clone());
                    if let Some(app) = app {
                        let handle = app.clone();
                        let _ = app.run_on_main_thread(move || crate::toggle_main(&handle));
                    }
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    /// 把快捷键里的按键映射为 Win32 虚拟键码，仅用于占用探测。
    fn key_to_vk(key: &Code) -> Option<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY> {
        use windows::Win32::UI::Input::KeyboardAndMouse::*;
        Some(match key {
            Code::KeyA => VK_A,
            Code::KeyB => VK_B,
            Code::KeyC => VK_C,
            Code::KeyD => VK_D,
            Code::KeyE => VK_E,
            Code::KeyF => VK_F,
            Code::KeyG => VK_G,
            Code::KeyH => VK_H,
            Code::KeyI => VK_I,
            Code::KeyJ => VK_J,
            Code::KeyK => VK_K,
            Code::KeyL => VK_L,
            Code::KeyM => VK_M,
            Code::KeyN => VK_N,
            Code::KeyO => VK_O,
            Code::KeyP => VK_P,
            Code::KeyQ => VK_Q,
            Code::KeyR => VK_R,
            Code::KeyS => VK_S,
            Code::KeyT => VK_T,
            Code::KeyU => VK_U,
            Code::KeyV => VK_V,
            Code::KeyW => VK_W,
            Code::KeyX => VK_X,
            Code::KeyY => VK_Y,
            Code::KeyZ => VK_Z,
            Code::Digit0 => VK_0,
            Code::Digit1 => VK_1,
            Code::Digit2 => VK_2,
            Code::Digit3 => VK_3,
            Code::Digit4 => VK_4,
            Code::Digit5 => VK_5,
            Code::Digit6 => VK_6,
            Code::Digit7 => VK_7,
            Code::Digit8 => VK_8,
            Code::Digit9 => VK_9,
            Code::Equal => VK_OEM_PLUS,
            Code::Comma => VK_OEM_COMMA,
            Code::Minus => VK_OEM_MINUS,
            Code::Period => VK_OEM_PERIOD,
            Code::Semicolon => VK_OEM_1,
            Code::Slash => VK_OEM_2,
            Code::Backquote => VK_OEM_3,
            Code::BracketLeft => VK_OEM_4,
            Code::Backslash => VK_OEM_5,
            Code::BracketRight => VK_OEM_6,
            Code::Quote => VK_OEM_7,
            Code::Backspace => VK_BACK,
            Code::Tab => VK_TAB,
            Code::Space => VK_SPACE,
            Code::Enter => VK_RETURN,
            Code::CapsLock => VK_CAPITAL,
            Code::Escape => VK_ESCAPE,
            Code::PageUp => VK_PRIOR,
            Code::PageDown => VK_NEXT,
            Code::End => VK_END,
            Code::Home => VK_HOME,
            Code::ArrowLeft => VK_LEFT,
            Code::ArrowUp => VK_UP,
            Code::ArrowRight => VK_RIGHT,
            Code::ArrowDown => VK_DOWN,
            Code::PrintScreen => VK_SNAPSHOT,
            Code::Insert => VK_INSERT,
            Code::Delete => VK_DELETE,
            Code::F1 => VK_F1,
            Code::F2 => VK_F2,
            Code::F3 => VK_F3,
            Code::F4 => VK_F4,
            Code::F5 => VK_F5,
            Code::F6 => VK_F6,
            Code::F7 => VK_F7,
            Code::F8 => VK_F8,
            Code::F9 => VK_F9,
            Code::F10 => VK_F10,
            Code::F11 => VK_F11,
            Code::F12 => VK_F12,
            Code::F13 => VK_F13,
            Code::F14 => VK_F14,
            Code::F15 => VK_F15,
            Code::F16 => VK_F16,
            Code::F17 => VK_F17,
            Code::F18 => VK_F18,
            Code::F19 => VK_F19,
            Code::F20 => VK_F20,
            Code::F21 => VK_F21,
            Code::F22 => VK_F22,
            Code::F23 => VK_F23,
            Code::F24 => VK_F24,
            Code::NumLock => VK_NUMLOCK,
            Code::Numpad0 => VK_NUMPAD0,
            Code::Numpad1 => VK_NUMPAD1,
            Code::Numpad2 => VK_NUMPAD2,
            Code::Numpad3 => VK_NUMPAD3,
            Code::Numpad4 => VK_NUMPAD4,
            Code::Numpad5 => VK_NUMPAD5,
            Code::Numpad6 => VK_NUMPAD6,
            Code::Numpad7 => VK_NUMPAD7,
            Code::Numpad8 => VK_NUMPAD8,
            Code::Numpad9 => VK_NUMPAD9,
            Code::NumpadAdd => VK_ADD,
            Code::NumpadDecimal => VK_DECIMAL,
            Code::NumpadDivide => VK_DIVIDE,
            Code::NumpadEnter => VK_RETURN,
            Code::NumpadMultiply => VK_MULTIPLY,
            Code::NumpadSubtract => VK_SUBTRACT,
            Code::ScrollLock => VK_SCROLL,
            Code::AudioVolumeDown => VK_VOLUME_DOWN,
            Code::AudioVolumeUp => VK_VOLUME_UP,
            Code::AudioVolumeMute => VK_VOLUME_MUTE,
            Code::MediaPlay => VK_PLAY,
            Code::MediaPause => VK_PAUSE,
            Code::MediaPlayPause => VK_MEDIA_PLAY_PAUSE,
            Code::MediaStop => VK_MEDIA_STOP,
            Code::MediaTrackNext => VK_MEDIA_NEXT_TRACK,
            Code::MediaTrackPrevious => VK_MEDIA_PREV_TRACK,
            Code::Pause => VK_PAUSE,
            _ => return None,
        })
    }
}

#[cfg(windows)]
pub use win::{hotkey_occupied, install, uninstall};

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn hotkey_occupied(_shortcut: &Shortcut) -> bool {
    false
}

#[cfg(not(windows))]
pub fn install(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn uninstall() {}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(base: Instant, millis: u64) -> Instant {
        base + Duration::from_millis(millis)
    }

    #[test]
    fn double_ctrl_triggers_once_then_resets() {
        let mut tracker = DoubleCtrlTracker::new();
        let t0 = Instant::now();
        assert!(!tracker.on_key(true, true, t0));
        assert!(!tracker.on_key(true, false, at(t0, 60)));
        assert!(tracker.on_key(true, true, at(t0, 120)));
        assert!(!tracker.on_key(true, false, at(t0, 160)));
        // 触发后立即第三次按下不应再触发。
        assert!(!tracker.on_key(true, true, at(t0, 200)));
    }

    #[test]
    fn other_key_between_presses_does_not_trigger() {
        let mut tracker = DoubleCtrlTracker::new();
        let t0 = Instant::now();
        assert!(!tracker.on_key(true, true, t0));
        assert!(!tracker.on_key(false, true, at(t0, 20)));
        assert!(!tracker.on_key(false, false, at(t0, 30)));
        assert!(!tracker.on_key(true, false, at(t0, 40)));
        assert!(!tracker.on_key(true, true, at(t0, 80)));
    }

    #[test]
    fn ctrl_combination_then_ctrl_does_not_trigger() {
        // Ctrl+C 之后再快速按一次 Ctrl 不应被视为双击。
        let mut tracker = DoubleCtrlTracker::new();
        let t0 = Instant::now();
        assert!(!tracker.on_key(true, true, t0));
        assert!(!tracker.on_key(false, true, at(t0, 30)));
        assert!(!tracker.on_key(false, false, at(t0, 50)));
        assert!(!tracker.on_key(true, false, at(t0, 60)));
        assert!(!tracker.on_key(true, true, at(t0, 100)));
    }

    #[test]
    fn slow_second_press_does_not_trigger() {
        let mut tracker = DoubleCtrlTracker::new();
        let t0 = Instant::now();
        assert!(!tracker.on_key(true, true, t0));
        assert!(!tracker.on_key(true, false, at(t0, 50)));
        assert!(!tracker.on_key(true, true, at(t0, 500)));
    }
}

use crate::models::Settings;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

const HISTORY_LIMIT: usize = 6;
const AUTO_COOLDOWN_MS: u64 = 15_000;
/// 空闲释放：键鼠 5 分钟无操作、内存使用率不低于 60% 时触发，最多每 10 分钟一次。
const IDLE_TRIM_AFTER_MS: u64 = 5 * 60 * 1000;
const IDLE_TRIM_COOLDOWN_MS: u64 = 10 * 60 * 1000;
const IDLE_TRIM_MIN_USED_PERCENT: u32 = 60;

static LOW_ACTIVE: AtomicBool = AtomicBool::new(false);
static LAST_AUTO_CHANGE: AtomicU64 = AtomicU64::new(0);
static LAST_IDLE_TRIM: AtomicU64 = AtomicU64::new(0);
static HISTORY: Mutex<Vec<LastAction>> = Mutex::new(Vec::new());
static STATS: Mutex<PersistedStats> = Mutex::new(PersistedStats {
    released_bytes: 0,
    adjust_count: 0,
    today_at: 0,
    today_released_bytes: 0,
});
static STATS_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastAction {
    pub reason: String,
    pub at: u64,
    pub released_bytes: u64,
    pub level: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PersistedStats {
    #[serde(default)]
    released_bytes: u64,
    #[serde(default)]
    adjust_count: u64,
    #[serde(default)]
    today_at: u64,
    #[serde(default)]
    today_released_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStatus {
    pub mode: String,
    pub level: String,
    pub monitor: String,
    pub trim_working_set: bool,
    pub trim_scope: String,
    pub idle_trim: bool,
    pub effective_interval_sec: u32,
    pub fullscreen_paused: bool,
    pub power_source: String,
    pub battery_percent: Option<u32>,
    pub power_aware: bool,
    pub effective_low_percent: u32,
    pub effective_recover_percent: u32,
    pub smart_thresholds: bool,
    pub emergency_low: bool,
    pub system_total_bytes: u64,
    pub system_avail_bytes: u64,
    pub system_used_percent: u32,
    pub system_commit_total_bytes: u64,
    pub system_commit_avail_bytes: u64,
    pub system_commit_used_percent: u32,
    pub commit_pressure: bool,
    pub user_idle_seconds: u64,
    pub self_working_set_bytes: u64,
    pub self_private_bytes: u64,
    pub last_action: Option<LastAction>,
    pub history: Vec<LastAction>,
    pub total_released_bytes: u64,
    pub today_released_bytes: u64,
    pub adjust_count: u64,
}

/// 记录累计释放量与调节次数，数据写在应用数据目录，不联网。
pub fn init(base: &Path) {
    let file = base.join("memory-stats.json");
    if let Ok(text) = fs::read_to_string(&file) {
        if let Ok(stats) = serde_json::from_str::<PersistedStats>(&text) {
            if let Ok(mut current) = STATS.lock() {
                *current = stats;
            }
        }
    }
    if let Ok(mut slot) = STATS_FILE.lock() {
        *slot = Some(file);
    }
}

pub fn status(settings: &Settings) -> MemoryStatus {
    let memory = system_memory();
    let (working_set, private) = self_memory();
    let (power_source, battery_percent) = power_state();
    let (effective_low, effective_recover) = effective_thresholds_for(settings, memory.total);
    let emergency = emergency_low(memory.total, memory.avail);
    let monitor = match settings.memory_mode.as_str() {
        "manual" => "off",
        "custom" => "timer",
        _ => "event",
    };
    let history = HISTORY
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let stats = STATS.lock().map(|value| value.clone()).unwrap_or_default();
    let commit_used = percent_used(memory.commit_total, memory.commit_avail);
    let now = now_millis();
    let today_released = if stats.today_at / 86_400_000 == now / 86_400_000 {
        stats.today_released_bytes
    } else {
        0
    };
    MemoryStatus {
        mode: settings.memory_mode.clone(),
        level: if LOW_ACTIVE.load(Ordering::SeqCst) {
            "low".to_string()
        } else {
            "normal".to_string()
        },
        monitor: monitor.to_string(),
        trim_working_set: settings.memory_trim_working_set,
        trim_scope: settings.memory_trim_scope.clone(),
        idle_trim: settings.memory_idle_trim,
        effective_interval_sec: effective_interval(settings),
        fullscreen_paused: settings.memory_pause_fullscreen && fullscreen_active(),
        power_source,
        battery_percent,
        power_aware: settings.memory_power_aware,
        effective_low_percent: effective_low,
        effective_recover_percent: effective_recover,
        smart_thresholds: settings.memory_smart_thresholds,
        emergency_low: emergency,
        system_total_bytes: memory.total,
        system_avail_bytes: memory.avail,
        system_used_percent: percent_used(memory.total, memory.avail),
        system_commit_total_bytes: memory.commit_total,
        system_commit_avail_bytes: memory.commit_avail,
        system_commit_used_percent: commit_used,
        commit_pressure: commit_pressure(&memory),
        user_idle_seconds: idle_seconds(),
        self_working_set_bytes: working_set,
        self_private_bytes: private,
        last_action: history.first().cloned(),
        history,
        total_released_bytes: stats.released_bytes,
        today_released_bytes: today_released,
        adjust_count: stats.adjust_count,
    }
}

/// 按物理内存总量给出基线阈值，机器换内存后自动变化。
pub fn smart_thresholds(total: u64) -> (u32, u32) {
    let gb = total as f64 / 1024.0 / 1024.0 / 1024.0;
    if gb <= 8.5 {
        (80, 50)
    } else if gb <= 12.5 {
        (82, 52)
    } else if gb <= 16.5 {
        (85, 55)
    } else if gb <= 24.5 {
        (87, 60)
    } else if gb <= 32.5 {
        (88, 62)
    } else if gb <= 64.5 {
        (90, 65)
    } else {
        (90, 70)
    }
}

/// 电池供电时各下调 5 个百分点，插电时按当前策略执行。
fn effective_thresholds_for(settings: &Settings, total: u64) -> (u32, u32) {
    let (mut low, mut recover) = if settings.memory_smart_thresholds {
        smart_thresholds(total)
    } else {
        (
            settings.memory_low_percent,
            settings.memory_recover_percent,
        )
    };
    let (source, _) = power_state();
    if settings.memory_power_aware && source == "battery" {
        low = low.saturating_sub(5).max(60);
        recover = recover.saturating_sub(5).max(20);
    }
    recover = recover.min(low.saturating_sub(5));
    (low, recover)
}

/// 可用内存低于物理内存的 5%（至少 1 GB）时视为紧急，直接降档。
fn emergency_low(total: u64, avail: u64) -> bool {
    if total == 0 {
        return false;
    }
    avail <= (total / 20).max(1024 * 1024 * 1024)
}

/// 紧急状态解除需要回到物理内存的 8%（至少 1.5 GB）以上，避免抖动。
fn emergency_cleared(total: u64, avail: u64) -> bool {
    if total == 0 {
        return true;
    }
    avail >= (total / 12).max(1536 * 1024 * 1024)
}

/// 提交内存接近上限（≥92% 或可用不足 1 GB）说明页面文件也快用满。
fn commit_pressure(memory: &MemorySnapshot) -> bool {
    if memory.commit_total == 0 {
        return false;
    }
    percent_used(memory.commit_total, memory.commit_avail) >= 92
        || memory.commit_avail <= 1024 * 1024 * 1024
}

/// 提交内存回落到 85% 以下且可用至少 1.5 GB 才视为解除，避免阈值附近抖动。
fn commit_cleared(memory: &MemorySnapshot) -> bool {
    if memory.commit_total == 0 {
        return true;
    }
    percent_used(memory.commit_total, memory.commit_avail) <= 85
        && memory.commit_avail >= 1536 * 1024 * 1024
}

/// 键鼠空闲秒数；读取失败时按 0 处理，不会误触发空闲释放。
fn idle_seconds() -> u64 {
    #[cfg(windows)]
    {
        idle_seconds_windows()
    }
    #[cfg(not(windows))]
    {
        0
    }
}

#[cfg(windows)]
fn idle_seconds_windows() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        let tick = unsafe { GetTickCount64() };
        tick.saturating_sub(u64::from(info.dwTime)) / 1000
    } else {
        0
    }
}

/// 自定义模式的实际检查间隔：压力高时缩短到 30 秒，压力低时拉长到 120 秒。
pub fn effective_interval(settings: &Settings) -> u32 {
    let configured = settings.memory_interval_sec.max(15);
    if !settings.memory_adaptive_interval {
        return configured;
    }
    let memory = system_memory();
    let used = percent_used(memory.total, memory.avail);
    let (low, recover) = effective_thresholds_for(settings, memory.total);
    if used >= low {
        15
    } else if used <= recover {
        configured.max(120).min(300)
    } else {
        configured
    }
}

/// 按当前设置与内存压力决定档位，并在允许时释放工作集。
/// 系统低内存通知会直接降档、恢复通知会直接尝试回升，不依赖使用率是否刚好越过阈值；
/// 定时检查产生的档位切换保留 15 秒冷却，避免反复切换，事件通知本身不受冷却影响。
pub fn apply_policy(app: &tauri::AppHandle, settings: &Settings, reason: &str) -> MemoryStatus {
    let memory = system_memory();
    let used = percent_used(memory.total, memory.avail);
    let (low, recover) = effective_thresholds_for(settings, memory.total);
    let emergency = emergency_low(memory.total, memory.avail);
    let cleared = emergency_cleared(memory.total, memory.avail);
    let commit_low = commit_pressure(&memory);
    let commit_ok = commit_cleared(&memory);
    let current = LOW_ACTIVE.load(Ordering::SeqCst);
    let low_event = reason == "系统低内存";
    let recovered_event = reason == "系统内存恢复";
    let mut target = if settings.memory_mode == "manual" {
        settings.memory_level == "low"
    } else if emergency || low_event || commit_low {
        true
    } else if used >= low {
        true
    } else if recovered_event {
        if cleared && commit_ok && used <= recover {
            false
        } else {
            current
        }
    } else if used <= recover && cleared && commit_ok {
        false
    } else {
        current
    };

    let timer = reason == "定时检查";
    let now = now_millis();
    if timer && target != current && !emergency && !commit_low {
        let last = LAST_AUTO_CHANGE.load(Ordering::SeqCst);
        if last > 0 && now.saturating_sub(last) < AUTO_COOLDOWN_MS {
            target = current;
        }
    }
    let changed = target != current;
    if changed {
        apply_level(app, target);
        if timer {
            LAST_AUTO_CHANGE.store(now, Ordering::SeqCst);
        }
    }
    let paused = settings.memory_pause_fullscreen && fullscreen_active();
    let mut freed = 0;
    if target && window_hidden(app) && !paused {
        if settings.memory_drop_icons {
            let _ = app.emit("memory-squeeze", ());
        }
        if settings.memory_trim_working_set {
            freed = trim_by_scope(settings);
        }
    }
    if changed || freed > 0 {
        record(reason, freed, target);
    }
    status(settings)
}

/// 窗口隐藏：无条件降到低占用，并按偏好释放工作集。
pub fn on_hidden(app: &tauri::AppHandle, settings: &Settings) {
    let changed = !LOW_ACTIVE.load(Ordering::SeqCst);
    if changed {
        apply_level(app, true);
    }
    if settings.memory_drop_icons && !(settings.memory_pause_fullscreen && fullscreen_active()) {
        let _ = app.emit("memory-squeeze", ());
    }
    let paused = settings.memory_pause_fullscreen && fullscreen_active();
    let freed = if settings.memory_trim_working_set && !paused {
        trim_by_scope(settings)
    } else {
        0
    };
    if changed || freed > 0 {
        record("窗口隐藏", freed, true);
    }
}

/// 窗口重新显示：先恢复被挂起的 WebView2，再按内存压力决定档位。
pub fn on_shown(app: &tauri::AppHandle, settings: &Settings) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = crate::set_webview_suspended(&window, false);
    }
    let memory = system_memory();
    let used = percent_used(memory.total, memory.avail);
    let (low, _) = effective_thresholds_for(settings, memory.total);
    let emergency = emergency_low(memory.total, memory.avail);
    let commit_low = commit_pressure(&memory);
    let current = LOW_ACTIVE.load(Ordering::SeqCst);
    let target = if settings.memory_mode == "manual" {
        settings.memory_level == "low"
    } else if emergency || commit_low {
        true
    } else {
        used >= low
    };
    if target != current {
        apply_level(app, target);
        record("窗口显示", 0, target);
    }
}

/// 手动释放一次工作集，返回实际释放字节数。
pub fn trim_now(app: &tauri::AppHandle, settings: &Settings) -> MemoryStatus {
    let _ = app;
    let freed = trim_by_scope(settings);
    record("手动释放", freed, LOW_ACTIVE.load(Ordering::SeqCst));
    status(settings)
}

/// 清理系统待机列表与已修改页面列表（参考 Mem Reduct 的 Native API 方式）。
/// 需要管理员权限；失败时返回可展示的原因。
pub fn purge_system(base: &Path) -> Result<u64, String> {
    if !crate::modules::is_installed(base, "optimize") {
        return Err("系统优化插件尚未安装".to_string());
    }
    #[cfg(windows)]
    {
        let freed = purge_system_windows()?;
        record("系统缓存清理", freed, LOW_ACTIVE.load(Ordering::SeqCst));
        Ok(freed)
    }
    #[cfg(not(windows))]
    {
        let _ = base;
        Err("系统缓存清理目前只支持 Windows".to_string())
    }
}

/// 空闲自动释放：键鼠 5 分钟无操作、内存使用率达到 60% 时按释放范围执行一次。
/// 由自动模式的通知线程或自定义模式的定时线程调用，不占用界面线程。
pub fn maybe_idle_trim(app: &tauri::AppHandle, settings: &Settings) {
    if !settings.memory_idle_trim || settings.memory_mode == "manual" {
        return;
    }
    // 窗口隐藏时由 on_hidden 统一释放，避免重复执行。
    if window_hidden(app) {
        return;
    }
    if settings.memory_pause_fullscreen && fullscreen_active() {
        return;
    }
    if idle_seconds() * 1000 < IDLE_TRIM_AFTER_MS {
        return;
    }
    let memory = system_memory();
    if percent_used(memory.total, memory.avail) < IDLE_TRIM_MIN_USED_PERCENT {
        return;
    }
    let now = now_millis();
    let last = LAST_IDLE_TRIM.load(Ordering::SeqCst);
    if last > 0 && now.saturating_sub(last) < IDLE_TRIM_COOLDOWN_MS {
        return;
    }
    LAST_IDLE_TRIM.store(now, Ordering::SeqCst);
    let freed = trim_by_scope(settings);
    if freed > 0 {
        record("空闲释放", freed, LOW_ACTIVE.load(Ordering::SeqCst));
    }
}

fn apply_level(app: &tauri::AppHandle, low: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let hidden = !window.is_visible().unwrap_or(false);
        let _ = crate::set_memory_saver(window.clone(), low);
        // 窗口已隐藏时进一步挂起 WebView2，显示时会先恢复再按压力决定档位。
        let _ = crate::set_webview_suspended(&window, low && hidden);
    }
    LOW_ACTIVE.store(low, Ordering::SeqCst);
}

fn record(reason: &str, released: u64, low: bool) {
    let now = now_millis();
    let action = LastAction {
        reason: reason.to_string(),
        at: now,
        released_bytes: released,
        level: if low { "low".to_string() } else { "normal".to_string() },
    };
    if let Ok(mut history) = HISTORY.lock() {
        history.insert(0, action);
        history.truncate(HISTORY_LIMIT);
    }
    let stats = if let Ok(mut stats) = STATS.lock() {
        stats.released_bytes = stats.released_bytes.saturating_add(released);
        stats.adjust_count = stats.adjust_count.saturating_add(1);
        if stats.today_at / 86_400_000 != now / 86_400_000 {
            stats.today_at = now;
            stats.today_released_bytes = 0;
        }
        stats.today_released_bytes = stats.today_released_bytes.saturating_add(released);
        Some(stats.clone())
    } else {
        None
    };
    if let (Some(stats), Ok(file)) = (stats, STATS_FILE.lock()) {
        if let Some(path) = file.as_ref() {
            if let Ok(data) = serde_json::to_vec_pretty(&stats) {
                let _ = fs::write(path, data);
            }
        }
    }
}

fn percent_used(total: u64, avail: u64) -> u32 {
    if total == 0 {
        return 0;
    }
    let used = total.saturating_sub(avail);
    ((u128::from(used) * 100 / u128::from(total)) as u32).min(100)
}

fn window_hidden(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .map(|visible| !visible)
        .unwrap_or(false)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, Default)]
struct MemorySnapshot {
    total: u64,
    avail: u64,
    commit_total: u64,
    commit_avail: u64,
}

#[cfg(windows)]
fn system_memory() -> MemorySnapshot {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut memory = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    if unsafe { GlobalMemoryStatusEx(&mut memory) }.is_err() {
        return MemorySnapshot::default();
    }
    MemorySnapshot {
        total: memory.ullTotalPhys,
        avail: memory.ullAvailPhys,
        commit_total: memory.ullTotalPageFile,
        commit_avail: memory.ullAvailPageFile,
    }
}

#[cfg(not(windows))]
fn system_memory() -> MemorySnapshot {
    MemorySnapshot::default()
}

#[cfg(windows)]
fn self_memory() -> (u64, u64) {
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::GetCurrentProcess;

    let mut counters = PROCESS_MEMORY_COUNTERS {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ..Default::default()
    };
    let result = unsafe {
        GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut counters,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
    };
    if result.is_err() {
        return (0, 0);
    }
    (
        counters.WorkingSetSize as u64,
        counters.PagefileUsage as u64,
    )
}

#[cfg(not(windows))]
fn self_memory() -> (u64, u64) {
    (0, 0)
}

#[cfg(windows)]
pub fn trim_self() -> u64 {
    use windows::Win32::System::ProcessStatus::EmptyWorkingSet;
    use windows::Win32::System::Threading::GetCurrentProcess;

    let before = self_memory().0;
    let _ = unsafe { EmptyWorkingSet(GetCurrentProcess()) };
    let after = self_memory().0;
    before.saturating_sub(after)
}

#[cfg(windows)]
#[link(name = "ntdll")]
extern "system" {
    fn NtSetSystemInformation(
        system_information_class: u32,
        system_information: *mut std::ffi::c_void,
        system_information_length: u32,
    ) -> i32;
}

/// 参考 Mem Reduct：清除已修改页面列表与待机列表（含低优先级待机页）。
/// 需要管理员权限与 SeProfileSingleProcessPrivilege。
#[cfg(windows)]
fn purge_system_windows() -> Result<u64, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{BOOL, CloseHandle, HANDLE, LUID};
    use windows::Win32::Security::{
        AdjustTokenPrivileges, LUID_AND_ATTRIBUTES, LookupPrivilegeValueW, SE_PRIVILEGE_ENABLED,
        TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    fn enable_privilege(name: &str) -> bool {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let mut token = HANDLE::default();
            if OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
                &mut token,
            )
            .is_err()
            {
                return false;
            }
            let mut luid = LUID::default();
            let mut enabled =
                LookupPrivilegeValueW(PCWSTR::null(), PCWSTR(wide.as_ptr()), &mut luid).is_ok();
            if enabled {
                let privileges = TOKEN_PRIVILEGES {
                    PrivilegeCount: 1,
                    Privileges: [LUID_AND_ATTRIBUTES {
                        Luid: luid,
                        Attributes: SE_PRIVILEGE_ENABLED,
                    }],
                };
                enabled = AdjustTokenPrivileges(
                    token,
                    BOOL(0),
                    Some(&privileges),
                    0,
                    None,
                    None,
                )
                .is_ok();
            }
            let _ = CloseHandle(token);
            enabled
        }
    }

    if !enable_privilege("SeProfileSingleProcessPrivilege") {
        return Err("需要管理员权限：请右键以管理员身份运行启点后再清理系统缓存".to_string());
    }

    let before = system_memory().avail;
    let mut applied = false;
    let mut last_status = 0i32;
    // 3 = 已修改页面列表，4 = 待机列表，5 = 低优先级待机列表。
    for command in [3u32, 4u32, 5u32] {
        let mut value = command;
        let status = unsafe {
            NtSetSystemInformation(
                80,
                &mut value as *mut u32 as *mut std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            )
        };
        if status >= 0 {
            applied = true;
        } else {
            last_status = status;
        }
    }
    if !applied {
        return Err(format!(
            "系统未授予内存清理权限（NTSTATUS 0x{:08X}），请以管理员身份运行启点",
            last_status
        ));
    }
    let after = system_memory().avail;
    Ok(after.saturating_sub(before))
}

#[cfg(not(windows))]
pub fn trim_self() -> u64 {
    0
}

/// 按设置选择释放范围；电池供电或全屏时自动退回仅释放启点自身。
fn trim_by_scope(settings: &Settings) -> u64 {
    let mut freed = trim_self();
    let battery = settings.memory_power_aware && power_state().0 == "battery";
    let paused = settings.memory_pause_fullscreen && fullscreen_active();
    if settings.memory_trim_scope == "system" && !battery && !paused {
        freed = freed.saturating_add(trim_system());
    }
    freed
}

/// 释放其他应用的空闲工作集：跳过系统保护进程、当前进程与前台进程。
#[cfg(windows)]
fn trim_system() -> u64 {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::ProcessStatus::{
        EmptyWorkingSet, GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA,
        PROCESS_VM_READ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    fn working_set(handle: windows::Win32::Foundation::HANDLE) -> u64 {
        let mut counters = PROCESS_MEMORY_COUNTERS {
            cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            ..Default::default()
        };
        if unsafe {
            GetProcessMemoryInfo(
                handle,
                &mut counters,
                std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            )
        }
        .is_ok()
        {
            counters.WorkingSetSize as u64
        } else {
            0
        }
    }

    let mut foreground = 0u32;
    unsafe {
        GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut foreground));
    }
    let current = unsafe { GetCurrentProcessId() };

    let snapshot = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
        Ok(handle) => handle,
        Err(_) => return 0,
    };
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_err() {
        let _ = unsafe { CloseHandle(snapshot) };
        return 0;
    }

    let mut freed = 0u64;
    loop {
        let pid = entry.th32ProcessID;
        let raw_name = String::from_utf16_lossy(
            &entry.szExeFile[..entry
                .szExeFile
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(entry.szExeFile.len())],
        );
        let name = raw_name
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_lowercase();
        if pid > 4
            && pid != current
            && pid != foreground
            && !name.is_empty()
            && !crate::processes::is_protected(&name, None)
        {
            if let Ok(handle) = unsafe {
                OpenProcess(
                    PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA | PROCESS_VM_READ,
                    false,
                    pid,
                )
            } {
                let before = working_set(handle);
                // 小进程释放收益很低，跳过以减少系统调用。
                if before >= 16 * 1024 * 1024 {
                    let _ = unsafe { EmptyWorkingSet(handle) };
                    let after = working_set(handle);
                    freed = freed.saturating_add(before.saturating_sub(after));
                }
                let _ = unsafe { CloseHandle(handle) };
            }
        }
        if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
            break;
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };
    freed
}

#[cfg(not(windows))]
fn trim_system() -> u64 {
    0
}

/// 当前电源状态：ac / battery / unknown，以及电池百分比。
pub fn power_state() -> (String, Option<u32>) {
    #[cfg(windows)]
    {
        power_state_windows()
    }
    #[cfg(not(windows))]
    {
        ("unknown".to_string(), None)
    }
}

#[cfg(windows)]
fn power_state_windows() -> (String, Option<u32>) {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut status = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut status) }.is_err() {
        return ("unknown".to_string(), None);
    }
    let source = match status.ACLineStatus {
        0 => "battery",
        1 => "ac",
        _ => "unknown",
    };
    let percent = if status.BatteryLifePercent <= 100 {
        Some(u32::from(status.BatteryLifePercent))
    } else {
        None
    };
    (source.to_string(), percent)
}

/// 检测前台是否全屏运行（游戏、播放器、演示），避免在其前面释放工作集。
pub fn fullscreen_active() -> bool {
    #[cfg(windows)]
    {
        fullscreen_active_windows()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn fullscreen_active_windows() -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, IsWindowVisible,
    };

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return false;
    }
    if !unsafe { IsWindowVisible(hwnd).as_bool() } {
        return false;
    }
    let mut class = [0u16; 64];
    let length = unsafe { GetClassNameW(hwnd, &mut class) };
    if length > 0 {
        let name = String::from_utf16_lossy(&class[..length as usize]);
        if matches!(name.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
            return false;
        }
    }
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return false;
    }
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return false;
    }
    let screen = info.rcMonitor;
    rect.left <= screen.left + 2
        && rect.top <= screen.top + 2
        && rect.right >= screen.right - 2
        && rect.bottom >= screen.bottom - 2
}

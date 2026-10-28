mod autostart;
mod cleanup;
mod force_delete;
mod icons;
mod launch;
mod memory;
mod models;
mod modules;
mod network;
mod optimize;
mod performance;
mod powershell;
mod processes;
mod scanner;
mod startup;
mod store;

use models::{
    AppEntry, AppSource, Bootstrap, LaunchTarget, ProcessItem, ProcessTarget, ScanCache,
    ScanOptions, ScanResult, ScannedApp, Settings, StartupScan, TerminateReport,
};
use cleanup::{CleanupDeleteReport, CleanupScan};
use performance::{
    CleanResult, PerfModuleStatus, PerfSystemInfo, PowerInfo, TempScan,
};
use memory::MemoryStatus;
use modules::ModuleStatus;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

static HOTKEY_OK: AtomicBool = AtomicBool::new(false);
static TRAY_OK: AtomicBool = AtomicBool::new(false);
static QUITTING: AtomicBool = AtomicBool::new(false);
static CUSTOM_MONITOR: AtomicBool = AtomicBool::new(false);
static MEMORY_WAKE: Mutex<Option<std::sync::mpsc::Sender<()>>> = Mutex::new(None);
static MEMORY_ACTIVE: AtomicBool = AtomicBool::new(false);
static MEMORY_WATCHER: AtomicBool = AtomicBool::new(false);
/// 显示/隐藏快捷键的规范化字符串（`Shortcut::to_string`）。
static HOTKEY_TOGGLE: Mutex<Option<String>> = Mutex::new(None);
/// 应用快捷键：规范化字符串 → 应用 id。
static HOTKEY_APPS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static HOTKEY_REPORT: Mutex<Option<HotkeyStatus>> = Mutex::new(None);

struct AppState {
    paths: store::Paths,
    settings: Mutex<Settings>,
    apps: Mutex<HashMap<String, ScannedApp>>,
    cache_at: Mutex<Option<u64>>,
}

#[tauri::command]
fn bootstrap(state: State<'_, AppState>) -> Result<Bootstrap, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "设置状态不可用".to_string())?
        .clone();
    let mut apps: Vec<AppEntry> = state
        .apps
        .lock()
        .map_err(|_| "应用索引不可用".to_string())?
        .values()
        .map(|item| item.entry.clone())
        .collect();
    sort_apps(&mut apps);
    let scanned_at = *state
        .cache_at
        .lock()
        .map_err(|_| "扫描状态不可用".to_string())?;
    Ok(Bootstrap {
        settings,
        apps,
        scanned_at,
    })
}

#[tauri::command]
async fn prune_missing_apps(app: tauri::AppHandle) -> Result<Vec<AppEntry>, String> {
    let handle = app.clone();
    let (entries, hotkeys_changed) = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let mut apps = state
            .apps
            .lock()
            .map_err(|_| "应用索引不可用".to_string())?;
        let before = apps.len();
        let mut removed = Vec::new();
        apps.retain(|id, item| {
            let alive = launch::target_exists(&item.target);
            if !alive {
                removed.push(id.clone());
            }
            alive
        });
        // 应用已不存在时同步清掉它的图标缓存，避免缓存目录越积越大。
        for id in &removed {
            let _ = std::fs::remove_file(state.paths.icons.join(format!("{id}.png")));
            let _ = std::fs::remove_file(state.paths.icons.join(format!("{id}.miss")));
        }
        let mut hotkeys_changed = false;
        if !removed.is_empty() {
            if let Ok(mut settings) = state.settings.lock() {
                let before_hotkeys = settings.app_hotkeys.len();
                settings.app_hotkeys.retain(|id, _| !removed.contains(id));
                if settings.app_hotkeys.len() != before_hotkeys {
                    let snapshot = settings.clone();
                    drop(settings);
                    let _ = store::save_settings(&state.paths, &snapshot);
                    hotkeys_changed = true;
                }
            }
        }
        if apps.len() != before {
            let scanned = apps.values().cloned().collect::<Vec<_>>();
            let scanned_at = *state
                .cache_at
                .lock()
                .map_err(|_| "扫描状态不可用".to_string())?;
            if let Some(scanned_at) = scanned_at {
                let _ = store::save_cache(
                    &state.paths,
                    &ScanCache {
                        schema: scanner::CACHE_SCHEMA,
                        scanned_at,
                        apps: scanned,
                    },
                );
            }
        }
        let mut entries: Vec<AppEntry> = apps.values().map(|item| item.entry.clone()).collect();
        sort_apps(&mut entries);
        Ok::<(Vec<AppEntry>, bool), String>((entries, hotkeys_changed))
    })
    .await
    .map_err(|_| "校验应用列表失败".to_string())??;

    if hotkeys_changed {
        apply_hotkeys(&app, &settings_snapshot(&app));
        refresh_tray_menu(&app);
    }
    Ok(entries)
}

#[tauri::command]
async fn scan_apps(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    force: bool,
) -> Result<ScanResult, String> {
    let paths = state.paths.clone();
    let (options, auto_refresh_hours) = {
        let settings = state
            .settings
            .lock()
            .map_err(|_| "设置状态不可用".to_string())?;
        (
            ScanOptions {
                scan_uwp: settings.scan_uwp,
                include_system_apps: settings.include_system_apps,
                scan_install_dirs: settings.scan_install_dirs,
            },
            settings.auto_refresh_hours,
        )
    };

    let cached_at = *state
        .cache_at
        .lock()
        .map_err(|_| "扫描状态不可用".to_string())?;

    if !force {
        if let Some(timestamp) = cached_at {
            let fresh = if auto_refresh_hours == 0 {
                true
            } else {
                store::now_millis().saturating_sub(timestamp)
                    < u64::from(auto_refresh_hours) * 3_600_000
            };
            if fresh {
                let mut apps: Vec<AppEntry> = state
                    .apps
                    .lock()
                    .map_err(|_| "应用索引不可用".to_string())?
                    .values()
                    .map(|item| item.entry.clone())
                    .collect();
                if !apps.is_empty() {
                    sort_apps(&mut apps);
                    return Ok(ScanResult {
                        apps,
                        scanned_at: timestamp,
                        cached: true,
                        duration_ms: 0,
                    });
                }
            }
        }
    }

    let app_handle = app.clone();
    let outcome =
        tauri::async_runtime::spawn_blocking(move || scanner::scan(&paths, &options, &app_handle))
            .await
            .map_err(|error| error.to_string())??;

    let index: HashMap<String, ScannedApp> = outcome
        .apps
        .into_iter()
        .map(|item| (item.entry.id.clone(), item))
        .collect();
    let mut apps: Vec<AppEntry> = index.values().map(|item| item.entry.clone()).collect();
    sort_apps(&mut apps);

    *state
        .apps
        .lock()
        .map_err(|_| "应用索引不可用".to_string())? = index;
    *state
        .cache_at
        .lock()
        .map_err(|_| "扫描状态不可用".to_string())? = Some(outcome.scanned_at);

    // 扫描后应用索引变化：重新绑定应用快捷键，并刷新托盘里的快捷启动菜单。
    apply_hotkeys(&app, &settings_snapshot(&app));
    refresh_tray_menu(&app);

    Ok(ScanResult {
        apps,
        scanned_at: outcome.scanned_at,
        cached: false,
        duration_ms: outcome.duration_ms,
    })
}

#[tauri::command]
async fn load_icons(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let paths = state.paths.clone();
    let targets: Vec<(String, LaunchTarget)> = {
        let apps = state
            .apps
            .lock()
            .map_err(|_| "应用索引不可用".to_string())?;
        ids.into_iter()
            .take(120)
            .filter_map(|id| apps.get(&id).map(|item| (id.clone(), item.target.clone())))
            .collect()
    };
    tauri::async_runtime::spawn_blocking(move || icons::load_icons(&paths, targets))
        .await
        .map_err(|error| error.to_string())
}

/// 启动后空闲时预热全部图标到磁盘缓存，滚动时直接读盘，不再现场提取。
#[tauri::command]
async fn warm_icons(state: State<'_, AppState>) -> Result<usize, String> {
    let paths = state.paths.clone();
    let targets: Vec<(String, LaunchTarget)> = {
        let apps = state
            .apps
            .lock()
            .map_err(|_| "应用索引不可用".to_string())?;
        apps.iter()
            .take(400)
            .map(|(id, item)| (id.clone(), item.target.clone()))
            .collect()
    };
    tauri::async_runtime::spawn_blocking(move || icons::warm_icons(&paths, targets))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn launch_app(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let target = {
        let apps = state
            .apps
            .lock()
            .map_err(|_| "应用索引不可用".to_string())?;
        apps.get(&id)
            .map(|item| item.target.clone())
            .ok_or_else(|| "应用不存在或索引已刷新".to_string())?
    };
    launch::launch(&target)?;
    record_usage(&state, &id);
    Ok(())
}

/// 记录一次启动，供启动台「常用优先」排序使用。
/// 启动成功才计数；写盘失败不影响启动本身。
fn record_usage(state: &State<'_, AppState>, id: &str) {
    let Ok(mut settings) = state.settings.lock() else {
        return;
    };
    *settings.usage.entry(id.to_string()).or_insert(0) += 1;
    let snapshot = settings.clone();
    drop(settings);
    let _ = store::save_settings(&state.paths, &snapshot);
}

#[tauri::command]
fn reveal_app(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let target = {
        let apps = state
            .apps
            .lock()
            .map_err(|_| "应用索引不可用".to_string())?;
        apps.get(&id)
            .map(|item| item.target.clone())
            .ok_or_else(|| "应用不存在或索引已刷新".to_string())?
    };
    launch::reveal(&target)
}

#[tauri::command]
fn save_settings(
    mut settings: Settings,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    store::sanitize_settings(&mut settings);
    // 前端持有的设置副本可能早于最近几次启动，合并时按 id 取较大计数，避免把启动次数写回旧值。
    let live_usage = state
        .settings
        .lock()
        .map(|item| item.usage.clone())
        .unwrap_or_default();
    for (id, count) in live_usage {
        let entry = settings.usage.entry(id).or_insert(0);
        if count > *entry {
            *entry = count;
        }
    }
    store::save_settings(&state.paths, &settings)?;
    let previous = state.settings.lock().map(|item| item.clone()).unwrap_or_default();
    *state
        .settings
        .lock()
        .map_err(|_| "设置状态不可用".to_string())? = settings.clone();
    if previous.hotkey_toggle != settings.hotkey_toggle
        || previous.app_hotkeys != settings.app_hotkeys
    {
        apply_hotkeys(&app, &settings);
    }
    refresh_tray_menu(&app);
    if MEMORY_ACTIVE.load(Ordering::SeqCst) {
        memory::apply_policy(&app, &settings, "设置变更");
        ensure_memory_monitor(&app);
        wake_memory_monitor();
    }
    Ok(())
}

#[tauri::command]
fn reset_settings(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Settings, String> {
    let settings = Settings::default();
    store::save_settings(&state.paths, &settings)?;
    *state
        .settings
        .lock()
        .map_err(|_| "设置状态不可用".to_string())? = settings.clone();
    apply_hotkeys(&app, &settings);
    refresh_tray_menu(&app);
    if MEMORY_ACTIVE.load(Ordering::SeqCst) {
        memory::apply_policy(&app, &settings, "恢复默认");
        ensure_memory_monitor(&app);
        wake_memory_monitor();
    }
    Ok(settings)
}

#[tauri::command]
fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    store::clear_cache(&state.paths)?;
    *state
        .cache_at
        .lock()
        .map_err(|_| "扫描状态不可用".to_string())? = None;
    Ok(())
}

#[tauri::command]
fn open_data_dir(state: State<'_, AppState>) -> Result<(), String> {
    launch::open_folder(&state.paths.base)
}

#[tauri::command]
fn save_wallpaper(state: State<'_, AppState>, id: String, data: String) -> Result<u64, String> {
    store::save_wallpaper(&state.paths, &id, &data)
}

#[tauri::command]
fn read_wallpaper(state: State<'_, AppState>, id: String) -> Result<String, String> {
    store::read_wallpaper(&state.paths, &id)
}

#[tauri::command]
fn delete_wallpaper(state: State<'_, AppState>, id: String) -> Result<(), String> {
    store::delete_wallpaper(&state.paths, &id)
}

#[cfg(windows)]
fn set_memory_level(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;

    window
        .with_webview(move |webview| {
            let controller = webview.controller();
            let core = match unsafe { controller.CoreWebView2() } {
                Ok(core) => core,
                Err(_) => return,
            };
            let core = match core.cast::<ICoreWebView2_19>() {
                Ok(core) => core,
                Err(_) => return,
            };
            let level = if enabled {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            };
            let _ = unsafe { core.SetMemoryUsageTargetLevel(level) };
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn set_memory_level(_window: &tauri::WebviewWindow, _enabled: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn set_memory_saver(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    if !MEMORY_ACTIVE.load(Ordering::SeqCst) {
        return Ok(());
    }
    set_memory_level(&window, enabled)
}

/// 窗口隐藏时挂起 WebView2，进一步释放渲染进程占用；显示前必须恢复。
#[cfg(windows)]
pub(crate) fn set_webview_suspended(
    window: &tauri::WebviewWindow,
    suspended: bool,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
    use windows_core::Interface;

    window
        .with_webview(move |webview| {
            let controller = webview.controller();
            let core = match unsafe { controller.CoreWebView2() } {
                Ok(core) => core,
                Err(_) => return,
            };
            let core = match core.cast::<ICoreWebView2_3>() {
                Ok(core) => core,
                Err(_) => return,
            };
            if suspended {
                let _ = unsafe { core.TrySuspend(None) };
            } else {
                let _ = unsafe { core.Resume() };
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
pub(crate) fn set_webview_suspended(
    _window: &tauri::WebviewWindow,
    _suspended: bool,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn list_startup(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<StartupScan, String> {
    require_module(&state, "background")?;
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        if force {
            startup::invalidate_probe_cache();
        }
        startup::list_startup()
    })
    .await
    .map_err(|_| "启动项读取失败".to_string())
}

#[tauri::command]
fn set_startup_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<StartupScan, String> {
    require_module(&state, "background")?;
    startup::set_startup_enabled(&id, enabled)
}

#[tauri::command]
async fn list_processes() -> Result<Vec<ProcessItem>, String> {
    tauri::async_runtime::spawn_blocking(processes::list_processes)
        .await
        .map_err(|_| "进程列表读取失败".to_string())?
}

#[tauri::command]
fn terminate_processes(
    state: State<'_, AppState>,
    targets: Vec<ProcessTarget>,
) -> Result<TerminateReport, String> {
    require_module(&state, "background")?;
    Ok(processes::terminate_processes(targets))
}

#[tauri::command]
fn performance_module_status(state: State<'_, AppState>) -> PerfModuleStatus {
    performance::status(&state.paths.base)
}

#[tauri::command]
fn performance_module_install(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<PerfModuleStatus, String> {
    performance::install(&app, &state.paths.base)
}

#[tauri::command]
fn performance_module_uninstall(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<PerfModuleStatus, String> {
    performance::uninstall(&app, &state.paths.base)
}

#[tauri::command]
fn list_modules(state: State<'_, AppState>) -> Vec<ModuleStatus> {
    modules::list(&state.paths.base)
}

#[tauri::command]
fn install_module(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ModuleStatus>, String> {
    modules::install(&app, &state.paths.base, &id)
}

#[tauri::command]
fn uninstall_module(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ModuleStatus>, String> {
    require_module(&state, &id)?;
    modules::uninstall(&app, &state.paths.base, &id)
}

#[tauri::command]
async fn cleanup_scan(state: State<'_, AppState>) -> Result<CleanupScan, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || cleanup::scan(&base))
        .await
        .map_err(|_| "应用清理扫描失败".to_string())?
}

#[tauri::command]
async fn cleanup_delete(
    state: State<'_, AppState>,
    paths: Vec<String>,
    recycle: bool,
) -> Result<CleanupDeleteReport, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || cleanup::delete(&base, paths, recycle))
        .await
        .map_err(|_| "删除残留文件夹失败".to_string())?
}

#[tauri::command]
fn cleanup_open(state: State<'_, AppState>, path: String) -> Result<(), String> {
    cleanup::open(&state.paths.base, &path)
}

#[tauri::command]
async fn cleanup_apps(
    state: State<'_, AppState>,
) -> Result<Vec<cleanup::CleanupApp>, String> {
    let base = state.paths.base.clone();
    let mut apps = tauri::async_runtime::spawn_blocking(move || cleanup::apps(&base))
        .await
        .map_err(|_| "读取已安装应用失败".to_string())??;

    let mut known_exes = HashSet::new();
    let mut known_dirs: Vec<String> = Vec::new();
    for app in &apps {
        if let Some(exe) = &app.icon_path {
            known_exes.insert(normalize_app_path(exe));
        }
        if let Some(dir) = &app.install_location {
            known_dirs.push(normalize_app_path(dir));
        }
    }

    let scanned = state
        .apps
        .lock()
        .map(|apps| apps.values().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let mut seen_dirs = HashSet::new();
    let mut added = 0usize;
    for item in scanned {
        if item.entry.source == AppSource::Uwp {
            continue;
        }
        let LaunchTarget::Executable { path, .. } = &item.target else {
            continue;
        };
        let exe = normalize_app_path(path);
        if exe.is_empty() || is_system_app_path(&exe) || known_exes.contains(&exe) {
            continue;
        }
        if known_dirs
            .iter()
            .any(|dir| exe == *dir || exe.starts_with(&format!("{dir}\\")))
        {
            continue;
        }
        let dir = item
            .entry
            .install_location
            .as_deref()
            .map(normalize_app_path)
            .filter(|dir| !dir.is_empty())
            .or_else(|| {
                std::path::Path::new(path)
                    .parent()
                    .map(|parent| normalize_app_path(&parent.to_string_lossy()))
            });
        let Some(dir) = dir else { continue };
        if dir.is_empty()
            || is_system_app_path(&format!("{dir}\\"))
            || !seen_dirs.insert(dir.clone())
        {
            continue;
        }
        if added >= 60 {
            break;
        }
        added += 1;
        apps.push(cleanup::CleanupApp {
            id: item.entry.id.clone(),
            name: item.entry.name.clone(),
            publisher: item.entry.publisher.clone(),
            version: item.entry.version.clone(),
            install_location: Some(dir),
            size_bytes: 0,
            scope: String::new(),
            icon_path: Some(path.clone()),
            quiet: false,
            uninstallable: false,
        });
    }
    apps.sort_by(|a, b| {
        b.uninstallable
            .cmp(&a.uninstallable)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(apps)
}

fn normalize_app_path(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn is_system_app_path(path: &str) -> bool {
    if path.contains(r"\microsoft\windowsapps\") {
        return true;
    }
    let mut roots = vec![
        r"\windows\system32\".to_string(),
        r"\windows\syswow64\".to_string(),
    ];
    if let Ok(windir) = std::env::var("SystemRoot") {
        let windir = normalize_app_path(&windir);
        roots.push(format!("{windir}\\system32\\"));
        roots.push(format!("{windir}\\syswow64\\"));
    }
    roots.iter().any(|root| path.contains(root.as_str()))
}

#[tauri::command]
async fn cleanup_uninstall(
    state: State<'_, AppState>,
    id: String,
    remove_leftovers: bool,
) -> Result<cleanup::UninstallReport, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || {
        cleanup::uninstall(&base, &id, remove_leftovers)
    })
    .await
    .map_err(|_| "卸载应用失败".to_string())?
}

#[tauri::command]
async fn performance_system_info(state: State<'_, AppState>) -> Result<PerfSystemInfo, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || performance::system_info(&base))
        .await
        .map_err(|_| "系统体检失败".to_string())?
}

#[tauri::command]
async fn performance_scan_temp(state: State<'_, AppState>, days: u32) -> Result<TempScan, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || performance::scan_temp(&base, days))
        .await
        .map_err(|_| "临时文件扫描失败".to_string())?
}

#[tauri::command]
async fn performance_clean_temp(
    state: State<'_, AppState>,
    categories: Vec<String>,
    days: u32,
) -> Result<CleanResult, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || performance::clean_temp(&base, categories, days))
        .await
        .map_err(|_| "临时文件清理失败".to_string())?
}

#[tauri::command]
async fn performance_disk_usage(
    state: State<'_, AppState>,
    drive: Option<String>,
) -> Result<performance::DiskUsageScan, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || performance::disk_usage(&base, drive))
        .await
        .map_err(|_| "磁盘空间分析失败".to_string())?
}

#[tauri::command]
async fn performance_set_power(
    state: State<'_, AppState>,
    guid: String,
) -> Result<PowerInfo, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || performance::set_power(&base, &guid))
        .await
        .map_err(|_| "切换电源计划失败".to_string())?
}

#[tauri::command]
async fn performance_flush_dns(state: State<'_, AppState>) -> Result<String, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || performance::flush_dns(&base))
        .await
        .map_err(|_| "刷新 DNS 失败".to_string())?
}

/// 优化插件的当前电源计划查询，独立于体检数据。
#[tauri::command]
async fn optimize_power_status(state: State<'_, AppState>) -> Result<performance::PowerInfo, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || performance::power_status(&base))
        .await
        .map_err(|_| "读取电源计划失败".to_string())?
}

#[tauri::command]
fn optimize_list(state: State<'_, AppState>) -> Result<Vec<optimize::OptimizeItem>, String> {
    optimize::list(&state.paths.base)
}

#[tauri::command]
async fn optimize_apply(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<optimize::OptimizeOutcome, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || optimize::apply(&base, ids))
        .await
        .map_err(|_| "应用优化项失败".to_string())?
}

#[tauri::command]
async fn optimize_restore(
    state: State<'_, AppState>,
    ids: Vec<String>,
    all: bool,
) -> Result<optimize::OptimizeOutcome, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || optimize::restore(&base, ids, all))
        .await
        .map_err(|_| "还原优化项失败".to_string())?
}

/// 当前进程是否为管理员令牌：决定系统级清理（Windows 临时目录、更新缓存等）
/// 是否需要先做提权。主程序默认以管理员运行，普通权限会返回 false。
#[tauri::command]
fn elevated_status() -> bool {
    optimize::is_elevated()
}

/// 读取当前各接口的 DNS 配置与是否已切换公共 DNS 的备份信息。
#[tauri::command]
async fn optimize_dns_status(
    state: State<'_, AppState>,
) -> Result<network::DnsStatus, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || network::dns_status(&base))
        .await
        .map_err(|_| "读取 DNS 状态失败".to_string())?
}

/// 一键切换公共 DNS（阿里/腾讯/Google/Cloudflare），切换前自动备份原配置。
#[tauri::command]
async fn optimize_dns_set(
    state: State<'_, AppState>,
    preset: String,
) -> Result<optimize::OptimizeOutcome, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || optimize::dns_set(&base, &preset))
        .await
        .map_err(|_| "切换 DNS 失败".to_string())?
}

/// 还原为切换公共 DNS 前的原始配置，并清除备份。
#[tauri::command]
async fn optimize_dns_restore(
    state: State<'_, AppState>,
) -> Result<optimize::OptimizeOutcome, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || optimize::dns_restore(&base))
        .await
        .map_err(|_| "还原 DNS 失败".to_string())?
}

/// 网络连通性诊断：公网可达性 + 域名解析测试，只读不会修改任何配置。
#[tauri::command]
async fn optimize_network_diag(
    state: State<'_, AppState>,
) -> Result<network::DiagReport, String> {
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if crate::modules::is_installed(&base, "optimize") {
            network::diagnose()
        } else {
            Err("系统优化模块尚未安装".to_string())
        }
    })
    .await
    .map_err(|_| "网络诊断失败".to_string())?
}

#[tauri::command]
fn autostart_status() -> bool {
    autostart::is_enabled()
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<bool, String> {
    autostart::set_enabled(enabled)
}

#[tauri::command]
fn hotkey_status() -> HotkeyStatus {
    HOTKEY_REPORT
        .lock()
        .ok()
        .and_then(|report| report.clone())
        .unwrap_or_else(|| HotkeyStatus {
            toggle: String::new(),
            toggle_ok: false,
            bindings: Vec::new(),
            errors: Vec::new(),
        })
}

#[tauri::command]
fn started_hidden() -> bool {
    std::env::args().any(|arg| arg == "--autostart") && TRAY_OK.load(Ordering::SeqCst)
}

#[tauri::command]
fn tray_status() -> bool {
    TRAY_OK.load(Ordering::SeqCst)
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn memory_status(state: State<'_, AppState>) -> Result<MemoryStatus, String> {
    require_module(&state, "memory")?;
    let settings = state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .unwrap_or_default();
    Ok(memory::status(&settings))
}

#[tauri::command]
fn memory_apply(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<MemoryStatus, String> {
    require_module(&state, "memory")?;
    Ok(apply_memory_policy(&app, "手动检查"))
}

#[tauri::command]
async fn memory_trim(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<MemoryStatus, String> {
    require_module(&state, "memory")?;
    let settings = state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .unwrap_or_default();
    // 释放全部应用时枚举进程会有一定耗时，放到阻塞线程，避免卡住界面。
    let status = tauri::async_runtime::spawn_blocking(move || memory::trim_now(&app, &settings))
        .await
        .map_err(|error| error.to_string())?;
    Ok(status)
}

#[tauri::command]
async fn memory_purge_system(state: State<'_, AppState>) -> Result<u64, String> {
    require_module(&state, "optimize")?;
    let base = state.paths.base.clone();
    tauri::async_runtime::spawn_blocking(move || memory::purge_system(&base))
        .await
        .map_err(|error| error.to_string())?
}

fn require_module(state: &AppState, id: &str) -> Result<(), String> {
    if modules::is_installed(&state.paths.base, id) {
        Ok(())
    } else {
        Err(format!("插件「{}」尚未安装", modules::name(id)))
    }
}

/// 自定义模式才启动定时线程；自动模式完全依赖系统低内存通知。
/// 线程阻塞在 recv_timeout 上，设置变化时被唤醒，不做短周期轮询。
fn ensure_memory_monitor(app: &tauri::AppHandle) {
    if !MEMORY_ACTIVE.load(Ordering::SeqCst) {
        return;
    }
    if settings_snapshot(app).memory_mode != "custom" {
        return;
    }
    if CUSTOM_MONITOR.swap(true, Ordering::SeqCst) {
        return;
    }
    let (sender, receiver) = std::sync::mpsc::channel::<()>();
    if let Ok(mut slot) = MEMORY_WAKE.lock() {
        *slot = Some(sender);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        use std::sync::mpsc::RecvTimeoutError;

        loop {
            if !MEMORY_ACTIVE.load(Ordering::SeqCst) {
                break;
            }
            let settings = settings_snapshot(&app);
            if settings.memory_mode != "custom" {
                break;
            }
            let interval = Duration::from_secs(u64::from(memory::effective_interval(&settings)));
            match receiver.recv_timeout(interval) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => {
                    let settings = settings_snapshot(&app);
                    if settings.memory_mode == "custom" {
                        memory::apply_policy(&app, &settings, "定时检查");
                        memory::maybe_idle_trim(&app, &settings);
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        CUSTOM_MONITOR.store(false, Ordering::SeqCst);
        if let Ok(mut slot) = MEMORY_WAKE.lock() {
            *slot = None;
        }
    });
}

fn wake_memory_monitor() {
    if let Ok(slot) = MEMORY_WAKE.lock() {
        if let Some(sender) = slot.as_ref() {
            let _ = sender.send(());
        }
    }
}

#[cfg(windows)]
fn spawn_memory_watcher(app: tauri::AppHandle) {
    use windows::Win32::System::Memory::{
        CreateMemoryResourceNotification, HighMemoryResourceNotification,
        LowMemoryResourceNotification,
    };
    use windows::Win32::System::Threading::WaitForMultipleObjects;

    if MEMORY_WATCHER.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let low = unsafe { CreateMemoryResourceNotification(LowMemoryResourceNotification) };
        let high = unsafe { CreateMemoryResourceNotification(HighMemoryResourceNotification) };
        let (Ok(low), Ok(high)) = (low, high) else {
            MEMORY_WATCHER.store(false, Ordering::SeqCst);
            return;
        };
        let handles = [low, high];
        let mut last: Option<bool> = None;
        loop {
            if !MEMORY_ACTIVE.load(Ordering::SeqCst) {
                break;
            }
            let result = unsafe { WaitForMultipleObjects(&handles, false, 30_000) };
            let index = result.0;
            if index > 1 {
                // 超时也做一次空闲检查，不依赖内存通知；无操作时才会实际执行。
                let settings = settings_snapshot(&app);
                if MEMORY_ACTIVE.load(Ordering::SeqCst) && settings.memory_mode == "auto" {
                    memory::maybe_idle_trim(&app, &settings);
                }
                continue;
            }
            let is_low = index == 0;
            if last == Some(is_low) {
                std::thread::sleep(Duration::from_secs(10));
                continue;
            }
            last = Some(is_low);
            let app = app.clone();
            let reason = if is_low { "系统低内存" } else { "系统内存恢复" };
            let task_app = app.clone();
            let _ = app.run_on_main_thread(move || {
                let settings = settings_snapshot(&task_app);
                if MEMORY_ACTIVE.load(Ordering::SeqCst) && settings.memory_mode == "auto" {
                    memory::apply_policy(&task_app, &settings, reason);
                }
            });
        }
        MEMORY_WATCHER.store(false, Ordering::SeqCst);
    });
}

#[cfg(not(windows))]
fn spawn_memory_watcher(_app: tauri::AppHandle) {}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if MEMORY_ACTIVE.load(Ordering::SeqCst) {
        let settings = settings_snapshot(app);
        memory::on_shown(app, &settings);
    }
    let _ = app.emit("memory-restore", ());
}

fn hide_main(app: &tauri::AppHandle) {
    let settings = settings_snapshot(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if MEMORY_ACTIVE.load(Ordering::SeqCst) {
        memory::on_hidden(app, &settings);
    }
}

fn settings_snapshot(app: &tauri::AppHandle) -> Settings {
    app.try_state::<AppState>()
        .and_then(|state| state.settings.lock().ok().map(|settings| settings.clone()))
        .unwrap_or_default()
}

fn apply_memory_policy(app: &tauri::AppHandle, reason: &str) -> MemoryStatus {
    let settings = settings_snapshot(app);
    if !MEMORY_ACTIVE.load(Ordering::SeqCst) {
        return memory::status(&settings);
    }
    memory::apply_policy(app, &settings, reason)
}

fn module_base(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.try_state::<AppState>()
        .map(|state| state.paths.base.clone())
        .unwrap_or_default()
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyBindingStatus {
    app_id: String,
    accelerator: String,
    ok: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyStatus {
    toggle: String,
    toggle_ok: bool,
    bindings: Vec<HotkeyBindingStatus>,
    errors: Vec<String>,
}

/// 全局快捷键必须带 Ctrl / Alt / Win，或使用 F1–F24；
/// 拒绝 Shift+字母这类会拦截日常输入的组合。
fn shortcut_is_safe(accelerator: &str, shortcut: &Shortcut) -> bool {
    let strong = shortcut.mods.contains(Modifiers::CONTROL)
        || shortcut.mods.contains(Modifiers::ALT)
        || shortcut.mods.contains(Modifiers::SUPER);
    if strong {
        return true;
    }
    let key = accelerator.rsplit('+').next().unwrap_or("").trim();
    let upper = key.to_uppercase();
    upper.len() <= 3
        && upper.starts_with('F')
        && upper[1..].chars().all(|ch| ch.is_ascii_digit())
        && !upper[1..].is_empty()
}

/// 重新注册显示快捷键与所有应用快捷键。先全部注销，避免设置变更后残留旧组合。
fn apply_hotkeys(app: &tauri::AppHandle, settings: &Settings) -> HotkeyStatus {
    let mut report = HotkeyStatus {
        toggle: settings.hotkey_toggle.clone(),
        toggle_ok: false,
        bindings: Vec::new(),
        errors: Vec::new(),
    };
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();

    if !modules::is_installed(&module_base(app), "boot") {
        HOTKEY_OK.store(false, Ordering::SeqCst);
        if let Ok(mut slot) = HOTKEY_TOGGLE.lock() {
            *slot = None;
        }
        if let Ok(mut map) = HOTKEY_APPS.lock() {
            *map = None;
        }
        if let Ok(mut slot) = HOTKEY_REPORT.lock() {
            *slot = Some(report.clone());
        }
        return report;
    }

    let mut registered_toggle: Option<String> = None;
    match settings.hotkey_toggle.parse::<Shortcut>() {
        Ok(shortcut) if !shortcut_is_safe(&settings.hotkey_toggle, &shortcut) => {
            report.errors.push(format!(
                "显示/隐藏快捷键 {} 需要 Ctrl / Alt / Win，或使用 F1–F24",
                settings.hotkey_toggle
            ));
        }
        Ok(shortcut) => match shortcuts.register(shortcut) {
            Ok(()) => {
                report.toggle_ok = true;
                registered_toggle = Some(shortcut.to_string());
            }
            Err(_) => report.errors.push(format!(
                "显示/隐藏快捷键 {} 被其它程序占用",
                settings.hotkey_toggle
            )),
        },
        Err(_) => report.errors.push(format!(
            "无法识别显示/隐藏快捷键 {}",
            settings.hotkey_toggle
        )),
    }

    let app_ids: HashSet<String> = app
        .try_state::<AppState>()
        .and_then(|state| {
            state
                .apps
                .lock()
                .ok()
                .map(|apps| apps.keys().cloned().collect())
        })
        .unwrap_or_default();
    let mut bindings = settings
        .app_hotkeys
        .iter()
        .collect::<Vec<(&String, &String)>>();
    bindings.sort_by(|a, b| a.0.cmp(b.0));

    let mut registered: HashMap<String, String> = HashMap::new();
    for (app_id, accelerator) in bindings {
        if !app_ids.contains(app_id) {
            report.bindings.push(HotkeyBindingStatus {
                app_id: app_id.clone(),
                accelerator: accelerator.clone(),
                ok: false,
            });
            report.errors.push(format!(
                "{} 的快捷键 {accelerator} 未生效：应用已不在列表中",
                app_id
            ));
            continue;
        }
        let parsed = match accelerator.parse::<Shortcut>() {
            Ok(shortcut) => shortcut,
            Err(_) => {
                report.bindings.push(HotkeyBindingStatus {
                    app_id: app_id.clone(),
                    accelerator: accelerator.clone(),
                    ok: false,
                });
                report
                    .errors
                    .push(format!("无法识别应用快捷键 {accelerator}"));
                continue;
            }
        };
        if !shortcut_is_safe(accelerator, &parsed) {
            report.bindings.push(HotkeyBindingStatus {
                app_id: app_id.clone(),
                accelerator: accelerator.clone(),
                ok: false,
            });
            report.errors.push(format!(
                "应用快捷键 {accelerator} 需要 Ctrl / Alt / Win，或使用 F1–F24"
            ));
            continue;
        }
        let key = parsed.to_string();
        if registered.contains_key(&key) || registered_toggle.as_deref() == Some(key.as_str()) {
            report.bindings.push(HotkeyBindingStatus {
                app_id: app_id.clone(),
                accelerator: accelerator.clone(),
                ok: false,
            });
            report
                .errors
                .push(format!("快捷键 {accelerator} 与已有快捷键重复"));
            continue;
        }
        match shortcuts.register(parsed) {
            Ok(()) => {
                registered.insert(key, app_id.clone());
                report.bindings.push(HotkeyBindingStatus {
                    app_id: app_id.clone(),
                    accelerator: accelerator.clone(),
                    ok: true,
                });
            }
            Err(_) => {
                report.bindings.push(HotkeyBindingStatus {
                    app_id: app_id.clone(),
                    accelerator: accelerator.clone(),
                    ok: false,
                });
                report
                    .errors
                    .push(format!("应用快捷键 {accelerator} 被其它程序占用"));
            }
        }
    }

    HOTKEY_OK.store(report.toggle_ok, Ordering::SeqCst);
    if let Ok(mut slot) = HOTKEY_TOGGLE.lock() {
        *slot = registered_toggle;
    }
    if let Ok(mut map) = HOTKEY_APPS.lock() {
        *map = Some(registered);
    }
    if let Ok(mut slot) = HOTKEY_REPORT.lock() {
        *slot = Some(report.clone());
    }
    report
}

fn launch_by_id(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "应用索引不可用".to_string())?;
    let target = {
        let apps = state
            .apps
            .lock()
            .map_err(|_| "应用索引不可用".to_string())?;
        apps.get(id)
            .map(|item| item.target.clone())
            .ok_or_else(|| "应用不存在或索引已刷新".to_string())?
    };
    launch::launch(&target)
}

fn launch_and_notify(app: &tauri::AppHandle, id: &str, source: &str) {
    match launch_by_id(app, id) {
        Ok(()) => {
            let _ = app.emit(
                "app-launched",
                serde_json::json!({ "id": id, "source": source }),
            );
        }
        Err(error) => {
            let _ = app.emit("hotkey-error", error);
        }
    }
}

fn tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    use tauri::menu::IsMenuItem;

    let settings = settings_snapshot(app);
    let mut items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = Vec::new();
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-show",
        "显示启点",
        true,
        None::<&str>,
    )?));

    if settings.tray_quick_apps {
        let names: HashMap<String, String> = app
            .try_state::<AppState>()
            .and_then(|state| {
                state.apps.lock().ok().map(|apps| {
                    apps.iter()
                        .map(|(id, item)| (id.clone(), item.entry.name.clone()))
                        .collect()
                })
            })
            .unwrap_or_default();
        let mut ids = settings.pinned.clone();
        if ids.is_empty() {
            ids = settings.recent.iter().take(6).map(|item| item.id.clone()).collect();
        }
        ids.retain(|id| names.contains_key(id));
        ids.truncate(6);
        if !ids.is_empty() {
            items.push(Box::new(PredefinedMenuItem::separator(app)?));
            for id in ids {
                let name = names.get(&id).cloned().unwrap_or_default();
                let label = if name.chars().count() > 24 {
                    format!("启动 {}…", name.chars().take(24).collect::<String>())
                } else {
                    format!("启动 {name}")
                };
                items.push(Box::new(MenuItem::with_id(
                    app,
                    format!("tray-app:{id}"),
                    label,
                    true,
                    None::<&str>,
                )?));
            }
        }
    }

    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-hide",
        "隐藏窗口",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-quit",
        "退出启点",
        true,
        None::<&str>,
    )?));
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &refs)
}

fn refresh_tray_menu(app: &tauri::AppHandle) {
    let Some(tray) = app.tray_by_id("qidian-tray") else {
        return;
    };
    if let Ok(menu) = tray_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
    let settings = settings_snapshot(app);
    let _ = tray.set_tooltip(Some(format!("启点 · {}", settings.hotkey_toggle)));
}

/// 插件安装后的运行时启停。安装状态文件由 modules 写入，这里只负责真正生效的副作用。
fn module_install_hook(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    match id {
        "memory" => {
            MEMORY_ACTIVE.store(true, Ordering::SeqCst);
            memory::init(&module_base(app));
            apply_memory_policy(app, "插件安装");
            ensure_memory_monitor(app);
            spawn_memory_watcher(app.clone());
            Ok(())
        }
        "boot" => {
            if !TRAY_OK.load(Ordering::SeqCst) {
                TRAY_OK.store(setup_tray(app).is_ok(), Ordering::SeqCst);
            }
            apply_hotkeys(app, &settings_snapshot(app));
            refresh_tray_menu(app);
            autostart::repair_command();
            Ok(())
        }
        "background" | "performance" | "optimize" | "cleanup" => Ok(()),
        _ => Err("未知插件".to_string()),
    }
}

fn module_uninstall_hook(app: &tauri::AppHandle, id: &str) {
    match id {
        "memory" => {
            MEMORY_ACTIVE.store(false, Ordering::SeqCst);
            wake_memory_monitor();
            if let Some(window) = app.get_webview_window("main") {
                let _ = set_memory_level(&window, false);
                let _ = set_webview_suspended(&window, false);
            }
        }
        "boot" => {
            show_main(app);
            let _ = app.remove_tray_by_id("qidian-tray");
            TRAY_OK.store(false, Ordering::SeqCst);
            let _ = app.global_shortcut().unregister_all();
            HOTKEY_OK.store(false, Ordering::SeqCst);
            if let Ok(mut slot) = HOTKEY_TOGGLE.lock() {
                *slot = None;
            }
            if let Ok(mut map) = HOTKEY_APPS.lock() {
                *map = None;
            }
            if let Ok(mut slot) = HOTKEY_REPORT.lock() {
                *slot = None;
            }
            let _ = autostart::set_enabled(false);
        }
        _ => {}
    }
}

fn toggle_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            hide_main(app);
        } else {
            show_main(app);
        }
    }
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let settings = settings_snapshot(app);
    let menu = tray_menu(app)?;

    let mut builder = TrayIconBuilder::with_id("qidian-tray")
        .menu(&menu)
        .tooltip(format!("启点 · {}", settings.hotkey_toggle))
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if let Some(app_id) = id.strip_prefix("tray-app:") {
                launch_and_notify(app, app_id, "tray");
                return;
            }
            match id {
                "tray-show" => show_main(app),
                "tray-hide" => hide_main(app),
                "tray-quit" => {
                    QUITTING.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn sort_apps(apps: &mut [AppEntry]) {
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 提权子进程只执行注册表写入后退出，不初始化窗口与托盘。
    if let Some(code) = optimize::run_cli() {
        std::process::exit(code);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let key = shortcut.to_string();
                    let is_toggle = HOTKEY_TOGGLE
                        .lock()
                        .ok()
                        .and_then(|slot| slot.clone())
                        .as_deref()
                        == Some(key.as_str());
                    if is_toggle {
                        toggle_main(app);
                        return;
                    }
                    let app_id = HOTKEY_APPS
                        .lock()
                        .ok()
                        .and_then(|map| {
                            map.as_ref().and_then(|map| map.get(&key).cloned())
                        });
                    if let Some(id) = app_id {
                        launch_and_notify(app, &id, "hotkey");
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if QUITTING.load(Ordering::SeqCst) || !TRAY_OK.load(Ordering::SeqCst) {
                    return;
                }
                if settings_snapshot(window.app_handle()).close_to_tray {
                    api.prevent_close();
                    hide_main(window.app_handle());
                }
            }
        })
        .setup(|app| {
            let paths = store::Paths::resolve(app.handle()).map_err(std::io::Error::other)?;
            let settings = store::load_settings(&paths);
            if !paths.settings.exists() {
                let _ = store::save_settings(&paths, &settings);
            }
            // 先拿缓存立刻显示窗口，失效条目的校验交给异步 prune，避免启动时逐项检查文件。
            // 缓存结构升级后忽略旧缓存，让前端自动重扫一次，应用合并规则立即生效。
            let cache = store::load_cache(&paths).ok().flatten();
            let (apps, cache_at) = match cache {
                Some(cache) if cache.schema == scanner::CACHE_SCHEMA => {
                    let mut map = HashMap::new();
                    for item in cache.apps {
                        map.insert(item.entry.id.clone(), item);
                    }
                    (map, Some(cache.scanned_at))
                }
                _ => (HashMap::new(), None),
            };

            let base = paths.base.clone();
            app.manage(AppState {
                paths,
                settings: Mutex::new(settings),
                apps: Mutex::new(apps),
                cache_at: Mutex::new(cache_at),
            });
            memory::init(&base);

            // 除“启动应用”外的能力都以插件形式存在，只有安装后才初始化对应的常驻逻辑。
            if modules::is_installed(&base, "boot") {
                TRAY_OK.store(setup_tray(app.handle()).is_ok(), Ordering::SeqCst);
                apply_hotkeys(app.handle(), &settings_snapshot(app.handle()));
                autostart::repair_command();
            } else if autostart::is_enabled() {
                // 旧版本写入的自启动项在插件未安装时不再保留，避免无声启动。
                let _ = autostart::set_enabled(false);
            }
            if modules::is_installed(&base, "memory") {
                MEMORY_ACTIVE.store(true, Ordering::SeqCst);
                apply_memory_policy(app.handle(), "启动检查");
                ensure_memory_monitor(app.handle());
                spawn_memory_watcher(app.handle().clone());
            }

            if std::env::args().any(|arg| arg == "--autostart")
                && TRAY_OK.load(Ordering::SeqCst)
            {
                if let Some(window) = app.get_webview_window("main") {
                    let memory_active = MEMORY_ACTIVE.load(Ordering::SeqCst);
                    if memory_active {
                        let _ = set_memory_level(&window, true);
                    }
                    let _ = window.hide();
                    if memory_active {
                        let _ = set_webview_suspended(&window, true);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            prune_missing_apps,
            scan_apps,
            load_icons,
            warm_icons,
            launch_app,
            reveal_app,
            save_settings,
            reset_settings,
            clear_cache,
            open_data_dir,
            save_wallpaper,
            read_wallpaper,
            delete_wallpaper,
            list_startup,
            set_startup_enabled,
            list_processes,
            terminate_processes,
            list_modules,
            install_module,
            uninstall_module,
            cleanup_scan,
            cleanup_delete,
            cleanup_open,
            cleanup_apps,
            cleanup_uninstall,
            performance_module_status,
            performance_module_install,
            performance_module_uninstall,
            performance_system_info,
            performance_scan_temp,
            performance_clean_temp,
            performance_disk_usage,
            performance_set_power,
            performance_flush_dns,
            optimize_list,
            optimize_apply,
            optimize_restore,
            optimize_power_status,
            optimize_dns_status,
            optimize_dns_set,
            optimize_dns_restore,
            optimize_network_diag,
            elevated_status,
            autostart_status,
            set_autostart,
            hotkey_status,
            started_hidden,
            tray_status,
            memory_status,
            memory_apply,
            memory_trim,
            memory_purge_system,
            quit_app,
            set_memory_saver
        ])
        .run(tauri::generate_context!())
        .expect("error while running QiDian");
}

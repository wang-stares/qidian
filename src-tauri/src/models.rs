use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppSource {
    StartMenu,
    Desktop,
    AppPaths,
    Registry,
    Uwp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    pub category: String,
    pub publisher: Option<String>,
    pub version: Option<String>,
    pub source: AppSource,
    pub install_location: Option<String>,
    pub shortcut_path: Option<String>,
    pub launchable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LaunchTarget {
    Executable {
        path: String,
        args: Option<String>,
        workdir: Option<String>,
    },
    Shortcut {
        path: String,
    },
    Uwp {
        aumid: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedApp {
    pub entry: AppEntry,
    pub target: LaunchTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCache {
    /// 缓存结构版本；升级扫描逻辑后递增，让旧缓存自动重建一次。
    #[serde(default)]
    pub schema: u32,
    pub scanned_at: u64,
    pub apps: Vec<ScannedApp>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    pub found: usize,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub apps: Vec<AppEntry>,
    pub scanned_at: u64,
    pub cached: bool,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: Settings,
    pub apps: Vec<AppEntry>,
    pub scanned_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub id: String,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub id: String,
    pub name: String,
    pub command: String,
    pub source: String,
    pub scope: String,
    pub enabled: bool,
    pub editable: bool,
    /// 对开机速度的影响程度：high / medium / low。
    pub impact: String,
    /// 建议：keep（建议保留）/ disable（建议关闭）/ optional（可选）。
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupScan {
    pub items: Vec<StartupItem>,
    /// 计划任务与自动服务是否读取成功；失败时前端会提示只显示注册表与启动文件夹。
    pub advanced_ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessItem {
    pub pid: u32,
    pub name: String,
    pub path: Option<String>,
    pub memory_bytes: u64,
    pub company: Option<String>,
    pub description: Option<String>,
    pub protected: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTarget {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminateFailure {
    pub pid: u32,
    pub name: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminateReport {
    pub terminated: u32,
    pub failed: Vec<TerminateFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub theme: String,
    pub theme_preset: String,
    pub color_mode: String,
    pub accent: String,
    pub density: String,
    pub low_power: bool,
    pub scan_uwp: bool,
    pub include_system_apps: bool,
    pub auto_refresh_hours: u32,
    pub memory_mode: String,
    pub memory_level: String,
    pub memory_low_percent: u32,
    pub memory_recover_percent: u32,
    pub memory_smart_thresholds: bool,
    pub memory_interval_sec: u32,
    pub memory_adaptive_interval: bool,
    pub memory_trim_working_set: bool,
    pub memory_trim_scope: String,
    pub memory_idle_trim: bool,
    pub memory_drop_icons: bool,
    pub memory_pause_fullscreen: bool,
    pub memory_power_aware: bool,
    pub hotkey_toggle: String,
    pub app_hotkeys: HashMap<String, String>,
    pub close_to_tray: bool,
    pub tray_quick_apps: bool,
    pub cleanup_recycle_bin: bool,
    pub categories: Vec<Category>,
    pub overrides: HashMap<String, String>,
    pub pinned: Vec<String>,
    pub recent: Vec<RecentEntry>,
    /// 每个应用的启动次数，用于启动台「常用优先」排序。
    #[serde(default)]
    pub usage: HashMap<String, u32>,
    pub hidden: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            theme: "win11".to_string(),
            theme_preset: "default".to_string(),
            color_mode: "system".to_string(),
            accent: "blue".to_string(),
            density: "cozy".to_string(),
            low_power: false,
            scan_uwp: true,
            include_system_apps: false,
            auto_refresh_hours: 12,
            memory_mode: "auto".to_string(),
            memory_level: "normal".to_string(),
            memory_low_percent: 85,
            memory_recover_percent: 60,
            memory_smart_thresholds: true,
            memory_interval_sec: 60,
            memory_adaptive_interval: true,
            memory_trim_working_set: true,
            memory_trim_scope: "self".to_string(),
            memory_idle_trim: true,
            memory_drop_icons: true,
            memory_pause_fullscreen: true,
            memory_power_aware: true,
            hotkey_toggle: "Ctrl+Alt+Q".to_string(),
            app_hotkeys: HashMap::new(),
            close_to_tray: true,
            tray_quick_apps: true,
            cleanup_recycle_bin: true,
            categories: default_categories(),
            overrides: HashMap::new(),
            pinned: Vec::new(),
            recent: Vec::new(),
            usage: HashMap::new(),
            hidden: Vec::new(),
        }
    }
}

pub fn default_categories() -> Vec<Category> {
    vec![
        category("dev", "开发工具"),
        category("office", "办公协作"),
        category("design", "设计创作"),
        category("media", "影音娱乐"),
        category("game", "游戏"),
        category("social", "社交通讯"),
        category("network", "网络浏览"),
        category("security", "安全工具"),
        category("system", "系统工具"),
        category("other", "其他"),
    ]
}

fn category(id: &str, name: &str) -> Category {
    Category {
        id: id.to_string(),
        name: name.to_string(),
        builtin: true,
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ScanOptions {
    pub scan_uwp: bool,
    pub include_system_apps: bool,
}

use crate::models::{StartupItem, StartupScan};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const APPROVAL_RUN: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const APPROVAL_RUN32: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32";
const APPROVAL_FOLDER: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder";
const PROBE_CACHE_TTL: Duration = Duration::from_secs(20);

/// 计划任务与自动服务通过 PowerShell 读取，结果短时间缓存，避免每次刷新和切换开关都重新跑一遍。
static PROBE_CACHE: Mutex<Option<(Instant, AdvancedProbe)>> = Mutex::new(None);

/// 应用启动项（注册表 Run + 启动文件夹）每次体检刷新都会全量扫描，
/// 15 秒内复用；后台管理页自身的扫描不走此缓存。
const APP_STARTUP_CACHE_TTL: Duration = Duration::from_secs(15);
static APP_STARTUP_CACHE: Mutex<Option<(Instant, Vec<StartupItem>)>> = Mutex::new(None);

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdvancedProbe {
    #[serde(default)]
    tasks: Vec<ProbeTask>,
    #[serde(default)]
    services: Vec<ProbeService>,
    #[serde(default = "default_true")]
    tasks_ok: bool,
    #[serde(default = "default_true")]
    services_ok: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct ProbeTask {
    #[serde(default)]
    name: String,
    #[serde(default)]
    path: String,
    #[serde(default = "default_true")]
    enabled: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct ProbeService {
    #[serde(default)]
    name: String,
    #[serde(default)]
    command: String,
}

fn default_true() -> bool {
    true
}

/// 手动刷新时绕过 20 秒探针缓存，立即重读计划任务与自动服务。
pub fn invalidate_probe_cache() {
    if let Ok(mut cache) = PROBE_CACHE.lock() {
        *cache = None;
    }
}

pub fn list_startup() -> StartupScan {
    #[cfg(windows)]
    {
        let (entries, advanced_ok) = collect(true);
        StartupScan {
            items: entries.into_iter().map(|entry| entry.item).collect(),
            advanced_ok,
        }
    }
    #[cfg(not(windows))]
    {
        StartupScan {
            items: Vec::new(),
            advanced_ok: false,
        }
    }
}

/// 只读注册表与启动文件夹，供性能评分使用，避免为了计数去启动 PowerShell。
pub fn list_app_startup() -> Vec<StartupItem> {
    #[cfg(windows)]
    {
        if let Ok(mut cache) = APP_STARTUP_CACHE.lock() {
            if let Some((at, items)) = cache.as_ref() {
                if at.elapsed() < APP_STARTUP_CACHE_TTL {
                    return items.clone();
                }
            }
            let items: Vec<StartupItem> = collect(false)
                .0
                .into_iter()
                .map(|entry| entry.item)
                .collect();
            *cache = Some((Instant::now(), items.clone()));
            return items;
        }
        collect(false)
            .0
            .into_iter()
            .map(|entry| entry.item)
            .collect()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

fn invalidate_app_startup_cache() {
    if let Ok(mut cache) = APP_STARTUP_CACHE.lock() {
        *cache = None;
    }
}

pub fn set_startup_enabled(id: &str, enabled: bool) -> Result<StartupScan, String> {
    #[cfg(windows)]
    {
        let result = set_enabled_windows(id, enabled);
        if result.is_ok() {
            invalidate_app_startup_cache();
        }
        result
    }
    #[cfg(not(windows))]
    {
        let _ = (id, enabled);
        Err("启点目前只支持 Windows".to_string())
    }
}

#[cfg(windows)]
struct StartupInternal {
    item: StartupItem,
    key_name: String,
    approval: &'static str,
}

/// 常见良性自启动项关键词：保留（输入法、安全软件、驱动、同步盘、硬件管理等）。
const KEEP_KEYWORDS: &[&str] = &[
    "sogou", "搜狗", "pinyin", "输入法", "ime", "firewall", "防火墙", "杀毒",
    "huorong", "火绒", "defender", "安全", "security", "驱动", "driver",
    "onedrive", "dns", "显卡", "nvidia", "amd", "intel", "realtek", "声卡",
    "razer", "logitech", "罗技", "synapse", "engine", "电源", "battery",
    "zhumu", "zoom", "wechat", "微信", "qq", "alipay", "支付宝", "hotkey",
    "launchpad", "显卡", "nahimic", "sound", "audio", "bluetooth", "蓝牙",
    "wifi", "wireless", "网络", "ethernet",
];

/// 常见可关闭的自启动关键词：建议关闭（更新器、浏览器、游戏平台、云盘、远控等）。
const DISABLE_KEYWORDS: &[&str] = &[
    "update", "更新", "updater", "auto", "自动", "install", "installer",
    "web", "browser", "chrome", "edge", "firefox", "spotify", "discord", "steam",
    "epic", "origin", "game", "游戏", "helper", "assistant", "助手",
    "cloud", "云", "sync", "backup", "备份", "baidu", "百度", "tencent", "腾讯",
    "netease", "网易", "jinshan", "金山", "wps", "office", "mi", "xiaomi",
    "leidian", "雷电", "mumu", "todesk", "向日葵", "sunlogin",
    "teamviewer", "anydesk", "remote", "远程", "gadget", "widget", "news",
    "推送", "promo", "adobe", "java", "oracle", "search", "搜索",
];

/// 按名称与来源给出影响度（impact）与建议（recommendation）。
fn startup_assessment(name: &str, source: &str) -> (String, String) {
    let lower = name.to_lowercase();
    let impact = match source {
        "service" => "high",
        "scheduledTask" => "medium",
        "registry" => "medium",
        _ => "low",
    };
    let recommendation = if DISABLE_KEYWORDS
        .iter()
        .any(|keyword| lower.contains(keyword))
    {
        "disable"
    } else if KEEP_KEYWORDS
        .iter()
        .any(|keyword| lower.contains(keyword))
    {
        "keep"
    } else {
        "optional"
    };
    (impact.to_string(), recommendation.to_string())
}

#[cfg(windows)]
fn collect(include_advanced: bool) -> (Vec<StartupInternal>, bool) {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};

    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // Run / RunOnce / 组策略 Run，覆盖当前用户与所有用户、64 位与 32 位视图。
    let run_keys: [(&str, &str, u32, &str, &str); 10] = [
        (
            "user",
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_READ | KEY_WOW64_64KEY,
            "Run",
            "registry",
        ),
        (
            "user",
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_READ | KEY_WOW64_32KEY,
            "Run32",
            "registry",
        ),
        (
            "machine",
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_READ | KEY_WOW64_64KEY,
            "Run",
            "registry",
        ),
        (
            "machine",
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_READ | KEY_WOW64_32KEY,
            "Run32",
            "registry",
        ),
        (
            "user",
            r"Software\Microsoft\Windows\CurrentVersion\RunOnce",
            KEY_READ | KEY_WOW64_64KEY,
            "RunOnce",
            "runOnce",
        ),
        (
            "user",
            r"Software\Microsoft\Windows\CurrentVersion\RunOnce",
            KEY_READ | KEY_WOW64_32KEY,
            "RunOnce32",
            "runOnce",
        ),
        (
            "machine",
            r"Software\Microsoft\Windows\CurrentVersion\RunOnce",
            KEY_READ | KEY_WOW64_64KEY,
            "RunOnce",
            "runOnce",
        ),
        (
            "machine",
            r"Software\Microsoft\Windows\CurrentVersion\RunOnce",
            KEY_READ | KEY_WOW64_32KEY,
            "RunOnce32",
            "runOnce",
        ),
        (
            "user",
            r"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run",
            KEY_READ,
            "PolicyRun",
            "policy",
        ),
        (
            "machine",
            r"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run",
            KEY_READ | KEY_WOW64_64KEY,
            "PolicyRun",
            "policy",
        ),
    ];

    for (scope, path, flags, approval, source) in run_keys {
        let root = if scope == "user" {
            HKEY_CURRENT_USER
        } else {
            HKEY_LOCAL_MACHINE
        };
        let key = match winreg::RegKey::predef(root).open_subkey_with_flags(path, flags) {
            Ok(key) => key,
            Err(_) => continue,
        };
        let names = match key.enum_values().collect::<Result<Vec<_>, _>>() {
            Ok(values) => values,
            Err(_) => continue,
        };
        for (name, _) in names {
            let command = match key.get_value::<String, _>(&name) {
                Ok(value) if !value.trim().is_empty() => value,
                _ => continue,
            };
            let dedupe = format!("{scope}|{approval}|{name}");
            if !seen.insert(dedupe) {
                continue;
            }
            // 只有当前用户的常规 Run 项可以在启点内切换；RunOnce / 组策略项只读展示。
            let editable = source == "registry" && scope == "user" && approval.starts_with("Run");
            let enabled = if editable {
                approval_state(scope, approval, &name)
            } else {
                true
            };
            entries.push(StartupInternal {
                item: StartupItem {
                    id: stable_id(approval, scope, &name),
                    name: name.clone(),
                    command,
                    source: source.to_string(),
                    scope: scope.to_string(),
                    enabled,
                    editable,
                    impact: startup_assessment(&name, source).0,
                    recommendation: startup_assessment(&name, source).1,
                },
                key_name: name.clone(),
                approval,
            });
        }
    }

    for (scope, path) in startup_folders() {
        let dir = match std::fs::read_dir(&path) {
            Ok(dir) => dir,
            Err(_) => continue,
        };
        for entry in dir.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_lowercase();
            if !matches!(
                extension.as_str(),
                "lnk" | "url" | "exe" | "bat" | "cmd" | "ps1" | "vbs"
            ) {
                continue;
            }
            let file_name = match path.file_name().and_then(|value| value.to_str()) {
                Some(name) if !name.eq_ignore_ascii_case("desktop.ini") => name.to_string(),
                _ => continue,
            };
            let display = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(&file_name)
                .to_string();
            let dedupe = format!("{scope}|folder|{file_name}");
            if !seen.insert(dedupe) {
                continue;
            }
            let enabled = approval_state(scope, "StartupFolder", &file_name);
            entries.push(StartupInternal {
                item: StartupItem {
                    id: stable_id("StartupFolder", scope, &file_name),
                    name: display.clone(),
                    command: path.to_string_lossy().to_string(),
                    source: "startupFolder".to_string(),
                    scope: scope.to_string(),
                    enabled,
                    editable: scope == "user",
                    impact: startup_assessment(&display, "startupFolder").0,
                    recommendation: startup_assessment(&display, "startupFolder").1,
                },
                key_name: file_name.clone(),
                approval: "StartupFolder",
            });
        }
    }

    let mut advanced_ok = true;
    if include_advanced {
        match probe_advanced() {
            Some(probe) => {
                advanced_ok = probe.tasks_ok && probe.services_ok;
                for task in probe.tasks {
                    let name = task.name.trim();
                    if name.is_empty() {
                        continue;
                    }
                    let path = task.path.trim();
                    let label = format!("{path}{name}");
                    entries.push(StartupInternal {
                        item: StartupItem {
                            id: stable_id("scheduledTask", "machine", &label),
                            name: name.to_string(),
                            command: format!("计划任务：{label}"),
                            source: "scheduledTask".to_string(),
                            scope: "machine".to_string(),
                            enabled: task.enabled,
                            editable: false,
                            impact: startup_assessment(&name, "scheduledTask").0,
                            recommendation: startup_assessment(&name, "scheduledTask").1,
                        },
                        key_name: String::new(),
                        approval: "ScheduledTask",
                    });
                }
                for service in probe.services {
                    let name = service.name.trim();
                    if name.is_empty() || service.command.trim().is_empty() {
                        continue;
                    }
                    entries.push(StartupInternal {
                        item: StartupItem {
                            id: stable_id("service", "machine", name),
                            name: name.to_string(),
                            command: service.command.trim().to_string(),
                            source: "service".to_string(),
                            scope: "machine".to_string(),
                            enabled: true,
                            editable: false,
                            impact: startup_assessment(name, "service").0,
                            recommendation: startup_assessment(name, "service").1,
                        },
                        key_name: String::new(),
                        approval: "Service",
                    });
                }
            }
            None => advanced_ok = false,
        }
    }

    entries.sort_by(|a, b| {
        a.item
            .editable
            .cmp(&b.item.editable)
            .reverse()
            .then(a.item.enabled.cmp(&b.item.enabled).reverse())
            .then(a.item.scope.cmp(&b.item.scope))
            .then(a.item.name.to_lowercase().cmp(&b.item.name.to_lowercase()))
    });
    (entries, advanced_ok)
}

#[cfg(windows)]
fn probe_advanced() -> Option<AdvancedProbe> {
    if let Ok(cache) = PROBE_CACHE.lock() {
        if let Some((at, probe)) = cache.as_ref() {
            if at.elapsed() < PROBE_CACHE_TTL {
                return Some(probe.clone());
            }
        }
    }

    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
        $ProgressPreference='SilentlyContinue'; \
        $tasksOk=$true; $servicesOk=$true; \
        $tasks=@(); \
        try { $tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { \
            $_.TaskPath -notlike '\\Microsoft\\Windows\\*' -and \
            ($_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'LogonTrigger|BootTrigger' }) \
        } | ForEach-Object { [pscustomobject]@{ name=$_.TaskName; path=$_.TaskPath; \
            enabled=($_.State -ne 'Disabled') } }) } catch { $tasksOk=$false }; \
        $services=@(); \
        try { $services = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue \
            -Filter \"StartMode='Auto'\" | Where-Object { $_.PathName -and \
            $_.PathName -notmatch '(?i)\\\\(Windows\\\\)?(System32|SysWOW64)\\\\' } | \
            ForEach-Object { [pscustomobject]@{ name=$_.DisplayName; command=$_.PathName } }) \
        } catch { $servicesOk=$false }; \
        [pscustomobject]@{ tasks=$tasks; services=$services; tasksOk=$tasksOk; \
            servicesOk=$servicesOk } | ConvertTo-Json -Depth 4 -Compress";

    let stdout = crate::powershell::run_encoded(script)?;
    let probe: AdvancedProbe = serde_json::from_slice(&stdout).ok()?;
    if let Ok(mut cache) = PROBE_CACHE.lock() {
        *cache = Some((Instant::now(), probe.clone()));
    }
    Some(probe)
}

#[cfg(windows)]
fn startup_folders() -> Vec<(&'static str, std::path::PathBuf)> {
    let mut folders = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        folders.push((
            "user",
            std::path::PathBuf::from(appdata)
                .join(r"Microsoft\Windows\Start Menu\Programs\Startup"),
        ));
    }
    if let Ok(program_data) = std::env::var("ProgramData") {
        folders.push((
            "machine",
            std::path::PathBuf::from(program_data)
                .join(r"Microsoft\Windows\Start Menu\Programs\Startup"),
        ));
    }
    folders
        .into_iter()
        .filter(|(_, path)| path.is_dir())
        .collect()
}

#[cfg(windows)]
fn approval_state(scope: &str, approval: &str, key_name: &str) -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};

    let subkey = approval_subkey(approval);
    let (root, flags) = if scope == "user" {
        (HKEY_CURRENT_USER, KEY_READ)
    } else {
        (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_64KEY)
    };
    let key = match winreg::RegKey::predef(root).open_subkey_with_flags(subkey, flags) {
        Ok(key) => key,
        Err(_) => return true,
    };
    match key.get_raw_value(key_name) {
        Ok(value) => value
            .bytes
            .first()
            .map(|first| first & 1 == 0)
            .unwrap_or(true),
        Err(_) => true,
    }
}

#[cfg(windows)]
fn approval_subkey(approval: &str) -> &'static str {
    match approval {
        "Run" => APPROVAL_RUN,
        "Run32" => APPROVAL_RUN32,
        _ => APPROVAL_FOLDER,
    }
}

#[cfg(windows)]
fn set_enabled_windows(id: &str, enabled: bool) -> Result<StartupScan, String> {
    use winreg::enums::{HKEY_CURRENT_USER, REG_BINARY};
    use winreg::{RegKey, RegValue};

    let (entries, _) = collect(false);
    let entry = entries
        .into_iter()
        .find(|entry| entry.item.id == id)
        .ok_or_else(|| "启动项已不存在，请刷新后重试".to_string())?;
    if !entry.item.editable {
        return Err("这是系统级启动项，需要管理员权限；请使用任务管理器修改".to_string());
    }

    let subkey = approval_subkey(entry.approval);
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(subkey)
        .map_err(|error| format!("无法写入启动项状态：{error}"))?;
    if enabled {
        let _ = key.delete_value(&entry.key_name);
    } else {
        let bytes = vec![3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        key.set_raw_value(
            &entry.key_name,
            &RegValue {
                bytes,
                vtype: REG_BINARY,
            },
        )
        .map_err(|error| format!("无法禁用启动项：{error}"))?;
    }

    let (entries, advanced_ok) = collect(true);
    Ok(StartupScan {
        items: entries.into_iter().map(|entry| entry.item).collect(),
        advanced_ok,
    })
}

fn stable_id(source: &str, scope: &str, key: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in source
        .bytes()
        .chain(std::iter::once(b'|'))
        .chain(scope.bytes())
        .chain(std::iter::once(b'|'))
        .chain(key.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("startup-{hash:016x}")
}

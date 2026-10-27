use crate::store::now_millis;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
#[cfg(windows)]
use std::sync::Mutex;
#[cfg(windows)]
use std::time::Instant;

const MODULE_ID: &str = "performance";
const MODULE_VERSION: &str = "1.2.0";
const ALL_CATEGORIES: [&str; 27] = [
    "userTemp",
    "windowsTemp",
    "updateCache",
    "logs",
    "prefetch",
    "d3dCache",
    "dxCache",
    "glCache",
    "inetCache",
    "transferCache",
    "wer",
    "werSystem",
    "crashDumps",
    "minidump",
    "liveKernel",
    "eventLogs",
    "thumbnailCache",
    "systemTemp32",
    "chromeCache",
    "edgeCache",
    "braveCache",
    "firefoxCache",
    "teamsCache",
    "discordCache",
    "slackCache",
    "windowsOld",
    "recycleBin",
];
const HARDWARE_CACHE_TTL: u64 = 7 * 86_400_000;
const POWER_SAVER: &str = "a1841308-3541-4fab-bc81-f71556f20b4a";
const POWER_BALANCED: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
const POWER_HIGH: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
/// 卓越性能（Ultimate Performance）模板 GUID：系统隐藏方案，需先复制启用。
/// 参考 Winhance 的 Power Management：一键启用隐藏的卓越性能计划。
const POWER_ULTIMATE: &str = "e9a42b02-d5df-448d-aa00-03f14749eb61";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfModuleStatus {
    pub installed: bool,
    pub installed_version: Option<String>,
    pub available_version: String,
    pub installed_at: Option<u64>,
    pub size_bytes: u64,
    pub path: Option<String>,
    pub update_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub drive: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
    pub system: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub name: String,
    pub logical: u32,
    pub usage_percent: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDiskInfo {
    pub name: String,
    pub media_type: String,
    pub health: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScorePoint {
    pub at: u64,
    pub score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanRecord {
    pub at: u64,
    pub freed_bytes: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerInfo {
    pub guid: String,
    pub name: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsInfo {
    pub caption: String,
    pub version: String,
    pub build: String,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfIssue {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub severity: String,
    /// 这一项扣掉的分数；0 表示只是提示、不影响得分。
    pub points: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PerfStats {
    #[serde(default)]
    freed_bytes: u64,
    #[serde(default)]
    clean_count: u64,
    #[serde(default)]
    last_clean_at: Option<u64>,
    #[serde(default)]
    history: Vec<ScorePoint>,
    #[serde(default)]
    recent_cleans: Vec<CleanRecord>,
    #[serde(default)]
    hardware_at: u64,
    #[serde(default)]
    physical_disks: Vec<PhysicalDiskInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfSystemInfo {
    pub memory: MemoryInfo,
    pub cpu: CpuInfo,
    pub disk: DiskInfo,
    pub disks: Vec<DiskInfo>,
    pub physical_disks: Vec<PhysicalDiskInfo>,
    pub hogs: Vec<crate::processes::ResourceHog>,
    pub power: PowerInfo,
    pub os: OsInfo,
    pub startup_total: u32,
    pub startup_enabled: u32,
    pub score: u32,
    pub score_label: String,
    pub issues: Vec<PerfIssue>,
    pub history: Vec<ScorePoint>,
    pub cleanup_total_bytes: u64,
    pub cleanup_count: u64,
    pub last_clean_at: Option<u64>,
    pub recent_cleans: Vec<CleanRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempCategory {
    pub id: String,
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub files: u64,
    pub accessible: bool,
    pub errors: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempScan {
    pub categories: Vec<TempCategory>,
    pub total_bytes: u64,
    pub total_files: u64,
    pub days: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanCategory {
    pub id: String,
    pub name: String,
    pub freed_bytes: u64,
    pub files: u64,
    pub failed: u64,
    /// 已安排下次重启后删除的对象数。
    pub pending_reboot: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub freed_bytes: u64,
    pub files: u64,
    pub failed: u64,
    pub pending_reboot: u64,
    pub categories: Vec<CleanCategory>,
}

/* ── disk usage analysis ─────────────────────────────────────── */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageEntry {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageScan {
    pub drive: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub entries: Vec<DiskUsageEntry>,
}

const DISK_USAGE_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
static DISK_USAGE_CACHE: Mutex<Option<(Instant, DiskUsageScan)>> = Mutex::new(None);

/// 递归统计单个目录占用，跳过重解析点（junction/symlink）避免死循环。
fn dir_usage(path: &Path, depth: u32) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return (0, 0),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_dir() {
            if !is_reparse_point(&metadata) {
                let (sub_bytes, sub_files) = dir_usage(&path, depth + 1);
                bytes += sub_bytes;
                files += sub_files;
            }
        } else if metadata.file_type().is_file() {
            bytes += metadata.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// 扫描系统盘根目录第一层，找出占用最大的目录（“空间去哪了”）。
pub fn disk_usage(base: &Path, drive: Option<String>) -> Result<DiskUsageScan, String> {
    require_opt_installed(base)?;
    #[cfg(windows)]
    {
        if let Ok(cache) = DISK_USAGE_CACHE.lock() {
            if let Some((at, scan)) = cache.as_ref() {
                if at.elapsed() < DISK_USAGE_CACHE_TTL {
                    return Ok(scan.clone());
                }
            }
        }
        // 默认系统盘；也可以传入其它盘符。
        let root = match drive {
            Some(text) => {
                let text = text.trim();
                if text.is_empty() {
                    return Err("请指定磁盘盘符".to_string());
                }
                let mut p = text.to_string();
                if !p.ends_with('\\') {
                    p.push('\\');
                }
                p
            }
            None => {
                // 从 Windows 目录环境变量推断系统盘符。
                let windir = std::env::var_os("WINDIR")
                    .or_else(|| std::env::var_os("SystemRoot"))
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| "C:\\Windows".to_string());
                let root = windir.split('\\').next().unwrap_or("C");
                format!("{root}\\")
            }
        };
        let root_path = PathBuf::from(&root);
        let mut entries = Vec::new();
        if let Ok(read) = fs::read_dir(&root_path) {
            for entry in read.flatten() {
                let path = entry.path();
                let metadata = match fs::symlink_metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(_) => continue,
                };
                if !metadata.file_type().is_dir() || is_reparse_point(&metadata) {
                    continue;
                }
                // 跳过指向系统目录内部会拖慢扫描的大头：Windows 目录单独按一层统计。
                let (bytes, files) = dir_usage(&path, 0);
                entries.push(DiskUsageEntry {
                    path: path.to_string_lossy().to_string(),
                    name: path
                        .file_name()
                        .map(|name| name.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    bytes,
                    files,
                });
            }
        }
        entries.sort_by(|a, b| b.bytes.cmp(&a.bytes));
        // 用 Windows API 读磁盘容量
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut free_avail = 0u64;
        let mut total_size = 0u64;
        let mut total_free = 0u64;
        let wide: Vec<u16> = root.encode_utf16().collect();
        unsafe {
            GetDiskFreeSpaceExW(
                windows::core::PCWSTR(wide.as_ptr()),
                Some(&mut free_avail),
                Some(&mut total_size),
                Some(&mut total_free),
            )
        }
        .ok();
        let total_bytes = total_size;
        let free_bytes = free_avail;
        let scan = DiskUsageScan {
            drive: root.trim_end_matches('\\').to_string(),
            total_bytes,
            used_bytes: total_bytes.saturating_sub(free_bytes),
            entries,
        };
        if let Ok(mut cache) = DISK_USAGE_CACHE.lock() {
            *cache = Some((Instant::now(), scan.clone()));
        }
        Ok(scan)
    }
    #[cfg(not(windows))]
    {
        let _ = (base, drive);
        Err("磁盘空间分析目前只支持 Windows".to_string())
    }
}

pub fn module_dir(base: &Path) -> PathBuf {
    base.join("modules").join(MODULE_ID)
}

pub fn status(base: &Path) -> PerfModuleStatus {
    let module = crate::modules::get(base, MODULE_ID);
    let installed = module.as_ref().map(|module| module.installed).unwrap_or(false);
    PerfModuleStatus {
        installed,
        installed_version: module
            .as_ref()
            .filter(|module| module.installed)
            .map(|module| module.version.clone()),
        available_version: module
            .as_ref()
            .map(|module| module.version.clone())
            .unwrap_or_else(|| MODULE_VERSION.to_string()),
        installed_at: module.as_ref().and_then(|module| module.installed_at),
        size_bytes: module.as_ref().map(|module| module.size_bytes).unwrap_or(0),
        path: installed.then(|| module_dir(base).to_string_lossy().to_string()),
        update_available: false,
    }
}

pub fn install(app: &tauri::AppHandle, base: &Path) -> Result<PerfModuleStatus, String> {
    crate::modules::install(app, base, MODULE_ID)?;
    Ok(status(base))
}

pub fn uninstall(app: &tauri::AppHandle, base: &Path) -> Result<PerfModuleStatus, String> {
    crate::modules::uninstall(app, base, MODULE_ID)?;
    Ok(status(base))
}

fn require_module(base: &Path, id: &str, hint: &str) -> Result<(), String> {
    if crate::modules::is_installed(base, id) {
        Ok(())
    } else {
        Err(format!("{hint}尚未安装"))
    }
}

/// 体检类命令（系统信息/评分）依赖「系统体检」插件。
fn require_installed(base: &Path) -> Result<(), String> {
    require_module(base, MODULE_ID, "系统体检模块")
}

/// 优化类命令（临时文件清理/电源/DNS）依赖「系统优化」插件。
fn require_opt_installed(base: &Path) -> Result<(), String> {
    require_module(base, "optimize", "系统优化模块")
}

/* ── system snapshot ──────────────────────────────────────────── */

pub fn system_info(base: &Path) -> Result<PerfSystemInfo, String> {
    require_installed(base)?;

    #[cfg(windows)]
    {
        system_info_windows(base)
    }
    #[cfg(not(windows))]
    {
        let _ = base;
        Err("系统体检目前只支持 Windows".to_string())
    }
}

fn stats_file(base: &Path) -> PathBuf {
    base.join("perf-stats.json")
}

fn load_stats(base: &Path) -> PerfStats {
    fs::read_to_string(stats_file(base))
        .ok()
        .and_then(|text| serde_json::from_str::<PerfStats>(&text).ok())
        .unwrap_or_default()
}

fn save_stats(base: &Path, stats: &PerfStats) {
    if let Ok(data) = serde_json::to_vec_pretty(stats) {
        let _ = fs::write(stats_file(base), data);
    }
}

fn record_clean(base: &Path, freed: u64, files: u64) {
    if freed == 0 && files == 0 {
        return;
    }
    let mut stats = load_stats(base);
    stats.freed_bytes = stats.freed_bytes.saturating_add(freed);
    stats.clean_count = stats.clean_count.saturating_add(1);
    let now = now_millis();
    stats.last_clean_at = Some(now);
    stats.recent_cleans.insert(
        0,
        CleanRecord {
            at: now,
            freed_bytes: freed,
            files,
        },
    );
    stats.recent_cleans.truncate(10);
    save_stats(base, &stats);
}

/// 每天保留一个评分点，最多 30 天；只有新增或分数变化时才需要写盘。
fn update_history(stats: &mut PerfStats, score: u32) -> bool {
    let now = now_millis();
    let day = now / 86_400_000;
    let mut dirty = false;
    match stats.history.last_mut() {
        Some(last) if last.at / 86_400_000 == day => {
            if last.score != score {
                last.score = score;
                last.at = now;
                dirty = true;
            }
        }
        _ => {
            stats.history.push(ScorePoint { at: now, score });
            dirty = true;
        }
    }
    if stats.history.len() > 30 {
        let extra = stats.history.len() - 30;
        stats.history.drain(0..extra);
        dirty = true;
    }
    dirty
}

/// 物理磁盘型号与健康不常变化，缓存 7 天，避免每次打开性能页都启动 PowerShell。
fn refresh_hardware(stats: &mut PerfStats) -> bool {
    let now = now_millis();
    if stats.hardware_at != 0 && now.saturating_sub(stats.hardware_at) < HARDWARE_CACHE_TTL {
        return false;
    }
    stats.physical_disks = probe_physical_disks();
    // 读取失败（精简系统、虚拟机）时次日重试，避免连续启动 PowerShell。
    let ttl = if stats.physical_disks.is_empty() {
        86_400_000
    } else {
        HARDWARE_CACHE_TTL
    };
    stats.hardware_at = now.saturating_sub(HARDWARE_CACHE_TTL.saturating_sub(ttl));
    true
}

#[cfg(windows)]
fn probe_physical_disks() -> Vec<PhysicalDiskInfo> {
    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
        $ProgressPreference='SilentlyContinue'; \
        @(Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object { \
            [pscustomobject]@{ name=$_.FriendlyName; mediaType=[string]$_.MediaType; \
                health=[string]$_.HealthStatus; size=[uint64]$_.Size } \
        }) | ConvertTo-Json -Compress";
    let Some(stdout) = crate::powershell::run_encoded(script) else {
        return Vec::new();
    };
    let value: serde_json::Value =
        serde_json::from_slice(&stdout).unwrap_or(serde_json::Value::Null);
    let objects = match &value {
        serde_json::Value::Array(items) => items.clone(),
        serde_json::Value::Object(_) => vec![value.clone()],
        _ => Vec::new(),
    };
    objects
        .iter()
        .filter_map(|object| {
            let name = object.get("name")?.as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(PhysicalDiskInfo {
                name: name.to_string(),
                media_type: object
                    .get("mediaType")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                health: object
                    .get("health")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                size_bytes: object
                    .get("size")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
            })
        })
        .collect()
}

#[cfg(not(windows))]
fn probe_physical_disks() -> Vec<PhysicalDiskInfo> {
    Vec::new()
}

fn health_score(
    memory_percent: u32,
    disk_percent: u32,
    cpu_percent: u32,
    startup_total: u32,
    startup_enabled: u32,
) -> (u32, String, Vec<PerfIssue>) {
    let mut score = 100i32;
    let mut issues: Vec<PerfIssue> = Vec::new();

    if memory_percent >= 90 {
        let points = 30;
        score -= points as i32;
        issues.push(PerfIssue {
            id: "memory".to_string(),
            title: "内存接近用满".to_string(),
            detail: format!("已用 {memory_percent}%，结束暂时不用的应用能立刻缓解。"),
            severity: "high".to_string(),
            points,
        });
    } else if memory_percent >= 80 {
        let points = 16;
        score -= points as i32;
        issues.push(PerfIssue {
            id: "memory".to_string(),
            title: "内存压力偏高".to_string(),
            detail: format!("已用 {memory_percent}%，可以关掉不用的后台应用。"),
            severity: "medium".to_string(),
            points,
        });
    }

    if disk_percent >= 92 {
        let points = 30;
        score -= points as i32;
        issues.push(PerfIssue {
            id: "disk".to_string(),
            title: "系统盘快满了".to_string(),
            detail: format!("已用 {disk_percent}%，清理临时文件和回收站可以释放空间。"),
            severity: "high".to_string(),
            points,
        });
    } else if disk_percent >= 85 {
        let points = 16;
        score -= points as i32;
        issues.push(PerfIssue {
            id: "disk".to_string(),
            title: "系统盘空间偏紧".to_string(),
            detail: format!("已用 {disk_percent}%，建议做一次临时文件清理。"),
            severity: "medium".to_string(),
            points,
        });
    }

    if cpu_percent >= 90 {
        let points = 16;
        score -= points as i32;
        issues.push(PerfIssue {
            id: "cpu".to_string(),
            title: "CPU 占用很高".to_string(),
            detail: format!("整机 CPU 已用 {cpu_percent}%，可在后台查看占用最高的进程。"),
            severity: "high".to_string(),
            points,
        });
    } else if cpu_percent >= 75 {
        let points = 8;
        score -= points as i32;
        issues.push(PerfIssue {
            id: "cpu".to_string(),
            title: "CPU 占用偏高".to_string(),
            detail: format!("整机 CPU 已用 {cpu_percent}%，短时占用可忽略，持续偏高建议排查后台应用。"),
            severity: "medium".to_string(),
            points,
        });
    }

    if startup_enabled >= 10 {
        let points = 12;
        score -= points as i32;
        issues.push(PerfIssue {
            id: "startup".to_string(),
            title: "开机自启动偏多".to_string(),
            detail: format!("{startup_enabled} / {startup_total} 项随登录启动，会拖慢开机。"),
            severity: "medium".to_string(),
            points,
        });
    } else if startup_total > 0 && startup_enabled * 2 > startup_total {
        let points = 6;
        score -= points as i32;
        issues.push(PerfIssue {
            id: "startup".to_string(),
            title: "多数启动项已开启".to_string(),
            detail: format!("{startup_enabled} / {startup_total} 项启用，可按需关闭。"),
            severity: "low".to_string(),
            points,
        });
    }

    if issues.is_empty() {
        issues.push(PerfIssue {
            id: "ok".to_string(),
            title: "状态良好".to_string(),
            detail: "内存、CPU、磁盘和启动项都没有明显压力。".to_string(),
            severity: "ok".to_string(),
            points: 0,
        });
    }

    let score = score.clamp(0, 100) as u32;
    let label = if score >= 90 {
        "运行良好"
    } else if score >= 80 {
        "状态不错"
    } else if score >= 65 {
        "可以优化"
    } else {
        "建议清理"
    };
    (score, label.to_string(), issues)
}

#[cfg(windows)]
fn system_info_windows(base: &Path) -> Result<PerfSystemInfo, String> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows::Win32::System::SystemInformation::{
        GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX,
    };

    let mut memory = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe { GlobalMemoryStatusEx(&mut memory) }
        .map_err(|error| format!("无法读取内存状态：{error}"))?;

    let sample = crate::processes::sample_resources(6);
    let logical = std::thread::available_parallelism()
        .map(|value| value.get() as u32)
        .unwrap_or(1);
    let cpu = CpuInfo {
        name: cpu_name_windows(),
        logical,
        usage_percent: sample.cpu_percent,
    };

    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
    let mut disks = fixed_disks(&drive);
    if disks.is_empty() {
        let root = HSTRING::from(format!("{drive}\\"));
        let mut free = 0u64;
        let mut total = 0u64;
        let _ = unsafe { GetDiskFreeSpaceExW(&root, Some(&mut free), Some(&mut total), None) };
        disks.push(DiskInfo {
            drive: drive.clone(),
            total_bytes: total,
            free_bytes: free,
            used_bytes: total.saturating_sub(free),
            system: true,
        });
    }
    let system_disk = disks
        .iter()
        .find(|disk| disk.system)
        .cloned()
        .unwrap_or_else(|| disks[0].clone());

    let (caption, version, build) = windows_version();
    let power = power_info().unwrap_or_else(|error| PowerInfo {
        guid: String::new(),
        name: "无法读取电源计划".to_string(),
        error: Some(error),
    });
    let app_startups = crate::startup::list_app_startup();
    let startup_total = app_startups.len() as u32;
    let startup_enabled = app_startups.iter().filter(|item| item.enabled).count() as u32;
    let memory_percent = percent_of(
        memory.ullTotalPhys.saturating_sub(memory.ullAvailPhys),
        memory.ullTotalPhys,
    );
    let disk_percent = percent_of(system_disk.used_bytes, system_disk.total_bytes);
    let (score, score_label, issues) = health_score(
        memory_percent,
        disk_percent,
        cpu.usage_percent,
        startup_total,
        startup_enabled,
    );

    let mut stats = load_stats(base);
    let mut dirty = update_history(&mut stats, score);
    dirty |= refresh_hardware(&mut stats);
    if dirty {
        save_stats(base, &stats);
    }

    Ok(PerfSystemInfo {
        memory: MemoryInfo {
            total_bytes: memory.ullTotalPhys,
            free_bytes: memory.ullAvailPhys,
            used_bytes: memory.ullTotalPhys.saturating_sub(memory.ullAvailPhys),
        },
        cpu,
        disk: system_disk,
        disks,
        physical_disks: stats.physical_disks.clone(),
        hogs: sample.items,
        power,
        os: OsInfo {
            caption,
            version,
            build,
            uptime_seconds: unsafe { GetTickCount64() } / 1000,
        },
        startup_total,
        startup_enabled,
        score,
        score_label,
        issues,
        history: stats.history.clone(),
        cleanup_total_bytes: stats.freed_bytes,
        cleanup_count: stats.clean_count,
        last_clean_at: stats.last_clean_at,
        recent_cleans: stats.recent_cleans.clone(),
    })
}

#[cfg(windows)]
fn cpu_name_windows() -> String {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        .and_then(|key| key.get_value::<String, _>("ProcessorNameString"))
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|_| "未知处理器".to_string())
}

#[cfg(windows)]
fn fixed_disks(system_drive: &str) -> Vec<DiskInfo> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW,
    };

    // DRIVE_FIXED 常量属于另一个 Win32 feature；固定磁盘的返回值就是 3。
    const DRIVE_FIXED: u32 = 3;

    let mut buffer = vec![0u16; 512];
    let length = unsafe { GetLogicalDriveStringsW(Some(&mut buffer)) } as usize;
    let mut disks = Vec::new();
    if length > 0 && length < buffer.len() {
        let mut offset = 0;
        while offset < length {
            let Some(relative_end) = buffer[offset..length].iter().position(|unit| *unit == 0)
            else {
                break;
            };
            let end = offset + relative_end;
            if end == offset {
                break;
            }
            let root = String::from_utf16_lossy(&buffer[offset..end]);
            offset = end + 1;
            let root = HSTRING::from(root);
            if unsafe { GetDriveTypeW(&root) } != DRIVE_FIXED {
                continue;
            }
            let mut free = 0u64;
            let mut total = 0u64;
            if unsafe { GetDiskFreeSpaceExW(&root, Some(&mut free), Some(&mut total), None) }
                .is_err()
            {
                continue;
            }
            if total == 0 {
                continue;
            }
            let label = root.to_string().trim_end_matches('\\').to_string();
            disks.push(DiskInfo {
                drive: label.clone(),
                total_bytes: total,
                free_bytes: free,
                used_bytes: total.saturating_sub(free),
                system: label.eq_ignore_ascii_case(system_drive),
            });
        }
    }
    disks.sort_by(|a, b| b.system.cmp(&a.system).then_with(|| a.drive.cmp(&b.drive)));
    disks
}

fn percent_of(used: u64, total: u64) -> u32 {
    if total == 0 {
        return 0;
    }
    ((u128::from(used) * 100 / u128::from(total)) as u32).min(100)
}

#[cfg(windows)]
fn windows_version() -> (String, String, String) {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .ok();
    let product: String = key
        .as_ref()
        .and_then(|key| key.get_value("ProductName").ok())
        .unwrap_or_else(|| "Windows".to_string());
    let version: String = key
        .as_ref()
        .and_then(|key| key.get_value("DisplayVersion").ok())
        .unwrap_or_default();
    let build: String = key
        .as_ref()
        .and_then(|key| key.get_value("CurrentBuildNumber").ok())
        .unwrap_or_default();
    let caption = if build
        .parse::<u32>()
        .map(|number| number >= 22000)
        .unwrap_or(false)
    {
        product.replace("Windows 10", "Windows 11")
    } else {
        product
    };
    (caption, version, build)
}

/* ── temp cleanup ─────────────────────────────────────────────── */

#[derive(Debug, Clone, Copy)]
struct ScanStats {
    bytes: u64,
    files: u64,
    errors: u64,
}

#[derive(Debug, Clone, Copy)]
struct CleanStats {
    freed_bytes: u64,
    files: u64,
    failed: u64,
    /// 已安排下次重启后删除的对象数。
    pending: u64,
}

struct TempTarget {
    id: &'static str,
    name: &'static str,
    /// 一个清理项可能对应多个目录（如浏览器多个 profile 的缓存）。
    paths: Vec<PathBuf>,
    /// 只清理文件名匹配这些前缀的缓存文件，避免误删目录里的其它数据。
    prefixes: Option<&'static [&'static str]>,
    /// 只清理文件名以这些后缀结尾的文件（如 ".log"）。
    suffixes: Option<&'static [&'static str]>,
    /// 回收站等特殊项走单独的实现，不走文件遍历。
    special: Option<&'static str>,
    /// 缓存/转储类不看修改时间：这些内容删掉会自动重建，
    /// 按保留期过滤反而会把刚用过的缓存全留下，导致「清了还是很多垃圾」。
    ignore_age: bool,
}

const THUMBNAIL_PREFIXES: &[&str] = &["thumbcache_", "iconcache_"];

/// 主流 Chromium 内核浏览器的缓存子目录（同一浏览器可能有多个 profile）。
fn chromium_cache_paths(user_data: PathBuf) -> Vec<PathBuf> {
    const PROFILES: [&str; 5] = ["Default", "Profile 1", "Profile 2", "Profile 3", "Guest Profile"];
    const SUBS: [&str; 3] = ["Cache", "Code Cache", "GPUCache"];
    let mut paths = Vec::new();
    for profile in PROFILES {
        for sub in SUBS {
            paths.push(user_data.join(profile).join(sub));
        }
    }
    paths
}

/// Firefox 的 profile 目录名随机，运行时枚举后取各自的 cache2。
fn firefox_cache_paths(local: &Path) -> Vec<PathBuf> {
    let profiles = local.join("Mozilla").join("Firefox").join("Profiles");
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(&profiles) {
        for entry in entries.flatten() {
            paths.push(entry.path().join("cache2"));
        }
    }
    paths
}

/// Electron 类应用（Teams / Discord / Slack）的缓存子目录。
fn electron_cache_paths(app_dir: PathBuf) -> Vec<PathBuf> {
    const SUBS: [&str; 4] = ["Cache", "Code Cache", "GPUCache", "DawnCache"];
    SUBS.iter().map(|sub| app_dir.join(sub)).collect()
}

fn temp_targets() -> Vec<TempTarget> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    let windows_root = std::env::var_os("WINDIR").or_else(|| std::env::var_os("SystemRoot"));
    let system_temp = windows_root.as_ref().map(|path| PathBuf::from(path).join("Temp"));
    let update_download = windows_root.as_ref().map(|path| {
        PathBuf::from(path)
            .join("SoftwareDistribution")
            .join("Download")
    });
    let system_logs = windows_root.as_ref().map(|path| PathBuf::from(path).join("Logs"));
    let prefetch = windows_root.as_ref().map(|path| PathBuf::from(path).join("Prefetch"));
    // 传递优化（Delivery Optimization）P2P 更新缓存，位于网络服务用户目录，通常是几 GB 的大块头。
    let transfer_cache = windows_root.as_ref().map(|path| {
        PathBuf::from(path)
            .join("ServiceProfiles")
            .join("NetworkService")
            .join("AppData")
            .join("Local")
            .join("Microsoft")
            .join("Windows")
            .join("DeliveryOptimization")
            .join("Cache")
    });
    // 系统级 Windows 错误报告（用户级 WER 单独列出）。
    let program_data = std::env::var_os("PROGRAMDATA").map(PathBuf::from);
    let wer_system = program_data
        .as_ref()
        .map(|path| path.join("Microsoft").join("Windows").join("WER"));
    // 事件日志目录：当前被占用的 .evtx 会安排重启后删除。
    let event_logs = windows_root.as_ref().map(|path| {
        PathBuf::from(path)
            .join("System32")
            .join("winevt")
            .join("Logs")
    });
    // 升级 Windows 后遗留的旧系统目录，通常 10 GB 以上。
    let windows_old = windows_root
        .as_ref()
        .and_then(|path| PathBuf::from(path).parent().map(Path::to_path_buf))
        .map(|root| root.join("Windows.old"));

    let mut targets = vec![
        TempTarget {
            id: "userTemp",
            name: "用户临时文件",
            paths: std::env::var_os("TEMP").map(PathBuf::from).into_iter().collect(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "windowsTemp",
            name: "Windows 临时文件",
            paths: system_temp.into_iter().collect(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "updateCache",
            name: "Windows 更新下载缓存",
            paths: update_download.into_iter().collect(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "logs",
            name: "系统日志文件",
            paths: system_logs.into_iter().collect(),
            prefixes: None,
            suffixes: Some(&["log"]),
            ignore_age: false,
            special: None,
        },
        TempTarget {
            id: "prefetch",
            name: "预读取缓存",
            paths: prefetch.into_iter().collect(),
            prefixes: None,
            suffixes: Some(&["pf"]),
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "d3dCache",
            name: "DirectX 着色器缓存",
            paths: local
                .as_ref()
                .map(|path| vec![path.join("D3DSCache")])
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "dxCache",
            name: "DXCache 缓存",
            paths: local
                .as_ref()
                .map(|path| vec![path.join("DXCache")])
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "glCache",
            name: "OpenGL 着色器缓存",
            paths: local
                .as_ref()
                .map(|path| vec![path.join("GLCache")])
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "inetCache",
            name: "IE/兼容性网络缓存",
            paths: local
                .as_ref()
                .map(|path| vec![path.join("Microsoft").join("Windows").join("INetCache")])
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "transferCache",
            name: "更新 P2P 传递缓存",
            paths: transfer_cache.into_iter().collect(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "wer",
            name: "Windows 错误报告（用户）",
            paths: local
                .as_ref()
                .map(|path| vec![path.join("Microsoft").join("Windows").join("WER")])
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "werSystem",
            name: "Windows 错误报告（系统）",
            paths: wer_system.into_iter().collect(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "crashDumps",
            name: "应用崩溃转储",
            paths: local
                .as_ref()
                .map(|path| vec![path.join("CrashDumps")])
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "minidump",
            name: "蓝屏小转储",
            paths: windows_root
                .as_ref()
                .map(|path| vec![PathBuf::from(path).join("Minidump")])
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "liveKernel",
            name: "内核实时转储",
            paths: windows_root
                .as_ref()
                .map(|path| vec![PathBuf::from(path).join("LiveKernelReports")])
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "eventLogs",
            name: "系统事件日志",
            paths: event_logs.into_iter().collect(),
            prefixes: None,
            suffixes: Some(&["evtx"]),
            ignore_age: false,
            special: None,
        },
        TempTarget {
            id: "thumbnailCache",
            name: "缩略图与图标缓存",
            paths: local
                .as_ref()
                .map(|path| vec![path.join("Microsoft").join("Windows").join("Explorer")])
                .unwrap_or_default(),
            prefixes: Some(THUMBNAIL_PREFIXES),
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "systemTemp32",
            name: "系统临时目录（32 位）",
            paths: windows_root
                .as_ref()
                .map(|path| vec![PathBuf::from(path).join("SystemTemp")])
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "chromeCache",
            name: "Chrome 浏览器缓存",
            paths: local
                .as_ref()
                .map(|path| {
                    chromium_cache_paths(
                        path.join("Google").join("Chrome").join("User Data"),
                    )
                })
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "edgeCache",
            name: "Edge 浏览器缓存",
            paths: local
                .as_ref()
                .map(|path| chromium_cache_paths(path.join("Microsoft").join("Edge").join("User Data")))
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "braveCache",
            name: "Brave 浏览器缓存",
            paths: local
                .as_ref()
                .map(|path| {
                    chromium_cache_paths(
                        path.join("BraveSoftware").join("Brave-Browser").join("User Data"),
                    )
                })
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "firefoxCache",
            name: "Firefox 浏览器缓存",
            paths: local
                .as_ref()
                .map(|path| firefox_cache_paths(path))
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "teamsCache",
            name: "Teams 应用缓存",
            paths: roaming
                .as_ref()
                .map(|path| electron_cache_paths(path.join("Microsoft").join("Teams")))
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "discordCache",
            name: "Discord 应用缓存",
            paths: roaming
                .as_ref()
                .map(|path| electron_cache_paths(path.join("discord")))
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "slackCache",
            name: "Slack 应用缓存",
            paths: roaming
                .as_ref()
                .map(|path| electron_cache_paths(path.join("Slack")))
                .unwrap_or_default(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: None,
        },
        TempTarget {
            id: "windowsOld",
            name: "旧系统目录 Windows.old",
            paths: windows_old.into_iter().collect(),
            prefixes: None,
            suffixes: None,
            ignore_age: true,
            special: Some("tree"),
        },
        TempTarget {
            id: "recycleBin",
            name: "回收站",
            paths: Vec::new(),
            prefixes: None,
            suffixes: None,
            special: Some("recycleBin"),
            ignore_age: false,
        },
    ];
    targets.sort_by_key(|target| target.id);
    targets
}

/// 回收站按整个用户统计，不按文件修改时间过滤。
#[cfg(windows)]
fn recycle_bin_stats() -> Result<(u64, u64), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};

    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        ..Default::default()
    };
    unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) }
        .map_err(|error| format!("无法读取回收站：{error}"))?;
    Ok((
        info.i64Size.max(0) as u64,
        info.i64NumItems.max(0) as u64,
    ))
}

#[cfg(not(windows))]
fn recycle_bin_stats() -> Result<(u64, u64), String> {
    Err("回收站清理只支持 Windows".to_string())
}

#[cfg(windows)]
fn empty_recycle_bin() -> Result<(u64, u64), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::{
        SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND,
    };

    let before = recycle_bin_stats().unwrap_or((0, 0));
    unsafe {
        SHEmptyRecycleBinW(
            HWND::default(),
            PCWSTR::null(),
            SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
        )
    }
    .map_err(|error| format!("无法清空回收站：{error}"))?;
    Ok(before)
}

#[cfg(not(windows))]
fn empty_recycle_bin() -> Result<(u64, u64), String> {
    Err("回收站清理只支持 Windows".to_string())
}

fn cutoff_for(days: u32) -> SystemTime {
    let days = days.clamp(1, 90);
    SystemTime::now()
        .checked_sub(Duration::from_secs(u64::from(days) * 86_400))
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

pub fn scan_temp(base: &Path, days: u32) -> Result<TempScan, String> {
    require_opt_installed(base)?;
    let days = days.clamp(1, 90);
    let cutoff = cutoff_for(days);
    let mut categories = Vec::new();
    let mut total_bytes = 0u64;
    let mut total_files = 0u64;

    for target in temp_targets() {
        let (path, accessible, stats, error) = if target.special == Some("recycleBin") {
            match recycle_bin_stats() {
                Ok((bytes, items)) => (
                    "回收站 · 所有磁盘".to_string(),
                    true,
                    ScanStats {
                        bytes,
                        files: items,
                        errors: 0,
                    },
                    None,
                ),
                Err(error) => (
                    "回收站 · 所有磁盘".to_string(),
                    false,
                    ScanStats {
                        bytes: 0,
                        files: 0,
                        errors: 1,
                    },
                    Some(error),
                ),
            }
        } else {
            let mut stats = ScanStats {
                bytes: 0,
                files: 0,
                errors: 0,
            };
            let mut existing = 0usize;
            let mut first_path: Option<String> = None;
            let mut first_error: Option<String> = None;
            for dir in &target.paths {
                if !dir.exists() {
                    continue;
                }
                existing += 1;
                if first_path.is_none() {
                    first_path = Some(dir.to_string_lossy().to_string());
                }
                match scan_root(dir, cutoff, target.prefixes, target.suffixes, target.ignore_age) {
                    Ok(part) => {
                        stats.bytes += part.bytes;
                        stats.files += part.files;
                        stats.errors += part.errors;
                    }
                    Err(error) => {
                        stats.errors += 1;
                        if first_error.is_none() {
                            first_error = Some(error);
                        }
                    }
                }
            }
            let label = match (&first_path, existing) {
                (Some(first), count) if count > 1 => format!("{first} 等 {count} 处"),
                (Some(first), _) => first.clone(),
                (None, _) => target
                    .paths
                    .first()
                    .map(|dir| dir.to_string_lossy().to_string())
                    .unwrap_or_default(),
            };
            if existing == 0 {
                (label, false, stats, Some("目录不存在".to_string()))
            } else {
                (label, true, stats, first_error)
            }
        };
        total_bytes += stats.bytes;
        total_files += stats.files;
        categories.push(TempCategory {
            id: target.id.to_string(),
            name: target.name.to_string(),
            path,
            bytes: stats.bytes,
            files: stats.files,
            accessible,
            errors: stats.errors,
            error,
        });
    }

    Ok(TempScan {
        categories,
        total_bytes,
        total_files,
        days,
    })
}

pub fn clean_temp(base: &Path, categories: Vec<String>, days: u32) -> Result<CleanResult, String> {
    require_opt_installed(base)?;
    let days = days.clamp(1, 90);
    let cutoff = cutoff_for(days);
    let mut wanted: Vec<String> = categories
        .into_iter()
        .filter(|id| ALL_CATEGORIES.contains(&id.as_str()))
        .collect();
    wanted.sort();
    wanted.dedup();
    if wanted.is_empty() {
        return Err("未选择任何清理项目".to_string());
    }

    let mut result = CleanResult {
        freed_bytes: 0,
        files: 0,
        failed: 0,
        pending_reboot: 0,
        categories: Vec::new(),
    };
    for target in temp_targets() {
        if !wanted.iter().any(|id| id == target.id) {
            continue;
        }
        let (freed_bytes, files, failed, pending_reboot, error) = if target.special == Some("recycleBin") {
            match empty_recycle_bin() {
                Ok((bytes, items)) => (bytes, items, 0, 0, None),
                Err(error) => (0, 0, 0, 0, Some(error)),
            }
        } else if target.special == Some("tree") {
            // 整棵目录删除（如 Windows.old）：逐个文件走 takeown 太慢，
            // 交给强删引擎一次性处理，删不掉的部分自动安排重启后删除。
            let mut freed = 0u64;
            let mut count = 0u64;
            let mut pending = 0u64;
            let mut existing = 0usize;
            let mut first_error: Option<String> = None;
            for dir in &target.paths {
                if !dir.exists() {
                    continue;
                }
                existing += 1;
                let report = crate::force_delete::delete_tree_forced(dir);
                freed += report.freed_bytes;
                count += report.files;
                pending += report.pending;
                if first_error.is_none() {
                    first_error = report.errors.first().cloned();
                }
            }
            if existing == 0 {
                (
                    0,
                    0,
                    0,
                    0,
                    Some(format!(
                        "目录不存在：{}",
                        target
                            .paths
                            .first()
                            .map(|dir| dir.to_string_lossy().to_string())
                            .unwrap_or_default()
                    )),
                )
            } else {
                (freed, count, 0, pending, first_error)
            }
        } else {
            let mut freed = 0u64;
            let mut count = 0u64;
            let mut failures = 0u64;
            let mut pending = 0u64;
            let mut existing = 0usize;
            let mut first_error: Option<String> = None;
            for dir in &target.paths {
                if !dir.exists() {
                    continue;
                }
                existing += 1;
                match clean_root(dir, cutoff, target.prefixes, target.suffixes, target.ignore_age) {
                    Ok(stats) => {
                        freed += stats.freed_bytes;
                        count += stats.files;
                        failures += stats.failed;
                        pending += stats.pending;
                    }
                    Err(error) => {
                        if first_error.is_none() {
                            first_error = Some(error);
                        }
                    }
                }
            }
            if existing == 0 {
                (
                    0,
                    0,
                    0,
                    0,
                    Some(format!(
                        "目录不存在：{}",
                        target
                            .paths
                            .first()
                            .map(|dir| dir.to_string_lossy().to_string())
                            .unwrap_or_default()
                    )),
                )
            } else {
                (freed, count, failures, pending, first_error)
            }
        };
        result.freed_bytes += freed_bytes;
        result.files += files;
        result.failed += failed;
        result.pending_reboot += pending_reboot;
        result.categories.push(CleanCategory {
            id: target.id.to_string(),
            name: target.name.to_string(),
            freed_bytes,
            files,
            failed,
            pending_reboot,
            error,
        });
    }
    record_clean(base, result.freed_bytes, result.files);
    Ok(result)
}

fn matches_filter(path: &Path, prefixes: Option<&[&str]>, suffixes: Option<&[&str]>) -> bool {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if let Some(prefixes) = prefixes {
        if !prefixes.iter().any(|prefix| name.starts_with(prefix)) {
            return false;
        }
    }
    if let Some(suffixes) = suffixes {
        if !suffixes.iter().any(|suffix| name.ends_with(suffix)) {
            return false;
        }
    }
    true
}

fn scan_root(
    root: &Path,
    cutoff: SystemTime,
    prefixes: Option<&[&str]>,
    suffixes: Option<&[&str]>,
    ignore_age: bool,
) -> Result<ScanStats, String> {
    let mut stack = vec![root.to_path_buf()];
    let mut stats = ScanStats {
        bytes: 0,
        files: 0,
        errors: 0,
    };
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => {
                stats.errors += 1;
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    stats.errors += 1;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    stats.errors += 1;
                    continue;
                }
            };
            if metadata.file_type().is_dir() {
                if !is_reparse_point(&metadata) {
                    stack.push(path);
                }
                continue;
            }
            if !metadata.file_type().is_file() {
                continue;
            }
            if !matches_filter(&path, prefixes, suffixes) {
                continue;
            }
            if ignore_age {
                stats.bytes += metadata.len();
                stats.files += 1;
                continue;
            }
            match metadata.modified() {
                Ok(modified) if modified < cutoff => {
                    stats.bytes += metadata.len();
                    stats.files += 1;
                }
                Ok(_) => {}
                Err(_) => stats.errors += 1,
            }
        }
    }
    Ok(stats)
}

fn clean_root(
    root: &Path,
    cutoff: SystemTime,
    prefixes: Option<&[&str]>,
    suffixes: Option<&[&str]>,
    ignore_age: bool,
) -> Result<CleanStats, String> {
    let mut stack = vec![root.to_path_buf()];
    let mut stats = CleanStats {
        freed_bytes: 0,
        files: 0,
        failed: 0,
        pending: 0,
    };
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => {
                stats.failed += 1;
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    stats.failed += 1;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    stats.failed += 1;
                    continue;
                }
            };
            if metadata.file_type().is_dir() {
                if !is_reparse_point(&metadata) {
                    stack.push(path);
                }
                continue;
            }
            if !metadata.file_type().is_file() {
                continue;
            }
            if !matches_filter(&path, prefixes, suffixes) {
                continue;
            }
            if !ignore_age {
                let old_enough = metadata
                    .modified()
                    .map(|modified| modified < cutoff)
                    .unwrap_or(false);
                if !old_enough {
                    continue;
                }
            }
            // 强删：先普通删除，被占用或权限不足时取所有权重试，仍占用则安排重启删除。
            match crate::force_delete::remove_file_forced(&path) {
                Ok(Some(_)) => {
                    stats.freed_bytes += metadata.len();
                    stats.files += 1;
                }
                Ok(None) => {
                    stats.freed_bytes += metadata.len();
                    stats.files += 1;
                    stats.pending += 1;
                }
                Err(_) => stats.failed += 1,
            }
        }
    }
    Ok(stats)
}

fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

/* ── power plan & DNS ─────────────────────────────────────────── */

pub fn set_power(base: &Path, guid: &str) -> Result<PowerInfo, String> {
    require_opt_installed(base)?;
    let guid = guid.trim().to_lowercase();
    let standard = [POWER_SAVER, POWER_BALANCED, POWER_HIGH];
    let ultimate = guid == POWER_ULTIMATE;
    if !ultimate && !standard.contains(&guid.as_str()) {
        return Err("不支持的电源计划".to_string());
    }

    #[cfg(windows)]
    {
        let target = if ultimate { ensure_ultimate()? } else { guid.clone() };
        let (ok, output) = run_hidden("powercfg", &["/setactive", target.as_str()])?;
        if !ok {
            return Err(if output.trim().is_empty() {
                "切换电源计划失败，可能需要管理员权限".to_string()
            } else {
                output.trim().to_string()
            });
        }
        invalidate_power_cache();
        power_info()
    }
    #[cfg(not(windows))]
    {
        Err("电源计划切换目前只支持 Windows".to_string())
    }
}

/// 确保「卓越性能」计划已存在，返回其真实 GUID。
/// 模板方案默认隐藏，需用 powercfg /duplicatescheme 复制出一个可见方案；
/// 若本机已有（名称含“卓越性能/Ultimate”）则直接复用，避免反复复制堆积。
#[cfg(windows)]
fn ensure_ultimate() -> Result<String, String> {
    let (ok, list) = run_hidden("powercfg", &["/list"])?;
    if ok {
        for line in list.lines() {
            let lower = line.to_lowercase();
            if lower.contains("卓越性能") || lower.contains("ultimate performance") {
                if let Some(guid) = extract_guid(line) {
                    return Ok(guid);
                }
            }
        }
    }
    let (ok, output) = run_hidden("powercfg", &["/duplicatescheme", POWER_ULTIMATE])?;
    if !ok {
        return Err("创建卓越性能计划失败，可能需要管理员权限".to_string());
    }
    extract_guid(&output)
        .ok_or_else(|| "无法解析新建的卓越性能计划 GUID".to_string())
}

pub fn flush_dns(base: &Path) -> Result<String, String> {
    require_opt_installed(base)?;

    #[cfg(windows)]
    {
        let (ok, output) = run_hidden("ipconfig", &["/flushdns"])?;
        if ok {
            Ok("DNS 缓存已刷新".to_string())
        } else if output.trim().is_empty() {
            Err("刷新 DNS 失败，可能需要管理员权限".to_string())
        } else {
            Err(output.trim().to_string())
        }
    }
    #[cfg(not(windows))]
    {
        Err("DNS 刷新目前只支持 Windows".to_string())
    }
}

/// 优化插件专用的当前电源计划查询，不依赖「系统体检」插件的体检数据。
pub fn power_status(base: &Path) -> Result<PowerInfo, String> {
    require_opt_installed(base)?;
    #[cfg(windows)]
    {
        power_info()
    }
    #[cfg(not(windows))]
    {
        let _ = base;
        Err("电源计划读取目前只支持 Windows".to_string())
    }
}

/// powercfg /getactivescheme 是子进程调用，每次体检都跑开销不小；
/// 电源计划不常变，30 秒内复用结果，切换后主动失效。
#[cfg(windows)]
const POWER_CACHE_TTL: Duration = Duration::from_secs(30);

#[cfg(windows)]
static POWER_CACHE: Mutex<Option<(Instant, PowerInfo)>> = Mutex::new(None);

#[cfg(windows)]
fn power_info() -> Result<PowerInfo, String> {
    if let Ok(cache) = POWER_CACHE.lock() {
        if let Some((at, info)) = cache.as_ref() {
            if at.elapsed() < POWER_CACHE_TTL {
                return Ok(info.clone());
            }
        }
    }
    let (ok, output) = run_hidden("powercfg", &["/getactivescheme"])?;
    if !ok {
        return Err("无法读取当前电源计划".to_string());
    }
    let guid = extract_guid(&output)
        .ok_or_else(|| "无法解析当前电源计划".to_string())?
        .to_lowercase();
    let name = parse_power_name(&output, &guid)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| power_name(&guid));
    let info = PowerInfo {
        name,
        guid,
        error: None,
    };
    if let Ok(mut cache) = POWER_CACHE.lock() {
        *cache = Some((Instant::now(), info.clone()));
    }
    Ok(info)
}

#[cfg(windows)]
fn invalidate_power_cache() {
    if let Ok(mut cache) = POWER_CACHE.lock() {
        *cache = None;
    }
}

#[cfg(windows)]
fn extract_guid(text: &str) -> Option<String> {
    text.split_whitespace().find_map(|token| {
        let candidate = token.trim_matches(|c: char| !c.is_ascii_hexdigit() && c != '-');
        let hyphens = candidate.chars().filter(|c| *c == '-').count();
        if candidate.len() == 36
            && hyphens == 4
            && candidate
                .chars()
                .all(|c| c.is_ascii_hexdigit() || c == '-')
        {
            Some(candidate.to_string())
        } else {
            None
        }
    })
}

fn power_name(guid: &str) -> String {
    match guid {
        POWER_SAVER => "省电".to_string(),
        POWER_BALANCED => "均衡".to_string(),
        POWER_HIGH => "高性能".to_string(),
        POWER_ULTIMATE => "卓越性能".to_string(),
        _ => "自定义电源计划".to_string(),
    }
}

/// 从 powercfg /getactivescheme 输出解析方案名称（本地化，如“(均衡)”“(卓越性能)”）。
fn parse_power_name(text: &str, guid: &str) -> Option<String> {
    text.lines().find_map(|line| {
        if !line.contains(guid) {
            return None;
        }
        let start = line.find('(')?;
        let rest = &line[start + 1..];
        let end = rest.find(')')?;
        let name = rest[..end].trim();
        if name.is_empty() { None } else { Some(name.to_string()) }
    })
}

#[cfg(windows)]
fn run_hidden(program: &str, args: &[&str]) -> Result<(bool, String), String> {
    use std::os::windows::process::CommandExt;

    let output = std::process::Command::new(program)
        .args(args)
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|error| format!("无法运行系统命令：{error}"))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
    ))
}

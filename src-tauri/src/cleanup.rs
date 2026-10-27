use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::time::{Duration, Instant};

const MODULE_ID: &str = "cleanup";
const MAX_CANDIDATES: usize = 240;
const STATS_THREADS: usize = 6;
const UNINSTALL_TIMEOUT_SECS: u64 = 600;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCandidate {
    pub id: String,
    pub name: String,
    pub path: String,
    pub root: String,
    pub kind: String,
    pub size_bytes: u64,
    pub files: u64,
    pub last_modified: u64,
    /// 是否仍被已安装应用、快捷方式或运行中进程引用。
    pub referenced: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupScan {
    pub candidates: Vec<CleanupCandidate>,
    pub references: u64,
    pub roots: Vec<String>,
    pub scanned_dirs: u64,
    /// 未被引用的疑似残留数量。
    pub suspects: u64,
    /// 当前列出文件夹的合计大小。
    pub total_bytes: u64,
    pub advanced_ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupDeleteReport {
    pub freed_bytes: u64,
    pub files: u64,
    pub deleted: Vec<String>,
    /// true 表示移入回收站；false 表示永久删除。
    pub recycled: bool,
    /// 已安排下次重启后删除的路径。
    pub pending_reboot: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupApp {
    pub id: String,
    pub name: String,
    pub publisher: Option<String>,
    pub version: Option<String>,
    pub install_location: Option<String>,
    pub size_bytes: u64,
    pub scope: String,
    pub icon_path: Option<String>,
    pub quiet: bool,
    /// 是否能调用应用自带卸载程序；便携版/未登记应用为 false。
    pub uninstallable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallReport {
    pub app_name: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub removed_dirs: Vec<String>,
    pub freed_bytes: u64,
    pub files: u64,
    pub registry_removed: bool,
    pub recycled: bool,
    pub errors: Vec<String>,
}

fn require_installed(base: &Path) -> Result<(), String> {
    if crate::modules::is_installed(base, MODULE_ID) {
        Ok(())
    } else {
        Err("应用管理插件尚未安装".to_string())
    }
}

pub fn scan(base: &Path) -> Result<CleanupScan, String> {
    require_installed(base)?;
    #[cfg(windows)]
    {
        scan_windows()
    }
    #[cfg(not(windows))]
    {
        Err("应用清理目前只支持 Windows".to_string())
    }
}

pub fn delete(
    base: &Path,
    paths: Vec<String>,
    recycle: bool,
) -> Result<CleanupDeleteReport, String> {
    require_installed(base)?;
    #[cfg(windows)]
    {
        delete_windows(paths, recycle)
    }
    #[cfg(not(windows))]
    {
        let _ = (paths, recycle);
        Err("应用清理目前只支持 Windows".to_string())
    }
}

pub fn open(base: &Path, path: &str) -> Result<(), String> {
    require_installed(base)?;
    let candidate = PathBuf::from(path);
    validate_scope(&candidate)?;
    crate::launch::open_folder(&candidate)
}

pub fn apps(base: &Path) -> Result<Vec<CleanupApp>, String> {
    require_installed(base)?;
    #[cfg(windows)]
    {
        Ok(list_windows())
    }
    #[cfg(not(windows))]
    {
        Err("应用卸载目前只支持 Windows".to_string())
    }
}

pub fn uninstall(base: &Path, id: &str, remove_leftovers: bool) -> Result<UninstallReport, String> {
    require_installed(base)?;
    #[cfg(windows)]
    {
        uninstall_windows(id, remove_leftovers)
    }
    #[cfg(not(windows))]
    {
        let _ = (id, remove_leftovers);
        Err("应用卸载目前只支持 Windows".to_string())
    }
}

fn protected_names() -> &'static [&'static str] {
    &[
        "$recycle.bin",
        "application data",
        "comms",
        "common files",
        "connecteddevicesplatform",
        "crashdumps",
        "d3dscache",
        "fontcache",
        "history",
        "iconcache",
        "internet explorer",
        "microsoft",
        "microsoft corporation",
        "microsoft.net",
        "modifiablewindowsapps",
        "msbuild",
        "package cache",
        "packages",
        "publishercache",
        "reference assemblies",
        "system volume information",
        "temp",
        "uninstall information",
        "uso-private",
        "uso-shared",
        "windows",
        "windows defender",
        "windows mail",
        "windows media player",
        "windows nt",
        "windows photo viewer",
        "windows portable devices",
        "windows security",
        "windows sidebar",
        "windowsapps",
        "windowspowershell",
        "windows system",
    ]
}

fn install_roots() -> Vec<(String, PathBuf)> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    let candidates = [
        ("Program Files", std::env::var_os("ProgramFiles").map(PathBuf::from)),
        (
            "Program Files (x86)",
            std::env::var_os("ProgramFiles(x86)").map(PathBuf::from),
        ),
        ("ProgramData", std::env::var_os("ProgramData").map(PathBuf::from)),
        (
            "LocalAppData\\Programs",
            std::env::var_os("LOCALAPPDATA").map(|path| PathBuf::from(path).join("Programs")),
        ),
    ];
    for (label, path) in candidates {
        let Some(path) = path else { continue };
        if !path.is_dir() {
            continue;
        }
        let key = normalize_path(&path);
        if seen.insert(key) {
            roots.push((label.to_string(), path));
        }
    }
    roots
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_lowercase()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RootKind {
    Install,
    Data,
}

struct ScanRoot {
    label: String,
    path: PathBuf,
    kind: RootKind,
    /// 安装根目录允许扫描到厂商目录下一级，应用数据只扫描一级。
    depth: u8,
}

fn scan_roots() -> Vec<ScanRoot> {
    let mut roots: Vec<ScanRoot> = install_roots()
        .into_iter()
        .map(|(label, path)| ScanRoot {
            label,
            path,
            kind: RootKind::Install,
            depth: 2,
        })
        .collect();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let path = PathBuf::from(local);
        if path.is_dir() {
            roots.push(ScanRoot {
                label: "LocalAppData".to_string(),
                path,
                kind: RootKind::Data,
                depth: 1,
            });
        }
    }
    if let Some(roaming) = std::env::var_os("APPDATA") {
        let path = PathBuf::from(roaming);
        if path.is_dir() {
            roots.push(ScanRoot {
                label: "AppData\\Roaming".to_string(),
                path,
                kind: RootKind::Data,
                depth: 1,
            });
        }
    }
    roots
}

/// 只允许打开或删除扫描范围内的文件夹：安装根目录一至两级，应用数据仅一级。
fn validate_scope(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("路径为空".to_string());
    }
    let roots = scan_roots();
    if roots
        .iter()
        .any(|root| normalize_path(&root.path) == normalize_path(path))
    {
        return Err("不能操作扫描根目录".to_string());
    }
    for root in &roots {
        let Ok(relative) = path.strip_prefix(&root.path) else {
            continue;
        };
        let depth = relative.components().count();
        let allowed = match root.kind {
            RootKind::Install => depth == 1 || depth == 2,
            RootKind::Data => depth == 1,
        };
        if !allowed {
            return Err("目录层级超出允许范围".to_string());
        }
        for component in relative.components() {
            let name = component.as_os_str().to_string_lossy();
            if is_protected_name(&name) {
                return Err(format!("受保护的目录：{name}"));
            }
        }
        return Ok(());
    }
    Err("不在允许清理的安装或应用数据目录中".to_string())
}

#[cfg(windows)]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse(_metadata: &fs::Metadata) -> bool {
    false
}

fn is_protected_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    lower.is_empty()
        || lower.starts_with('.')
        || lower.starts_with('$')
        || protected_names().contains(&lower.as_str())
}

fn name_tokens(name: &str) -> Vec<String> {
    name.to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| token.len() >= 4)
        .map(str::to_string)
        .collect()
}

struct References {
    paths: Vec<String>,
    tokens: HashSet<String>,
}

impl References {
    fn count(&self) -> u64 {
        self.paths.len() as u64
    }

    fn matches_path(&self, candidate: &Path) -> bool {
        let candidate = normalize_path(candidate);
        if candidate.is_empty() {
            return true;
        }
        let prefix = format!("{candidate}\\");
        self.paths
            .iter()
            .any(|reference| *reference == candidate || reference.starts_with(&prefix))
    }

    fn matches_name(&self, name: &str) -> bool {
        let tokens = name_tokens(name);
        tokens.iter().any(|token| self.tokens.contains(token))
    }
}

#[cfg(windows)]
struct FolderSeed {
    path: PathBuf,
    name: String,
    root: String,
    kind: &'static str,
    last_modified: u64,
    referenced: bool,
}

#[cfg(windows)]
fn scan_windows() -> Result<CleanupScan, String> {
    let roots = scan_roots();
    if roots.is_empty() {
        return Err("没有找到可扫描的安装或应用数据目录".to_string());
    }
    let root_paths = roots
        .iter()
        .map(|root| root.path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let Some(references) = collect_references(None) else {
        return Ok(CleanupScan {
            candidates: Vec::new(),
            references: 0,
            roots: root_paths,
            scanned_dirs: 0,
            suspects: 0,
            total_bytes: 0,
            advanced_ok: false,
        });
    };

    let mut seeds = Vec::new();
    let mut scanned_dirs = 0u64;
    for root in &roots {
        for (path, name, metadata) in child_dirs(&root.path) {
            scanned_dirs += 1;
            if root.kind == RootKind::Data && name.eq_ignore_ascii_case("programs") {
                continue;
            }
            // 安装目录里常见的「厂商 / 产品」两层结构：
            // 厂商目录本身没有 exe 时，展开到产品级，避免整包只显示成厂商文件夹。
            if root.kind == RootKind::Install && root.depth > 1 && is_vendor_container(&path) {
                for (child_path, child_name, child_metadata) in child_dirs(&path) {
                    scanned_dirs += 1;
                    seeds.push(make_seed(
                        root,
                        child_path,
                        child_name,
                        &child_metadata,
                        &references,
                    ));
                }
                continue;
            }
            seeds.push(make_seed(root, path, name, &metadata, &references));
        }
    }

    let paths: Vec<PathBuf> = seeds.iter().map(|seed| seed.path.clone()).collect();
    let stats = stats_parallel(&paths);
    let mut candidates = Vec::with_capacity(seeds.len());
    for (seed, (size_bytes, files)) in seeds.into_iter().zip(stats) {
        candidates.push(CleanupCandidate {
            id: stable_id(&seed.path),
            name: seed.name,
            path: seed.path.to_string_lossy().to_string(),
            root: seed.root,
            kind: seed.kind.to_string(),
            size_bytes,
            files,
            last_modified: seed.last_modified,
            referenced: seed.referenced,
        });
    }

    candidates.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    candidates.truncate(MAX_CANDIDATES);
    let total_bytes = candidates.iter().map(|item| item.size_bytes).sum();
    let suspects = candidates.iter().filter(|item| !item.referenced).count() as u64;

    Ok(CleanupScan {
        candidates,
        references: references.count(),
        roots: root_paths,
        scanned_dirs,
        suspects,
        total_bytes,
        advanced_ok: true,
    })
}

#[cfg(windows)]
fn child_dirs(dir: &Path) -> Vec<(PathBuf, String, fs::Metadata)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).ok()?;
            if !metadata.file_type().is_dir()
                || metadata.file_type().is_symlink()
                || is_reparse(&metadata)
            {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if is_protected_name(&name) {
                return None;
            }
            Some((path, name, metadata))
        })
        .collect()
}

#[cfg(windows)]
fn is_vendor_container(path: &Path) -> bool {
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    let mut has_child_dir = false;
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_dir() {
            has_child_dir = true;
            continue;
        }
        let extension = child
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if extension.eq_ignore_ascii_case("exe") {
            return false;
        }
    }
    has_child_dir
}

#[cfg(windows)]
fn make_seed(
    root: &ScanRoot,
    path: PathBuf,
    name: String,
    metadata: &fs::Metadata,
    references: &References,
) -> FolderSeed {
    let last_modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let referenced = references.matches_path(&path) || references.matches_name(&name);
    FolderSeed {
        path,
        name,
        root: root.label.clone(),
        kind: match root.kind {
            RootKind::Install => "install",
            RootKind::Data => "data",
        },
        last_modified,
        referenced,
    }
}

#[cfg(windows)]
fn stats_parallel(paths: &[PathBuf]) -> Vec<(u64, u64)> {
    if paths.is_empty() {
        return Vec::new();
    }
    let workers = paths.len().min(STATS_THREADS).max(1);
    let chunk_size = paths.len().div_ceil(workers);
    std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(workers);
        for chunk in paths.chunks(chunk_size) {
            handles.push(scope.spawn(move || {
                chunk.iter().map(|path| dir_stats(path)).collect::<Vec<_>>()
            }));
        }
        let mut stats = Vec::with_capacity(paths.len());
        for handle in handles {
            if let Ok(part) = handle.join() {
                stats.extend(part);
            }
        }
        stats
    })
}

#[cfg(windows)]
fn delete_windows(paths: Vec<String>, recycle: bool) -> Result<CleanupDeleteReport, String> {
    if paths.is_empty() {
        return Err("没有选择要删除的文件夹".to_string());
    }
    let Some(references) = collect_references(None) else {
        return Err("无法确认文件夹是否仍被应用引用，已取消删除".to_string());
    };

    let mut report = CleanupDeleteReport {
        freed_bytes: 0,
        files: 0,
        deleted: Vec::new(),
        recycled: false,
        pending_reboot: Vec::new(),
        errors: Vec::new(),
    };
    let mut seen = HashSet::new();
    for raw in paths {
        if !seen.insert(raw.clone()) {
            continue;
        }
        let path = PathBuf::from(&raw);
        if let Err(reason) = validate_scope(&path) {
            report.errors.push(format!("{raw}：{reason}"));
            continue;
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                report.errors.push(format!("{raw}：{error}"));
                continue;
            }
        };
        if !metadata.file_type().is_dir()
            || metadata.file_type().is_symlink()
            || is_reparse(&metadata)
        {
            report.errors.push(format!("{raw}：不是普通文件夹"));
            continue;
        }
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        if is_protected_name(&name) || references.matches_path(&path) || references.matches_name(&name) {
            report.errors.push(format!("{raw}：仍被已安装应用、快捷方式或进程引用"));
            continue;
        }
        let (size_bytes, files) = dir_stats(&path);
        if recycle {
            match recycle_path(&path) {
                Ok(()) => {
                    report.recycled = true;
                    report.freed_bytes += size_bytes;
                    report.files += files;
                    report.deleted.push(raw);
                }
                Err(error) => report.errors.push(format!("{raw}：{error}")),
            }
            continue;
        }
        // 强删：能删的立刻删；被占用的安排重启删除；失败的原因如实收集。
        let result = crate::force_delete::delete_tree_forced(&path);
        report.freed_bytes += result.freed_bytes;
        report.files += result.files;
        if result.errors.is_empty() {
            if result.pending > 0 {
                report.pending_reboot.push(raw);
            } else {
                report.deleted.push(raw);
            }
        } else {
            report.errors.extend(
                result
                    .errors
                    .iter()
                    .map(|reason| format!("{raw}：{reason}")),
            );
            if result.pending > 0 {
                report.pending_reboot.push(raw);
            }
        }
    }
    if report.deleted.is_empty() && !report.errors.is_empty() {
        return Err(report.errors.join("；"));
    }
    Ok(report)
}

#[cfg(windows)]
fn recycle_path(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{BOOL, HWND};
    use windows::Win32::UI::Shell::{
        SHFileOperationW, SHFILEOPSTRUCTW, FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION,
        FOF_NOERRORUI, FOF_SILENT,
    };

    let mut from: Vec<u16> = path.as_os_str().encode_wide().collect();
    from.push(0);
    from.push(0);
    let mut operation = SHFILEOPSTRUCTW {
        hwnd: HWND(std::ptr::null_mut()),
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        pTo: PCWSTR::null(),
        fFlags: (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_NOERRORUI.0 | FOF_SILENT.0) as u16,
        fAnyOperationsAborted: BOOL(0),
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: PCWSTR::null(),
    };
    let code = unsafe { SHFileOperationW(&mut operation) };
    if operation.fAnyOperationsAborted.as_bool() {
        return Err("移入回收站被中止".to_string());
    }
    if code != 0 {
        return Err(format!("移入回收站失败（代码 {code}）"));
    }
    Ok(())
}

fn dir_stats(root: &Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut files = 0u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.file_type().is_symlink() || is_reparse(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                stack.push(path);
            } else if metadata.is_file() {
                size = size.saturating_add(metadata.len());
                files += 1;
            }
        }
    }
    (size, files)
}

#[cfg(windows)]
fn collect_references(exclude: Option<&str>) -> Option<References> {
    let mut paths: HashSet<String> = HashSet::new();
    let mut tokens: HashSet<String> = HashSet::new();

    for entry in registry_entries() {
        if exclude == Some(entry.id.as_str()) {
            continue;
        }
        tokens.extend(name_tokens(&entry.name));
        if let Some(publisher) = &entry.publisher {
            tokens.extend(name_tokens(publisher));
        }
        for value in [
            entry.install_location.as_deref(),
            entry.display_icon.as_deref(),
            entry.uninstall.as_deref(),
            entry.quiet_uninstall.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if let Some(path) = extract_path(value) {
                paths.insert(normalize_path(&path));
            }
        }
    }

    let (shortcut_targets, process_paths, both_ok) = probe_running_paths()?;
    if !both_ok {
        return None;
    }
    for value in shortcut_targets.into_iter().chain(process_paths) {
        if let Some(path) = extract_path(&value) {
            paths.insert(normalize_path(&path));
        }
    }
    // 卸载后遗留的失效快捷方式不应继续保护目录，只保留仍存在的目标。
    paths.retain(|path| Path::new(path).exists());

    Some(References {
        paths: paths.into_iter().collect(),
        tokens,
    })
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hive {
    Current,
    Machine,
}

#[cfg(windows)]
impl Hive {
    fn root(self) -> winreg::HKEY {
        match self {
            Hive::Current => winreg::enums::HKEY_CURRENT_USER,
            Hive::Machine => winreg::enums::HKEY_LOCAL_MACHINE,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Hive::Current => "当前用户",
            Hive::Machine => "所有用户",
        }
    }
}

#[cfg(windows)]
struct UninstallEntry {
    id: String,
    hive: Hive,
    flags: u32,
    key_name: String,
    name: String,
    publisher: Option<String>,
    version: Option<String>,
    install_location: Option<String>,
    display_icon: Option<String>,
    uninstall: Option<String>,
    quiet_uninstall: Option<String>,
    estimated_kb: Option<u32>,
}

#[cfg(windows)]
const UNINSTALL_PATH: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

/// 合并 64/32 位视图，读一次注册表供列表、引用保护与卸载共用。
#[cfg(windows)]
fn registry_entries() -> Vec<UninstallEntry> {
    use winreg::enums::{KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    use winreg::RegKey;

    let sources = [
        (Hive::Current, KEY_READ | KEY_WOW64_64KEY),
        (Hive::Current, KEY_READ | KEY_WOW64_32KEY),
        (Hive::Machine, KEY_READ | KEY_WOW64_64KEY),
        (Hive::Machine, KEY_READ | KEY_WOW64_32KEY),
    ];
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    for (hive, flags) in sources {
        let Ok(root) = RegKey::predef(hive.root()).open_subkey_with_flags(UNINSTALL_PATH, flags)
        else {
            continue;
        };
        for key_name in root.enum_keys().flatten() {
            let Ok(key) = root.open_subkey_with_flags(&key_name, flags) else {
                continue;
            };
            let name = key
                .get_value::<String, _>("DisplayName")
                .ok()
                .map(|value| value.trim().to_string())
                .unwrap_or_default();
            if name.is_empty() || is_update_name(&name) || is_hidden_entry(&key) {
                continue;
            }
            let uninstall = read_string(&key, "UninstallString");
            if uninstall.is_none()
                && key
                    .get_value::<String, _>("InstallLocation")
                    .map(|value| value.trim().is_empty())
                    .unwrap_or(true)
                && key.get_value::<String, _>("DisplayIcon").is_err()
            {
                continue;
            }
            let id = stable_app_id(&key_name);
            if !seen.insert(id.clone()) {
                continue;
            }
            entries.push(UninstallEntry {
                id,
                hive,
                flags,
                key_name,
                name,
                publisher: read_string(&key, "Publisher"),
                version: read_string(&key, "DisplayVersion"),
                install_location: read_string(&key, "InstallLocation"),
                display_icon: read_string(&key, "DisplayIcon"),
                uninstall,
                quiet_uninstall: read_string(&key, "QuietUninstallString"),
                estimated_kb: key.get_value::<u32, _>("EstimatedSize").ok(),
            });
        }
    }
    entries
}

#[cfg(windows)]
fn read_string(key: &winreg::RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(windows)]
fn is_hidden_entry(key: &winreg::RegKey) -> bool {
    if key
        .get_value::<u32, _>("SystemComponent")
        .map(|value| value == 1)
        .unwrap_or(false)
    {
        return true;
    }
    if key
        .get_value::<u32, _>("NoRemove")
        .map(|value| value == 1)
        .unwrap_or(false)
    {
        return true;
    }
    if key
        .get_value::<String, _>("ParentKeyName")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    key.get_value::<String, _>("ReleaseType")
        .map(|value| {
            let lower = value.to_lowercase();
            lower.contains("update") || lower.contains("hotfix")
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_update_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.starts_with("update for")
        || lower.starts_with("hotfix for")
        || lower.starts_with("security update for")
    {
        return true;
    }
    match lower.strip_prefix("kb") {
        Some(rest) if !rest.is_empty() => rest
            .chars()
            .all(|ch| ch.is_ascii_digit() || ch == ' ' || ch == '(' || ch == ')'),
        _ => false,
    }
}

#[cfg(windows)]
fn stable_app_id(key_name: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key_name.to_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("cleanup-app-{hash:016x}")
}

#[cfg(windows)]
fn list_windows() -> Vec<CleanupApp> {
    let mut apps: Vec<CleanupApp> = registry_entries()
        .into_iter()
        .filter(|entry| entry.uninstall.is_some())
        .map(|entry| CleanupApp {
            id: entry.id,
            name: entry.name,
            publisher: entry.publisher,
            version: entry.version,
            install_location: entry
                .install_location
                .as_deref()
                .and_then(clean_dir)
                .map(|path| path.to_string_lossy().to_string())
                .or_else(|| {
                    entry
                        .display_icon
                        .as_deref()
                        .and_then(extract_path)
                        .and_then(|exe| exe.parent().map(|parent| parent.to_string_lossy().to_string()))
                }),
            size_bytes: entry.estimated_kb.map(|kb| u64::from(kb) * 1024).unwrap_or(0),
            scope: entry.hive.label().to_string(),
            icon_path: entry
                .display_icon
                .as_deref()
                .and_then(extract_path)
                .map(|path| path.to_string_lossy().to_string()),
            quiet: entry.quiet_uninstall.is_some(),
            uninstallable: true,
        })
        .collect();
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

#[cfg(windows)]
fn uninstall_windows(id: &str, remove_leftovers: bool) -> Result<UninstallReport, String> {
    let entry = registry_entries()
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "应用不存在或已经被卸载".to_string())?;
    let raw = entry
        .uninstall
        .clone()
        .ok_or_else(|| "该应用没有可用的卸载命令".to_string())?;
    let command = if remove_leftovers {
        entry.quiet_uninstall.clone().unwrap_or(raw)
    } else {
        raw
    };
    let (program, args) = build_command(&command, remove_leftovers)?;
    validate_program(&program)?;

    use std::os::windows::process::CommandExt;
    let mut process = Command::new(&program);
    process
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000);
    let mut child = process
        .spawn()
        .map_err(|error| format!("无法启动卸载程序：{error}"))?;
    let deadline = Instant::now() + Duration::from_secs(UNINSTALL_TIMEOUT_SECS);
    let mut timed_out = false;
    let exit_code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(_) => break None,
        }
    };

    let mut report = UninstallReport {
        app_name: entry.name.clone(),
        exit_code,
        timed_out,
        removed_dirs: Vec::new(),
        freed_bytes: 0,
        files: 0,
        registry_removed: false,
        recycled: false,
        errors: Vec::new(),
    };
    let success = exit_code
        .map(|code| matches!(code, 0 | 1641 | 3010))
        .unwrap_or(false);
    if !success {
        report.errors.push(if timed_out {
            format!(
                "卸载程序超过 {} 分钟未结束，已终止；未删除任何文件夹",
                UNINSTALL_TIMEOUT_SECS / 60
            )
        } else {
            match exit_code {
                Some(code) => format!("卸载程序退出码 {code}，未删除任何文件夹"),
                None => "卸载程序未能正常结束，未删除任何文件夹".to_string(),
            }
        });
        return Ok(report);
    }
    if !remove_leftovers {
        return Ok(report);
    }

    // 等待卸载程序释放文件句柄，再核对引用并删除安装目录。
    std::thread::sleep(Duration::from_millis(1200));
    let Some(references) = collect_references(Some(&entry.id)) else {
        report
            .errors
            .push("无法核对开始菜单与运行中进程引用，已跳过文件夹删除".to_string());
        return Ok(report);
    };
    for raw_dir in leftover_dirs(&entry) {
        let path = Path::new(&raw_dir);
        // 卸载程序已经删掉目录时不必再报错。
        if !path.exists() {
            continue;
        }
        match removable_dir(path, &entry, &references) {
            Ok(()) => {
                let result = crate::force_delete::delete_tree_forced(path);
                report.freed_bytes += result.freed_bytes;
                report.files += result.files;
                if result.errors.is_empty() {
                    report.removed_dirs.push(raw_dir);
                } else {
                    report.errors.extend(
                        result
                            .errors
                            .iter()
                            .map(|reason| format!("{raw_dir}：{reason}")),
                    );
                    if result.pending > 0 {
                        report.removed_dirs.push(format!("{raw_dir}（重启后删除）"));
                    }
                }
            }
            Err(reason) => report.errors.push(format!("{raw_dir}：{reason}")),
        }
    }
    report.registry_removed = delete_entry_key(&entry);
    Ok(report)
}

#[cfg(windows)]
fn build_command(raw: &str, silent: bool) -> Result<(PathBuf, Vec<String>), String> {
    let (program, mut args) = split_command_line(raw)?;
    if silent {
        let name = program
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();
        if name == "msiexec.exe" {
            for arg in &mut args {
                if arg
                    .get(..2)
                    .map(|prefix| prefix.eq_ignore_ascii_case("/i"))
                    .unwrap_or(false)
                {
                    arg.replace_range(..2, "/X");
                }
            }
            if !args
                .iter()
                .any(|arg| arg.eq_ignore_ascii_case("/qn") || arg.eq_ignore_ascii_case("/quiet"))
            {
                args.push("/qn".to_string());
            }
            if !args.iter().any(|arg| arg.eq_ignore_ascii_case("/norestart")) {
                args.push("/norestart".to_string());
            }
        } else if name.starts_with("unins") && name.ends_with(".exe") {
            if !args
                .iter()
                .any(|arg| arg.eq_ignore_ascii_case("/VERYSILENT"))
            {
                args.push("/VERYSILENT".to_string());
                args.push("/SUPPRESSMSGBOXES".to_string());
                args.push("/NORESTART".to_string());
            }
        }
    }
    Ok((program, args))
}

#[cfg(windows)]
fn split_command_line(raw: &str) -> Result<(PathBuf, Vec<String>), String> {
    let text = expand_env(raw.trim());
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for ch in text.chars() {
        match ch {
            '"' => quoted = !quoted,
            ' ' | '\t' if !quoted => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    let program = parts
        .first()
        .map(|value| PathBuf::from(value.trim_matches('"')))
        .ok_or_else(|| "卸载命令为空".to_string())?;
    if !program.is_absolute() {
        return Err("卸载命令不是绝对路径，已拒绝执行".to_string());
    }
    Ok((program, parts.iter().skip(1).cloned().collect()))
}

#[cfg(windows)]
fn validate_program(program: &Path) -> Result<(), String> {
    if !program.is_file() {
        return Err(format!("卸载程序不存在：{}", program.display()));
    }
    let name = program
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if matches!(
        name.as_str(),
        "cmd.exe" | "powershell.exe" | "pwsh.exe" | "wscript.exe" | "cscript.exe" | "mshta.exe"
    ) {
        return Err("出于安全考虑，不执行脚本解释器形式的卸载命令".to_string());
    }
    if name != "msiexec.exe" && name != "rundll32.exe" {
        if let Some(system_root) = std::env::var_os("SystemRoot") {
            let system32 = normalize_path(&PathBuf::from(system_root).join("System32"));
            if normalize_path(program).starts_with(&format!("{system32}\\")) {
                return Err("不执行系统目录中的卸载程序".to_string());
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn leftover_dirs(entry: &UninstallEntry) -> Vec<String> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(path) = entry.install_location.as_deref().and_then(clean_dir) {
        dirs.push(path);
    }
    if let Some(parent) = entry
        .display_icon
        .as_deref()
        .and_then(extract_path)
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        dirs.push(parent);
    }
    dirs.sort_by_key(|path| path.components().count());
    let mut unique: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        if unique.iter().any(|parent| dir.starts_with(parent)) {
            continue;
        }
        unique.push(dir);
    }
    unique
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[cfg(windows)]
fn removable_dir(path: &Path, entry: &UninstallEntry, references: &References) -> Result<(), String> {
    let Some((_, root)) = install_roots()
        .into_iter()
        .find(|(_, root)| path.starts_with(root))
    else {
        return Err("不在允许清理的安装目录中".to_string());
    };
    if normalize_path(path) == normalize_path(&root) {
        return Err("不能删除安装根目录".to_string());
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.file_type().is_dir()
        || metadata.file_type().is_symlink()
        || is_reparse(&metadata)
    {
        return Err("不是普通文件夹".to_string());
    }
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    if is_protected_name(&name) {
        return Err("受保护的目录名".to_string());
    }
    let relative: Vec<_> = path
        .strip_prefix(&root)
        .map(|relative| relative.components().collect())
        .unwrap_or_default();
    if relative.is_empty() || relative.len() > 2 {
        return Err("目录层级过深，需要手动清理".to_string());
    }
    if relative.len() == 2 {
        let vendor = relative[0].as_os_str().to_string_lossy().to_lowercase();
        let mut tokens = name_tokens(&entry.name);
        if let Some(publisher) = &entry.publisher {
            tokens.extend(name_tokens(publisher));
        }
        if !tokens.iter().any(|token| vendor.contains(token.as_str())) {
            return Err("上级目录不属于该应用，避免误删".to_string());
        }
    }
    if references.matches_path(path) || references.matches_name(&name) {
        return Err("仍被其它应用、快捷方式或进程引用".to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn delete_entry_key(entry: &UninstallEntry) -> bool {
    use winreg::enums::KEY_WRITE;
    use winreg::RegKey;

    // RegDeleteTree 需要父键带 DELETE 访问权限。
    const DELETE_ACCESS: u32 = 0x0001_0000;
    let Ok(root) = RegKey::predef(entry.hive.root())
        .open_subkey_with_flags(UNINSTALL_PATH, entry.flags | KEY_WRITE | DELETE_ACCESS)
    else {
        return false;
    };
    match root.delete_subkey_all(&entry.key_name) {
        Ok(()) => true,
        // 卸载程序通常已经删掉了这项，找不到也视为清理完成。
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
    }
}

#[cfg(windows)]
fn clean_dir(value: &str) -> Option<PathBuf> {
    let expanded = expand_env(value.trim());
    let text = expanded.trim().trim_matches('"').trim();
    if text.is_empty() {
        return None;
    }
    let path = PathBuf::from(text);
    path.is_absolute().then_some(path)
}

#[cfg(windows)]
fn probe_running_paths() -> Option<(Vec<String>, Vec<String>, bool)> {
    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
        $ProgressPreference='SilentlyContinue'; \
        $shortcutsOk=$true; $processesOk=$true; \
        $shortcuts=@(); \
        try { $ws=New-Object -ComObject WScript.Shell; \
            Get-ChildItem \"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\", \
                \"$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\" \
                -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { \
                try { $target=$ws.CreateShortcut($_.FullName).TargetPath; \
                    if ($target) { $shortcuts += $target } } catch {} } } catch { $shortcutsOk=$false }; \
        $processes=@(); \
        try { Get-Process -ErrorAction SilentlyContinue | ForEach-Object { \
            try { if ($_.Path) { $processes += $_.Path } } catch {} } } catch { $processesOk=$false }; \
        [pscustomobject]@{ shortcuts=$shortcuts; processes=$processes; \
            shortcutsOk=$shortcutsOk; processesOk=$processesOk } | \
            ConvertTo-Json -Compress";

    let stdout = crate::powershell::run_encoded(script)?;
    let value: serde_json::Value = serde_json::from_slice(&stdout).ok()?;
    let list = |key: &str| -> Vec<String> {
        match value.get(key) {
            Some(serde_json::Value::Array(items)) => items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect(),
            Some(serde_json::Value::String(item)) => vec![item.clone()],
            _ => Vec::new(),
        }
    };
    let ok = |key: &str| value.get(key).and_then(|item| item.as_bool()).unwrap_or(false);
    Some((list("shortcuts"), list("processes"), ok("shortcutsOk") && ok("processesOk")))
}

fn extract_path(value: &str) -> Option<PathBuf> {
    let expanded = expand_env(value.trim());
    let text = expanded.trim();
    if text.is_empty() {
        return None;
    }
    let candidate = if let Some(rest) = text.strip_prefix('"') {
        rest.split('"').next().unwrap_or("").to_string()
    } else if let Some(index) = text.to_lowercase().find(".exe") {
        text[..index + 4].to_string()
    } else {
        text.split(" /").next()?.trim().to_string()
    };
    let candidate = candidate.trim().trim_matches('"');
    if candidate.is_empty() {
        return None;
    }
    let path = PathBuf::from(candidate.trim_end_matches(",0"));
    if path.is_absolute() {
        Some(path)
    } else {
        None
    }
}

fn expand_env(value: &str) -> String {
    let mut result = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        result.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            result.push_str(&rest[start..]);
            return result;
        };
        let name = &after[..end];
        match std::env::var(name) {
            Ok(value) => result.push_str(&value),
            Err(_) => {
                result.push('%');
                result.push_str(name);
                result.push('%');
            }
        }
        rest = &after[end + 1..];
    }
    result.push_str(rest);
    result
}

fn stable_id(path: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in normalize_path(path).bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("cleanup-{hash:016x}")
}

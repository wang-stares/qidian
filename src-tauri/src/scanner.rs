use crate::models::{
    AppEntry, AppSource, LaunchTarget, ScanCache, ScanOptions, ScanProgress, ScannedApp,
};
use crate::store::{self, Paths};
use std::collections::{HashMap, HashSet};
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;
#[cfg(windows)]
use std::time::Instant;
use tauri::{AppHandle, Emitter};

pub struct ScanOutcome {
    pub apps: Vec<ScannedApp>,
    pub scanned_at: u64,
    pub duration_ms: u64,
}

/// 缓存结构版本。扫描逻辑影响条目合并或目标格式时递增，
/// 旧缓存会在下次启动时被忽略并自动重扫一次。
pub const CACHE_SCHEMA: u32 = 7;

pub fn scan(paths: &Paths, options: &ScanOptions, app: &AppHandle) -> Result<ScanOutcome, String> {
    #[cfg(windows)]
    {
        scan_windows(paths, options, app)
    }
    #[cfg(not(windows))]
    {
        let _ = (paths, options, app);
        Err("启点目前只支持 Windows".to_string())
    }
}

#[cfg(windows)]
fn scan_windows(
    paths: &Paths,
    options: &ScanOptions,
    app: &AppHandle,
) -> Result<ScanOutcome, String> {
    let started = Instant::now();
    // 解析开始菜单快捷方式需要 COM；扫描线程只初始化一次，后续逐个读取 .lnk 目标。
    unsafe {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let mut accumulator = Accumulator::default();
    let scan_uwp = options.scan_uwp;
    let include_system = options.include_system_apps;

    emit_progress(app, "shortcuts", 0, 0.04);
    let shortcuts = collect_shortcuts();
    // 快捷方式解析、卸载注册表与 Store 应用三路并行，扫描耗时从相加变成取最大值。
    let (shortcut_count, registry, uwp) = std::thread::scope(|scope| {
        let registry_handle = scope.spawn(collect_registry);
        let uwp_handle =
            scan_uwp.then(|| scope.spawn(move || collect_uwp(include_system)));
        let shortcut_count = push_shortcuts(&mut accumulator, &shortcuts);
        let registry = registry_handle.join().unwrap_or_default();
        let uwp = uwp_handle
            .map(|handle| handle.join().unwrap_or_default())
            .unwrap_or_default();
        (shortcut_count, registry, uwp)
    });
    emit_progress(app, "shortcuts", shortcut_count, 0.35);

    merge_registry(&mut accumulator, registry);
    emit_progress(app, "registry", accumulator.entries.len(), 0.7);

    let has_uwp = !uwp.is_empty();
    for (name, aumid) in uwp {
        if name.is_empty() || aumid.is_empty() || is_junk_name(&name) {
            continue;
        }
        let category = classify(&name, "", &aumid);
        accumulator.push(
            &name,
            category,
            AppSource::Uwp,
            LaunchTarget::Uwp { aumid },
            None,
            None,
            None,
            None,
        );
    }
    if has_uwp {
        // 系统目录里的 UWP 执行别名存根（如 SnippingTool.exe）与 Store 条目是同一应用，
        // 已在 WindowsApps 中声明别名时保留 Store 条目，避免同一应用出现两次。
        accumulator.entries.retain(|app| {
            if matches!(app.target, LaunchTarget::Uwp { .. }) {
                return true;
            }
            let LaunchTarget::Executable { path, .. } = &app.target else {
                return true;
            };
            let Some(stem) = Path::new(path).file_stem().and_then(|value| value.to_str())
            else {
                return true;
            };
            !is_system_stub_path(path) || !windowsapps_alias_exists(stem)
        });
    }
    emit_progress(app, "uwp", accumulator.entries.len(), 0.88);

    for scanned in &mut accumulator.entries {
        let hint = target_hint(&scanned.target);
        let publisher = scanned.entry.publisher.as_deref().unwrap_or("");
        scanned.entry.category = classify(&scanned.entry.name, publisher, &hint).to_string();
    }
    emit_progress(app, "classify", accumulator.entries.len(), 0.9);

    let mut apps = accumulator.entries;
    apps.sort_by(|a, b| {
        a.entry
            .name
            .to_lowercase()
            .cmp(&b.entry.name.to_lowercase())
    });

    let scanned_at = store::now_millis();
    let cache = ScanCache {
        schema: CACHE_SCHEMA,
        scanned_at,
        apps: apps.clone(),
    };
    let _ = store::save_cache(paths, &cache);

    emit_progress(app, "done", apps.len(), 1.0);
    Ok(ScanOutcome {
        apps,
        scanned_at,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(windows)]
fn emit_progress(app: &AppHandle, phase: &str, found: usize, percent: f64) {
    let _ = app.emit(
        "scan-progress",
        ScanProgress {
            phase: phase.to_string(),
            found,
            percent,
        },
    );
}

#[cfg(windows)]
#[derive(Default)]
struct Accumulator {
    entries: Vec<ScannedApp>,
    names: HashMap<String, usize>,
    targets: HashMap<String, usize>,
    ids: HashSet<String>,
}

#[cfg(windows)]
impl Accumulator {
    #[allow(clippy::too_many_arguments)]
    fn push(
        &mut self,
        name: &str,
        category: &str,
        source: AppSource,
        target: LaunchTarget,
        publisher: Option<String>,
        version: Option<String>,
        install_location: Option<String>,
        shortcut_path: Option<String>,
    ) -> Option<usize> {
        let display = strip_scope_suffix(name);
        let normalized = normalize_name(&display);
        let dedupe = dedupe_name(name);
        if normalized.is_empty() || dedupe.is_empty() {
            return None;
        }

        // 同一目标（同一 exe / 同一快捷方式 / 同一 AUMID）或去掉范围后缀后同名，
        // 视为同一应用，只保留一条并优先使用更干净的显示名。
        let key = target_key(&target);
        if let Some(index) = self
            .targets
            .get(&key)
            .or_else(|| self.names.get(&dedupe))
            .copied()
        {
            self.prefer_name(index, &display);
            self.targets.entry(key).or_insert(index);
            return None;
        }

        let base_id = make_id(source_key(source), &normalized);
        let mut id = base_id.clone();
        let mut suffix = 2;
        while self.ids.contains(&id) {
            id = format!("{base_id}-{suffix}");
            suffix += 1;
        }
        self.ids.insert(id.clone());
        let index = self.entries.len();
        self.names.insert(dedupe, index);
        self.targets.insert(key, index);
        self.entries.push(ScannedApp {
            entry: AppEntry {
                id,
                name: display,
                category: category.to_string(),
                publisher,
                version,
                source,
                install_location,
                shortcut_path,
                launchable: true,
            },
            target,
        });
        Some(index)
    }

    fn find(&self, name: &str) -> Option<usize> {
        self.names.get(&dedupe_name(name)).copied()
    }

    fn find_target(&self, target: &LaunchTarget) -> Option<usize> {
        self.targets.get(&target_key(target)).copied()
    }

    /// 同名或同目标重复时保留更短、不带 (User)/(x64) 等范围后缀的显示名。
    fn prefer_name(&mut self, index: usize, candidate: &str) {
        let entry = &mut self.entries[index].entry;
        if name_penalty(candidate) < name_penalty(&entry.name) {
            entry.name = candidate.to_string();
        }
    }
}

/* ── shortcuts ────────────────────────────────────────────────── */

#[cfg(windows)]
struct ShortcutCandidate {
    name: String,
    path: String,
    source: AppSource,
}

/// 收集开始菜单、桌面与任务栏固定项里的所有快捷方式。
#[cfg(windows)]
fn collect_shortcuts() -> Vec<ShortcutCandidate> {
    let mut candidates = Vec::new();
    for root in start_menu_roots() {
        walk_shortcut_files(&root, 0, 6, AppSource::StartMenu, true, &mut candidates);
    }
    for root in desktop_roots() {
        walk_shortcut_files(&root, 0, 2, AppSource::Desktop, false, &mut candidates);
    }
    for root in taskbar_roots() {
        walk_shortcut_files(&root, 0, 1, AppSource::Desktop, false, &mut candidates);
    }
    candidates
}

#[cfg(windows)]
fn start_menu_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    // 开始菜单目录可能被用户改到别处，优先读注册表里的真实路径。
    roots.extend(user_shell_folder("Programs"));
    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(program_data) = std::env::var("ProgramData") {
        roots.push(PathBuf::from(program_data).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    // 管理员权限下补齐其它账户的开始菜单，避免切换账户安装的应用漏扫。
    for profile in user_profile_dirs() {
        roots.push(profile.join(r"AppData\Roaming\Microsoft\Windows\Start Menu\Programs"));
    }
    dedupe_roots(&mut roots);
    roots
}

#[cfg(windows)]
fn desktop_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    // 桌面常被 OneDrive 重定向，注册表路径才是用户真正看到的那一个。
    roots.extend(user_shell_folder("Desktop"));
    if let Ok(profile) = std::env::var("USERPROFILE") {
        roots.push(PathBuf::from(profile).join("Desktop"));
    }
    if let Ok(public) = std::env::var("PUBLIC") {
        roots.push(PathBuf::from(public).join("Desktop"));
    }
    for profile in user_profile_dirs() {
        roots.push(profile.join("Desktop"));
    }
    dedupe_roots(&mut roots);
    roots
}

#[cfg(windows)]
fn user_shell_folder(name: &str) -> Option<PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders")
        .ok()?;
    let raw = key.get_value::<String, _>(name).ok()?;
    let path = PathBuf::from(expand_env_vars(raw.trim()));
    path.is_dir().then_some(path)
}

/// 枚举所有用户配置目录；无权限或读不到的子项直接跳过。
#[cfg(windows)]
fn user_profile_dirs() -> Vec<PathBuf> {
    let Some(users_root) = std::env::var("PUBLIC")
        .ok()
        .and_then(|public| Path::new(&public).parent().map(Path::to_path_buf))
    else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(users_root) else {
        return Vec::new();
    };
    let mut profiles = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if matches!(
            name.as_str(),
            "public" | "default" | "default user" | "all users" | "defaultuser0"
        ) {
            continue;
        }
        profiles.push(path);
    }
    profiles.sort();
    profiles
}

#[cfg(windows)]
fn dedupe_roots(roots: &mut Vec<PathBuf>) {
    let mut seen = HashSet::new();
    roots.retain(|path| path.is_dir() && seen.insert(path.to_string_lossy().to_lowercase()));
}

#[cfg(windows)]
fn taskbar_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push(
            PathBuf::from(appdata)
                .join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"),
        );
    }
    roots.retain(|path| path.is_dir());
    roots
}

#[cfg(windows)]
fn walk_shortcut_files(
    dir: &Path,
    depth: u8,
    max_depth: u8,
    source: AppSource,
    skip_startup: bool,
    out: &mut Vec<ShortcutCandidate>,
) {
    if depth > max_depth {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_shortcut_files(&path, depth + 1, max_depth, source, skip_startup, out);
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !extension.eq_ignore_ascii_case("lnk") {
            continue;
        }
        let path_text = path.to_string_lossy().to_string();
        if skip_startup && path_text.to_lowercase().contains(r"\startup\") {
            continue;
        }
        let raw_name = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let name = strip_shortcut_suffix(&raw_name);
        if name.is_empty() || is_junk_name(&name) {
            continue;
        }
        out.push(ShortcutCandidate {
            name,
            path: path_text,
            source,
        });
    }
}

/// 并行解析快捷方式目标，再按固定顺序写入索引，保证名称与去重结果稳定。
#[cfg(windows)]
fn push_shortcuts(
    accumulator: &mut Accumulator,
    candidates: &[ShortcutCandidate],
) -> usize {
    if candidates.is_empty() {
        return 0;
    }
    let workers = candidates.len().min(4).max(1);
    let chunk_size = candidates.len().div_ceil(workers);
    let resolved: Vec<(&ShortcutCandidate, ShortcutTarget)> = std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(workers);
        for chunk in candidates.chunks(chunk_size) {
            handles.push(scope.spawn(move || {
                use windows::Win32::System::Com::{
                    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
                };
                let initialized =
                    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
                let items = chunk
                    .iter()
                    .map(|candidate| (candidate, resolve_shortcut(&candidate.path, &candidate.name)))
                    .collect::<Vec<_>>();
                if initialized {
                    unsafe { CoUninitialize() };
                }
                items
            }));
        }
        let mut items = Vec::with_capacity(candidates.len());
        for handle in handles {
            if let Ok(part) = handle.join() {
                items.extend(part);
            }
        }
        items
    });

    let mut count = 0;
    for (candidate, target) in resolved {
        // 目标明确不存在或不是应用时跳过；无法解析的广告式快捷方式仍按 .lnk 启动。
        let launch = match target {
            ShortcutTarget::Resolved(target) => target,
            ShortcutTarget::Unresolved => LaunchTarget::Shortcut {
                path: candidate.path.clone(),
            },
            ShortcutTarget::Missing => continue,
        };
        let category = classify(&candidate.name, "", &candidate.path);
        if accumulator
            .push(
                &candidate.name,
                category,
                candidate.source,
                launch,
                None,
                None,
                None,
                Some(candidate.path.clone()),
            )
            .is_some()
        {
            count += 1;
        }
    }
    count
}

/// 桌面与开始菜单里可能混入文档、文件夹快捷方式，只接受可执行目标。
#[cfg(windows)]
fn is_app_target(path: &str) -> bool {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    matches!(extension.as_str(), "exe" | "com" | "bat" | "cmd" | "msc")
}

/// 判断可执行文件名（不含扩展名，小写）是否是卸载程序。
/// 覆盖 uninstall / uninstaller / uninst / unins000~unins999 / auxunin / 卸载* 等常见命名。
#[cfg(windows)]
fn is_uninstaller_stem(stem: &str) -> bool {
    let lower = stem.to_lowercase();
    lower.starts_with("unins")
        || lower == "auxunin"
        || lower.starts_with("uninstall")
        || lower.starts_with("卸载")
}

/// 判断一个可执行文件路径是否指向卸载程序（按文件名或所在目录）。
#[cfg(windows)]
fn is_uninstaller_path(path: &str) -> bool {
    if is_uninstaller_stem(
        Path::new(path)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default(),
    ) {
        return true;
    }
    // 少数卸载器会放在 uninstall 子目录里（如 uninstall\auxunin.exe）。
    Path::new(path)
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|value| value.to_str())
        .map(|dir| dir.to_lowercase().starts_with("unins"))
        .unwrap_or(false)
}

/// 安装/修复/运行时等辅助可执行文件，不适合作为应用启动目标。
#[cfg(windows)]
fn is_auxiliary_exe(stem: &str) -> bool {
    let lower = stem.to_lowercase();
    if is_uninstaller_stem(&lower) {
        return true;
    }
    const AUX: &[&str] = &[
        "setup",
        "install",
        "update",
        "repair",
        "vcredist",
        "redist",
        "dxsetup",
        "dotnet",
        "eula",
        "readme",
    ];
    AUX.iter().any(|word| lower.contains(word))
}

/// 递归收集目录下的 exe（最多两层子目录），跳过卸载/更新等辅助目录。
#[cfg(windows)]
fn collect_executables(dir: &Path, remaining: u32, out: &mut Vec<(PathBuf, u64)>) {
    if out.len() >= 2000 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            if remaining == 0 {
                continue;
            }
            let lower = entry.file_name().to_string_lossy().to_lowercase();
            if lower.starts_with("unins")
                || lower.contains("uninstall")
                || matches!(lower.as_str(), "update" | "updates" | "installer")
            {
                continue;
            }
            collect_executables(&path, remaining - 1, out);
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if extension.eq_ignore_ascii_case("exe") {
            out.push((path, metadata.len()));
        }
    }
}

/// 安装根、Program Files、系统目录这类泛化路径不适合用来挑主程序。
#[cfg(windows)]
fn is_generic_install_dir(dir: &Path) -> bool {
    let Some(name) = dir.file_name().and_then(|value| value.to_str()) else {
        return true;
    };
    let lower = name.to_lowercase();
    matches!(
        lower.as_str(),
        "program files"
            | "program files (x86)"
            | "windows"
            | "users"
            | "programdata"
            | "appdata"
            | "local"
            | "roaming"
            | "system32"
            | "syswow64"
            | "temp"
    ) || dir.parent().is_none()
}

/// 从 InstallLocation、图标/卸载器所在目录及其上一级构造候选目录。
#[cfg(windows)]
fn candidate_install_dirs(
    install_location: Option<&str>,
    icon_exe: Option<&str>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut push = |dir: &Path| {
        if !dir.is_dir() || is_generic_install_dir(dir) {
            return;
        }
        let lower = dir.to_string_lossy().to_lowercase();
        if dirs.iter().any(|item| item.to_string_lossy().to_lowercase() == lower) {
            return;
        }
        dirs.push(dir.to_path_buf());
    };
    if let Some(location) = install_location {
        push(Path::new(location));
    }
    if let Some(exe) = icon_exe {
        let path = Path::new(exe);
        if let Some(parent) = path.parent() {
            push(parent);
            if let Some(grand) = parent.parent() {
                push(grand);
            }
        }
    }
    dirs
}

/// 在安装目录里挑选主程序：递归两层子目录，按应用名分词、厂商标识、
/// 文件体积综合打分，排除卸载器 / 安装器 / 更新器 / 服务等辅助程序。
#[cfg(windows)]
fn pick_main_executable(
    dir: &Path,
    display_name: &str,
    publisher: Option<&str>,
) -> Option<String> {
    if !dir.is_dir() {
        return None;
    }
    let mut candidates: Vec<(PathBuf, u64)> = Vec::new();
    collect_executables(dir, 2, &mut candidates);
    if candidates.is_empty() {
        return None;
    }

    const BRANDS: &[&str] = &[
        "xiaomi",
        "redmi",
        "miconnect",
        "mi connect",
        "milink",
        "miread",
        "mihome",
        "miui",
    ];
    let name_lower = display_name.to_lowercase();
    let words: Vec<String> = name_lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| word.len() >= 3 && *word != "beta" && *word != "preview")
        .map(str::to_string)
        .collect();
    let vendor_lower = format!("{name_lower} {}", publisher.unwrap_or_default().to_lowercase());
    let brand = display_name.contains("小米")
        || BRANDS.iter().any(|token| vendor_lower.contains(token));

    let mut best: Option<(i64, String)> = None;
    for (path, size) in candidates {
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();
        if is_auxiliary_exe(&stem) {
            continue;
        }
        let mut score = 0i64;
        if words.iter().any(|word| stem.contains(word)) {
            score += 400;
        }
        if brand && BRANDS.iter().any(|token| stem.contains(token)) {
            score += 300;
        }
        // 后台服务、崩溃上报、遥测等组件通常不是用户点击的主程序。
        if stem.contains("service")
            || stem.contains("daemon")
            || stem.contains("crash")
            || stem.contains("telemetry")
            || stem.contains("helper")
        {
            score -= 250;
        }
        // 主程序通常体积更大，且更靠近安装根目录。
        score += (size / (1024 * 1024)).min(200) as i64;
        if best.as_ref().map(|(top, _)| score > *top).unwrap_or(true) {
            best = Some((score, path.to_string_lossy().to_string()));
        }
    }
    best.map(|(_, path)| path)
}

#[cfg(windows)]
fn strip_shortcut_suffix(name: &str) -> String {
    let lower = name.to_lowercase();
    for suffix in [" - shortcut", " - 快捷方式", " shortcut", " 快捷方式"] {
        if lower.ends_with(suffix) {
            return name[..name.len() - suffix.len()].trim().to_string();
        }
    }
    name.to_string()
}

/* ── registry ─────────────────────────────────────────────────── */

/// 快捷方式解析结果：成功拿到真实目标、无法解析（保留 .lnk 启动）、目标缺失（跳过）。
#[cfg(windows)]
enum ShortcutTarget {
    Resolved(LaunchTarget),
    Unresolved,
    Missing,
}

/// 读取 .lnk 的真实启动目标。
#[cfg(windows)]
fn resolve_shortcut(path: &str, display_name: &str) -> ShortcutTarget {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_UNCPRIORITY};

    unsafe {
        let Some(link) = CoCreateInstance::<_, IShellLinkW>(
            &ShellLink,
            None,
            CLSCTX_INPROC_SERVER,
        )
        .ok() else {
            return ShortcutTarget::Unresolved;
        };
        let Some(persist) = link.cast::<IPersistFile>().ok() else {
            return ShortcutTarget::Unresolved;
        };
        if persist.Load(&HSTRING::from(path), STGM(0)).is_err() {
            return ShortcutTarget::Unresolved;
        }

        let mut buffer = vec![0u16; 32768];
        // UNCPRIORITY 会展开环境变量并优先返回 UNC 路径，便于直接做存在性校验。
        if link
            .GetPath(&mut buffer, std::ptr::null_mut(), SLGP_UNCPRIORITY.0 as u32)
            .is_err()
        {
            return ShortcutTarget::Unresolved;
        }
        let length = buffer.iter().position(|unit| *unit == 0).unwrap_or(0);
        if length == 0 {
            return ShortcutTarget::Unresolved;
        }
        let exe = String::from_utf16_lossy(&buffer[..length]);
        if !Path::new(&exe).is_file() || !is_app_target(&exe) {
            return ShortcutTarget::Missing;
        }
        // 快捷方式指向卸载程序（部分厂商把开始菜单项错误地指向 unins.exe）时，
        // 从卸载器所在目录及其上一级反推主程序；反推不到才跳过。
        if is_uninstaller_path(&exe) {
            let fallback = Path::new(&exe).parent().and_then(|dir| {
                pick_main_executable(dir, display_name, None).or_else(|| {
                    dir.parent()
                        .filter(|parent| !is_generic_install_dir(parent))
                        .and_then(|parent| pick_main_executable(parent, display_name, None))
                })
            });
            let Some(fallback) = fallback else {
                return ShortcutTarget::Missing;
            };
            let workdir = Path::new(&fallback)
                .parent()
                .map(|parent| parent.to_string_lossy().to_string());
            return ShortcutTarget::Resolved(LaunchTarget::Executable {
                path: fallback,
                args: None,
                workdir,
            });
        }

        let mut args_buffer = vec![0u16; 8192];
        let args = match link.GetArguments(&mut args_buffer) {
            Ok(()) => {
                let length = args_buffer.iter().position(|unit| *unit == 0).unwrap_or(0);
                (length > 0).then(|| String::from_utf16_lossy(&args_buffer[..length]))
            }
            Err(_) => None,
        };
        let mut dir_buffer = vec![0u16; 4096];
        let workdir = match link.GetWorkingDirectory(&mut dir_buffer) {
            Ok(()) => {
                let length = dir_buffer.iter().position(|unit| *unit == 0).unwrap_or(0);
                (length > 0).then(|| String::from_utf16_lossy(&dir_buffer[..length]))
            }
            Err(_) => None,
        };
        ShortcutTarget::Resolved(LaunchTarget::Executable {
            path: exe,
            args,
            workdir,
        })
    }
}

#[cfg(windows)]
struct RegistryApp {
    name: String,
    source: AppSource,
    publisher: Option<String>,
    version: Option<String>,
    install_location: Option<String>,
    exe: Option<String>,
}

#[cfg(windows)]
fn collect_registry() -> Vec<RegistryApp> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
    use winreg::RegKey;

    const UNINSTALL: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    const UNINSTALL_WOW: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

    let mut result = Vec::new();
    let sources = [
        (HKEY_LOCAL_MACHINE, UNINSTALL, KEY_READ | KEY_WOW64_64KEY),
        (HKEY_LOCAL_MACHINE, UNINSTALL_WOW, KEY_READ),
        (HKEY_CURRENT_USER, UNINSTALL, KEY_READ),
        (HKEY_CURRENT_USER, UNINSTALL_WOW, KEY_READ),
    ];

    for (root, path, flags) in sources {
        let uninstall = match RegKey::predef(root).open_subkey_with_flags(path, flags) {
            Ok(key) => key,
            Err(_) => continue,
        };
        let subkeys = match uninstall.enum_keys().collect::<Result<Vec<_>, _>>() {
            Ok(keys) => keys,
            Err(_) => continue,
        };
        for subkey in subkeys {
            let key = match uninstall.open_subkey(&subkey) {
                Ok(key) => key,
                Err(_) => continue,
            };
            let name: String = match key.get_value::<String, _>("DisplayName") {
                Ok(value) => value.trim().to_string(),
                Err(_) => continue,
            };
            if name.is_empty() || is_junk_name(&name) {
                continue;
            }
            if is_system_component(&key) || has_parent_key(&key) {
                continue;
            }
            if let Ok(release_type) = key.get_value::<String, _>("ReleaseType") {
                let lower = release_type.to_lowercase();
                if lower.contains("update") || lower.contains("hotfix") {
                    continue;
                }
            }
            let install_location = key
                .get_value::<String, _>("InstallLocation")
                .ok()
                .map(|value| clean_path(&value))
                .filter(|value| !value.is_empty());
            let display_icon: Option<String> = key.get_value("DisplayIcon").ok();
            let publisher = key
                .get_value::<String, _>("Publisher")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let version = key
                .get_value::<String, _>("DisplayVersion")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());

            let icon_exe = display_icon.as_deref().and_then(display_icon_to_exe);
            let mut exe = icon_exe.clone();
            // DisplayIcon 常指向卸载程序（unins000.exe / 卸载.exe 等）而不是主程序，
            // 点这样的条目会直接弹出卸载确认框。此时从 InstallLocation、卸载器所在
            // 目录及其上一级递归反推主程序；反推不到才把 exe 置空，不作为启动入口。
            if exe.as_ref().is_some_and(|path| is_uninstaller_path(path)) {
                exe = None;
            }
            if exe.is_none() && icon_exe.is_some() {
                exe = candidate_install_dirs(install_location.as_deref(), icon_exe.as_deref())
                    .into_iter()
                    .find_map(|dir| {
                        pick_main_executable(&dir, &name, publisher.as_deref())
                    });
            }

            result.push(RegistryApp {
                name,
                source: AppSource::Registry,
                publisher,
                version,
                install_location,
                exe,
            });
        }
    }
    result.extend(collect_app_paths());
    result
}

/// App Paths 里注册的命令即使没有开始菜单快捷方式也能找到，
/// 覆盖 Chrome、部分开发工具与绿色安装程序的常见注册方式。
#[cfg(windows)]
fn collect_app_paths() -> Vec<RegistryApp> {
    use winreg::enums::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
    };
    use winreg::RegKey;

    const APP_PATHS: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths";
    let sources = [
        (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_64KEY),
        (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_32KEY),
        (HKEY_CURRENT_USER, KEY_READ),
    ];
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (root, flags) in sources {
        let Ok(key) = RegKey::predef(root).open_subkey_with_flags(APP_PATHS, flags) else {
            continue;
        };
        let Ok(subkeys) = key.enum_keys().collect::<Result<Vec<_>, _>>() else {
            continue;
        };
        for subkey in subkeys {
            let Ok(entry) = key.open_subkey(&subkey) else {
                continue;
            };
            let raw = entry
                .get_value::<String, _>("")
                .or_else(|_| entry.get_value::<String, _>("Path"))
                .unwrap_or_default();
            let Some(exe) = display_icon_to_exe(&raw) else {
                continue;
            };
            // App Paths 理论上只登记主程序，个别应用也会登记卸载器，过滤掉。
            if is_uninstaller_path(&exe) {
                continue;
            }
            // Windows 自带应用执行别名（如 System32\SnippingTool.exe）会与
            // Store / 开始菜单条目重复，例如「SnippingTool」和「截图工具」。
            if is_windows_alias_path(&exe) {
                continue;
            }
            if !seen.insert(exe.to_lowercase()) {
                continue;
            }
            let name = std::path::Path::new(&exe)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            if name.is_empty() || is_junk_name(&name) {
                continue;
            }
            let install_location = std::path::Path::new(&exe)
                .parent()
                .map(|parent| parent.to_string_lossy().to_string());
            result.push(RegistryApp {
                name,
                source: AppSource::AppPaths,
                publisher: None,
                version: None,
                install_location,
                exe: Some(exe),
            });
        }
    }
    result
}

#[cfg(windows)]
fn is_system_stub_path(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_lowercase();
    let mut roots = Vec::new();
    if let Ok(windir) = std::env::var("SystemRoot") {
        let windir = windir.trim_end_matches(['\\', '/']).to_lowercase();
        roots.push(format!("{windir}\\system32\\"));
        roots.push(format!("{windir}\\syswow64\\"));
    }
    roots.iter().any(|root| normalized.starts_with(root))
}

/// WindowsApps 下存在同名执行别名时，系统目录里的同名 exe 只是 UWP 应用的存根。
#[cfg(windows)]
fn windowsapps_alias_exists(stem: &str) -> bool {
    std::env::var_os("LOCALAPPDATA")
        .map(|local| {
            PathBuf::from(local)
                .join(r"Microsoft\WindowsApps")
                .join(format!("{stem}.exe"))
                .is_file()
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_windows_alias_path(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_lowercase();
    let mut roots = Vec::new();
    if let Ok(windir) = std::env::var("SystemRoot") {
        let windir = windir.trim_end_matches(['\\', '/']).to_lowercase();
        roots.push(format!("{windir}\\system32\\"));
        roots.push(format!("{windir}\\syswow64\\"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let local = local.trim_end_matches(['\\', '/']).to_lowercase();
        roots.push(format!("{local}\\microsoft\\windowsapps\\"));
    }
    roots.iter().any(|root| normalized.starts_with(root))
}

#[cfg(windows)]
fn is_system_component(key: &winreg::RegKey) -> bool {
    if let Ok(value) = key.get_value::<u32, _>("SystemComponent") {
        if value == 1 {
            return true;
        }
    }
    if let Ok(value) = key.get_value::<String, _>("SystemComponent") {
        if value.trim() == "1" {
            return true;
        }
    }
    false
}

#[cfg(windows)]
fn has_parent_key(key: &winreg::RegKey) -> bool {
    key.get_value::<String, _>("ParentKeyName")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

#[cfg(windows)]
fn merge_registry(accumulator: &mut Accumulator, registry: Vec<RegistryApp>) {
    for app in registry {
        let target = app.exe.as_ref().map(|exe| {
            let workdir = app.install_location.clone().or_else(|| {
                Path::new(exe)
                    .parent()
                    .map(|parent| parent.to_string_lossy().to_string())
            });
            LaunchTarget::Executable {
                path: exe.clone(),
                args: None,
                workdir,
            }
        });

        let existing = accumulator
            .find(&app.name)
            .or_else(|| target.as_ref().and_then(|item| accumulator.find_target(item)));
        if let Some(index) = existing {
            accumulator.prefer_name(index, &app.name);
            let entry = &mut accumulator.entries[index].entry;
            if entry.publisher.is_none() {
                entry.publisher = app.publisher;
            }
            if entry.version.is_none() {
                entry.version = app.version;
            }
            if entry.install_location.is_none() {
                entry.install_location = app.install_location;
            }
            continue;
        }

        let (Some(exe), Some(target)) = (app.exe, target) else {
            continue;
        };
        let category = classify(&app.name, app.publisher.as_deref().unwrap_or(""), &exe);
        accumulator.push(
            &app.name,
            category,
            app.source,
            target,
            app.publisher,
            app.version,
            app.install_location,
            None,
        );
    }
}

/* ── Microsoft Store / UWP ────────────────────────────────────── */

#[cfg(windows)]
fn collect_uwp(include_system: bool) -> Vec<(String, String)> {
    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
        $ProgressPreference='SilentlyContinue'; \
        $apps = Get-StartApps | Where-Object { $_.AppID -like '*!*' } | Select-Object Name, AppID; \
        @($apps) | ConvertTo-Json -Compress";
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

    let mut result = Vec::new();
    for object in objects {
        let Some(name) = object.get("Name").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(aumid) = object.get("AppID").and_then(|value| value.as_str()) else {
            continue;
        };
        let name = name.trim();
        let aumid = aumid.trim();
        if name.is_empty() || aumid.is_empty() || is_junk_name(name) {
            continue;
        }
        if !include_system && is_system_uwp(name) {
            continue;
        }
        result.push((name.to_string(), aumid.to_string()));
    }
    result
}

/* ── classification & helpers ─────────────────────────────────── */

fn target_hint(target: &LaunchTarget) -> String {
    match target {
        LaunchTarget::Executable { path, .. } => path.clone(),
        LaunchTarget::Shortcut { path } => path.clone(),
        LaunchTarget::Uwp { aumid } => aumid.clone(),
    }
}

fn source_key(source: AppSource) -> &'static str {
    match source {
        AppSource::StartMenu => "lnk",
        AppSource::Desktop => "desk",
        AppSource::AppPaths => "apppath",
        AppSource::Registry => "reg",
        AppSource::Uwp => "uwp",
    }
}

fn make_id(prefix: &str, key: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in prefix
        .bytes()
        .chain(std::iter::once(b'|'))
        .chain(key.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn normalize_name(name: &str) -> String {
    name.chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(|character| character.to_lowercase())
        .collect()
}

/// 安装范围 / 位数的常见括注。只在去重与显示名清理时移除，
/// 不会改动应用自身的核心名称。
#[cfg(any(windows, test))]
const SCOPE_SUFFIXES: &[&str] = &[
    "(user)",
    "(machine)",
    "(x64)",
    "(x86)",
    "(64-bit)",
    "(32-bit)",
    "(64 bit)",
    "(32 bit)",
];

#[cfg(any(windows, test))]
fn strip_scope_suffix(name: &str) -> String {
    let mut current = name.trim();
    loop {
        let lower = current.to_lowercase();
        let Some(suffix) = SCOPE_SUFFIXES
            .iter()
            .find(|suffix| lower.ends_with(**suffix))
        else {
            return current.trim().to_string();
        };
        current = current[..current.len() - suffix.len()].trim_end();
    }
}

/// 去重键：忽略大小写、空格与范围后缀，因此 “TRAE CN (User)” 与 “TRAE CN” 视为同一条。
#[cfg(any(windows, test))]
fn dedupe_name(name: &str) -> String {
    normalize_name(&strip_scope_suffix(name))
}

#[cfg(windows)]
fn name_penalty(name: &str) -> usize {
    let lower = name.to_lowercase();
    let mut penalty = name.chars().count();
    for suffix in SCOPE_SUFFIXES {
        if lower.contains(suffix) {
            penalty += 200;
        }
    }
    penalty
}

#[cfg(windows)]
fn target_key(target: &LaunchTarget) -> String {
    match target {
        LaunchTarget::Executable { path, .. } => format!("exe:{}", path.to_lowercase()),
        LaunchTarget::Shortcut { path } => format!("lnk:{}", path.to_lowercase()),
        LaunchTarget::Uwp { aumid } => format!("uwp:{}", aumid.to_lowercase()),
    }
}

fn classify(name: &str, publisher: &str, extra: &str) -> &'static str {
    let haystack = format!(
        " {} {} {} ",
        name.to_lowercase(),
        publisher.to_lowercase(),
        extra.to_lowercase()
    );

    for (category, keywords) in RULES {
        if keywords.iter().any(|keyword| haystack.contains(keyword)) {
            return category;
        }
    }

    let extra_lower = extra.to_lowercase();
    if extra_lower.contains("administrative tools") {
        return "system";
    }
    if extra_lower.contains(r"\games\") {
        return "game";
    }
    "other"
}

const RULES: &[(&str, &[&str])] = &[
    (
        "game",
        &[
            "steam",
            "epic games",
            "wegame",
            "battle.net",
            "blizzard",
            "ubisoft connect",
            "ea app",
            "origin",
            "riot client",
            "minecraft",
            "genshin",
            "原神",
            "英雄联盟",
            "league of legends",
            "valorant",
            "xbox",
            "游戏",
        ],
    ),
    (
        "dev",
        &[
            "visual studio",
            "vscode",
            "vs code",
            "cursor",
            "jetbrains",
            "intellij",
            "pycharm",
            "webstorm",
            "clion",
            "goland",
            "rider",
            "datagrip",
            "android studio",
            "postman",
            "apifox",
            "docker",
            "git bash",
            "github desktop",
            "sourcetree",
            "navicat",
            "dbeaver",
            "xshell",
            "mobaxterm",
            "putty",
            "windows terminal",
            "powershell",
            "command prompt",
            "cmd",
            "developer",
            "开发者",
            "sdk",
            "unity",
            "unreal engine",
            "node.js",
            "anaconda",
            "jupyter",
            "sublime text",
            "notepad++",
            "neovim",
            "vim",
            "emacs",
            "wireshark",
            "fiddler",
            "charles",
            "dev-c++",
            "eclipse",
            "qt",
            "mysql workbench",
            "tabby",
            "terminus",
            "cmder",
        ],
    ),
    (
        "design",
        &[
            "photoshop",
            "illustrator",
            "indesign",
            "lightroom",
            "figma",
            "sketch",
            "adobe xd",
            "coreldraw",
            "affinity",
            "gimp",
            "inkscape",
            "canva",
            "blender",
            "3ds max",
            "maya",
            "cinema 4d",
            "zbrush",
            "substance",
            "krita",
            "clip studio",
            "paint.net",
            "axure",
            "framer",
            "设计",
            "建模",
            "绘图",
        ],
    ),
    (
        "office",
        &[
            "word",
            "excel",
            "powerpoint",
            "outlook",
            "onenote",
            "microsoft 365",
            "office",
            "wps",
            "acrobat",
            "foxit",
            "pdf",
            "notion",
            "obsidian",
            "evernote",
            "印象笔记",
            "有道云笔记",
            "石墨文档",
            "腾讯文档",
            "金山文档",
            "飞书",
            "lark",
            "钉钉",
            "dingtalk",
            "企业微信",
            "wecom",
            "teams",
            "zoom",
            "腾讯会议",
            "slack",
            "todoist",
            "滴答清单",
            "xmind",
            "mindmanager",
            "processon",
            "visio",
        ],
    ),
    (
        "media",
        &[
            "potplayer",
            "vlc",
            "mpv",
            "foobar",
            "spotify",
            "netease",
            "网易云音乐",
            "qq音乐",
            "酷狗",
            "酷我",
            "bilibili",
            "哔哩哔哩",
            "爱奇艺",
            "优酷",
            "腾讯视频",
            "芒果tv",
            "obs studio",
            "obs",
            "premiere",
            "after effects",
            "davinci resolve",
            "audacity",
            "audition",
            "剪映",
            "capcut",
            "格式工厂",
            "handbrake",
            "暴风影音",
            "kmplayer",
            "musicbee",
            "aimp",
            "winamp",
            "quicktime",
            "媒体播放器",
            "音乐",
            "视频",
            "播放器",
        ],
    ),
    (
        "social",
        &[
            "wechat",
            "微信",
            "qq",
            "telegram",
            "discord",
            "whatsapp",
            "line",
            "skype",
            "微博",
            "weibo",
            "陌陌",
            "知乎",
            "小红书",
            "rednote",
            "messenger",
        ],
    ),
    (
        "network",
        &[
            "chrome",
            "edge",
            "firefox",
            "brave",
            "opera",
            "vivaldi",
            "browser",
            "浏览器",
            "迅雷",
            "thunder",
            "idm",
            "internet download manager",
            "百度网盘",
            "阿里云盘",
            "夸克",
            "坚果云",
            "onedrive",
            "dropbox",
            "google drive",
            "teamviewer",
            "anydesk",
            "todesk",
            "向日葵",
            "远程",
            "filezilla",
            "winscp",
            "网盘",
            "云盘",
            "下载",
        ],
    ),
    (
        "security",
        &[
            "火绒",
            "huorong",
            "360安全",
            "360safe",
            "电脑管家",
            "defender",
            "security",
            "杀毒",
            "安全卫士",
            "防火墙",
            "kaspersky",
            "bitdefender",
            "malwarebytes",
            "avast",
            "eset",
            "norton",
            "mcafee",
        ],
    ),
    (
        "system",
        &[
            "7-zip",
            "7zip",
            "winrar",
            "bandizip",
            "winzip",
            "peazip",
            "everything",
            "powertoys",
            "ccleaner",
            "geek uninstaller",
            "revo uninstaller",
            "driver booster",
            "驱动",
            "清理",
            "优化",
            "控制面板",
            "control panel",
            "设置",
            "settings",
            "计算器",
            "calculator",
            "任务管理器",
            "task manager",
            "设备管理器",
            "磁盘管理",
            "系统配置",
            "注册表",
            "截图",
            "snipaste",
            "sharex",
            "备份",
            "还原",
            "windows tools",
            "windows 工具",
            "文件资源管理器",
            "explorer",
            "microsoft store",
            "应用商店",
            "时钟",
            "天气",
            "weather",
        ],
    ),
];

#[cfg_attr(not(windows), allow(dead_code))]
fn is_junk_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    const JUNK: &[&str] = &[
        "readme",
        "read me",
        "帮助",
        "help",
        "网站",
        "website",
        "update",
        "更新",
        "setup",
        "安装程序",
        "repair",
        "修复",
        "license",
        "许可",
        "release notes",
        "changelog",
        "documentation",
        "文档",
        "modify",
        "删除",
    ];
    let uninstall_like = lower == "uninstall"
        || lower.starts_with("uninstall ")
        || lower.starts_with("unins")
        || lower.starts_with("卸载");
    JUNK.iter().any(|word| lower.contains(word))
        || uninstall_like
        || lower.starts_with('~')
        || lower.contains("update for")
        || lower.contains("security update")
}

#[cfg(windows)]
fn is_system_uwp(name: &str) -> bool {
    let lower = name.to_lowercase();
    const SYSTEM_NAMES: &[&str] = &[
        "设置",
        "settings",
        "计算器",
        "calculator",
        "照片",
        "photos",
        "相机",
        "camera",
        "时钟",
        "clock",
        "录音机",
        "sound recorder",
        "画图",
        "paint",
        "截图工具",
        "snipping",
        "记事本",
        "notepad",
        "媒体播放器",
        "media player",
        "电影和电视",
        "movies & tv",
        "xbox",
        "游戏栏",
        "game bar",
        "商店",
        "store",
        "邮件",
        "mail",
        "日历",
        "calendar",
        "地图",
        "maps",
        "天气",
        "weather",
        "新闻",
        "news",
        "获取帮助",
        "get help",
        "反馈中心",
        "feedback hub",
        "手机连接",
        "phone link",
        "便笺",
        "sticky notes",
        "快速助手",
        "quick assist",
        "windows 备份",
        "windows backup",
        "clipchamp",
        "windows 安全中心",
        "windows security",
        "终端",
        "terminal",
        "powershell",
        "命令提示符",
        "command prompt",
        "远程桌面",
        "remote desktop",
        "windows 工具",
        "windows tools",
        "控制面板",
        "control panel",
        "任务管理器",
        "task manager",
        "闹钟",
        "alarms",
    ];
    SYSTEM_NAMES
        .iter()
        .any(|word| lower == *word || lower.contains(word))
}

#[cfg(windows)]
fn display_icon_to_exe(raw: &str) -> Option<String> {
    let mut text = raw.trim().to_string();
    if text.starts_with('@') {
        return None;
    }
    if let Some((prefix, suffix)) = text.rsplit_once(',') {
        if suffix.trim().parse::<i32>().is_ok() {
            text = prefix.to_string();
        }
    }
    let text = text.trim().trim_matches('"').trim();
    let expanded = expand_env_vars(text);
    if !expanded.to_lowercase().ends_with(".exe") {
        return None;
    }
    if Path::new(&expanded).is_file() {
        Some(expanded)
    } else {
        None
    }
}

fn clean_path(value: &str) -> String {
    let text = value.trim().trim_matches('"').trim();
    expand_env_vars(text)
}

fn expand_env_vars(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    loop {
        let Some(start) = rest.find('%') else {
            result.push_str(rest);
            break;
        };
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            result.push_str(rest);
            break;
        };
        let variable = &after[..end];
        if variable.is_empty() {
            result.push_str(&rest[..=start]);
            rest = &rest[start + 1..];
            continue;
        }
        match std::env::var(variable) {
            Ok(value) => {
                result.push_str(&rest[..start]);
                result.push_str(&value);
                rest = &after[end + 1..];
            }
            Err(_) => {
                result.push_str(&rest[..start + end + 2]);
                rest = &after[end + 1..];
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_names_for_deduplication() {
        assert_eq!(normalize_name("Visual Studio Code"), "visualstudiocode");
        assert_eq!(normalize_name("微信"), "微信");
    }

    #[test]
    fn ignores_install_scope_suffixes() {
        assert_eq!(dedupe_name("TRAE CN (User)"), "traecn");
        assert_eq!(dedupe_name("TRAE CN"), "traecn");
        assert_eq!(strip_scope_suffix("Foo (x64)"), "Foo");
        assert_eq!(strip_scope_suffix("Foo (64-bit) (User)"), "Foo");
        assert_eq!(strip_scope_suffix("Foo"), "Foo");
    }

    #[test]
    fn classifies_common_apps() {
        assert_eq!(classify("Visual Studio Code", "Microsoft", ""), "dev");
        assert_eq!(classify("微信", "腾讯", ""), "social");
        assert_eq!(classify("QQ音乐", "腾讯", ""), "media");
        assert_eq!(classify("企业微信", "腾讯", ""), "office");
        assert_eq!(classify("Steam", "Valve", ""), "game");
        assert_eq!(classify("Microsoft Edge", "Microsoft", ""), "network");
        assert_eq!(classify("火绒安全", "火绒", ""), "security");
        assert_eq!(classify("7-Zip", "Igor Pavlov", ""), "system");
    }

    #[test]
    fn ids_are_stable_and_distinct() {
        let a = make_id("lnk", "微信");
        let b = make_id("lnk", "微信");
        let c = make_id("uwp", "微信");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn expands_environment_variables() {
        std::env::set_var("QIDIAN_TEST_PATH", "C:\\Apps");
        assert_eq!(
            expand_env_vars("%QIDIAN_TEST_PATH%\\Foo.exe"),
            "C:\\Apps\\Foo.exe"
        );
    }

    #[test]
    fn keeps_uninstaller_tools_but_drops_uninstall_entries() {
        assert!(!is_junk_name("Geek Uninstaller"));
        assert!(!is_junk_name("Revo Uninstaller"));
        assert!(is_junk_name("Uninstall Steam"));
        assert!(is_junk_name("卸载 微信"));
    }
}

//! 快捷方式（.lnk / .url）扫描、迁移与创建。
//! 全部通过 Windows Shell 的 COM 接口完成，不启动外部进程，也不引入新依赖。

use serde::{Deserialize, Serialize};
#[cfg(any(windows, test))]
use std::path::{Path, PathBuf};

const NOT_WINDOWS: &str = "仅支持 Windows";
/// 递归扫描的最大层级，开始菜单与桌面极少超过这个深度。
const MAX_DEPTH: usize = 6;

/// 一条失效的快捷方式。`kind` 为 "lnk" 或 "url"。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenShortcut {
    pub path: String,
    pub name: String,
    pub target: Option<String>,
    pub reason: String,
    pub kind: String,
}

/// 新建快捷方式的参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShortcutSpec {
    pub target: String,
    pub args: Option<String>,
    pub workdir: Option<String>,
    pub icon: Option<String>,
    pub name: String,
    /// "desktop" | "startMenu" | "sameFolder"
    pub location: String,
    pub run_as_admin: bool,
}

/* ── 命令 ─────────────────────────────────────────────────────── */

/// 扫描桌面与开始菜单，返回目标已失效的快捷方式；只读，不改动任何文件。
#[tauri::command]
pub fn scan_broken_shortcuts() -> Result<Vec<BrokenShortcut>, String> {
    #[cfg(windows)]
    {
        scan_impl()
    }
    #[cfg(not(windows))]
    {
        Err(NOT_WINDOWS.to_string())
    }
}

/// 修改已有 .lnk 的目标，保留原参数与图标。
#[tauri::command]
pub fn relocate_shortcut(path: String, new_target: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        relocate_impl(&path, &new_target)
    }
    #[cfg(not(windows))]
    {
        let _ = (path, new_target);
        Err(NOT_WINDOWS.to_string())
    }
}

/// 删除给定的 .lnk / .url。仅允许桌面与开始菜单目录内的文件。
#[tauri::command]
pub fn delete_shortcuts(paths: Vec<String>) -> Result<u64, String> {
    #[cfg(windows)]
    {
        delete_impl(&paths)
    }
    #[cfg(not(windows))]
    {
        let _ = paths;
        Err(NOT_WINDOWS.to_string())
    }
}

/// 在当前用户桌面、开始菜单或目标同目录创建 .lnk，返回绝对路径。
#[tauri::command]
pub fn create_shortcut(spec: CreateShortcutSpec) -> Result<String, String> {
    #[cfg(windows)]
    {
        create_impl(&spec)
    }
    #[cfg(not(windows))]
    {
        let _ = spec;
        Err(NOT_WINDOWS.to_string())
    }
}

/* ── COM 基础 ─────────────────────────────────────────────────── */

/// 每个命令调用独立初始化一次 COM。初始化失败（线程已在别的套间）时
/// 不阻止后续调用，只是不再负责反初始化。
#[cfg(windows)]
struct ComGuard {
    initialized: bool,
}

#[cfg(windows)]
impl ComGuard {
    fn new() -> Self {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
        Self { initialized }
    }
}

#[cfg(windows)]
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.initialized {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

/// 把 HRESULT 翻译成中文提示，避免前端只看到一串数字。
#[cfg(windows)]
fn describe(context: &str, error: &windows::core::Error) -> String {
    let code = error.code().0 as u32;
    let hint = match code {
        0x8007_0002 | 0x8007_0003 => "找不到文件或目录",
        0x8007_0005 => "拒绝访问",
        0x8007_0020 => "文件正被其它程序占用",
        0x8007_000B => "路径无效",
        0x8000_4005 | 0x8000_4007 => "操作未完成",
        _ => "Shell 接口调用失败",
    };
    let detail = error.message();
    if detail.is_empty() {
        format!("{context}失败：{hint}")
    } else {
        format!("{context}失败：{hint}（{detail}）")
    }
}

/* ── 扫描 ─────────────────────────────────────────────────────── */

#[cfg(windows)]
fn scan_impl() -> Result<Vec<BrokenShortcut>, String> {
    let _guard = ComGuard::new();
    let roots = shortcut_roots();
    if roots.is_empty() {
        return Err("无法定位桌面或开始菜单目录".to_string());
    }

    let mut files = Vec::new();
    for root in &roots {
        walk_shortcuts(root, 0, &mut files);
    }

    // 已知文件夹与桌面重定向可能指向同一目录，按规范化的完整路径去重。
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for path in files {
        if !seen.insert(normalize_path(&path.to_string_lossy())) {
            continue;
        }
        if let Some(item) = inspect(&path) {
            result.push(item);
        }
    }
    result.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(result)
}

/// 当前用户桌面、公共桌面、当前用户开始菜单、所有用户开始菜单。
#[cfg(windows)]
fn shortcut_roots() -> Vec<PathBuf> {
    use windows::Win32::UI::Shell::{
        FOLDERID_CommonPrograms, FOLDERID_Desktop, FOLDERID_Programs, FOLDERID_PublicDesktop,
    };

    let mut roots = Vec::new();
    for id in [
        &FOLDERID_Desktop,
        &FOLDERID_PublicDesktop,
        &FOLDERID_Programs,
        &FOLDERID_CommonPrograms,
    ] {
        if let Some(path) = known_folder_path(id) {
            push_dir(&mut roots, path);
        }
    }
    // 已知文件夹接口不可用时用环境变量兜底，覆盖面保持一致。
    if let Ok(profile) = std::env::var("USERPROFILE") {
        push_dir(&mut roots, PathBuf::from(profile).join("Desktop"));
    }
    if let Ok(public) = std::env::var("PUBLIC") {
        push_dir(&mut roots, PathBuf::from(public).join("Desktop"));
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        push_dir(
            &mut roots,
            PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"),
        );
    }
    if let Ok(program_data) = std::env::var("ProgramData") {
        push_dir(
            &mut roots,
            PathBuf::from(program_data).join(r"Microsoft\Windows\Start Menu\Programs"),
        );
    }

    let mut seen = std::collections::HashSet::new();
    roots.retain(|path| seen.insert(normalize_path(&path.to_string_lossy())));
    roots
}

#[cfg(windows)]
fn push_dir(roots: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_dir() {
        roots.push(path);
    }
}

#[cfg(windows)]
fn walk_shortcuts(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        // 不跟随符号链接，避免进入环路。
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            walk_shortcuts(&path, depth + 1, out);
            continue;
        }
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(ext.as_str(), "lnk" | "url") {
            out.push(path);
        }
    }
}

#[cfg(windows)]
fn inspect(path: &Path) -> Option<BrokenShortcut> {
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名快捷方式")
        .to_string();
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "lnk" => inspect_lnk(path, name),
        "url" => inspect_url(path, name),
        _ => None,
    }
}

#[cfg(windows)]
fn inspect_lnk(path: &Path, name: String) -> Option<BrokenShortcut> {
    let (target, reason) = match resolve_lnk_target(path) {
        Ok(target) if target.trim().is_empty() => (None, Some("目标为空".to_string())),
        Ok(target) => {
            let target = target.trim().to_string();
            if target_exists(&target) {
                (Some(target), None)
            } else {
                let reason = missing_reason(&target);
                (Some(target), Some(reason))
            }
        }
        Err(_) => (None, Some("快捷方式损坏".to_string())),
    };
    reason.map(|reason| BrokenShortcut {
        path: path.display().to_string(),
        name,
        target,
        reason,
        kind: "lnk".to_string(),
    })
}

/// 用 IShellLinkW 读取 .lnk 的目标；无法解析时返回错误由上层归类为损坏。
#[cfg(windows)]
fn resolve_lnk_target(path: &Path) -> Result<String, String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_UNCPRIORITY};

    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| describe("打开快捷方式", &error))?;
        let persist: IPersistFile = link
            .cast()
            .map_err(|error| describe("读取快捷方式", &error))?;
        let wide = HSTRING::from(path.to_string_lossy().as_ref());
        persist
            .Load(&wide, STGM(0))
            .map_err(|error| describe("读取快捷方式", &error))?;

        let mut buffer = vec![0u16; 32768];
        // UNCPRIORITY 会展开环境变量并优先返回 UNC 路径，便于直接做存在性校验。
        link.GetPath(
            &mut buffer,
            std::ptr::null_mut(),
            SLGP_UNCPRIORITY.0 as u32,
        )
        .map_err(|error| describe("读取快捷方式目标", &error))?;
        Ok(take_wide(&buffer))
    }
}

#[cfg(windows)]
fn target_exists(target: &str) -> bool {
    let path = Path::new(target);
    if path.exists() {
        return true;
    }
    // MSIX / Store 应用的安装目录受系统 ACL 保护，普通权限下探测不到，
    // 但快捷方式本身仍能正常启动，按存在处理。
    target.to_lowercase().contains(r"\windowsapps\")
}

/// 区分「目标不存在」与「目标所在盘符已被移除」两种原因。
#[cfg(windows)]
fn missing_reason(target: &str) -> String {
    let bytes = target.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        let root = format!("{}:\\", &target[..1]);
        if !Path::new(&root).exists() {
            return "指向已删除的盘符".to_string();
        }
    }
    "目标不存在".to_string()
}

#[cfg(windows)]
fn inspect_url(path: &Path, name: String) -> Option<BrokenShortcut> {
    let display = path.display().to_string();
    let Ok(bytes) = std::fs::read(path) else {
        return Some(BrokenShortcut {
            path: display,
            name,
            target: None,
            reason: "快捷方式损坏".to_string(),
            kind: "url".to_string(),
        });
    };

    let text = decode_ini(&bytes);
    let mut url: Option<String> = None;
    for line in text.lines() {
        let line = line.trim().trim_start_matches('\u{feff}');
        // 用 get 而不是直接切片，避免首字符是多字节时触发边界 panic。
        if line.get(..4).is_some_and(|prefix| prefix.eq_ignore_ascii_case("URL=")) {
            url = Some(line[4..].trim().trim_matches('"').to_string());
            break;
        }
    }

    let Some(url) = url else {
        return Some(BrokenShortcut {
            path: display,
            name,
            target: None,
            reason: "快捷方式损坏".to_string(),
            kind: "url".to_string(),
        });
    };

    let target = Some(url.clone());
    if url.is_empty() {
        return Some(BrokenShortcut {
            path: display,
            name,
            target: None,
            reason: "目标为空".to_string(),
            kind: "url".to_string(),
        });
    }

    // 只校验明确指向本地文件的 URL；http(s)、ftp、mailto、steam 等
    // 交给浏览器或协议处理器判断，扫描阶段不联网。
    if let Some(local) = local_file_from_url(&url) {
        if !Path::new(&local).exists() && !local.contains('%') {
            let reason = missing_reason(&local);
            return Some(BrokenShortcut {
                path: display,
                name,
                target,
                reason,
                kind: "url".to_string(),
            });
        }
    }
    None
}

/// .url 是 INI 文本，系统实际可能以 UTF-16LE（带 BOM）写入。
#[cfg(windows)]
fn decode_ini(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

#[cfg(windows)]
fn local_file_from_url(url: &str) -> Option<String> {
    // 只处理 file:///C:/... 这类本机路径；file://server/... 与其它协议
    // 一律视为有效，避免把网络共享误判为失效。
    let rest = url.strip_prefix("file:///")?;
    if rest.is_empty() {
        return None;
    }
    Some(rest.replace('/', "\\"))
}

/* ── 修改 ─────────────────────────────────────────────────────── */

#[cfg(windows)]
fn relocate_impl(path: &str, new_target: &str) -> Result<(), String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let link_path = Path::new(path);
    if !path.to_ascii_lowercase().ends_with(".lnk") {
        return Err("只能修改 .lnk 快捷方式".to_string());
    }
    if !link_path.is_file() {
        return Err(format!("快捷方式不存在：{path}"));
    }
    let new_target = new_target.trim();
    if !Path::new(new_target).is_file() {
        return Err(format!("新的目标不存在：{new_target}"));
    }

    let _guard = ComGuard::new();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| describe("打开快捷方式", &error))?;
        let persist: IPersistFile = link
            .cast()
            .map_err(|error| describe("读取快捷方式", &error))?;
        let wide = HSTRING::from(path);
        persist
            .Load(&wide, STGM(0))
            .map_err(|error| describe("读取快捷方式", &error))?;

        // 先读出原参数与图标，写完目标后再原样写回，避免迁移时丢失。
        let args = read_string(|buffer| link.GetArguments(buffer));
        let icon = {
            let mut buffer = vec![0u16; 1024];
            let mut index = 0i32;
            match link.GetIconLocation(&mut buffer, &mut index) {
                Ok(()) => Some((take_wide(&buffer), index)),
                Err(_) => None,
            }
        };

        let target = HSTRING::from(new_target);
        link.SetPath(&target)
            .map_err(|error| describe("设置目标", &error))?;
        if let Some(args) = args {
            let _ = link.SetArguments(&HSTRING::from(args.as_str()));
        }
        if let Some((icon, index)) = icon {
            if !icon.is_empty() {
                let _ = link.SetIconLocation(&HSTRING::from(icon.as_str()), index);
            }
        }

        persist
            .Save(&wide, true)
            .map_err(|error| describe("保存快捷方式", &error))?;
    }
    Ok(())
}

/* ── 删除 ─────────────────────────────────────────────────────── */

#[cfg(windows)]
fn delete_impl(paths: &[String]) -> Result<u64, String> {
    // 白名单目录也取真实路径，避免桌面被 OneDrive 重定向后误判。
    let roots = shortcut_roots()
        .into_iter()
        .map(|root| {
            std::fs::canonicalize(&root)
                .unwrap_or(root)
                .to_string_lossy()
                .to_string()
        })
        .collect::<Vec<_>>();
    let mut deleted = 0u64;
    let mut failures: Vec<String> = Vec::new();

    for raw in paths {
        let path = Path::new(raw.trim());
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "lnk" | "url") {
            failures.push(format!("{raw}：只能删除 .lnk / .url"));
            continue;
        }
        if !path.is_file() {
            failures.push(format!("{raw}：文件不存在"));
            continue;
        }
        // 先解析真实路径再比对白名单，防止用 `..` 跳出桌面/开始菜单。
        let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let real_text = real.to_string_lossy().to_string();
        if !is_under_roots(&real_text, &roots) {
            failures.push(format!("{raw}：不在桌面或开始菜单目录内"));
            continue;
        }
        match std::fs::remove_file(&real) {
            Ok(()) => deleted += 1,
            Err(error) => failures.push(format!("{raw}：{error}")),
        }
    }

    if failures.is_empty() {
        Ok(deleted)
    } else {
        Err(format!(
            "已删除 {deleted} 个，以下 {} 个未能删除：{}",
            failures.len(),
            failures.join("；")
        ))
    }
}

/* ── 创建 ─────────────────────────────────────────────────────── */

#[cfg(windows)]
fn create_impl(spec: &CreateShortcutSpec) -> Result<String, String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkDataList, IShellLinkW, ShellLink, SLDF_RUNAS_USER,
    };

    let target = spec.target.trim();
    if target.is_empty() {
        return Err("启动目标不能为空".to_string());
    }

    let dir = destination_dir(&spec.location, target)?;
    let name = sanitize_file_name(&spec.name);
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建目录 {}：{error}", dir.display()))?;
    let file_path = unique_shortcut_path(&dir, &name);

    // UWP / MSIX 应用没有可直接指向的 exe，能启动它的唯一形式是
    // `shell:AppsFolder\<AUMID>`；而 .lnk 的目标不支持 shell 命名空间路径，
    // 只能生成一个指向 explorer.exe、参数为该 AUMID 的 wrapper 快捷方式。
    let (link_target, link_args) = if is_apps_folder(target) {
        let explorer = std::env::var("SystemRoot")
            .map(|root| format!("{root}\\explorer.exe"))
            .unwrap_or_else(|_| r"C:\Windows\explorer.exe".to_string());
        (explorer, Some(target.to_string()))
    } else {
        if !Path::new(target).exists() {
            return Err(format!("启动目标不存在：{target}"));
        }
        (
            target.to_string(),
            spec.args
                .clone()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        )
    };

    let workdir = spec
        .workdir
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            Path::new(&link_target)
                .parent()
                .map(|parent| parent.to_string_lossy().to_string())
        });
    let icon = spec
        .icon
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| link_target.clone());

    let _guard = ComGuard::new();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| describe("创建快捷方式", &error))?;

        let wide_target = HSTRING::from(link_target.as_str());
        link.SetPath(&wide_target)
            .map_err(|error| describe("设置目标", &error))?;
        if let Some(args) = &link_args {
            link.SetArguments(&HSTRING::from(args.as_str()))
                .map_err(|error| describe("设置参数", &error))?;
        }
        if let Some(workdir) = &workdir {
            link.SetWorkingDirectory(&HSTRING::from(workdir.as_str()))
                .map_err(|error| describe("设置工作目录", &error))?;
        }
        link.SetIconLocation(&HSTRING::from(icon.as_str()), 0)
            .map_err(|error| describe("设置图标", &error))?;
        link.SetDescription(&HSTRING::from(name.as_str()))
            .map_err(|error| describe("设置描述", &error))?;

        if spec.run_as_admin {
            // SLDF_RUNAS_USER 是快捷方式自身数据块的标志位，只能用
            // IShellLinkDataList::GetFlags / SetFlags 修改；AddDataBlock
            // 用于附加控制台属性之类的结构体数据块，不能设置该标志。
            let data: IShellLinkDataList = link
                .cast()
                .map_err(|error| describe("读取快捷方式数据", &error))?;
            let flags = data
                .GetFlags()
                .map_err(|error| describe("读取管理员标记", &error))?;
            data.SetFlags(flags | SLDF_RUNAS_USER.0 as u32)
                .map_err(|error| describe("写入管理员标记", &error))?;
        }

        let persist: IPersistFile = link
            .cast()
            .map_err(|error| describe("创建快捷方式", &error))?;
        let wide_path = HSTRING::from(file_path.to_string_lossy().as_ref());
        persist
            .Save(&wide_path, true)
            .map_err(|error| describe("保存快捷方式", &error))?;
    }

    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(windows)]
fn destination_dir(location: &str, target: &str) -> Result<PathBuf, String> {
    use windows::Win32::UI::Shell::{FOLDERID_Desktop, FOLDERID_Programs};

    match location {
        "desktop" => known_folder_path(&FOLDERID_Desktop)
            .or_else(|| {
                std::env::var("USERPROFILE")
                    .ok()
                    .map(|profile| PathBuf::from(profile).join("Desktop"))
            })
            .ok_or_else(|| "无法定位当前用户桌面目录".to_string()),
        // 开始菜单的「程序」子目录，与用户在开始菜单里右键创建的位置一致。
        "startMenu" => known_folder_path(&FOLDERID_Programs)
            .or_else(|| {
                std::env::var("APPDATA").ok().map(|appdata| {
                    PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs")
                })
            })
            .ok_or_else(|| "无法定位当前用户开始菜单目录".to_string()),
        "sameFolder" => {
            if is_apps_folder(target) {
                return Err("shell:AppsFolder 目标没有可用的同目录".to_string());
            }
            Path::new(target)
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| "无法确定目标所在目录".to_string())
        }
        other => Err(format!("不支持的位置：{other}")),
    }
}

#[cfg(windows)]
fn is_apps_folder(target: &str) -> bool {
    let lower = target.replace('/', "\\").to_ascii_lowercase();
    lower.starts_with("shell:appsfolder\\")
}

#[cfg(windows)]
fn known_folder_path(id: &windows::core::GUID) -> Option<PathBuf> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};

    unsafe {
        let raw = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, HANDLE::default()).ok()?;
        let text = raw.to_string().ok();
        // SHGetKnownFolderPath 返回 CoTaskMemAlloc 分配的字符串，必须释放。
        CoTaskMemFree(Some(raw.0 as *const std::ffi::c_void));
        let text = text?.trim().to_string();
        (!text.is_empty()).then(|| PathBuf::from(text))
    }
}

/* ── 纯逻辑（可单测） ─────────────────────────────────────────── */

/// 清洗文件名：去掉 Windows 非法字符、控制字符与结尾的点/空格。
#[cfg(any(windows, test))]
fn sanitize_file_name(raw: &str) -> String {
    let mut cleaned = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => cleaned.push(' '),
            c if (c as u32) < 0x20 => cleaned.push(' '),
            c => cleaned.push(c),
        }
    }
    let mut cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    // 用户可能已经带了 .lnk 后缀，统一由调用方补，避免出现 .lnk.lnk。
    if cleaned.to_lowercase().ends_with(".lnk") {
        cleaned.truncate(cleaned.len() - 4);
    }
    let cleaned = cleaned
        .trim_matches(|ch| ch == '.' || ch == ' ')
        .chars()
        .take(120)
        .collect::<String>();
    let cleaned = cleaned.trim_end_matches(' ').to_string();
    if cleaned.is_empty() {
        "快捷方式".to_string()
    } else {
        cleaned
    }
}

/// 同名文件已存在时追加 ` (2)`、` (3)`，不覆盖已有快捷方式。
#[cfg(any(windows, test))]
fn unique_shortcut_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(format!("{name}.lnk"));
    if !first.exists() {
        return first;
    }
    for index in 2..=9999u32 {
        let candidate = dir.join(format!("{name} ({index}).lnk"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{name} ({}).lnk", std::process::id()))
}

/// 规范化用于比较的路径：统一分隔符、去掉 `\\?\` 前缀、转小写。
#[cfg(any(windows, test))]
fn normalize_path(path: &str) -> String {
    let mut value = path.trim().trim_matches('"').replace('/', "\\");
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        value = format!(r"\\{rest}");
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        value = rest.to_string();
    }
    while value.len() > 3 && value.ends_with('\\') {
        value.pop();
    }
    value.to_lowercase()
}

/// 路径是否位于任一白名单目录之下（含目录本身）。
#[cfg(any(windows, test))]
fn is_under_roots(path: &str, roots: &[String]) -> bool {
    let normalized = normalize_path(path);
    if normalized.is_empty() {
        return false;
    }
    roots.iter().any(|root| {
        let root = normalize_path(root);
        !root.is_empty() && (normalized == root || normalized.starts_with(&format!("{root}\\")))
    })
}

/// 取以 NUL 结尾的宽字符串内容。
#[cfg(windows)]
fn take_wide(buffer: &[u16]) -> String {
    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..length])
}

#[cfg(windows)]
fn read_string(fill: impl FnOnce(&mut [u16]) -> windows::core::Result<()>) -> Option<String> {
    let mut buffer = vec![0u16; 8192];
    fill(&mut buffer).ok()?;
    let text = take_wide(&buffer);
    (!text.is_empty()).then_some(text)
}

/* ── 测试 ─────────────────────────────────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("qidian-lnk-{tag}-{}-{stamp}", std::process::id()))
    }

    #[test]
    fn sanitize_replaces_illegal_chars_and_suffix() {
        assert_eq!(
            sanitize_file_name("我的 程序/测试:版*?.lnk"),
            "我的 程序 测试 版"
        );
        assert_eq!(sanitize_file_name("..  名称..."), "名称");
        assert_eq!(sanitize_file_name("???"), "快捷方式");
    }

    #[test]
    fn unique_path_appends_counter() {
        let dir = temp_dir("unique");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("记事本.lnk"), b"x").unwrap();

        let second = unique_shortcut_path(&dir, "记事本");
        assert_eq!(second.file_name().unwrap(), "记事本 (2).lnk");
        std::fs::write(&second, b"x").unwrap();

        let third = unique_shortcut_path(&dir, "记事本");
        assert_eq!(third.file_name().unwrap(), "记事本 (3).lnk");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn whitelist_checks_roots() {
        let roots = vec![
            r"C:\Users\me\Desktop".to_string(),
            r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs".to_string(),
        ];
        assert!(is_under_roots(r"C:\Users\me\Desktop\a.lnk", &roots));
        assert!(is_under_roots(r"c:/users/me/desktop/sub/a.lnk", &roots));
        assert!(is_under_roots(r"\\?\C:\Users\me\Desktop\a.lnk", &roots));
        assert!(!is_under_roots(r"C:\Users\me\Desktop2\a.lnk", &roots));
        assert!(!is_under_roots(r"C:\Windows\a.lnk", &roots));
    }
}

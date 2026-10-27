use crate::models::{ProcessItem, ProcessTarget, TerminateFailure, TerminateReport};
use serde::Serialize;
#[cfg(windows)]
use std::sync::Mutex;
#[cfg(windows)]
use std::time::{Duration, Instant};

/// 进程枚举要遍历整张系统快照并读取路径与内存，1.2 秒内复用结果：
/// 后台页与内存页几乎同时请求时不再重复枚举。结束进程后主动失效。
#[cfg(windows)]
const PROCESS_CACHE_TTL: Duration = Duration::from_millis(1200);

#[cfg(windows)]
static PROCESS_CACHE: Mutex<Option<(Instant, Vec<ProcessItem>)>> = Mutex::new(None);

/// 资源采样需要 320ms 窗口 + 全进程快照，2 秒内复用：
/// 体检页刷新、切页时不再重复等待采样窗口。
#[cfg(windows)]
const RESOURCE_CACHE_TTL: Duration = Duration::from_millis(2000);

#[cfg(windows)]
static RESOURCE_CACHE: Mutex<Option<(Instant, ResourceSample)>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceHog {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: u32,
    pub memory_bytes: u64,
    pub protected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSample {
    pub cpu_percent: u32,
    pub items: Vec<ResourceHog>,
}

/// 采样一次整机 CPU 占用与进程 CPU/内存排行。
/// 用两次系统时间 + 进程时间做差，窗口约 320ms；TTL 内复用最近一次采样，
/// 只在真正需要新数据时（TTL 过期）才重新采样。
pub fn sample_resources(limit: usize) -> ResourceSample {
    #[cfg(windows)]
    {
        let mut sample = if let Ok(mut cache) = RESOURCE_CACHE.lock() {
            if let Some((at, cached)) = cache.as_ref() {
                if at.elapsed() < RESOURCE_CACHE_TTL {
                    let mut out = cached.clone();
                    out.items.truncate(limit.max(1));
                    return out;
                }
            }
            let sample = sample_windows();
            *cache = Some((Instant::now(), sample.clone()));
            sample
        } else {
            sample_windows()
        };
        sample.items.truncate(limit.max(1));
        sample
    }
    #[cfg(not(windows))]
    {
        let _ = limit;
        ResourceSample {
            cpu_percent: 0,
            items: Vec::new(),
        }
    }
}

#[cfg(windows)]
fn sample_windows() -> ResourceSample {
    use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::{
        GetProcessTimes, GetSystemTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_VM_READ,
    };

    struct Tracked {
        pid: u32,
        name: String,
        handle: HANDLE,
        ticks: u64,
        memory: u64,
    }

    fn filetime_ticks(value: FILETIME) -> u64 {
        (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime)
    }

    fn system_ticks() -> (u64, u64) {
        let mut idle = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut kernel = idle;
        let mut user = idle;
        if unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.is_err() {
            return (0, 0);
        }
        (filetime_ticks(idle), filetime_ticks(kernel) + filetime_ticks(user))
    }

    fn process_ticks(handle: HANDLE) -> u64 {
        let mut creation = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut exit = creation;
        let mut kernel = creation;
        let mut user = creation;
        if unsafe {
            GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user)
        }
        .is_err()
        {
            return 0;
        }
        filetime_ticks(kernel) + filetime_ticks(user)
    }

    let (idle_before, total_before) = system_ticks();
    let snapshot = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
        Ok(handle) => handle,
        Err(_) => {
            return ResourceSample {
                cpu_percent: 0,
                items: Vec::new(),
            }
        }
    };
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut tracked: Vec<Tracked> = Vec::new();
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_err() {
        let _ = unsafe { CloseHandle(snapshot) };
        return ResourceSample {
            cpu_percent: 0,
            items: Vec::new(),
        };
    }
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
        if pid > 4 && !name.is_empty() {
            if let Ok(handle) = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                    false,
                    pid,
                )
            } {
                let mut counters = PROCESS_MEMORY_COUNTERS {
                    cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                    ..Default::default()
                };
                let memory = if unsafe {
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
                };
                tracked.push(Tracked {
                    pid,
                    name,
                    handle,
                    ticks: process_ticks(handle),
                    memory,
                });
            }
        }
        if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
            break;
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };

    std::thread::sleep(Duration::from_millis(320));
    let (idle_after, total_after) = system_ticks();
    let total_delta = total_after.saturating_sub(total_before);
    let idle_delta = idle_after.saturating_sub(idle_before);
    let busy_delta = total_delta.saturating_sub(idle_delta);
    let cpu_percent = if total_delta > 0 {
        ((u128::from(busy_delta) * 100 / u128::from(total_delta)) as u32).min(100)
    } else {
        0
    };

    let current = current_process_name();
    let mut items = Vec::with_capacity(tracked.len());
    for tracked in tracked {
        let after = process_ticks(tracked.handle);
        let _ = unsafe { CloseHandle(tracked.handle) };
        let delta = after.saturating_sub(tracked.ticks);
        let usage = if total_delta > 0 {
            ((u128::from(delta) * 100 / u128::from(total_delta)) as u32).min(100)
        } else {
            0
        };
        items.push(ResourceHog {
            pid: tracked.pid,
            name: tracked.name.clone(),
            cpu_percent: usage,
            memory_bytes: tracked.memory,
            protected: is_protected(&tracked.name, current.as_deref()),
        });
    }

    items.sort_by(|a, b| {
        b.cpu_percent
            .cmp(&a.cpu_percent)
            .then(b.memory_bytes.cmp(&a.memory_bytes))
            .then(a.name.cmp(&b.name))
    });
    ResourceSample { cpu_percent, items }
}

/// Windows 和启点界面所依赖的进程，禁止从后台页直接结束。
/// 关闭 svchost、dwm、explorer、msedgewebview2 等会导致系统或界面异常。
const PROTECTED: &[&str] = &[
    "system",
    "idle",
    "registry",
    "memcompression",
    "smss",
    "csrss",
    "wininit",
    "winlogon",
    "services",
    "lsass",
    "svchost",
    "fontdrvhost",
    "dwm",
    "audiodg",
    "ctfmon",
    "sihost",
    "taskhostw",
    "runtimebroker",
    "securityhealthservice",
    "msmpeng",
    "nissrv",
    "explorer",
    "msedgewebview2",
    "qidian",
];

pub fn list_processes() -> Result<Vec<ProcessItem>, String> {
    #[cfg(windows)]
    {
        if let Ok(guard) = PROCESS_CACHE.lock() {
            if let Some((at, items)) = guard.as_ref() {
                if at.elapsed() < PROCESS_CACHE_TTL {
                    return Ok(items.clone());
                }
            }
        }
        let items = list_windows()?;
        if let Ok(mut guard) = PROCESS_CACHE.lock() {
            *guard = Some((Instant::now(), items.clone()));
        }
        Ok(items)
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

pub fn terminate_processes(targets: Vec<ProcessTarget>) -> TerminateReport {
    #[cfg(windows)]
    {
        terminate_windows(targets)
    }
    #[cfg(not(windows))]
    {
        let _ = targets;
        TerminateReport {
            terminated: 0,
            failed: vec![TerminateFailure {
                pid: 0,
                name: String::new(),
                error: "启点目前只支持 Windows".to_string(),
            }],
        }
    }
}

/// 直接枚举系统进程，避免每次打开后台页都启动 PowerShell。
/// 公司名与描述只对非 Windows 目录下的可执行文件读取版本信息，并按路径缓存。
#[cfg(windows)]
fn list_windows() -> Result<Vec<ProcessItem>, String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|error| format!("无法枚举进程：{error}"))?;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut result = Vec::new();
    let current = current_process_name();

    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_err() {
        let _ = unsafe { CloseHandle(snapshot) };
        return Ok(result);
    }
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
        if pid > 4 && !name.is_empty() {
            let (path, memory_bytes) = process_details(pid);
            let (company, description) = match path.as_deref() {
                Some(path) if !is_system_path(path) => file_meta_cached(path),
                _ => (None, None),
            };
            result.push(ProcessItem {
                pid,
                name: name.clone(),
                path,
                memory_bytes,
                company,
                description,
                protected: is_protected(&name, current.as_deref()),
            });
        }
        if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
            break;
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };

    result.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.pid.cmp(&b.pid))
    });
    Ok(result)
}

#[cfg(windows)]
fn process_details(pid: u32) -> (Option<String>, u64) {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_VM_READ,
    };

    let handle = match unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
            false,
            pid,
        )
    } {
        Ok(handle) => handle,
        Err(_) => return (None, 0),
    };

    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let path = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    }
    .ok()
    .map(|_| String::from_utf16_lossy(&buffer[..length as usize]));

    let mut counters = PROCESS_MEMORY_COUNTERS {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ..Default::default()
    };
    let memory = if unsafe {
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
    };
    let _ = unsafe { CloseHandle(handle) };
    (path, memory)
}

#[cfg(windows)]
fn is_system_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.starts_with(r"c:\windows\") || lower.contains(r"\windows\system32\") || lower.contains(r"\windows\syswow64\")
}

/// 版本信息对同一文件是稳定的，跨次枚举按路径缓存，
/// 避免每次刷新都重新解析几百个可执行文件的资源段。
#[cfg(windows)]
fn file_meta_cached(path: &str) -> (Option<String>, Option<String>) {
    use std::collections::HashMap;
    use std::sync::OnceLock;

    static META_CACHE: OnceLock<Mutex<HashMap<String, (Option<String>, Option<String>)>>> =
        OnceLock::new();
    let cache = META_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let key = path.to_lowercase();
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(&key) {
            return value.clone();
        }
    }
    let value = file_meta(path);
    if let Ok(mut guard) = cache.lock() {
        if guard.len() >= 2048 {
            guard.clear();
        }
        guard.insert(key, value.clone());
    }
    value
}

#[cfg(windows)]
fn file_meta(path: &str) -> (Option<String>, Option<String>) {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };

    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let size = unsafe { GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), None) };
    if size == 0 {
        return (None, None);
    }
    let mut buffer = vec![0u8; size as usize];
    if unsafe {
        GetFileVersionInfoW(
            PCWSTR(wide.as_ptr()),
            0,
            size,
            buffer.as_mut_ptr() as *mut core::ffi::c_void,
        )
    }
    .is_err()
    {
        return (None, None);
    }

    let mut pointer: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut length = 0u32;
    let translation = "\\VarFileInfo\\Translation";
    let translation_wide: Vec<u16> = translation
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    if !unsafe {
        VerQueryValueW(
            buffer.as_ptr() as *const core::ffi::c_void,
            PCWSTR(translation_wide.as_ptr()),
            &mut pointer,
            &mut length,
        )
    }
    .as_bool()
        || pointer.is_null()
        || length < 4
    {
        return (None, None);
    }
    let language = unsafe { *(pointer as *const u16) };
    let codepage = unsafe { *((pointer as *const u16).add(1)) };

    let query = |key: &str| -> Option<String> {
        let sub = format!("\\StringFileInfo\\{language:04x}{codepage:04x}\\{key}");
        let sub_wide: Vec<u16> = sub.encode_utf16().chain(std::iter::once(0)).collect();
        let mut value: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut value_len = 0u32;
        if !unsafe {
            VerQueryValueW(
                buffer.as_ptr() as *const core::ffi::c_void,
                PCWSTR(sub_wide.as_ptr()),
                &mut value,
                &mut value_len,
            )
        }
        .as_bool()
            || value.is_null()
            || value_len == 0
        {
            return None;
        }
        let slice = unsafe { std::slice::from_raw_parts(value as *const u16, value_len as usize) };
        let text = String::from_utf16_lossy(slice)
            .trim_end_matches('\0')
            .trim()
            .to_string();
        (!text.is_empty()).then_some(text)
    };
    (query("CompanyName"), query("FileDescription"))
}

#[cfg(windows)]
fn terminate_windows(targets: Vec<ProcessTarget>) -> TerminateReport {
    use std::collections::HashSet;

    let mut report = TerminateReport {
        terminated: 0,
        failed: Vec::new(),
    };
    let mut seen = HashSet::new();
    let current = current_process_name();

    for target in targets.into_iter().take(64) {
        if !seen.insert(target.pid) {
            continue;
        }
        if target.pid <= 4 {
            report.failed.push(TerminateFailure {
                pid: target.pid,
                name: target.name,
                error: "系统核心进程，已受保护".to_string(),
            });
            continue;
        }
        if is_protected(&target.name, current.as_deref()) {
            report.failed.push(TerminateFailure {
                pid: target.pid,
                name: target.name,
                error: "系统或启点依赖的进程，已受保护".to_string(),
            });
            continue;
        }
        match terminate_one(target.pid, &target.name) {
            Ok(()) => report.terminated += 1,
            Err(error) => report.failed.push(TerminateFailure {
                pid: target.pid,
                name: target.name,
                error,
            }),
        }
    }

    if let Ok(mut guard) = PROCESS_CACHE.lock() {
        *guard = None;
    }

    report
}

#[cfg(windows)]
fn terminate_one(pid: u32, expected_name: &str) -> Result<(), String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    let handle = unsafe {
        OpenProcess(
            PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        )
    }
    .map_err(|_| "无权结束该进程，可能需要管理员权限".to_string())?;

    let actual_name = process_image_name(handle)
        .map_err(|_| "无法验证进程身份，已取消结束".to_string())?;
    if !actual_name.eq_ignore_ascii_case(expected_name) {
        let _ = unsafe { CloseHandle(handle) };
        return Err("进程身份已变化，已取消结束".to_string());
    }
    if is_protected(&actual_name, current_process_name().as_deref()) {
        let _ = unsafe { CloseHandle(handle) };
        return Err("系统或启点依赖的进程，已受保护".to_string());
    }

    let terminated = unsafe { TerminateProcess(handle, 1) }.is_ok();
    let _ = unsafe { CloseHandle(handle) };
    if terminated {
        Ok(())
    } else {
        Err("结束进程失败，可能需要管理员权限".to_string())
    }
}

#[cfg(windows)]
fn process_image_name(
    handle: windows::Win32::Foundation::HANDLE,
) -> windows::core::Result<String> {
    use windows::core::PWSTR;
    use windows::Win32::System::Threading::{QueryFullProcessImageNameW, PROCESS_NAME_WIN32};

    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )?;
    }
    let path = String::from_utf16_lossy(&buffer[..length as usize]);
    let stem = std::path::Path::new(&path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(path.as_str())
        .to_lowercase();
    Ok(stem)
}

#[cfg(windows)]
fn current_process_name() -> Option<String> {
    std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .map(|value| value.to_lowercase())
        })
}

pub(crate) fn is_protected(name: &str, current: Option<&str>) -> bool {
    let name = name.trim().to_lowercase();
    current == Some(name.as_str())
        || PROTECTED.iter().any(|protected| *protected == name)
}

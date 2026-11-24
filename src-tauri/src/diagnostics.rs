//! 本地崩溃记录与诊断导出：全部离线完成，不启动任何后台线程或定时器。
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const LOG_DIR: &str = "logs";
const PANIC_LOG: &str = "panic.log";
/// 最多保留 3 个崩溃日志（panic.log + 2 个轮转文件），单个不超过 256KB。
const PANIC_MAX_FILES: usize = 3;
const PANIC_MAX_BYTES: usize = 256 * 1024;
/// panic hook 内写盘需要串行，避免多线程同时崩溃时内容交错。
static PANIC_LOCK: Mutex<()> = Mutex::new(());

/// 安装 panic hook：崩溃时追加到 `<数据目录>/logs/panic.log`，其余行为保持默认。
pub fn install_panic_hook(base: &Path) {
    let dir = base.join(LOG_DIR);
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .map(|text| (*text).to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "未知崩溃".to_string());

        let mut text = String::new();
        text.push_str(&format!("===== {} =====\n", utc_now()));
        text.push_str(&format!("消息：{}\n", one_line(&message, 300)));
        if let Some(location) = info.location() {
            text.push_str(&format!(
                "位置：{}:{}:{}\n",
                location.file(),
                location.line(),
                location.column()
            ));
        }
        text.push_str("回溯（摘要）：\n");
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        for line in backtrace.lines().filter(|line| !line.trim().is_empty()).take(12) {
            text.push_str(line);
            text.push('\n');
        }
        text.push('\n');

        append_panic(&dir, &text);
        // 保留默认输出，不改变原有崩溃行为。
        previous(info);
    }));
}

fn append_panic(dir: &Path, text: &str) {
    let _guard = PANIC_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let path = dir.join(PANIC_LOG);
    let current = fs::metadata(&path).map(|meta| meta.len() as usize).unwrap_or(0);
    if current > 0 && current + text.len() > PANIC_MAX_BYTES {
        rotate(dir);
    }
    let content = clamp_text(text, PANIC_MAX_BYTES);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(content.as_bytes());
    }
}

fn rotate(dir: &Path) {
    // 先删最旧的，再把 panic.1 → panic.2 …… 依次后移，最后把当前日志挪到 panic.1。
    let _ = fs::remove_file(dir.join(format!("panic.{}.log", PANIC_MAX_FILES - 1)));
    for index in (1..PANIC_MAX_FILES - 1).rev() {
        let _ = fs::rename(
            dir.join(format!("panic.{index}.log")),
            dir.join(format!("panic.{}.log", index + 1)),
        );
    }
    let _ = fs::rename(dir.join(PANIC_LOG), dir.join("panic.1.log"));
}

/// 按字符边界截断，避免把 UTF-8 字符切坏。
fn clamp_text(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max.saturating_sub(64);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…（内容过长已截断）\n", &text[..end])
}

fn one_line(text: &str, max: usize) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut end = joined.len().min(max);
    while end > 0 && !joined.is_char_boundary(end) {
        end -= 1;
    }
    joined[..end].to_string()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn utc_now() -> String {
    format_millis(now_millis())
}

fn format_millis(millis: u64) -> String {
    let seconds = (millis / 1000) as i64;
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

fn file_stamp() -> String {
    let seconds = (now_millis() / 1000) as i64;
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

/// Howard Hinnant 的 civil_from_days，避免为了时间格式引入额外依赖。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        if month <= 2 { year + 1 } else { year },
        month as u32,
        day as u32,
    )
}

/// 在桌面生成脱敏后的诊断文本，返回文件绝对路径。
#[tauri::command]
pub fn export_diagnostics(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位数据目录：{error}"))?;
    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|error| format!("无法定位桌面目录：{error}"))?;
    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
        .unwrap_or_default();

    let mut out = String::new();
    out.push_str("启点诊断报告\n");
    out.push_str(&format!("生成时间：{}\n", utc_now()));
    out.push_str(&format!("程序版本：{}\n", env!("CARGO_PKG_VERSION")));
    out.push_str(&format!("安装路径：{}\n", install_dir.display()));
    out.push_str(&format!("数据目录：{}\n", base.display()));
    out.push_str(&format!("系统信息：{}\n", system_summary()));

    out.push_str("\n插件状态：\n");
    let modules = crate::modules::list(&base);
    if modules.is_empty() {
        out.push_str("  - 无\n");
    }
    for module in modules {
        out.push_str(&format!(
            "  - {} {}：{}\n",
            module.name,
            module.version,
            if module.installed { "已安装" } else { "未安装" }
        ));
    }

    out.push_str("\n最近一次崩溃：\n");
    out.push_str(&last_panic_summary(&base));

    out.push_str("\n最近清理记录：\n");
    out.push_str(&cleanup_summary(&base));

    out.push_str("\n最近优化记录：\n");
    out.push_str(&optimize_summary(&base));
    out.push_str(&memory_summary(&base));

    out.push_str("\n脱敏说明：路径中的用户名已替换为环境变量占位符，报告不包含账号、网络、机器名或登录信息。\n");

    let text = sanitize(&out);
    let path = desktop.join(format!("QiDian-Diagnostics-{}.txt", file_stamp()));
    fs::create_dir_all(&desktop).map_err(|error| format!("无法创建桌面路径：{error}"))?;
    fs::write(&path, text).map_err(|error| format!("写入诊断文件失败：{error}"))?;
    Ok(path.to_string_lossy().to_string())
}

fn last_panic_summary(base: &Path) -> String {
    let path = base.join(LOG_DIR).join(PANIC_LOG);
    let Ok(bytes) = fs::read(&path) else {
        return "  无记录\n".to_string();
    };
    let text = String::from_utf8_lossy(&bytes);
    let start = text.rfind("===== ").unwrap_or(0);
    let block = text[start..].lines().take(8).collect::<Vec<_>>().join("\n");
    format!("{}\n", clamp_text(block.trim(), 1_200))
}

fn cleanup_summary(base: &Path) -> String {
    let Some(json) = read_json(&base.join("perf-stats.json")) else {
        return "  无记录\n".to_string();
    };
    let count = json.get("clean_count").and_then(Value::as_u64).unwrap_or(0);
    let total = json.get("freed_bytes").and_then(Value::as_u64).unwrap_or(0);
    let mut out = format!("  累计清理 {count} 次，共释放 {}。\n", human_bytes(total));
    if let Some(items) = json.get("recent_cleans").and_then(Value::as_array) {
        for item in items.iter().take(5) {
            let at = item.get("at").and_then(Value::as_u64).unwrap_or(0);
            let freed = item.get("freed_bytes").and_then(Value::as_u64).unwrap_or(0);
            let files = item.get("files").and_then(Value::as_u64).unwrap_or(0);
            out.push_str(&format!(
                "  - {} 释放 {}，{} 个文件\n",
                format_millis(at),
                human_bytes(freed),
                files
            ));
        }
    }
    out
}

fn optimize_summary(base: &Path) -> String {
    let Some(json) = read_json(&base.join("optimize-backup.json")) else {
        return "  优化：无记录\n".to_string();
    };
    let count = json
        .get("values")
        .and_then(Value::as_object)
        .map(|values| values.len())
        .unwrap_or(0);
    if count == 0 {
        "  优化：无记录\n".to_string()
    } else {
        format!("  优化：当前 {count} 项保持生效，可在应用内还原（具体注册表键值不写入诊断）。\n")
    }
}

fn memory_summary(base: &Path) -> String {
    let Some(json) = read_json(&base.join("memory-stats.json")) else {
        return "  内存释放：无记录\n".to_string();
    };
    let released = json
        .get("released_bytes")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let adjust = json
        .get("adjust_count")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    format!("  内存释放：累计 {}，调节 {} 次\n", human_bytes(released), adjust)
}

fn read_json(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} {}", UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(windows)]
fn system_summary() -> String {
    use windows::Win32::System::SystemInformation::{
        GetNativeSystemInfo, GlobalMemoryStatusEx, MEMORYSTATUSEX, SYSTEM_INFO,
    };
    use winreg::enums::HKEY_LOCAL_MACHINE;

    let mut os = String::from("Windows");
    if let Ok(key) = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
    {
        let product: String = key.get_value("ProductName").unwrap_or_default();
        let display: String = key.get_value("DisplayVersion").unwrap_or_default();
        let build: String = key.get_value("CurrentBuildNumber").unwrap_or_default();
        let ubr: u32 = key.get_value("UBR").unwrap_or(0);
        if !product.trim().is_empty() {
            os = product.trim().to_string();
        }
        if !display.trim().is_empty() {
            os.push(' ');
            os.push_str(display.trim());
        }
        if !build.trim().is_empty() {
            os.push_str(&format!(" (Build {}.{ubr})", build.trim()));
        }
    }

    let mut cpu = String::from("未知 CPU");
    if let Ok(key) = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
    {
        if let Ok(name) = key.get_value::<String, _>("ProcessorNameString") {
            if !name.trim().is_empty() {
                cpu = name.trim().to_string();
            }
        }
    }

    let mut info = SYSTEM_INFO::default();
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe {
        GetNativeSystemInfo(&mut info);
        let _ = GlobalMemoryStatusEx(&mut status);
    }
    let cores = info.dwNumberOfProcessors;

    format!(
        "{} · {} 架构 · CPU：{}（{} 逻辑核心）· 内存：{}（可用 {}）",
        os,
        std::env::consts::ARCH,
        cpu,
        cores,
        human_bytes(status.ullTotalPhys),
        human_bytes(status.ullAvailPhys)
    )
}

#[cfg(not(windows))]
fn system_summary() -> String {
    let cores = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(0);
    let (total, avail) = linux_memory().unwrap_or((0, 0));
    let memory = if total == 0 {
        "未知".to_string()
    } else {
        format!("{}（可用 {}）", human_bytes(total), human_bytes(avail))
    };
    format!(
        "{} · {} 架构 · CPU：{} 逻辑核心 · 内存：{}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        cores,
        memory
    )
}

#[cfg(not(windows))]
fn linux_memory() -> Option<(u64, u64)> {
    let text = fs::read_to_string("/proc/meminfo").ok()?;
    let mut total = 0u64;
    let mut avail = 0u64;
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let key = parts.next()?;
        let value = parts.next().and_then(|value| value.parse::<u64>().ok())?;
        match key {
            "MemTotal:" => total = value * 1024,
            "MemAvailable:" => avail = value * 1024,
            _ => {}
        }
    }
    Some((total, avail))
}

/// 脱敏：按“长路径优先”替换用户目录，再兜底掩掉 `C:\Users\<name>`。
fn sanitize(input: &str) -> String {
    let mut out = input.to_string();
    for variable in ["LOCALAPPDATA", "APPDATA", "USERPROFILE", "HOME"] {
        if let Ok(value) = std::env::var(variable) {
            if value.len() > 3 {
                let token = format!("%{variable}%");
                out = replace_ci(&out, &value, &token);
            }
        }
    }
    mask_windows_profile(&out)
}

fn replace_ci(haystack: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return haystack.to_string();
    }
    // 非 ASCII 路径（如中文用户名）不涉及大小写，直接精确替换。
    if !needle.is_ascii() {
        return haystack.replace(needle, replacement);
    }
    let bytes = haystack.as_bytes();
    let target = needle.as_bytes();
    let mut out = String::with_capacity(haystack.len());
    let mut cursor = 0;
    let mut index = 0;
    while index + target.len() <= bytes.len() {
        let matched = target.iter().enumerate().all(|(offset, byte)| {
            bytes[index + offset].eq_ignore_ascii_case(byte)
        });
        if matched {
            // 命中位置必然从 ASCII 字节开始，可直接按字节切片。
            out.push_str(&haystack[cursor..index]);
            out.push_str(replacement);
            index += target.len();
            cursor = index;
        } else {
            index += 1;
        }
    }
    out.push_str(&haystack[cursor..]);
    out
}

fn mask_windows_profile(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let prefix = r"c:\users\";
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(found) = lower[cursor..].find(prefix) {
        let start = cursor + found;
        let name_start = start + prefix.len();
        out.push_str(&text[cursor..name_start]);
        let rest = &text[name_start..];
        let name_end = rest.find('\\').unwrap_or(rest.len());
        out.push_str("<用户>");
        cursor = name_start + name_end;
    }
    out.push_str(&text[cursor..]);
    out
}

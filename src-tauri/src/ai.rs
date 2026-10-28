//! 本地 AI 助手：下载 llama.cpp / whisper.cpp 与模型，管理本地推理进程。
//!
//! 所有文件都放在数据目录 `ai/` 下，下载源只有 GitHub Release 与 Hugging Face
//! （含国内镜像）；模型就绪后完全离线运行，不上传任何对话或音频。

use crate::store::Paths;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

pub const PORT: u16 = 11435;

const LLAMA_URL: &str =
    "https://github.com/ggml-org/llama.cpp/releases/download/b11946/llama-b11946-bin-win-cpu-x64.zip";
const LLAMA_BYTES: u64 = 24_376_086;
const WHISPER_URL: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip";
const WHISPER_BYTES: u64 = 8_928_640;
const WHISPER_MODEL: &str = "ggml-base.bin";
const WHISPER_MODEL_BYTES: u64 = 147_951_465;
const WHISPER_MODEL_URLS: &[&str] = &[
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
];

/// 可选语言模型。低配电脑选 0.5B，性能越好越可以往上选。
pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub file: &'static str,
    pub bytes: u64,
    pub memory: &'static str,
    pub note: &'static str,
    pub context: u32,
    pub urls: &'static [&'static str],
}

pub const DEFAULT_MODEL: &str = "qwen1.5b";

pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "qwen0.5b",
        label: "Qwen2.5-0.5B",
        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        bytes: 491_400_032,
        memory: "内存约 1.2 GB",
        note: "低配电脑首选：下载最小、响应最快，复杂指令偶尔理解不到位",
        context: 4096,
        urls: &[
            "https://hf-mirror.com/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "https://modelscope.cn/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/master/qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
        ],
    },
    ModelSpec {
        id: "qwen1.5b",
        label: "Qwen2.5-1.5B",
        file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        bytes: 1_117_320_736,
        memory: "内存约 2.2 GB",
        note: "默认推荐：问答、工具调用与速度平衡",
        context: 4096,
        urls: &[
            "https://hf-mirror.com/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
            "https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/master/qwen2.5-1.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
        ],
    },
    ModelSpec {
        id: "qwen3b",
        label: "Qwen2.5-3B",
        file: "qwen2.5-3b-instruct-q4_k_m.gguf",
        bytes: 2_104_932_768,
        memory: "内存约 3.5 GB",
        note: "性能较好的电脑：理解与工具调用最稳，启动更慢",
        context: 3072,
        urls: &[
            "https://hf-mirror.com/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
            "https://modelscope.cn/models/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/master/qwen2.5-3b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
        ],
    },
];

/// 推理进程句柄。只允许一个 llama-server 实例，重复启动直接复用。
#[derive(Default)]
pub struct AiState {
    server: Mutex<Option<Child>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    /// 安装器里是否勾选了 AI 助手，或用户后来在插件页启用。
    pub enabled: bool,
    /// 运行时、语音模型与所选语言模型是否都已落盘。
    pub installed: bool,
    /// llama-server 是否正在运行。
    pub running: bool,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub model_label: String,
    pub downloading: bool,
    /// 当前选中的语言模型 id。
    pub model: String,
    /// 所有可选语言模型及其安装状态。
    pub models: Vec<AiModelInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelInfo {
    pub id: String,
    pub label: String,
    pub bytes: u64,
    pub memory: String,
    pub note: String,
    pub installed: bool,
    pub selected: bool,
}

static DOWNLOADING: Mutex<bool> = Mutex::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProgress {
    phase: String,
    done: u64,
    total: u64,
    percent: f64,
}

impl AiState {
    pub fn running(&self) -> bool {
        let Ok(mut guard) = self.server.lock() else {
            return false;
        };
        let Some(child) = guard.as_mut() else {
            return false;
        };
        matches!(child.try_wait(), Ok(None))
    }
}

/* ── 路径与状态 ──────────────────────────────────────────────── */

pub fn ai_dir(paths: &Paths) -> PathBuf {
    paths.base.join("ai")
}

fn models_dir(paths: &Paths) -> PathBuf {
    ai_dir(paths).join("models")
}

pub fn model_by_id(id: &str) -> &'static ModelSpec {
    MODELS
        .iter()
        .find(|spec| spec.id == id)
        .unwrap_or(&MODELS[1])
}

pub fn selected_spec() -> &'static ModelSpec {
    model_by_id(&selected_model_id())
}

fn model_path(paths: &Paths, spec: &ModelSpec) -> PathBuf {
    models_dir(paths).join(spec.file)
}

fn whisper_model(paths: &Paths) -> PathBuf {
    models_dir(paths).join(WHISPER_MODEL)
}

fn find_named(dir: &Path, names: &[&str], depth: u8) -> Option<PathBuf> {
    if depth == 0 || !dir.is_dir() {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_named(&path, names, depth - 1) {
                return Some(found);
            }
        } else if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
            if names.iter().any(|wanted| name.eq_ignore_ascii_case(wanted)) {
                return Some(path);
            }
        }
    }
    None
}

fn llama_server_exe(paths: &Paths) -> Option<PathBuf> {
    find_named(&ai_dir(paths).join("llama"), &["llama-server.exe"], 5)
}

fn whisper_cli_exe(paths: &Paths) -> Option<PathBuf> {
    find_named(
        &ai_dir(paths).join("whisper"),
        &["whisper-cli.exe", "main.exe", "whisper.exe"],
        5,
    )
}

pub fn installed(paths: &Paths) -> bool {
    llama_server_exe(paths).is_some()
        && whisper_cli_exe(paths).is_some()
        && model_path(paths, selected_spec()).is_file()
        && whisper_model(paths).is_file()
}

pub fn model_installed(paths: &Paths, spec: &ModelSpec) -> bool {
    model_path(paths, spec).is_file()
}

fn downloaded_bytes(paths: &Paths) -> u64 {
    [model_path(paths, selected_spec()), whisper_model(paths)]
        .iter()
        .filter_map(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len())
        .sum()
}

#[cfg(windows)]
pub fn enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\QiDian")
        .and_then(|key| key.get_value::<u32, _>("AiEnabled"))
        .map(|value| value == 1)
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn enabled() -> bool {
    false
}

#[cfg(windows)]
pub fn set_enabled(value: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\QiDian")
        .map_err(|error| format!("无法写入安装偏好：{error}"))?
        .0;
    key.set_value("AiEnabled", &u32::from(value))
        .map_err(|error| format!("无法写入安装偏好：{error}"))
}

#[cfg(not(windows))]
pub fn set_enabled(_value: bool) -> Result<(), String> {
    Err("AI 助手仅支持 Windows".to_string())
}

#[cfg(windows)]
pub fn selected_model_id() -> String {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let stored = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\QiDian")
        .and_then(|key| key.get_value::<String, _>("AiModel"))
        .ok();
    match stored {
        Some(id) if MODELS.iter().any(|spec| spec.id == id) => id,
        _ => DEFAULT_MODEL.to_string(),
    }
}

#[cfg(not(windows))]
pub fn selected_model_id() -> String {
    DEFAULT_MODEL.to_string()
}

#[cfg(windows)]
pub fn set_model(id: &str, state: &AiState) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    if !MODELS.iter().any(|spec| spec.id == id) {
        return Err("未知的模型".to_string());
    }
    // 切换模型时先释放当前推理进程，避免继续占用内存。
    stop(state);
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\QiDian")
        .map_err(|error| format!("无法保存模型偏好：{error}"))?
        .0;
    key.set_value("AiModel", &id)
        .map_err(|error| format!("无法保存模型偏好：{error}"))
}

#[cfg(not(windows))]
pub fn set_model(_id: &str, _state: &AiState) -> Result<(), String> {
    Err("AI 助手仅支持 Windows".to_string())
}

pub fn is_downloading() -> bool {
    DOWNLOADING.lock().map(|value| *value).unwrap_or(false)
}

pub fn status(paths: &Paths, state: &AiState) -> AiStatus {
    let spec = selected_spec();
    let selected = spec.id.to_string();
    let models = MODELS
        .iter()
        .map(|item| AiModelInfo {
            id: item.id.to_string(),
            label: item.label.to_string(),
            bytes: item.bytes,
            memory: item.memory.to_string(),
            note: item.note.to_string(),
            installed: model_installed(paths, item),
            selected: item.id == spec.id,
        })
        .collect();
    AiStatus {
        enabled: enabled(),
        installed: installed(paths),
        running: state.running(),
        downloaded_bytes: downloaded_bytes(paths),
        total_bytes: spec.bytes + WHISPER_MODEL_BYTES,
        model_label: spec.label.to_string(),
        downloading: is_downloading(),
        model: selected,
        models,
    }
}

/* ── 下载与解压 ──────────────────────────────────────────────── */

#[cfg(windows)]
fn emit_progress(app: &AppHandle, phase: &str, done: u64, total: u64) {
    use tauri::Emitter;
    let percent = if total == 0 {
        0.0
    } else {
        (done as f64 / total as f64 * 100.0).clamp(0.0, 100.0)
    };
    let _ = app.emit(
        "ai-progress",
        AiProgress {
            phase: phase.to_string(),
            done,
            total,
            percent,
        },
    );
}

#[cfg(windows)]
fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// 下载单个文件：保留 `.part` 断点，按 URL 轮换并多次续传。
///
/// `base` / `pack_total` 用于把分项进度折算成整个组件包的总进度。
#[cfg(windows)]
fn download_asset(
    app: &AppHandle,
    urls: &[&str],
    dest: &Path,
    expected: u64,
    phase: &str,
    base: u64,
    pack_total: u64,
) -> Result<(), String> {
    use std::fs;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    // 允许 2% 的误差：镜像可能修订文件，或解压工具补充了元数据。
    let enough = expected.saturating_mul(98) / 100;
    if file_len(dest) >= enough {
        emit_progress(app, phase, base + expected, pack_total);
        return Ok(());
    }
    if file_len(dest) > 0 {
        let _ = fs::remove_file(dest);
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建模型目录：{error}"))?;
    }
    let file_name = dest
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download.bin");
    let part = dest.with_file_name(format!("{file_name}.part"));
    // 上次中断时已经下满的临时文件直接转正，避免重复下载。
    if file_len(&part) >= enough {
        fs::rename(&part, dest).map_err(|error| format!("无法保存模型文件：{error}"))?;
        emit_progress(app, phase, base + expected, pack_total);
        return Ok(());
    }
    let mut last_error = String::new();
    let rounds = 3u32;

    for round in 0..rounds {
        for url in urls {
            // 每个 URL 最多两轮：第一轮续传，服务器不支持 Range 时清空后从头再来。
            for _ in 0..2 {
                let resume = file_len(&part) > 0;
                let mut command = Command::new("curl.exe");
                command.args([
                    "-L",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--connect-timeout",
                    "20",
                    // 连续 45 秒低于 4 KB/s 视为卡死，交给外层续传重试。
                    "--speed-limit",
                    "4096",
                    "--speed-time",
                    "45",
                    "--output",
                ]);
                command.arg(&part);
                if resume {
                    command.args(["--continue-at", "-"]);
                }
                let mut child = match command
                    .arg(url)
                    .stdout(Stdio::null())
                    .stderr(Stdio::piped())
                    .creation_flags(0x0800_0000)
                    .spawn()
                {
                    Ok(child) => child,
                    Err(error) => {
                        return Err(format!(
                            "无法调用 curl.exe 下载模型（Windows 10 1809+ 自带）：{error}"
                        ))
                    }
                };

                let mut last_emit = Instant::now();
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) => {}
                        Err(_) => {
                            let _ = child.kill();
                            break;
                        }
                    }
                    if last_emit.elapsed() >= Duration::from_millis(280) {
                        emit_progress(app, phase, base + file_len(&part), pack_total);
                        last_emit = Instant::now();
                    }
                    std::thread::sleep(Duration::from_millis(120));
                }

                let output = child.wait_with_output().ok();
                let status = output.as_ref().map(|output| output.status);
                let success = status.map(|status| status.success()).unwrap_or(false);
                let code = status.and_then(|status| status.code());
                let size = file_len(&part);
                if success && (enough..=expected + expected / 50).contains(&size) {
                    fs::rename(&part, dest)
                        .map_err(|error| format!("无法保存模型文件：{error}"))?;
                    emit_progress(app, phase, base + expected, pack_total);
                    return Ok(());
                }
                last_error = output
                    .and_then(|output| String::from_utf8(output.stderr).ok())
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if code == Some(33) {
                    // 服务器不支持断点续传：清空临时文件，下一轮从头下载。
                    let _ = fs::remove_file(&part);
                    continue;
                }
                if success && !(enough..=expected + expected / 50).contains(&size) {
                    // 返回 200 但文件明显不对（例如错误页），丢弃后换源。
                    let _ = fs::remove_file(&part);
                }
                // 其余失败保留 .part，下一轮 URL / 下一轮重试从断点继续。
                break;
            }
        }
        if round + 1 < rounds {
            emit_progress(app, phase, base + file_len(&part), pack_total);
            std::thread::sleep(Duration::from_millis(1500));
        }
    }

    Err(format!(
        "下载失败：{}。已下载的 {} 会保留，重试会从断点继续。",
        if last_error.is_empty() {
            "网络不可用或下载源拒绝连接".to_string()
        } else {
            last_error
        },
        human_bytes(file_len(&part))
    ))
}

#[cfg(windows)]
fn extract_zip(
    app: &AppHandle,
    zip: &Path,
    dir: &Path,
    phase: &str,
    done: u64,
    pack_total: u64,
) -> Result<(), String> {
    use std::fs;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    fs::create_dir_all(dir).map_err(|error| format!("无法创建组件目录：{error}"))?;
    emit_progress(app, phase, done, pack_total);
    let status = Command::new("tar.exe")
        .arg("-xf")
        .arg(zip)
        .arg("-C")
        .arg(dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .status();
    let ok = status.map(|value| value.success()).unwrap_or(false);
    if !ok {
        let quote = |value: &Path| value.to_string_lossy().replace('\'', "''");
        let script = format!(
            "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            quote(zip),
            quote(dir)
        );
        let status = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &script,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .status()
            .map_err(|error| format!("无法解压组件：{error}"))?;
        if !status.success() {
            return Err("组件压缩包解压失败，请重试".to_string());
        }
    }
    emit_progress(app, phase, done, pack_total);
    Ok(())
}

#[cfg(windows)]
fn human_bytes(bytes: u64) -> String {
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = MB * 1024.0;
    let value = bytes as f64;
    if value >= GB {
        format!("{:.2} GB", value / GB)
    } else if value >= MB {
        format!("{:.1} MB", value / MB)
    } else {
        format!("{} KB", (bytes / 1024).max(1))
    }
}

#[cfg(windows)]
pub fn download_pack(app: &AppHandle, paths: &Paths) -> Result<(), String> {
    {
        let mut guard = DOWNLOADING.lock().map_err(|_| "下载状态不可用".to_string())?;
        if *guard {
            return Err("正在下载，请稍候".to_string());
        }
        *guard = true;
    }
    let result = download_pack_inner(app, paths);
    if let Ok(mut guard) = DOWNLOADING.lock() {
        *guard = false;
    }
    result
}

#[cfg(windows)]
fn download_pack_inner(app: &AppHandle, paths: &Paths) -> Result<(), String> {
    use std::fs;

    let dir = ai_dir(paths);
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建 AI 目录：{error}"))?;
    let spec = selected_spec();
    let pack_total = LLAMA_BYTES + WHISPER_BYTES + spec.bytes + WHISPER_MODEL_BYTES;
    let mut base = 0u64;

    if llama_server_exe(paths).is_none() {
        let zip = dir.join("llama.zip");
        download_asset(app, &[LLAMA_URL], &zip, LLAMA_BYTES, "llama", base, pack_total)?;
        extract_zip(
            app,
            &zip,
            &dir.join("llama"),
            "extract",
            base + LLAMA_BYTES,
            pack_total,
        )?;
        let _ = fs::remove_file(&zip);
        if llama_server_exe(paths).is_none() {
            return Err("llama.cpp 组件解压后缺少 llama-server.exe".to_string());
        }
    }
    base += LLAMA_BYTES;

    if whisper_cli_exe(paths).is_none() {
        let zip = dir.join("whisper.zip");
        download_asset(
            app,
            &[WHISPER_URL],
            &zip,
            WHISPER_BYTES,
            "whisper",
            base,
            pack_total,
        )?;
        extract_zip(
            app,
            &zip,
            &dir.join("whisper"),
            "extract",
            base + WHISPER_BYTES,
            pack_total,
        )?;
        let _ = fs::remove_file(&zip);
        if whisper_cli_exe(paths).is_none() {
            return Err("whisper.cpp 组件解压后缺少 whisper-cli.exe".to_string());
        }
    }
    base += WHISPER_BYTES;

    if !model_installed(paths, spec) {
        download_asset(
            app,
            spec.urls,
            &model_path(paths, spec),
            spec.bytes,
            "model",
            base,
            pack_total,
        )?;
    }
    base += spec.bytes;

    if !whisper_model(paths).is_file() {
        download_asset(
            app,
            WHISPER_MODEL_URLS,
            &whisper_model(paths),
            WHISPER_MODEL_BYTES,
            "speech",
            base,
            pack_total,
        )?;
    }
    // 新模型已经落盘，顺手删掉其它模型文件，避免同时占用多份空间。
    for other in MODELS {
        if other.id == spec.id {
            continue;
        }
        let _ = fs::remove_file(model_path(paths, other));
        let _ = fs::remove_file(model_path(paths, other).with_file_name(format!(
            "{}.part",
            other.file
        )));
    }
    emit_progress(app, "done", pack_total, pack_total);
    Ok(())
}

#[cfg(not(windows))]
pub fn download_pack(_app: &AppHandle, _paths: &Paths) -> Result<(), String> {
    Err("AI 助手仅支持 Windows".to_string())
}

/* ── llama-server 管理 ──────────────────────────────────────── */

#[cfg(windows)]
pub fn start(paths: &Paths, state: &AiState) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    if state.running() {
        return Ok(());
    }
    if !installed(paths) {
        return Err("请先下载 AI 组件".to_string());
    }
    let spec = selected_spec();
    let exe = llama_server_exe(paths).ok_or_else(|| "缺少 llama-server.exe".to_string())?;
    let model = model_path(paths, spec);
    // 线程数按本机核心数收敛，既吃满 CPU 又避免在低配机器上抢占过度。
    let threads = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .clamp(2, 8);
    {
        let mut guard = state.server.lock().map_err(|_| "AI 状态不可用".to_string())?;
        *guard = None;
        let child = Command::new(&exe)
            .arg("-m")
            .arg(&model)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(PORT.to_string())
            .arg("-c")
            .arg(spec.context.to_string())
            .arg("-t")
            .arg(threads.to_string())
            .arg("--jinja")
            .arg("--no-webui")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|error| format!("无法启动本地模型：{error}"))?;
        *guard = Some(child);
    }

    let deadline = Instant::now() + Duration::from_secs(75);
    loop {
        if port_ready() {
            return Ok(());
        }
        {
            let mut guard = state.server.lock().map_err(|_| "AI 状态不可用".to_string())?;
            if let Some(child) = guard.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    *guard = None;
                    return Err(format!("本地模型启动失败（{status}）"));
                }
            }
        }
        if Instant::now() >= deadline {
            stop(state);
            return Err("本地模型启动超时".to_string());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(not(windows))]
pub fn start(_paths: &Paths, _state: &AiState) -> Result<(), String> {
    Err("AI 助手仅支持 Windows".to_string())
}

pub fn stop(state: &AiState) {
    let Ok(mut guard) = state.server.lock() else {
        return;
    };
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn port_ready() -> bool {
    use std::net::{SocketAddr, TcpStream};
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], PORT)),
        Duration::from_millis(300),
    )
    .is_ok()
}

#[cfg(windows)]
fn http_post(body: &str) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let mut stream = TcpStream::connect(("127.0.0.1", PORT))
        .map_err(|_| "本地模型尚未启动".to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(180)))
        .map_err(|error| error.to_string())?;
    let request = format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("无法发送请求：{error}"))?;
    let mut buffer = Vec::new();
    stream
        .read_to_end(&mut buffer)
        .map_err(|error| format!("读取模型响应失败：{error}"))?;
    let split = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "模型返回了无效响应".to_string())?;
    String::from_utf8(buffer[split + 4..].to_vec())
        .map_err(|error| format!("模型响应编码错误：{error}"))
}

#[cfg(windows)]
pub fn chat(messages: Value, tools: Value) -> Result<Value, String> {
    let mut body = serde_json::json!({
        "model": "qwen2.5-1.5b-instruct",
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 512,
        "stream": false,
    });
    // 所有工具都被用户关闭时不发送 tools，避免模型继续尝试函数调用。
    if tools
        .as_array()
        .map(|items| !items.is_empty())
        .unwrap_or(false)
    {
        body["tools"] = tools;
        body["tool_choice"] = serde_json::json!("auto");
    }
    let response = http_post(&body.to_string())?;
    let value: Value =
        serde_json::from_str(&response).map_err(|error| format!("模型响应解析失败：{error}"))?;
    value
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .cloned()
        .ok_or_else(|| {
            let message = value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(|message| message.as_str())
                .unwrap_or("本地模型没有返回内容");
            message.to_string()
        })
}

#[cfg(not(windows))]
pub fn chat(_messages: Value, _tools: Value) -> Result<Value, String> {
    Err("AI 助手仅支持 Windows".to_string())
}

/* ── 语音识别 ──────────────────────────────────────────────── */

#[cfg(windows)]
pub fn transcribe(paths: &Paths, wav_base64: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::fs;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    let exe = whisper_cli_exe(paths).ok_or_else(|| "语音组件尚未安装".to_string())?;
    let model = whisper_model(paths);
    let bytes = STANDARD
        .decode(wav_base64)
        .map_err(|error| format!("音频解码失败：{error}"))?;
    if bytes.len() < 1024 {
        return Err("录音太短".to_string());
    }
    let dir = ai_dir(paths).join("tmp");
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建临时目录：{error}"))?;
    let stamp = crate::store::now_millis();
    let wav = dir.join(format!("voice-{stamp}.wav"));
    let prefix = dir.join(format!("voice-{stamp}"));
    fs::write(&wav, &bytes).map_err(|error| format!("无法保存录音：{error}"))?;

    let mut child = Command::new(&exe)
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(&wav)
        .arg("-l")
        .arg("auto")
        .arg("-nt")
        .arg("-otxt")
        .arg("-of")
        .arg(&prefix)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|error| format!("无法启动语音识别：{error}"))?;

    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            break;
        }
        std::thread::sleep(Duration::from_millis(120));
    }

    let text = fs::read_to_string(prefix.with_extension("txt")).unwrap_or_default();
    let _ = fs::remove_file(&wav);
    let _ = fs::remove_file(prefix.with_extension("txt"));
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("没有识别到语音内容，请靠近麦克风重试".to_string());
    }
    Ok(text)
}

#[cfg(not(windows))]
pub fn transcribe(_paths: &Paths, _wav_base64: &str) -> Result<String, String> {
    Err("AI 助手仅支持 Windows".to_string())
}

/* ── 删除组件 ──────────────────────────────────────────────── */

#[cfg(windows)]
pub fn remove(paths: &Paths, state: &AiState) -> Result<(), String> {
    stop(state);
    let dir = ai_dir(paths);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|error| format!("无法删除 AI 组件：{error}"))?;
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn remove(_paths: &Paths, _state: &AiState) -> Result<(), String> {
    Ok(())
}

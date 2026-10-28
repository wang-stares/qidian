/// 运行一次无窗口的 Windows PowerShell，返回标准输出。
/// 仅用于按需枚举（Microsoft Store 应用、运行中进程），不做后台轮询。
#[cfg(windows)]
pub fn run_encoded(script: &str) -> Option<Vec<u8>> {
    run_encoded_with_timeout(script, 15)
}

/// 与 [`run_encoded`] 相同，可指定超时；开始菜单清单在冷启动或杀软扫描时
/// 可能超过 15 秒，需要更宽松的上限。
#[cfg(windows)]
pub fn run_encoded_with_timeout(script: &str, seconds: u64) -> Option<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let encoded = {
        let bytes: Vec<u8> = script
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        STANDARD.encode(bytes)
    };

    let mut child = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .spawn()
        .ok()?;

    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    break;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(_) => break,
        }
    }

    child.wait_with_output().ok().map(|output| output.stdout)
}

#[cfg(not(windows))]
pub fn run_encoded(_script: &str) -> Option<Vec<u8>> {
    None
}

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVAL_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const STATE_KEY: &str = r"Software\QiDian";
const VALUE_NAME: &str = "QiDian";
const TASK_NAME: &str = "QiDian";
const STATE_TASK: &str = "AutostartTask";
const STATE_COMMAND: &str = "AutostartCommand";

pub fn is_enabled() -> bool {
    #[cfg(windows)]
    {
        // 先看注册表状态，避免没开过自启动的用户每次启动都拉起一次 schtasks。
        run_enabled() || (task_flag() && task_exists())
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn set_enabled(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        if enabled {
            enable_task()?;
        } else {
            disable_all();
        }
        Ok(is_enabled())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("开机自启动目前只支持 Windows".to_string())
    }
}

/// 应用被移动后，保持自启动命令指向当前可执行文件。
/// 管理员权限下使用计划任务（最高权限、登录触发）静默启动；
/// 旧版本遗留的 HKCU Run 仍会被修复或清理。
pub fn repair_command() {
    #[cfg(windows)]
    {
        let Ok(command) = desired_command() else {
            return;
        };
        if task_flag() {
            if stored_command().as_deref() == Some(command.as_str()) {
                return;
            }
            // 只在任务仍存在时更新，避免把用户主动删除的任务重新创建。
            if task_exists() && enable_task().is_ok() {
                return;
            }
            clear_state();
            return;
        }
        if run_enabled() {
            let current = read_command();
            if current.as_deref() != Some(command.as_str()) {
                write_run_value(&command);
            }
        }
    }
}

#[cfg(windows)]
fn enable_task() -> Result<(), String> {
    let command = desired_command()?;
    let (ok, output) = run_hidden(
        "schtasks",
        &[
            "/Create",
            "/TN",
            TASK_NAME,
            "/TR",
            command.as_str(),
            "/SC",
            "ONLOGON",
            "/RL",
            "HIGHEST",
            "/F",
        ],
    )?;
    if !ok {
        return Err(if output.trim().is_empty() {
            "创建开机自启动任务失败，可能需要管理员权限".to_string()
        } else {
            output.trim().to_string()
        });
    }
    set_state(&command);
    remove_run_value();
    Ok(())
}

#[cfg(windows)]
fn disable_all() {
    let _ = run_hidden("schtasks", &["/Delete", "/TN", TASK_NAME, "/F"]);
    remove_run_value();
    clear_state();
}

#[cfg(windows)]
fn task_exists() -> bool {
    run_hidden("schtasks", &["/Query", "/TN", TASK_NAME])
        .map(|(ok, _)| ok)
        .unwrap_or(false)
}

#[cfg(windows)]
fn set_state(command: &str) {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    if let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(STATE_KEY) {
        let _ = key.set_value(STATE_TASK, &1u32);
        let _ = key.set_value(STATE_COMMAND, &command);
    }
}

#[cfg(windows)]
fn clear_state() {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    if let Ok(key) =
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(STATE_KEY, KEY_SET_VALUE)
    {
        let _ = key.delete_value(STATE_TASK);
        let _ = key.delete_value(STATE_COMMAND);
    }
}

#[cfg(windows)]
fn task_flag() -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(STATE_KEY, KEY_READ)
        .ok()
        .and_then(|key| key.get_value::<u32, _>(STATE_TASK).ok())
        .map(|value| value == 1)
        .unwrap_or(false)
}

#[cfg(windows)]
fn stored_command() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(STATE_KEY, KEY_READ)
        .ok()
        .and_then(|key| key.get_value::<String, _>(STATE_COMMAND).ok())
}

#[cfg(windows)]
fn run_enabled() -> bool {
    read_command().is_some() && !approval_disabled()
}

#[cfg(windows)]
fn write_run_value(command: &str) {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    if let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN_KEY) {
        let _ = key.set_value(VALUE_NAME, &command);
    }
}

#[cfg(windows)]
fn remove_run_value() {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    if let Ok(key) =
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
    {
        let _ = key.delete_value(VALUE_NAME);
    }
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(APPROVAL_KEY, KEY_SET_VALUE | KEY_READ)
    {
        let _ = key.delete_value(VALUE_NAME);
    }
}

#[cfg(windows)]
fn read_command() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, KEY_READ)
        .ok()
        .and_then(|key| key.get_value::<String, _>(VALUE_NAME).ok())
}

#[cfg(windows)]
fn approval_disabled() -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(APPROVAL_KEY, KEY_READ)
        .ok()
        .and_then(|key| key.get_raw_value(VALUE_NAME).ok())
        .and_then(|value| value.bytes.first().copied())
        .map(|first| first & 1 == 1)
        .unwrap_or(false)
}

#[cfg(windows)]
fn desired_command() -> Result<String, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("无法定位启点可执行文件：{error}"))?;
    Ok(format!("\"{}\" --autostart", executable.display()))
}

#[cfg(windows)]
fn run_hidden(program: &str, args: &[&str]) -> Result<(bool, String), String> {
    use std::os::windows::process::CommandExt;

    let output = std::process::Command::new(program)
        .args(args)
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|error| format!("无法运行系统命令：{error}"))?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&output.stderr).to_string();
    }
    Ok((output.status.success(), text))
}

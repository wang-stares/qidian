use crate::models::LaunchTarget;
use std::path::Path;

/// 缓存里的应用是否仍然存在。Store 应用无法用文件路径判断，按存在处理。
pub fn target_exists(target: &LaunchTarget) -> bool {
    match target {
        LaunchTarget::Executable { path, .. } | LaunchTarget::Shortcut { path } => {
            Path::new(path).is_file()
        }
        LaunchTarget::Uwp { .. } => true,
    }
}

pub fn launch(target: &LaunchTarget) -> Result<(), String> {
    #[cfg(windows)]
    {
        launch_windows(target)
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err("启点目前只支持 Windows".to_string())
    }
}

pub fn reveal(target: &LaunchTarget) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let path = match target {
            LaunchTarget::Executable { path, .. } => path,
            LaunchTarget::Shortcut { path } => path,
            LaunchTarget::Uwp { .. } => {
                return Err("Store 应用没有可定位的文件位置".to_string());
            }
        };
        Command::new("explorer.exe")
            .arg(format!("/select,\"{path}\""))
            .creation_flags(0x0800_0000)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("无法打开文件位置：{error}"))
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err("启点目前只支持 Windows".to_string())
    }
}

pub fn open_folder(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        Command::new("explorer.exe")
            .arg(path)
            .creation_flags(0x0800_0000)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("无法打开目录：{error}"))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("启点目前只支持 Windows".to_string())
    }
}

#[cfg(windows)]
fn launch_windows(target: &LaunchTarget) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    match target {
        LaunchTarget::Executable {
            path,
            args,
            workdir,
        } => {
            if !Path::new(path).is_file() {
                return Err(format!("启动目标不存在：{path}"));
            }
            shell_open(
                path,
                args.as_deref().unwrap_or(""),
                workdir.as_deref().unwrap_or(""),
            )
        }
        LaunchTarget::Shortcut { path } => {
            if !Path::new(path).is_file() {
                return Err(format!("快捷方式不存在：{path}"));
            }
            shell_open(path, "", "")
        }
        LaunchTarget::Uwp { aumid } => {
            let uri = format!("shell:AppsFolder\\{aumid}");
            // 先让 Shell 直接激活目标，不额外拉起一个 explorer.exe；
            // 少数环境不支持 shell 路径时再退回 explorer.exe。
            if shell_open(&uri, "", "").is_ok() {
                return Ok(());
            }
            Command::new("explorer.exe")
                .arg(uri)
                .creation_flags(0x0800_0000)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("无法启动 Store 应用：{error}"))
        }
    }
}

#[cfg(windows)]
fn shell_open(file: &str, parameters: &str, workdir: &str) -> Result<(), String> {
    use windows::core::{w, HSTRING};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let file = HSTRING::from(file);
    let parameters = HSTRING::from(parameters);
    let workdir = HSTRING::from(workdir);
    let result = unsafe {
        ShellExecuteW(
            HWND::default(),
            w!("open"),
            &file,
            &parameters,
            &workdir,
            SW_SHOWNORMAL,
        )
    };
    let code = result.0 as isize;
    if code <= 32 {
        Err(format!("ShellExecute 返回错误码 {code}"))
    } else {
        Ok(())
    }
}

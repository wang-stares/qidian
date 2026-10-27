//! 强删引擎：删除被权限保护或被进程占用的文件/文件夹。
//!
//! 参考实现：
//! - takeown / SetNamedSecurityInfoW：先启用特权、取得所有权并给 Administrators
//!   授予完全控制，再重试删除（仅“管理员”令牌还不够，文件可能由
//!   TrustedInstaller / SYSTEM 所有，或 DACL 显式拒绝）。
//! - MoveFileExW(MOVEFILE_DELAY_UNTIL_REBOOT)：仍被进程占用时安排重启后删除。
//! - BleachBit：删除失败如实分类上报，绝不把失败当成成功。

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForceError {
    /// 权限拒绝：已尽力取所有权仍失败。
    AccessDenied(String),
    /// 被进程占用，且无法安排重启删除。
    Locked(String),
    /// 其它失败（非 Windows 平台的占位分支）。
    #[allow(dead_code)]
    Other(String),
}

impl ForceError {
    fn message(&self) -> String {
        match self {
            ForceError::AccessDenied(text) => text.clone(),
            ForceError::Locked(text) => text.clone(),
            ForceError::Other(text) => text.clone(),
        }
    }
}

/// 一次删除的汇总结果。
#[derive(Debug, Clone, Default)]
pub struct DeleteReport {
    pub freed_bytes: u64,
    /// 本次已删除的对象数（文件 + 目录）。
    pub files: u64,
    /// 已安排下次重启删除的对象数。
    pub pending: u64,
    /// 彻底失败的原因列表。
    pub errors: Vec<String>,
}

/// 尝试删除单个文件：普通删除 → 取所有权 + 授完全控制 → 重试 → 安排重启删除。
#[cfg(windows)]
pub fn remove_file_forced(path: &Path) -> Result<Option<u64>, ForceError> {
    // Some(bytes)：本次已删；None：已安排重启删除。
    match fs::remove_file(path) {
        Ok(()) => Ok(Some(0)),
        Err(error) => match error.kind() {
            ErrorKind::NotFound => Ok(Some(0)),
            ErrorKind::PermissionDenied => {
                if take_ownership_and_grant(path).is_ok() {
                    if fs::remove_file(path).is_ok() {
                        return Ok(Some(0));
                    }
                }
                if schedule_delete_on_reboot(path).is_ok() {
                    return Ok(None);
                }
                Err(ForceError::AccessDenied(format!(
                    "{}：权限不足且无法取回所有权",
                    path.to_string_lossy()
                )))
            }
            _ => {
                // 共享冲突 / 锁冲突 / 文件在用等 → 安排重启删除。
                if schedule_delete_on_reboot(path).is_ok() {
                    return Ok(None);
                }
                Err(ForceError::Locked(format!(
                    "{}：文件被占用且无法安排重启删除",
                    path.to_string_lossy()
                )))
            }
        },
    }
}

#[cfg(not(windows))]
pub fn remove_file_forced(_path: &Path) -> Result<Option<u64>, ForceError> {
    Err(ForceError::Other("强删只支持 Windows".to_string()))
}

/// 递归强删整个目录树；能删的立刻删，被占用的安排重启删除，失败的原因如实收集。
#[cfg(windows)]
pub fn delete_tree_forced(path: &Path) -> DeleteReport {
    let mut report = DeleteReport::default();
    delete_tree_inner(path, &mut report, 0);
    // 顶层目录本身最后尝试删除。
    remove_dir_forced(path, &mut report, true);
    report
}

#[cfg(not(windows))]
pub fn delete_tree_forced(_path: &Path) -> DeleteReport {
    DeleteReport {
        errors: vec!["强删只支持 Windows".to_string()],
        ..Default::default()
    }
}

#[cfg(windows)]
fn delete_tree_inner(path: &Path, report: &mut DeleteReport, depth: usize) {
    // 防御过深递归。
    if depth > 48 {
        report
            .errors
            .push(format!("{}：目录层级过深，已跳过", path.to_string_lossy()));
        return;
    }
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) => {
            if error.kind() != ErrorKind::NotFound {
                report
                    .errors
                    .push(format!("{}：无法读取目录：{error}", path.to_string_lossy()));
            }
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let child = entry.path();
        let metadata = match fs::symlink_metadata(&child) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => {
                report
                    .errors
                    .push(format!("{}：{error}", child.to_string_lossy()));
                continue;
            }
        };
        if metadata.file_type().is_dir() {
            delete_tree_inner(&child, report, depth + 1);
            remove_dir_forced(&child, report, false);
        } else if metadata.file_type().is_file() {
            report.freed_bytes += metadata.len();
            report.files += 1;
            match remove_file_forced(&child) {
                Ok(Some(_)) => {}
                Ok(None) => report.pending += 1,
                Err(error) => report.errors.push(error.message()),
            }
        }
        // 其它类型（符号链接、命名管道等）跳过，避免误删系统对象。
    }
}

/// 删除一个（应为空的）目录：普通删除 → 取所有权重试 → 仍失败则安排重启删除。
#[cfg(windows)]
fn remove_dir_forced(path: &Path, report: &mut DeleteReport, is_root: bool) {
    let remove = |p: &Path| -> std::io::Result<()> { fs::remove_dir(p) };
    match remove(path) {
        Ok(()) => {
            report.files += 1;
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            let mut handled = false;
            if error.kind() == ErrorKind::PermissionDenied
                && take_ownership_and_grant(path).is_ok()
                && remove(path).is_ok()
            {
                report.files += 1;
                handled = true;
            }
            if !handled && schedule_delete_on_reboot(path).is_ok() {
                // 目录内文件已安排重启删除，重启后目录为空即可被系统移除。
                report.pending += 1;
                if is_root {
                    report.files += 1;
                }
                handled = true;
            }
            if !handled {
                report.errors.push(format!(
                    "{}：{}",
                    path.to_string_lossy(),
                    error
                ));
            }
        }
    }
}

/* ── 特权与所有权 ───────────────────────────────────────────── */

#[cfg(windows)]
fn run_hidden(program: &str, args: &[&str]) -> Result<bool, String> {
    use std::os::windows::process::CommandExt;

    let output = std::process::Command::new(program)
        .args(args)
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|error| format!("无法运行系统命令：{error}"))?;
    Ok(output.status.success())
}

/// 取得文件/目录的所有权并给 Administrators 授予完全控制。
/// 使用系统自带的 takeown + icacls（与“资源管理器 - 取得所有权”等效），
/// 比直接构造 DACL 更稳，也避免手写安全描述符带来的兼容问题。
#[cfg(windows)]
fn take_ownership_and_grant(path: &Path) -> Result<(), String> {
    let raw = path.to_string_lossy().to_string();
    let owned = run_hidden(
        "takeown.exe",
        &["/f", &raw, "/a", "/r", "/d", "y"],
    )?;
    if !owned {
        return Err(format!("takeown 未能取得所有权：{}", raw));
    }
    let granted = run_hidden(
        "icacls.exe",
        &["/grant", "*S-1-5-32-544:(OI)(CI)F", &raw, "/t", "/c", "/q"],
    )?;
    if !granted {
        return Err(format!("icacls 未能授予完全控制：{}", raw));
    }
    Ok(())
}

/* ── 重启后删除 ─────────────────────────────────────────────── */

/// 安排文件/目录在系统重启后删除。需要管理员权限；目录在重启时必须为空才会被移除。
#[cfg(windows)]
fn schedule_delete_on_reboot(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_DELAY_UNTIL_REBOOT};

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        MoveFileExW(PCWSTR(wide.as_ptr()), PCWSTR::null(), MOVEFILE_DELAY_UNTIL_REBOOT)
            .map_err(|error| format!("无法安排重启删除 {}：{error}", path.to_string_lossy()))
    }
}

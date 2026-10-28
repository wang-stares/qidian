//! 网络优化：DNS 读取、公共 DNS 一键切换（可还原）、网络连通性诊断。
//!
//! 读取与诊断在普通进程即可完成；切换与还原需要管理员权限，
//! 由 optimize 模块的提权 CLI 分支执行（mode = dnsSet / dnsRestore），
//! 原 DNS 配置会先备份到 `network-dns-backup.json`，可随时还原。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MODULE_ID: &str = "optimize";
const BACKUP_FILE: &str = "network-dns-backup.json";

/// 公共 DNS 预设：id 与前端 `OPT_DNS_PRESETS` 保持一致。
pub struct PresetDef {
    pub id: &'static str,
    pub name: &'static str,
    pub primary: &'static str,
    pub secondary: &'static str,
}

pub const DNS_PRESETS: [PresetDef; 4] = [
    PresetDef {
        id: "ali",
        name: "阿里 DNS",
        primary: "223.5.5.5",
        secondary: "223.6.6.6",
    },
    PresetDef {
        id: "tencent",
        name: "腾讯 DNS",
        primary: "119.29.29.29",
        secondary: "119.28.28.28",
    },
    PresetDef {
        id: "google",
        name: "Google DNS",
        primary: "8.8.8.8",
        secondary: "8.8.4.4",
    },
    PresetDef {
        id: "cloudflare",
        name: "Cloudflare",
        primary: "1.1.1.1",
        secondary: "1.0.0.1",
    },
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsInterfaceInfo {
    pub index: u32,
    pub alias: String,
    pub servers: Vec<String>,
}

/// 切换公共 DNS 前的原始配置快照。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsBackup {
    #[serde(default)]
    pub preset: Option<String>,
    #[serde(default)]
    pub at: u64,
    #[serde(default)]
    pub interfaces: Vec<DnsInterfaceInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsStatus {
    pub interfaces: Vec<DnsInterfaceInfo>,
    pub backup: Option<DnsBackup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagProbe {
    pub target: String,
    pub label: String,
    pub ok: bool,
    /// 往返延迟毫秒数；失败时为空。
    pub ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagReport {
    pub probes: Vec<DiagProbe>,
}

fn backup_path(base: &Path) -> PathBuf {
    base.join(BACKUP_FILE)
}

fn load_backup(base: &Path) -> Option<DnsBackup> {
    fs::read_to_string(backup_path(base))
        .ok()
        .and_then(|text| serde_json::from_str::<DnsBackup>(&text).ok())
        .filter(|backup| !backup.interfaces.is_empty())
}

#[cfg(windows)]
fn run_ps(script: &str) -> Result<String, String> {
    let Some(bytes) = crate::powershell::run_encoded(script) else {
        return Err("无法运行 PowerShell".to_string());
    };
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[cfg(windows)]
fn ps_error(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("[ERR]")
            .map(|message| message.trim().to_string())
    })
}

/// 读取当前各接口的 IPv4 DNS 配置（无需管理员权限）。
#[cfg(windows)]
fn read_interfaces() -> Result<Vec<DnsInterfaceInfo>, String> {
    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
        $ProgressPreference='SilentlyContinue'; \
        $rows=@(); \
        try { \
            $rows = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop | \
                Where-Object { $_.ServerAddresses -and $_.ServerAddresses.Count -gt 0 } | \
                ForEach-Object { [pscustomobject]@{ index=[int]$_.InterfaceIndex; \
                    alias=[string]$_.InterfaceAlias; \
                    servers=[string]($_.ServerAddresses -join ',') } }) \
        } catch {}; \
        $rows | ConvertTo-Json -Compress -Depth 2";
    let output = run_ps(script)?;
    let value: serde_json::Value =
        serde_json::from_str(output.trim()).unwrap_or(serde_json::Value::Null);
    let objects = match &value {
        serde_json::Value::Array(items) => items.clone(),
        serde_json::Value::Object(_) => vec![value.clone()],
        _ => Vec::new(),
    };
    let mut interfaces: Vec<DnsInterfaceInfo> = objects
        .into_iter()
        .filter_map(|object| {
            let index = object.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let alias = object
                .get("alias")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            let servers: Vec<String> = object
                .get("servers")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if index == 0 || servers.is_empty() {
                return None;
            }
            Some(DnsInterfaceInfo {
                index,
                alias,
                servers,
            })
        })
        .collect();
    interfaces.sort_by_key(|entry| entry.index);
    if interfaces.is_empty() {
        return Err("没有找到配置了 DNS 的网络接口".to_string());
    }
    Ok(interfaces)
}

/// 读取当前 DNS 状态与备份信息。
pub fn dns_status(base: &Path) -> Result<DnsStatus, String> {
    if !crate::modules::is_installed(base, MODULE_ID) {
        return Err("系统优化模块尚未安装".to_string());
    }
    #[cfg(windows)]
    {
        Ok(DnsStatus {
            interfaces: read_interfaces()?,
            backup: load_backup(base),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = base;
        Err("网络优化目前只支持 Windows".to_string())
    }
}

/// 把当前 DNS 配置以指定预设覆盖，`auto` 表示恢复为 DHCP 自动获取。
/// 需要管理员权限，由提权分支调用；应用前先把接口原始配置写入备份文件，
/// 供 `restore_dns` 还原。
pub fn apply_dns(base: &Path, preset: &str) -> Result<String, String> {
    let reset = preset == "auto";
    if !reset && !DNS_PRESETS.iter().any(|item| item.id == preset) {
        return Err(format!("未知的 DNS 预设：{preset}"));
    }
    #[cfg(windows)]
    {
        let interfaces = read_interfaces()?;
        let backup = DnsBackup {
            preset: Some(preset.to_string()),
            at: crate::store::now_millis(),
            interfaces: interfaces.clone(),
        };
        let data = serde_json::to_vec_pretty(&backup).map_err(|e| e.to_string())?;
        fs::write(backup_path(base), data).map_err(|e| format!("无法保存 DNS 备份：{e}"))?;

        let def = DNS_PRESETS.iter().find(|item| item.id == preset);
        let mut changed = 0usize;
        let mut failed: Vec<String> = Vec::new();
        for iface in &interfaces {
            let action = match def {
                Some(item) => format!("-ServerAddresses ('{}','{}')", item.primary, item.secondary),
                None => "-ResetServerAddresses".to_string(),
            };
            let script = format!(
                "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
                $ErrorActionPreference='Stop'; \
                try {{ Set-DnsClientServerAddress -InterfaceIndex {} {action} -ErrorAction Stop; '[OK]' }} \
                catch {{ '[ERR] ' + $_.Exception.Message }}",
                iface.index
            );
            match run_ps(&script) {
                Ok(output) if ps_error(&output).is_none() => changed += 1,
                Ok(output) => failed.push(
                    ps_error(&output).unwrap_or_else(|| format!("接口 {} 设置失败", iface.index)),
                ),
                Err(error) => failed.push(error),
            }
        }
        if !failed.is_empty() {
            return Err(format!(
                "{} 个接口设置失败：{}（已改动的接口已备份，可用「还原 DNS」恢复）",
                failed.len(),
                failed.join("；")
            ));
        }
        match def {
            Some(item) => Ok(format!(
                "已将 {} 个接口的 DNS 切换到{}（{}/{}），原配置已备份，随时可还原",
                changed, item.name, item.primary, item.secondary
            )),
            None => Ok(format!(
                "已将 {} 个接口的 DNS 恢复为自动获取（DHCP），原配置已备份，随时可还原",
                changed
            )),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (base, preset, reset);
        Err("网络优化目前只支持 Windows".to_string())
    }
}

/// 还原为切换前的 DNS 配置（写回原地址或恢复自动获取），并清除备份。需要管理员权限。
pub fn restore_dns(base: &Path) -> Result<String, String> {
    #[cfg(windows)]
    {
        let Some(backup) = load_backup(base) else {
            return Err("没有找到可还原的 DNS 备份（尚未切换过公共 DNS）".to_string());
        };
        let mut script = String::from(
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
            $ErrorActionPreference='Stop'; $failed=0; ",
        );
        for iface in &backup.interfaces {
            if iface.servers.is_empty() {
                script.push_str(&format!(
                    "try {{ Set-DnsClientServerAddress -InterfaceIndex {} -ResetServerAddresses -ErrorAction Stop }} catch {{ $failed++ }}; ",
                    iface.index
                ));
            } else {
                let list = iface
                    .servers
                    .iter()
                    .map(|s| format!("'{s}'"))
                    .collect::<Vec<_>>()
                    .join(",");
                script.push_str(&format!(
                    "try {{ Set-DnsClientServerAddress -InterfaceIndex {} -ServerAddresses ({list}) -ErrorAction Stop }} catch {{ $failed++ }}; ",
                    iface.index
                ));
            }
        }
        script.push_str("if($failed -gt 0){ '[ERR] 有 ' + $failed + ' 个接口还原失败' } else { '[OK]' }");
        let output = run_ps(&script)?;
        if let Some(message) = ps_error(&output) {
            return Err(format!("还原 DNS 失败：{message}（备份仍保留，可稍后重试）"));
        }
        let _ = fs::remove_file(backup_path(base));
        let total = backup.interfaces.len();
        let reset = backup
            .interfaces
            .iter()
            .filter(|iface| iface.servers.is_empty())
            .count();
        if reset > 0 {
            Ok(format!(
                "已还原 {} 个接口：{} 个写回原 DNS 配置，{} 个恢复为自动获取；备份已清除",
                total,
                total - reset,
                reset
            ))
        } else {
            Ok(format!(
                "已把 {} 个接口的 DNS 写回原配置；备份已清除",
                total
            ))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = base;
        Err("网络优化目前只支持 Windows".to_string())
    }
}

/// 连通性诊断：内网/公网可达性（阿里、腾讯、Google DNS）+ 域名解析测试。
/// 只读操作，不需要管理员权限。
pub fn diagnose() -> Result<DiagReport, String> {
    #[cfg(windows)]
    {
        let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
            $ProgressPreference='SilentlyContinue'; $r=@(); \
            foreach($t in @('223.5.5.5','119.29.29.29','8.8.8.8')){ \
                try { $p=New-Object System.Net.NetworkInformation.Ping; \
                    $res=$p.Send($t,1500); \
                    if($res.Status -eq 'Success'){ $r += \"OK|$t|$($res.RoundtripTime)\" } \
                    else { $r += \"FAIL|$t|\" } } catch { $r += \"FAIL|$t|\" } }; \
            try { $names=[System.Net.Dns]::GetHostAddresses('www.baidu.com'); \
                $ips=($names | ForEach-Object { $_.IPAddressToString }) -join ','; \
                $r += \"OK|resolve|0|$ips\" } catch { $r += \"FAIL|resolve|\" }; \
            $r -join \"`n\"";
        let output = run_ps(script)?;
        let mut probes = Vec::new();
        for line in output.lines() {
            let parts: Vec<&str> = line.trim().split('|').collect();
            if parts.len() < 3 {
                continue;
            }
            let status = parts[0];
            let target = parts[1];
            let ms = parts[2].parse::<u64>().ok();
            let label = match target {
                "223.5.5.5" => "阿里 DNS",
                "119.29.29.29" => "腾讯 DNS",
                "8.8.8.8" => "Google DNS",
                "resolve" => "域名解析 www.baidu.com",
                _ => "网络节点",
            };
            if target == "resolve" {
                probes.push(DiagProbe {
                    target: "resolve".to_string(),
                    label: label.to_string(),
                    ok: status == "OK",
                    ms: None,
                });
            } else {
                probes.push(DiagProbe {
                    target: target.to_string(),
                    label: label.to_string(),
                    ok: status == "OK",
                    ms,
                });
            }
        }
        if probes.is_empty() {
            return Err("诊断失败：没有返回任何结果".to_string());
        }
        Ok(DiagReport { probes })
    }
    #[cfg(not(windows))]
    {
        Err("网络优化目前只支持 Windows".to_string())
    }
}
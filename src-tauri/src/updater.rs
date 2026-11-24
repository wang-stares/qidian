//! 应用更新：只允许用户手动触发检查，绝不在启动时自动联网。
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: String,
    pub date: String,
}

/// 手动检查更新；已是最新版本时返回 `None`。
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|error| format!("更新组件不可用：{error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("检查更新失败：{error}"))?;
    Ok(update.map(|update| UpdateInfo {
        version: update.version,
        current_version: update.current_version,
        notes: update.body.unwrap_or_default(),
        date: update
            .date
            .map(|date| date.to_string())
            .unwrap_or_default(),
    }))
}

/// 下载并静默安装更新；通过 `updater://progress` 上报下载进度。
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|error| format!("更新组件不可用：{error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("检查更新失败：{error}"))?
        .ok_or_else(|| "当前已是最新版本".to_string())?;

    let progress_app = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = progress_app.emit(
                    "updater://progress",
                    serde_json::json!({
                        "chunkLength": chunk_length,
                        "contentLength": content_length,
                    }),
                );
            },
            || {},
        )
        .await
        .map_err(|error| format!("下载或安装更新失败：{error}"))?;

    // Windows 上插件启动安装程序后会先结束当前进程，正常路径下这里不会返回。
    app.restart()
}

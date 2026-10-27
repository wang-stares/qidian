use crate::models::{ScanCache, Settings};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct Paths {
    pub base: PathBuf,
    pub settings: PathBuf,
    pub cache: PathBuf,
    pub icons: PathBuf,
}

impl Paths {
    pub fn resolve(app: &tauri::AppHandle) -> Result<Self, String> {
        use tauri::Manager;

        let base = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("无法定位本地数据目录：{error}"))?;
        fs::create_dir_all(&base).map_err(|error| format!("无法创建数据目录：{error}"))?;
        let icons = base.join("icons");
        fs::create_dir_all(&icons).map_err(|error| format!("无法创建图标目录：{error}"))?;
        Ok(Self {
            settings: base.join("settings.json"),
            cache: base.join("apps.json"),
            icons,
            base,
        })
    }
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn load_settings(paths: &Paths) -> Settings {
    let text = match fs::read_to_string(&paths.settings) {
        Ok(text) => text,
        Err(_) => return Settings::default(),
    };
    let mut settings: Settings = serde_json::from_str(&text).unwrap_or_default();
    sanitize_settings(&mut settings);
    settings
}

pub fn save_settings(paths: &Paths, settings: &Settings) -> Result<(), String> {
    write_json(&paths.settings, settings)
}

pub fn load_cache(paths: &Paths) -> Result<Option<ScanCache>, String> {
    if !paths.cache.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&paths.cache).map_err(|error| error.to_string())?;
    let cache: ScanCache = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    Ok(Some(cache))
}

pub fn save_cache(paths: &Paths, cache: &ScanCache) -> Result<(), String> {
    write_json(&paths.cache, cache)
}

pub fn clear_cache(paths: &Paths) -> Result<(), String> {
    if paths.cache.exists() {
        fs::remove_file(&paths.cache).map_err(|error| format!("无法删除扫描缓存：{error}"))?;
    }
    if paths.icons.exists() {
        for entry in fs::read_dir(&paths.icons).map_err(|error| error.to_string())? {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            let path = entry.path();
            if path.is_file() {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("qidian.json");
    let tmp = path.with_file_name(format!("{file_name}.tmp"));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&tmp, data).map_err(|error| format!("无法写入临时文件：{error}"))?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path).map_err(|error| format!("无法写入文件：{error}"))
}

fn snap(value: u32, allowed: &[u32], fallback: u32) -> u32 {
    allowed
        .iter()
        .copied()
        .min_by_key(|candidate| (*candidate as i64 - value as i64).abs())
        .unwrap_or(fallback)
}

/// 自定义强调色只接受 #rrggbb，避免把任意 CSS 注入到内联样式里。
fn sanitize_hex(value: &str) -> String {
    let trimmed = value.trim();
    let valid = trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].chars().all(|char| char.is_ascii_hexdigit());
    if valid {
        trimmed.to_ascii_lowercase()
    } else {
        "#1b62d6".to_string()
    }
}

/// 自定义壁纸只接受 data URL 形式的图片，长度上限约 1.5M 字符。
fn sanitize_wallpaper_image(value: &str) -> String {
    const MAX_IMAGE_CHARS: usize = 1_500_000;
    if value.starts_with("data:image/") && value.len() <= MAX_IMAGE_CHARS {
        value.to_string()
    } else {
        String::new()
    }
}

pub fn sanitize_settings(settings: &mut Settings) {
    const MAX_CATEGORIES: usize = 20;
    if !matches!(settings.theme.as_str(), "miuix" | "win11" | "macos" | "mono") {
        settings.theme = "win11".to_string();
    }
    if !matches!(
        settings.theme_preset.as_str(),
        "default"
            | "ocean"
            | "forest"
            | "sunset"
            | "lavender"
            | "sakura"
            | "nebula"
            | "mint"
            | "graphite"
            | "coffee"
            | "aurora"
            | "peach"
    ) {
        settings.theme_preset = "default".to_string();
    }
    if !matches!(settings.color_mode.as_str(), "system" | "light" | "dark") {
        settings.color_mode = "system".to_string();
    }
    if !matches!(
        settings.accent.as_str(),
        "blue" | "violet" | "orange" | "green" | "rose" | "cyan" | "amber" | "slate" | "custom"
    ) {
        settings.accent = "blue".to_string();
    }
    settings.custom_accent = sanitize_hex(&settings.custom_accent);
    if !matches!(settings.density.as_str(), "cozy" | "compact") {
        settings.density = "cozy".to_string();
    }
    if !matches!(settings.corners.as_str(), "soft" | "sharp" | "round") {
        settings.corners = "soft".to_string();
    }
    if !matches!(settings.blur.as_str(), "off" | "standard" | "strong") {
        settings.blur = "standard".to_string();
    }
    if !matches!(
        settings.wallpaper.as_str(),
        "none" | "aurora" | "dusk" | "sea" | "nebula" | "dots" | "grid" | "custom"
    ) {
        settings.wallpaper = "none".to_string();
    }
    settings.wallpaper_image = sanitize_wallpaper_image(&settings.wallpaper_image);
    settings.wallpaper_opacity = settings.wallpaper_opacity.min(100).max(20);
    settings.wallpaper_blur = settings.wallpaper_blur.min(40);
    settings.wallpaper_dim = settings.wallpaper_dim.min(70);
    if settings.wallpaper == "custom" && settings.wallpaper_image.is_empty() {
        settings.wallpaper = "none".to_string();
    }
    settings.custom_themes.truncate(12);
    for theme in &mut settings.custom_themes {
        if theme.name.trim().is_empty() {
            theme.name = "我的主题".to_string();
        }
        theme.name = theme.name.trim().chars().take(16).collect();
        theme.id = theme.id.trim().chars().take(40).collect();
        if !matches!(theme.theme.as_str(), "miuix" | "win11" | "macos" | "mono") {
            theme.theme = "win11".to_string();
        }
        if !matches!(theme.color_mode.as_str(), "system" | "light" | "dark") {
            theme.color_mode = "system".to_string();
        }
        if !matches!(theme.corners.as_str(), "soft" | "sharp" | "round") {
            theme.corners = "soft".to_string();
        }
        if !matches!(theme.blur.as_str(), "off" | "standard" | "strong") {
            theme.blur = "standard".to_string();
        }
        if !matches!(
            theme.wallpaper.as_str(),
            "none" | "aurora" | "dusk" | "sea" | "nebula" | "dots" | "grid" | "custom"
        ) {
            theme.wallpaper = "none".to_string();
        }
        theme.custom_accent = sanitize_hex(&theme.custom_accent);
        theme.wallpaper_image = sanitize_wallpaper_image(&theme.wallpaper_image);
        theme.wallpaper_opacity = theme.wallpaper_opacity.min(100).max(20);
        theme.wallpaper_blur = theme.wallpaper_blur.min(40);
        theme.wallpaper_dim = theme.wallpaper_dim.min(70);
        if theme.wallpaper == "custom" && theme.wallpaper_image.is_empty() {
            theme.wallpaper = "none".to_string();
        }
    }
    if !matches!(settings.auto_refresh_hours, 0 | 6 | 12 | 24 | 168) {
        settings.auto_refresh_hours = 12;
    }
    if !matches!(settings.memory_mode.as_str(), "auto" | "custom" | "manual") {
        settings.memory_mode = "auto".to_string();
    }
    if !matches!(settings.memory_level.as_str(), "low" | "normal") {
        settings.memory_level = "normal".to_string();
    }
    if !matches!(settings.memory_trim_scope.as_str(), "self" | "system") {
        settings.memory_trim_scope = "self".to_string();
    }
    settings.memory_low_percent = snap(
        settings.memory_low_percent,
        &[70, 75, 80, 85, 90],
        85,
    );
    settings.memory_recover_percent = *[40, 50, 60, 70]
        .iter()
        .filter(|value| **value + 5 <= settings.memory_low_percent)
        .filter(|value| **value <= settings.memory_recover_percent.max(40))
        .last()
        .unwrap_or(&40);
    settings.memory_interval_sec = snap(settings.memory_interval_sec, &[15, 30, 60, 120, 300], 60);
    settings.hotkey_toggle = settings.hotkey_toggle.trim().to_string();
    if settings.hotkey_toggle.is_empty() || settings.hotkey_toggle.chars().count() > 64 {
        settings.hotkey_toggle = "Ctrl+Alt+Q".to_string();
    }
    settings.app_hotkeys.retain(|id, accelerator| {
        !id.trim().is_empty()
            && !accelerator.trim().is_empty()
            && accelerator.chars().count() <= 64
    });
    let mut accelerators = std::collections::HashSet::new();
    settings
        .app_hotkeys
        .retain(|_, accelerator| accelerators.insert(accelerator.trim().to_lowercase()));
    if settings.app_hotkeys.len() > 20 {
        let mut keys = settings.app_hotkeys.keys().cloned().collect::<Vec<_>>();
        keys.sort();
        let keep = keys.into_iter().take(20).collect::<std::collections::HashSet<_>>();
        settings.app_hotkeys.retain(|id, _| keep.contains(id));
    }
    if settings.categories.is_empty() {
        settings.categories = crate::models::default_categories();
    }
    if settings.categories.len() > MAX_CATEGORIES {
        settings.categories.truncate(MAX_CATEGORIES);
    }
    let mut seen = std::collections::HashSet::new();
    settings.categories.retain(|category| {
        if category.id.trim().is_empty() || !seen.insert(category.id.clone()) {
            return false;
        }
        true
    });
    settings.pinned.truncate(9);
    settings.recent.truncate(24);
    settings.recent.sort_by(|a, b| b.at.cmp(&a.at));
    // 启动次数只用于「常用优先」排序，限制条目数避免设置文件无限增长。
    settings.usage.retain(|id, count| !id.trim().is_empty() && *count > 0);
    if settings.usage.len() > 400 {
        let mut entries: Vec<(String, u32)> = settings
            .usage
            .iter()
            .map(|(id, count)| (id.clone(), *count))
            .collect();
        entries.sort_by(|a, b| b.1.cmp(&a.1));
        settings.usage = entries.into_iter().take(400).collect();
    }
}

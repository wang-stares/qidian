use crate::models::{CustomPalette, ScanCache, Settings};
use base64::{engine::general_purpose::STANDARD, Engine as _};
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
    pub wallpapers: PathBuf,
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
        let wallpapers = base.join("wallpapers");
        fs::create_dir_all(&wallpapers).map_err(|error| format!("无法创建壁纸目录：{error}"))?;
        Ok(Self {
            settings: base.join("settings.json"),
            cache: base.join("apps.json"),
            icons,
            wallpapers,
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

/// 壁纸文件名只允许字母、数字、连字符与下划线，避免路径穿越。
fn wallpaper_file(paths: &Paths, id: &str) -> Result<PathBuf, String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_');
    if !valid {
        return Err("壁纸标识无效".to_string());
    }
    Ok(paths.wallpapers.join(format!("{id}.jpg")))
}

/// 保存压缩后的 JPEG（data URL 或裸 base64），返回字节数。
pub fn save_wallpaper(paths: &Paths, id: &str, data: &str) -> Result<u64, String> {
    const MAX_BYTES: usize = 8 * 1024 * 1024;
    let payload = data.split_once(',').map(|(_, value)| value).unwrap_or(data);
    let bytes = STANDARD
        .decode(payload.trim())
        .map_err(|error| format!("壁纸解码失败：{error}"))?;
    if bytes.is_empty() {
        return Err("壁纸内容为空".to_string());
    }
    if bytes.len() > MAX_BYTES {
        return Err("壁纸文件超出大小限制".to_string());
    }
    let target = wallpaper_file(paths, id)?;
    fs::write(&target, &bytes).map_err(|error| format!("写入壁纸失败：{error}"))?;
    Ok(bytes.len() as u64)
}

pub fn read_wallpaper(paths: &Paths, id: &str) -> Result<String, String> {
    let target = wallpaper_file(paths, id)?;
    let bytes = fs::read(&target).map_err(|error| format!("读取壁纸失败：{error}"))?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

pub fn delete_wallpaper(paths: &Paths, id: &str) -> Result<(), String> {
    let target = wallpaper_file(paths, id)?;
    if target.exists() {
        fs::remove_file(&target).map_err(|error| format!("删除壁纸失败：{error}"))?;
    }
    Ok(())
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

fn valid_asset_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_')
}

/// 自定义调色板：颜色只接受 #rrggbb，数值按可用范围收敛。
fn sanitize_palette(palette: &mut CustomPalette) {
    palette.bg_light = sanitize_hex(&palette.bg_light);
    palette.bg_dark = sanitize_hex(&palette.bg_dark);
    palette.panel_light = sanitize_hex(&palette.panel_light);
    palette.panel_dark = sanitize_hex(&palette.panel_dark);
    palette.text_light = sanitize_hex(&palette.text_light);
    palette.text_dark = sanitize_hex(&palette.text_dark);
    palette.radius = palette.radius.min(30);
    palette.panel_opacity = palette.panel_opacity.clamp(30, 100);
    palette.blur = palette.blur.min(48);
    palette.icon_size = palette.icon_size.clamp(28, 64);
}

pub fn sanitize_settings(settings: &mut Settings) {
    const MAX_CATEGORIES: usize = 20;
    if !matches!(
        settings.theme.as_str(),
        "miuix" | "win11" | "macos" | "mono" | "custom"
    ) {
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
    settings.wallpaper_library.truncate(12);
    settings.wallpaper_library.retain(|asset| valid_asset_id(&asset.id));
    for asset in &mut settings.wallpaper_library {
        asset.name = asset.name.trim().chars().take(24).collect();
        if asset.name.is_empty() {
            asset.name = "本地壁纸".to_string();
        }
        asset.bytes = asset.bytes.min(8 * 1024 * 1024);
    }
    if !valid_asset_id(&settings.wallpaper_asset)
        || !settings
            .wallpaper_library
            .iter()
            .any(|asset| asset.id == settings.wallpaper_asset)
    {
        settings.wallpaper_asset = String::new();
    }
    if !matches!(
        settings.wallpaper_fit.as_str(),
        "cover" | "contain" | "tile" | "stretch"
    ) {
        settings.wallpaper_fit = "cover".to_string();
    }
    settings.wallpaper_x = settings.wallpaper_x.min(100);
    settings.wallpaper_y = settings.wallpaper_y.min(100);
    settings.wallpaper_zoom = settings.wallpaper_zoom.clamp(100, 200);
    settings.wallpaper_opacity = settings.wallpaper_opacity.clamp(20, 100);
    settings.wallpaper_blur = settings.wallpaper_blur.min(40);
    settings.wallpaper_dim = settings.wallpaper_dim.min(70);
    sanitize_palette(&mut settings.custom_palette);
    if settings.wallpaper == "custom"
        && settings.wallpaper_asset.is_empty()
        && settings.wallpaper_image.is_empty()
    {
        settings.wallpaper = "none".to_string();
    }
    settings.custom_themes.truncate(12);
    for theme in &mut settings.custom_themes {
        if theme.name.trim().is_empty() {
            theme.name = "我的主题".to_string();
        }
        theme.name = theme.name.trim().chars().take(16).collect();
        theme.id = theme.id.trim().chars().take(40).collect();
        if !matches!(
            theme.theme.as_str(),
            "miuix" | "win11" | "macos" | "mono" | "custom"
        ) {
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
        if !valid_asset_id(&theme.wallpaper_asset) {
            theme.wallpaper_asset = String::new();
        }
        if !matches!(
            theme.wallpaper_fit.as_str(),
            "cover" | "contain" | "tile" | "stretch"
        ) {
            theme.wallpaper_fit = "cover".to_string();
        }
        theme.wallpaper_x = theme.wallpaper_x.min(100);
        theme.wallpaper_y = theme.wallpaper_y.min(100);
        theme.wallpaper_zoom = theme.wallpaper_zoom.clamp(100, 200);
        theme.wallpaper_opacity = theme.wallpaper_opacity.clamp(20, 100);
        theme.wallpaper_blur = theme.wallpaper_blur.min(40);
        theme.wallpaper_dim = theme.wallpaper_dim.min(70);
        sanitize_palette(&mut theme.palette);
        if theme.wallpaper == "custom"
            && theme.wallpaper_image.is_empty()
            && theme.wallpaper_asset.is_empty()
        {
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

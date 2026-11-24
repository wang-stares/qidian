use crate::models::LaunchTarget;
use crate::store::Paths;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// 首次提取要经过 Shell 图像工厂与 PNG 编码，串行处理一批会明显等待。
/// 按最多 4 个线程并行提取，磁盘已缓存的图标仍走同步快路径。
const MAX_EXTRACT_THREADS: usize = 4;

/// 单次预热最多处理 100 个图标：启动后分几批做，避免一口气拉起全部
/// Shell 提取线程和磁盘读写，把首帧之后的交互抢掉。
const WARM_BATCH: usize = 100;

/// 单个缓存文件的上限：超过视为损坏，避免把异常文件塞进协议响应。
const MAX_ICON_BYTES: usize = 4 * 1024 * 1024;

/// `.miss` 分两级。永久失败（目标不存在、类型不支持提取）基本不会自愈，
/// 记 7 天，避免每次预热都白跑一遍 Shell 提取。
const MISS_PERMANENT_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
/// 临时失败（COM 忙、文件被占用、磁盘暂时不可读）只记 10 分钟，
/// 一次偶发失败不会再让图标消失一整天。
const MISS_TRANSIENT_TTL: Duration = Duration::from_secs(10 * 60);

/// 写入 `.miss` 的内容用于区分失败类型；旧的 `1` 标记按临时失败处理。
const MISS_PERMANENT_MARKER: &[u8] = b"permanent";
const MISS_TRANSIENT_MARKER: &[u8] = b"transient";

/// 预热结果：本次处理数量与仍待预热的数量，前端据此决定是否继续下一批。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmOutcome {
    pub processed: usize,
    pub pending: usize,
}

/// 同一图标可能同时被可视区请求与后台预热命中，进程内先去重，避免重复提取。
fn icon_claims() -> &'static Mutex<HashSet<String>> {
    static CLAIMS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CLAIMS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn claim_icon(id: &str) -> bool {
    icon_claims()
        .lock()
        .map(|mut claims| claims.insert(id.to_string()))
        .unwrap_or(false)
}

fn release_icon(id: &str) {
    if let Ok(mut claims) = icon_claims().lock() {
        claims.remove(id);
    }
}

/// 占位句柄：靠 Drop 释放，避免提取线程 panic 后 id 被永久占住、再也拿不到图标。
struct IconClaim(String);

impl IconClaim {
    fn acquire(id: &str) -> Option<Self> {
        claim_icon(id).then(|| Self(id.to_string()))
    }
}

impl Drop for IconClaim {
    fn drop(&mut self) {
        release_icon(&self.0);
    }
}

/// 缓存文件名主体：把任意 id 规范化成安全、稳定、有界的 key。
///
/// 规则：
/// - `[A-Za-z0-9._-]` 原样保留。旧版本只缓存过 `[A-Za-z0-9-]` 的 id，
///   这类 id 的 key 与旧文件名一致，升级后可直接复用旧缓存。
/// - 其余字符（`:`、`\`、`/`、空白、非 ASCII 等）逐个替换成 `_`。
/// - 只要发生过替换或截断，就在末尾追加 8 位 FNV-1a 哈希，
///   避免 `custom:ab` 与 `custom_ab` 落到同一个文件上。
pub fn icon_key(id: &str) -> String {
    let mut key = String::with_capacity(id.len() + 9);
    let mut rewritten = false;
    for character in id.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            key.push(character);
        } else {
            key.push('_');
            rewritten = true;
        }
    }
    if key.is_empty() {
        key.push('_');
        rewritten = true;
    }
    // 文件名上限 255 字节，这里留 100 给后缀与哈希，避免超长 id 写盘失败。
    if key.len() > 100 {
        key.truncate(100);
        rewritten = true;
    }
    if rewritten {
        key.push('_');
        key.push_str(&format!("{:08x}", fnv1a32(id)));
    }
    key
}

fn fnv1a32(input: &str) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in input.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

fn icon_path(icons_dir: &Path, id: &str) -> PathBuf {
    icons_dir.join(format!("{}.png", icon_key(id)))
}

fn miss_path(icons_dir: &Path, id: &str) -> PathBuf {
    icons_dir.join(format!("{}.miss", icon_key(id)))
}

/// 后台预热磁盘图标缓存，不返回 data URL，供启动后空闲时调用。
/// 每次只处理一批，剩下的交给下一次调用，前端按窗口可见性决定何时继续。
pub fn warm_icons(paths: &Paths, targets: Vec<(String, LaunchTarget)>) -> WarmOutcome {
    let mut pending = Vec::new();
    // 缓存文件名只由 id 决定，所以同一 id 的多个 target 只会落到同一个文件，
    // 保留先到的一份即可；这里显式去重，同时避免 pending 计数虚高。
    let mut seen = HashSet::new();
    for (id, target) in targets {
        if !seen.insert(id.clone()) {
            continue;
        }
        if usable_png(&icon_path(&paths.icons, &id)) {
            continue;
        }
        if miss_is_fresh(&miss_path(&paths.icons, &id)) {
            continue;
        }
        pending.push((id, target));
    }
    let total = pending.len();
    if total == 0 {
        return WarmOutcome {
            processed: 0,
            pending: 0,
        };
    }
    let batch: Vec<(String, LaunchTarget)> = pending.into_iter().take(WARM_BATCH).collect();
    let processed = batch.len();
    #[cfg(windows)]
    let _ = extract_parallel(&paths.icons, batch, false);
    #[cfg(not(windows))]
    let _ = batch;
    WarmOutcome {
        processed,
        pending: total - processed,
    }
}

pub fn load_icons(paths: &Paths, targets: Vec<(String, LaunchTarget)>) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let mut pending = Vec::new();
    for (id, target) in targets {
        let png_path = icon_path(&paths.icons, &id);
        if png_path.is_file() {
            match encode_png(&png_path) {
                Some(url) => {
                    result.insert(id, url);
                    continue;
                }
                // 缓存文件损坏（含 0 字节）时删掉并重新提取，避免永久占位。
                None => {
                    let _ = fs::remove_file(&png_path);
                }
            }
        }
        if miss_is_fresh(&miss_path(&paths.icons, &id)) {
            continue;
        }
        pending.push((id, target));
    }

    if !pending.is_empty() {
        #[cfg(windows)]
        for (id, url) in extract_parallel(&paths.icons, pending, false) {
            if let Some(url) = url {
                result.insert(id, url);
            }
        }
        #[cfg(not(windows))]
        {
            let _ = pending;
        }
    }
    result
}

/// 强制重新提取一批图标：忽略 `.miss` 标记，先删旧缓存再提取。
/// 供前端在协议图 404 后调用，重试次数与退避由前端控制。
pub fn retry_icons(paths: &Paths, targets: Vec<(String, LaunchTarget)>) {
    #[cfg(windows)]
    {
        let mut pending = Vec::new();
        let mut seen = HashSet::new();
        for (id, target) in targets {
            if !seen.insert(id.clone()) {
                continue;
            }
            let _ = fs::remove_file(icon_path(&paths.icons, &id));
            let _ = fs::remove_file(miss_path(&paths.icons, &id));
            pending.push((id, target));
        }
        if !pending.is_empty() {
            let _ = extract_parallel(&paths.icons, pending, true);
        }
    }
    #[cfg(not(windows))]
    let _ = (paths, targets);
}

/// 缓存文件是否可用：存在、非空且不超限。0 字节多为上次写入中断。
fn usable_png(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| {
            metadata.is_file()
                && metadata.len() > 0
                && metadata.len() <= MAX_ICON_BYTES as u64
        })
        .unwrap_or(false)
}

/// 同一批图标按线程拆分，每个线程先初始化自己的 COM 单元再调用 Shell。
/// `force` 为真时忽略 `.miss`，用于前端主动重试。
#[cfg(windows)]
fn extract_parallel(
    icons_dir: &Path,
    pending: Vec<(String, LaunchTarget)>,
    force: bool,
) -> Vec<(String, Option<String>)> {
    let workers = pending.len().min(MAX_EXTRACT_THREADS).max(1);
    let chunk_size = pending.len().div_ceil(workers);
    std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(workers);
        for chunk in pending.chunks(chunk_size) {
            let icons_dir = icons_dir;
            handles.push(scope.spawn(move || {
                use windows::Win32::System::Com::{
                    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
                };
                let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
                let items = chunk
                    .iter()
                    .filter_map(|(id, target)| {
                        // 占位在 Drop 时释放；拿不到占位说明同 id 正在别的线程提取。
                        let _claim = IconClaim::acquire(id)?;
                        let url = load_one(icons_dir, id, target, force);
                        Some((id.clone(), url))
                    })
                    .collect::<Vec<_>>();
                if initialized {
                    unsafe { CoUninitialize() };
                }
                items
            }));
        }
        let mut items = Vec::with_capacity(pending.len());
        for handle in handles {
            if let Ok(part) = handle.join() {
                items.extend(part);
            }
        }
        items
    })
}

fn load_one(icons_dir: &Path, id: &str, target: &LaunchTarget, force: bool) -> Option<String> {
    let png_path = icon_path(icons_dir, id);
    let miss_path = miss_path(icons_dir, id);

    if png_path.is_file() {
        if let Some(url) = encode_png(&png_path) {
            return Some(url);
        }
        // 0 字节或超限：多半是上次写入中断，删掉后重新提取。
        let _ = fs::remove_file(&png_path);
    }
    if !force && miss_is_fresh(&miss_path) {
        return None;
    }

    let source = match icon_source(target) {
        Some(source) => source,
        // 类型根本不支持提取：写长期 miss，别反复重试。
        None => {
            write_miss(&miss_path, MissKind::Permanent);
            return None;
        }
    };
    // 目标已经不存在时不必再走 Shell，那只会得到一次"偶发失败"。
    if target_missing(target) {
        write_miss(&miss_path, MissKind::Permanent);
        return None;
    }

    #[cfg(windows)]
    {
        match extract_icon(&source, &png_path) {
            Ok(()) => {
                let _ = fs::remove_file(&miss_path);
                encode_png(&png_path)
            }
            Err(kind) => {
                write_miss(&miss_path, kind);
                None
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (&source, &png_path);
        None
    }
}

fn encode_png(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    // 0 字节缓存是上次写入中断的产物，必须当作损坏而不是"透明图标"。
    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
        return None;
    }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

/// 自定义协议 `qidian-icon` 读取磁盘缓存：只返回 `<key>.png` 的原始字节。
/// 未预热、id 为空、文件损坏时返回 None，由协议层回 404；
/// 现场提取仍走 warm/load/retry 流程，避免协议线程被 Shell 调用卡住。
pub fn cached_icon(paths: &Paths, id: &str) -> Option<Vec<u8>> {
    if id.is_empty() {
        return None;
    }
    let path = icon_path(&paths.icons, id);
    let bytes = fs::read(&path).ok()?;
    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
        // 0 字节/超限视为损坏：删掉并回 404，让下一次预热重新提取。
        let _ = fs::remove_file(&path);
        return None;
    }
    Some(bytes)
}

/// 失败分级：永久失败保留 7 天，临时失败只保留 10 分钟。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MissKind {
    Permanent,
    Transient,
}

impl MissKind {
    fn ttl(self) -> Duration {
        match self {
            Self::Permanent => MISS_PERMANENT_TTL,
            Self::Transient => MISS_TRANSIENT_TTL,
        }
    }

    fn marker(self) -> &'static [u8] {
        match self {
            Self::Permanent => MISS_PERMANENT_MARKER,
            Self::Transient => MISS_TRANSIENT_MARKER,
        }
    }

    /// 旧版本只写 `1`，没有类型信息，按临时失败处理以便尽快重试。
    fn from_marker(bytes: &[u8]) -> Self {
        if bytes == MISS_PERMANENT_MARKER {
            Self::Permanent
        } else {
            Self::Transient
        }
    }
}

fn write_miss(path: &Path, kind: MissKind) {
    let _ = fs::write(path, kind.marker());
}

/// 只信任 `.miss` 中记录的有效期：永久失败 7 天，临时失败 10 分钟。
/// 读不出来（被占用/已删除）就当没有标记，立即允许重试。
fn miss_is_fresh(path: &Path) -> bool {
    let Ok(marker) = fs::read(path) else {
        return false;
    };
    let ttl = MissKind::from_marker(&marker).ttl();
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map(|modified| {
            modified
                .elapsed()
                .map(|age| age < ttl)
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// 目标本身不存在时直接判永久失败，避免把"文件已删"当成 COM 偶发错误。
fn target_missing(target: &LaunchTarget) -> bool {
    match target {
        LaunchTarget::Executable { path, .. } | LaunchTarget::Shortcut { path } => {
            !Path::new(path).is_file()
        }
        LaunchTarget::Uwp { .. } => false,
    }
}

fn icon_source(target: &LaunchTarget) -> Option<String> {
    match target {
        LaunchTarget::Executable { path, .. } => Some(path.clone()),
        LaunchTarget::Shortcut { path } => Some(path.clone()),
        LaunchTarget::Uwp { aumid } => Some(format!("shell:AppsFolder\\{aumid}")),
    }
}

#[cfg(windows)]
fn extract_icon(source: &str, output: &Path) -> Result<(), MissKind> {
    use image::ImageEncoder;
    use windows::core::HSTRING;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::System::Com::IBindCtx;
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };

    unsafe {
        let source = HSTRING::from(source);
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&source, None::<&IBindCtx>)
                .map_err(classify_com_error)?;
        let bitmap = factory
            .GetImage(
                SIZE { cx: 128, cy: 128 },
                SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
            )
            .map_err(classify_com_error)?;

        let image = hbitmap_to_image(bitmap).map_err(|_| MissKind::Transient)?;
        // 图标只在本地缓存与展示，用快速压缩与简单滤波，避免首次提取时把时间花在 PNG 压缩上。
        let mut buffer = Vec::new();
        image::codecs::png::PngEncoder::new_with_quality(
            &mut buffer,
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::Sub,
        )
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|_| MissKind::Transient)?;
        // 写盘失败（被占用/磁盘满）是临时问题，10 分钟后重试而不是转圈一整天。
        fs::write(output, buffer).map_err(|_| MissKind::Transient)?;
    }
    Ok(())
}

/// COM 错误分级：路径不存在/参数无效说明目标真的不在了，记永久失败；
/// 其余（COM 忙、越权、未知 HRESULT）都按临时失败处理，留给下次重试。
#[cfg(windows)]
fn classify_com_error(error: windows::core::Error) -> MissKind {
    const HRESULT_FILE_NOT_FOUND: i32 = 0x8007_0002u32 as i32;
    const HRESULT_PATH_NOT_FOUND: i32 = 0x8007_0003u32 as i32;
    const HRESULT_INVALID_PARAMETER: i32 = 0x8007_0057u32 as i32;
    const HRESULT_BAD_PATHNAME: i32 = 0x8007_00A1u32 as i32;
    match error.code().0 {
        HRESULT_FILE_NOT_FOUND
        | HRESULT_PATH_NOT_FOUND
        | HRESULT_INVALID_PARAMETER
        | HRESULT_BAD_PATHNAME => MissKind::Permanent,
        _ => MissKind::Transient,
    }
}

#[cfg(windows)]
unsafe fn hbitmap_to_image(
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
) -> Result<image::RgbaImage, String> {
    use std::mem::size_of;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, SelectObject, BITMAP,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC, HGDIOBJ,
    };

    let mut info = BITMAP::default();
    if GetObjectW(
        HGDIOBJ::from(bitmap),
        size_of::<BITMAP>() as i32,
        Some(&mut info as *mut _ as *mut core::ffi::c_void),
    ) == 0
    {
        let _ = DeleteObject(bitmap);
        return Err("无法读取图标位图".to_string());
    }

    let width = info.bmWidth;
    let height = info.bmHeight;
    if width <= 0 || height <= 0 || width > 4096 || height > 4096 {
        let _ = DeleteObject(bitmap);
        return Err("图标尺寸无效".to_string());
    }

    let mut bitmap_info = BITMAPINFO::default();
    bitmap_info.bmiHeader = BITMAPINFOHEADER {
        biSize: size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        biHeight: -height,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };

    let mut buffer = vec![0u8; width as usize * height as usize * 4];
    let device_context: HDC = CreateCompatibleDC(HDC::default());
    let previous = SelectObject(device_context, bitmap);
    let lines = GetDIBits(
        device_context,
        bitmap,
        0,
        height as u32,
        Some(buffer.as_mut_ptr() as *mut core::ffi::c_void),
        &mut bitmap_info,
        DIB_RGB_COLORS,
    );
    let _ = SelectObject(device_context, previous);
    let _ = DeleteDC(device_context);
    let _ = DeleteObject(bitmap);

    if lines == 0 {
        return Err("无法读取图标像素".to_string());
    }

    let any_alpha = buffer.chunks_exact(4).any(|pixel| pixel[3] > 0);
    if any_alpha {
        for pixel in buffer.chunks_exact_mut(4) {
            let alpha = pixel[3];
            if alpha == 0 {
                pixel.copy_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            let blue = pixel[0] as f32;
            let green = pixel[1] as f32;
            let red = pixel[2] as f32;
            let scale = 255.0 / alpha as f32;
            pixel[0] = (red * scale).min(255.0) as u8;
            pixel[1] = (green * scale).min(255.0) as u8;
            pixel[2] = (blue * scale).min(255.0) as u8;
            pixel[3] = alpha;
        }
    } else {
        for pixel in buffer.chunks_exact_mut(4) {
            let blue = pixel[0];
            let green = pixel[1];
            let red = pixel[2];
            pixel[0] = red;
            pixel[1] = green;
            pixel[2] = blue;
            pixel[3] = 255;
        }
    }

    let mut image = image::RgbaImage::from_raw(width as u32, height as u32, buffer)
        .ok_or_else(|| "图标像素缓冲无效".to_string())?;
    let longest = width.max(height);
    if longest > 128 {
        let scale = 128.0 / longest as f32;
        let new_width = ((width as f32 * scale).round() as u32).max(1);
        let new_height = ((height as f32 * scale).round() as u32).max(1);
        image = image::imageops::resize(
            &image,
            new_width,
            new_height,
            image::imageops::FilterType::Triangle,
        );
    }
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qidian-icons-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_paths(dir: &Path) -> Paths {
        Paths {
            base: dir.to_path_buf(),
            settings: dir.join("settings.json"),
            cache: dir.join("apps.json"),
            icons: dir.to_path_buf(),
            wallpapers: dir.join("wallpapers"),
        }
    }

    #[test]
    fn icon_key_keeps_legacy_ids_unchanged() {
        // 旧版本只缓存过 [A-Za-z0-9-] 的 id，升级后必须直接命中旧文件名。
        for id in ["a1b2c3d4e5f6", "custom-abc123", "ABC-001", "0"] {
            assert_eq!(icon_key(id), id);
        }
    }

    #[test]
    fn icon_key_rewrites_custom_prefix() {
        let key = icon_key("custom:f00dbabe");
        assert!(!key.contains(':'));
        assert!(key.starts_with("custom_f00dbabe_"));
        // 同一 id 永远得到同一个 key。
        assert_eq!(key, icon_key("custom:f00dbabe"));
        // 替换后不能与"本来就用下划线"的 id 撞车。
        assert_ne!(key, icon_key("custom_f00dbabe"));
        assert_ne!(icon_key("custom:1"), icon_key("custom:2"));
    }

    #[test]
    fn icon_key_is_ascii_bounded_and_unique() {
        let key = icon_key("应用/图标\\测试");
        assert!(key.is_ascii());
        assert!(!key.contains('/') && !key.contains('\\'));
        // 100 字节主体 + "_" + 8 位哈希。
        assert!(key.len() <= 109);

        let long = icon_key(&"x".repeat(400));
        assert!(long.len() <= 109);
        assert_eq!(long, icon_key(&"x".repeat(400)));
        assert_ne!(long, icon_key(&"x".repeat(399)));

        // 空 id 也要给出可用文件名，避免退化成 ".png"。
        assert_eq!(icon_key(""), "__811c9dc5");
        assert!(!icon_key("").starts_with('.'));
    }

    #[test]
    fn miss_ttl_is_graded() {
        assert_eq!(
            MissKind::Permanent.ttl(),
            Duration::from_secs(7 * 24 * 3600)
        );
        assert_eq!(MissKind::Transient.ttl(), Duration::from_secs(10 * 60));
        assert!(MissKind::Permanent.ttl() > MissKind::Transient.ttl());
    }

    #[test]
    fn legacy_miss_marker_is_transient() {
        assert_eq!(MissKind::from_marker(b"permanent"), MissKind::Permanent);
        assert_eq!(MissKind::from_marker(b"transient"), MissKind::Transient);
        // 旧版本写的 "1" 与空文件都没有类型信息，按临时失败尽快重试。
        assert_eq!(MissKind::from_marker(b"1"), MissKind::Transient);
        assert_eq!(MissKind::from_marker(b""), MissKind::Transient);
    }

    #[test]
    fn miss_marker_roundtrip_and_freshness() {
        let dir = temp_dir("miss");
        let miss = dir.join("x.miss");
        assert!(!miss_is_fresh(&miss));

        write_miss(&miss, MissKind::Permanent);
        assert!(miss_is_fresh(&miss));
        assert_eq!(fs::read(&miss).unwrap(), MISS_PERMANENT_MARKER.to_vec());

        write_miss(&miss, MissKind::Transient);
        assert!(miss_is_fresh(&miss));
        assert_eq!(fs::read(&miss).unwrap(), MISS_TRANSIENT_MARKER.to_vec());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_target_writes_permanent_miss() {
        let dir = temp_dir("missing");
        let target = LaunchTarget::Executable {
            path: dir.join("gone.exe").to_string_lossy().into_owned(),
            args: None,
            workdir: None,
        };
        assert!(target_missing(&target));
        assert!(load_one(&dir, "custom:dead", &target, false).is_none());
        let miss = dir.join(format!("{}.miss", icon_key("custom:dead")));
        assert_eq!(fs::read(&miss).unwrap(), MISS_PERMANENT_MARKER.to_vec());
        // force 重试也不能跳过"目标不存在"，但必须安静返回而不是 panic。
        assert!(load_one(&dir, "custom:dead", &target, true).is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_cache_file_is_rejected_and_removed() {
        let dir = temp_dir("empty");
        let paths = fake_paths(&dir);
        let cache = dir.join(format!("{}.png", icon_key("custom:abc")));
        fs::write(&cache, b"").unwrap();

        assert!(encode_png(&cache).is_none());
        assert!(cached_icon(&paths, "custom:abc").is_none());
        assert!(!cache.exists());
        // 空 id 直接 404，不会去拼 ".png"。
        assert!(cached_icon(&paths, "").is_none());

        let _ = fs::remove_dir_all(&dir);
    }
}


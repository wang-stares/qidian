use crate::models::LaunchTarget;
use crate::store::Paths;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// 首次提取要经过 Shell 图像工厂与 PNG 编码，串行处理一批会明显等待。
/// 按最多 6 个线程并行提取，磁盘已缓存的图标仍走同步快路径。
const MAX_EXTRACT_THREADS: usize = 6;

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

/// 后台预热磁盘图标缓存，不返回 data URL，供启动后空闲时调用。
pub fn warm_icons(paths: &Paths, targets: Vec<(String, LaunchTarget)>) -> usize {
    let mut pending = Vec::new();
    for (id, target) in targets {
        if !valid_id(&id) {
            continue;
        }
        if paths.icons.join(format!("{id}.png")).is_file() {
            continue;
        }
        if miss_is_fresh(&paths.icons.join(format!("{id}.miss"))) {
            continue;
        }
        pending.push((id, target));
    }
    if pending.is_empty() {
        return 0;
    }
    #[cfg(windows)]
    {
        extract_parallel(&paths.icons, pending)
            .into_iter()
            .filter(|(_, url)| url.is_some())
            .count()
    }
    #[cfg(not(windows))]
    {
        let _ = pending;
        0
    }
}

pub fn load_icons(paths: &Paths, targets: Vec<(String, LaunchTarget)>) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let mut pending = Vec::new();
    for (id, target) in targets {
        if !valid_id(&id) {
            continue;
        }
        let png_path = paths.icons.join(format!("{id}.png"));
        if png_path.is_file() {
            match encode_png(&png_path) {
                Some(url) => {
                    result.insert(id, url);
                    continue;
                }
                // 缓存文件损坏时删掉并重新提取，避免永久占位。
                None => {
                    let _ = fs::remove_file(&png_path);
                }
            }
        }
        if miss_is_fresh(&paths.icons.join(format!("{id}.miss"))) {
            continue;
        }
        pending.push((id, target));
    }

    if !pending.is_empty() {
        #[cfg(windows)]
        for (id, url) in extract_parallel(&paths.icons, pending) {
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

fn valid_id(id: &str) -> bool {
    id.chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

/// 同一批图标按线程拆分，每个线程先初始化自己的 COM 单元再调用 Shell。
#[cfg(windows)]
fn extract_parallel(
    icons_dir: &Path,
    pending: Vec<(String, LaunchTarget)>,
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
                        if !claim_icon(id) {
                            return None;
                        }
                        let url = load_one(icons_dir, id, target);
                        release_icon(id);
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

fn load_one(icons_dir: &Path, id: &str, target: &LaunchTarget) -> Option<String> {
    let png_path = icons_dir.join(format!("{id}.png"));
    let miss_path = icons_dir.join(format!("{id}.miss"));

    if png_path.is_file() {
        if let Some(url) = encode_png(&png_path) {
            return Some(url);
        }
        let _ = fs::remove_file(&png_path);
    }
    if miss_is_fresh(&miss_path) {
        return None;
    }

    let source = icon_source(target)?;
    #[cfg(windows)]
    {
        if extract_icon(&source, &png_path).is_ok() {
            return encode_png(&png_path);
        }
        let _ = fs::write(&miss_path, b"1");
        None
    }
    #[cfg(not(windows))]
    {
        let _ = source;
        None
    }
}

fn encode_png(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() > 4 * 1024 * 1024 {
        return None;
    }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

/// 提取失败会写 .miss 标记；只信任 24 小时内的失败记录，
/// 过期后重新尝试，避免应用更新或系统修复后一直显示占位图。
fn miss_is_fresh(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map(|modified| {
            modified
                .elapsed()
                .map(|age| age < Duration::from_secs(24 * 3600))
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn icon_source(target: &LaunchTarget) -> Option<String> {
    match target {
        LaunchTarget::Executable { path, .. } => Some(path.clone()),
        LaunchTarget::Shortcut { path } => Some(path.clone()),
        LaunchTarget::Uwp { aumid } => Some(format!("shell:AppsFolder\\{aumid}")),
    }
}

#[cfg(windows)]
fn extract_icon(source: &str, output: &Path) -> Result<(), String> {
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
                .map_err(|error| error.to_string())?;
        let bitmap = factory
            .GetImage(
                SIZE { cx: 128, cy: 128 },
                SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
            )
            .map_err(|error| error.to_string())?;

        let image = hbitmap_to_image(bitmap)?;
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
        .map_err(|error| error.to_string())?;
        fs::write(output, buffer).map_err(|error| error.to_string())?;
    }
    Ok(())
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

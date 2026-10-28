use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MODULES: &[ModuleDef] = &[
    ModuleDef {
        id: "ai",
        name: "本地 AI 助手",
        version: "1.5.6",
        description: "完全在本机运行的 AI 助手：按电脑性能选择 Qwen2.5-0.5B / 1.5B / 3B，可搜索并启动应用、结束后台应用、读取系统状态、释放内存、打开网页、切换主题，还支持 Whisper 语音输入与朗读。未下载模型时不占用磁盘与内存。",
        features: &[
            "本地模型问答",
            "0.5B / 1.5B / 3B 可选",
            "按需下载",
            "输入时预热",
            "启动应用",
            "结束应用",
            "系统状态",
            "释放内存",
            "打开网页",
            "切换主题",
            "语音输入",
            "语音朗读",
        ],
        manifest: include_str!("../resources/modules/ai/manifest.json"),
    },
    ModuleDef {
        id: "background",
        name: "后台管理",
        version: "1.2.0",
        description: "管理注册表、启动文件夹、计划任务与自动服务里的自启动，并说明每个进程的用途；启动项按影响与建议汇总（高影响/建议关闭/建议保留），支持按影响、名称、来源排序。",
        features: &[
            "全量自启动扫描",
            "来源与只读标识",
            "启动影响评估",
            "影响总览",
            "启动项排序",
            "一键关闭建议项",
            "进程分组与结束",
            "进程用途说明",
            "关键进程保护",
        ],
        manifest: include_str!("../resources/modules/background/manifest.json"),
    },
    ModuleDef {
        id: "performance",
        name: "系统体检",
        version: "1.5.0",
        description: "只做体检不插手优化：系统健康评分（每项扣分可见）、CPU 与多磁盘状态、物理磁盘健康、资源占用排行与评分趋势，并支持一键复制体检报告。",
        features: &[
            "体检评分",
            "扣分明细",
            "一键复制报告",
            "CPU 采样",
            "多磁盘状态",
            "磁盘健康",
            "资源排行",
            "评分趋势",
            "清理记录",
        ],
        manifest: include_str!("../resources/performance/manifest.json"),
    },
    ModuleDef {
        id: "optimize",
        name: "系统优化",
        version: "1.5.0",
        description: "集中所有主动优化动作：可撤销的一键优化（51 项、按隐私/性能/服务/更新分类，参考 Winhance / WinUtil / Optimizer）、27 处垃圾清理（含浏览器缓存与 Windows.old）、电源计划（含卓越性能）、DNS 一键切换（阿里/腾讯/Google/Cloudflare，可还原）与网络诊断、深层内存清理；体检监控已拆分到「系统体检」插件。",
        features: &["一键优化", "原值备份", "单项还原", "类别筛选", "临时文件清理", "更新缓存清理", "预读取缓存清理", "回收站清理", "电源计划", "卓越性能", "公共 DNS 切换", "DNS 还原", "网络诊断", "刷新 DNS", "深度内存清理"],
        manifest: include_str!("../resources/modules/optimize/manifest.json"),
    },
    ModuleDef {
        id: "memory",
        name: "内存管理",
        version: "1.3.0",
        description: "自动识别物理内存与提交内存，按压力调节 WebView2 档位；支持工作集释放与管理员级的系统缓存、待机列表清理，空闲自动释放，隐藏时挂起并释放工作集。",
        features: &["自动识别内存", "智能阈值", "动态档位", "工作集释放", "系统缓存清理", "待机列表清理", "深度释放", "空闲释放", "提交内存", "提交压力", "趋势采样", "隐藏挂起", "调节记录"],
        manifest: include_str!("../resources/modules/memory/manifest.json"),
    },
    ModuleDef {
        id: "cleanup",
        name: "应用管理",
        version: "1.3.0",
        description: "卸载应用并可完全清除；同时扫描安装目录与应用数据文件夹，标注是否仍被引用，按大小与疑似残留筛选清理；已安装应用支持按名称/发布者搜索与按占用大小排序。",
        features: &[
            "已安装应用列表",
            "应用搜索",
            "按占用排序",
            "调用自带卸载程序",
            "完全清除安装文件夹",
            "残留注册表清理",
            "安装目录两级扫描",
            "应用数据目录扫描",
            "空间占用排行",
            "疑似残留标记",
            "引用保护",
            "确认后删除",
        ],
        manifest: include_str!("../resources/modules/cleanup/manifest.json"),
    },
    ModuleDef {
        id: "boot",
        name: "启动与托盘",
        version: "1.1.0",
        description: "自定义显示/隐藏快捷键，为常用应用设置全局启动快捷键；托盘右键可直接启动常用应用，关闭窗口可隐藏或退出。",
        features: &["系统托盘", "自定义全局快捷键", "应用快捷键", "托盘快捷启动", "关闭行为可选", "开机自启动", "单实例"],
        manifest: include_str!("../resources/modules/boot/manifest.json"),
    },
];

struct ModuleDef {
    id: &'static str,
    name: &'static str,
    version: &'static str,
    description: &'static str,
    features: &'static [&'static str],
    manifest: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleStatus {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub features: Vec<String>,
    pub installed: bool,
    pub installed_at: Option<u64>,
    pub size_bytes: u64,
    pub runtime: String,
}

pub fn list(base: &Path) -> Vec<ModuleStatus> {
    MODULES
        .iter()
        .map(|module| status(base, module))
        .collect()
}

pub fn is_installed(base: &Path, id: &str) -> bool {
    module_dir(base, id).join("install.json").is_file()
}

/// 只删除插件的安装记录，不触发卸载副作用（用于外部已经关闭该功能的场景）。
pub fn drop_record(base: &Path, id: &str) {
    let _ = fs::remove_dir_all(module_dir(base, id));
}

pub fn get(base: &Path, id: &str) -> Option<ModuleStatus> {
    find(id).map(|module| status(base, module))
}

pub fn install(app: &tauri::AppHandle, base: &Path, id: &str) -> Result<Vec<ModuleStatus>, String> {
    let module = find(id).ok_or_else(|| "未知插件".to_string())?;
    let dir = module_dir(base, id);
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建插件目录：{error}"))?;
    fs::write(dir.join("manifest.json"), module.manifest)
        .map_err(|error| format!("无法写入插件清单：{error}"))?;
    let install = serde_json::json!({
        "moduleId": module.id,
        "moduleVersion": module.version,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "installedAt": crate::store::now_millis(),
    });
    fs::write(
        dir.join("install.json"),
        serde_json::to_vec_pretty(&install).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("无法写入插件状态：{error}"))?;
    if let Err(error) = crate::module_install_hook(app, id) {
        let _ = fs::remove_dir_all(&dir);
        return Err(error);
    }
    Ok(list(base))
}

pub fn uninstall(
    app: &tauri::AppHandle,
    base: &Path,
    id: &str,
) -> Result<Vec<ModuleStatus>, String> {
    if find(id).is_none() {
        return Err("未知插件".to_string());
    }
    crate::module_uninstall_hook(app, id);
    let dir = module_dir(base, id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|error| format!("无法卸载插件：{error}"))?;
    }
    Ok(list(base))
}

pub fn name(id: &str) -> String {
    find(id)
        .map(|module| module.name.to_string())
        .unwrap_or_else(|| id.to_string())
}

fn find(id: &str) -> Option<&'static ModuleDef> {
    MODULES.iter().find(|module| module.id == id)
}

fn module_dir(base: &Path, id: &str) -> PathBuf {
    base.join("modules").join(id)
}

fn status(base: &Path, module: &ModuleDef) -> ModuleStatus {
    let dir = module_dir(base, module.id);
    let installed = dir.join("install.json").is_file();
    let installed_at = fs::read_to_string(dir.join("install.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("installedAt").and_then(|at| at.as_u64()));
    ModuleStatus {
        id: module.id.to_string(),
        name: module.name.to_string(),
        version: module.version.to_string(),
        description: module.description.to_string(),
        features: module.features.iter().map(|item| item.to_string()).collect(),
        installed,
        installed_at,
        size_bytes: if installed { directory_size(&dir) } else { 0 },
        runtime: "in-app".to_string(),
    }
}

fn directory_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                }
            }
        }
    }
    total
}

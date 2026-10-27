fn main() {
    // 启点需要管理员权限才能完整读取系统信息、扫描所有用户的应用并执行深度内存释放。
    // 通过自定义应用清单声明 requireAdministrator，安装包与自启动任务也按管理员运行。
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    let attributes =
        tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}

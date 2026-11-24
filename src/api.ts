import type {
  AppEntry,
  Bootstrap,
  BrokenShortcut,
  CleanupApp,
  CleanupDeleteReport,
  CleanupScan,
  CreateShortcutSpec,
  CustomTheme,
  DiagReport,
  DiskUsageScan,
  DnsStatus,
  HotkeyStatus,
  IconMap,
  LaunchOptions,
  LaunchResult,
  LockedProcess,
  MemoryStatus,
  ModuleId,
  ModuleStatus,
  OptimizeItem,
  OptimizeOutcome,
  PerfCleanResult,
  PerfModuleStatus,
  PerfPowerInfo,
  PerfSystemInfo,
  PerfTempScan,
  ProcessItem,
  ProcessTarget,
  ScanProgress,
  ScanResult,
  Settings,
  StartupScan,
  TerminateReport,
  UninstallReport,
  UpdateInfo,
  UpdateProgress,
  WarmIconsResult,
} from "./types";
import { cloneSettings, DEFAULT_SETTINGS } from "./defaults";

const TAURI = "__TAURI_INTERNALS__" in window;
const MOCK_KEY = "qidian.settings.v1";
/// 图标自定义协议：Windows/WebView2 只接受 http 形式，其他平台会解析为 qidian-icon://localhost。
const ICON_PROTOCOL_ORIGIN = "http://qidian-icon.localhost";
let mockModulePromise: Promise<typeof import("./mock")> | null = null;
let mockAutostart = localStorage.getItem("qidian.mock.autostart") === "1";
const mockUpdateListeners = new Set<(progress: UpdateProgress) => void>();
let mockUpdateInstalled = false;

export const isTauri = TAURI;

function mockModule(): Promise<typeof import("./mock")> {
  mockModulePromise ??= import("./mock");
  return mockModulePromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== "object") return cloneSettings(DEFAULT_SETTINGS);
  const incoming = raw as Partial<Settings>;
  const merged: Settings = {
    ...cloneSettings(DEFAULT_SETTINGS),
    ...incoming,
    categories:
      Array.isArray(incoming.categories) && incoming.categories.length > 0
        ? incoming.categories.map((c) => ({ ...c }))
        : cloneSettings(DEFAULT_SETTINGS).categories,
    overrides: { ...(incoming.overrides ?? {}) },
    appHotkeys:
      incoming.appHotkeys && typeof incoming.appHotkeys === "object"
        ? Object.fromEntries(
            Object.entries(incoming.appHotkeys).filter(
              ([, value]) => typeof value === "string" && value.trim().length > 0,
            ),
          )
        : {},
    hotkeyToggle:
      typeof incoming.hotkeyToggle === "string" && incoming.hotkeyToggle.trim()
        ? incoming.hotkeyToggle
        : DEFAULT_SETTINGS.hotkeyToggle,
    doubleCtrlEnabled:
      typeof incoming.doubleCtrlEnabled === "boolean"
        ? incoming.doubleCtrlEnabled
        : DEFAULT_SETTINGS.doubleCtrlEnabled,
    closeToTray:
      typeof incoming.closeToTray === "boolean"
        ? incoming.closeToTray
        : DEFAULT_SETTINGS.closeToTray,
    trayQuickApps:
      typeof incoming.trayQuickApps === "boolean"
        ? incoming.trayQuickApps
        : DEFAULT_SETTINGS.trayQuickApps,
    cleanupRecycleBin:
      typeof incoming.cleanupRecycleBin === "boolean"
        ? incoming.cleanupRecycleBin
        : DEFAULT_SETTINGS.cleanupRecycleBin,
    pinned: Array.isArray(incoming.pinned) ? [...incoming.pinned] : [],
    recent: Array.isArray(incoming.recent) ? incoming.recent.map((r) => ({ ...r })) : [],
    usage:
      incoming.usage && typeof incoming.usage === "object"
        ? Object.fromEntries(
            Object.entries(incoming.usage).filter(
              ([, value]) => typeof value === "number" && value > 0,
            ),
          )
        : {},
    hidden: Array.isArray(incoming.hidden) ? [...incoming.hidden] : [],
    customPalette:
      incoming.customPalette && typeof incoming.customPalette === "object"
        ? { ...DEFAULT_SETTINGS.customPalette, ...incoming.customPalette }
        : { ...DEFAULT_SETTINGS.customPalette },
    wallpaperLibrary: Array.isArray(incoming.wallpaperLibrary)
      ? incoming.wallpaperLibrary
          .filter(
            (asset) =>
              Boolean(asset) && typeof asset === "object" && typeof asset.id === "string",
          )
          .slice(-12)
          .map((asset) => ({ ...asset }))
      : [],
    customThemes: Array.isArray(incoming.customThemes)
      ? incoming.customThemes
          .filter(
            (theme): theme is CustomTheme =>
              Boolean(theme) &&
              typeof theme === "object" &&
              typeof (theme as CustomTheme).id === "string" &&
              typeof (theme as CustomTheme).name === "string",
          )
          .slice(-12)
          .map((theme) => ({
            ...theme,
            wallpaperFit: theme.wallpaperFit ?? "cover",
            wallpaperX:
              typeof theme.wallpaperX === "number" ? theme.wallpaperX : 50,
            wallpaperY:
              typeof theme.wallpaperY === "number" ? theme.wallpaperY : 50,
            wallpaperZoom:
              typeof theme.wallpaperZoom === "number" ? theme.wallpaperZoom : 100,
            wallpaperAsset:
              typeof theme.wallpaperAsset === "string" ? theme.wallpaperAsset : "",
            palette: { ...DEFAULT_SETTINGS.customPalette, ...(theme.palette ?? {}) },
          }))
      : [],
  };
  return merged;
}

async function loadMockSettings(): Promise<Settings> {
  const { MOCK_SETTINGS } = await mockModule();
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (!raw) return cloneSettings(MOCK_SETTINGS);
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return cloneSettings(MOCK_SETTINGS);
  }
}

function saveMockSettings(settings: Settings): void {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(settings));
  } catch {
    // 存储不可用时保持内存态
  }
}

const MOCK_WALLPAPER_KEY = "qidian.wallpapers.v1";

function readMockWallpapers(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MOCK_WALLPAPER_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeMockWallpapers(map: Record<string, string>): void {
  try {
    localStorage.setItem(MOCK_WALLPAPER_KEY, JSON.stringify(map));
  } catch {
    // 浏览器预览配额不足时忽略，桌面端由后端写文件
  }
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

const mockBridge = {
  async bootstrap(): Promise<Bootstrap> {
    await sleep(240);
    const { MOCK_APPS } = await mockModule();
    return {
      settings: await loadMockSettings(),
      apps: MOCK_APPS,
      scannedAt: Date.now() - 42 * 60 * 1000,
    };
  },

  async scan(force: boolean, onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
    void force;
    const { MOCK_APPS } = await mockModule();
    const started = performance.now();
    const steps: ScanProgress[] = [
      { phase: "shortcuts", found: 18, percent: 0.16 },
      { phase: "registry", found: 36, percent: 0.42 },
      { phase: "uwp", found: 41, percent: 0.68 },
      { phase: "classify", found: MOCK_APPS.length, percent: 0.9 },
      { phase: "done", found: MOCK_APPS.length, percent: 1 },
    ];
    for (const step of steps) {
      onProgress?.(step);
      await sleep(step.phase === "done" ? 60 : 130);
    }
    return {
      apps: MOCK_APPS,
      scannedAt: Date.now(),
      cached: false,
      durationMs: Math.round(performance.now() - started),
    };
  },

  async loadIcons(ids: string[]): Promise<IconMap> {
    void ids;
    return {};
  },

  iconUrl(_id: string): string | null {
    // 浏览器预览没有本地图标缓存，继续使用演示数据。
    return null;
  },

  async warmIcons(): Promise<WarmIconsResult> {
    return { processed: 0, pending: 0 };
  },

  async cleanupLegacyAi(): Promise<number> {
    return 0;
  },

  async launch(id: string, options?: LaunchOptions): Promise<LaunchResult> {
    void options;
    const { MOCK_APPS } = await mockModule();
    const app = MOCK_APPS.find((item) => item.id === id);
    if (!app) return { ok: false, error: "应用不存在" };
    await sleep(160);
    // 与桌面端一致：启动成功后累加计数，供「常用优先」排序使用。
    const settings = await loadMockSettings();
    settings.usage = { ...(settings.usage ?? {}) };
    settings.usage[id] = (settings.usage[id] ?? 0) + 1;
    saveMockSettings(settings);
    return { ok: true };
  },

  async addCustomApp(path: string): Promise<AppEntry | null> {
    void path;
    await sleep(120);
    // 浏览器预览不真正解析快捷方式，直接返回 null 让界面提示「不支持」。
    return null;
  },

  async reveal(id: string): Promise<void> {
    void id;
    await sleep(80);
  },

  async pruneApps(): Promise<AppEntry[]> {
    const { MOCK_APPS } = await mockModule();
    return MOCK_APPS;
  },

  async cleanupScan(): Promise<CleanupScan> {
    await sleep(600);
    const { mockCleanupScan } = await mockModule();
    return mockCleanupScan();
  },

  async cleanupDelete(paths: string[], recycle: boolean): Promise<CleanupDeleteReport> {
    await sleep(700);
    const { mockCleanupDelete } = await mockModule();
    return mockCleanupDelete(paths, recycle);
  },

  async cleanupOpen(path: string): Promise<void> {
    void path;
    await sleep(60);
  },

  async checkPathLocks(paths: string[]): Promise<LockedProcess[]> {
    void paths;
    return [];
  },

  async cleanupApps(): Promise<CleanupApp[]> {
    await sleep(300);
    const { mockCleanupApps } = await mockModule();
    return mockCleanupApps();
  },

  async cleanupUninstall(id: string, removeLeftovers: boolean): Promise<UninstallReport> {
    await sleep(1200);
    const { mockCleanupUninstall } = await mockModule();
    return mockCleanupUninstall(id, removeLeftovers);
  },

  async saveSettings(settings: Settings): Promise<void> {
    saveMockSettings(settings);
    await sleep(20);
  },

  async resetSettings(): Promise<Settings> {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    saveMockSettings(settings);
    return settings;
  },

  async clearCache(): Promise<void> {
    await sleep(120);
  },

  async openDataDir(): Promise<void> {
    await sleep(40);
  },

  async saveWallpaper(id: string, data: string): Promise<number> {
    const map = readMockWallpapers();
    map[id] = data;
    writeMockWallpapers(map);
    await sleep(40);
    return Math.round(data.length * 0.75);
  },

  async readWallpaper(id: string): Promise<string> {
    return readMockWallpapers()[id] ?? "";
  },

  async deleteWallpaper(id: string): Promise<void> {
    const map = readMockWallpapers();
    delete map[id];
    writeMockWallpapers(map);
    await sleep(20);
  },

  async listStartup(_force = false): Promise<StartupScan> {
    await sleep(320);
    const { mockStartupScan } = await mockModule();
    return mockStartupScan();
  },

  async setStartupEnabled(id: string, enabled: boolean): Promise<StartupScan> {
    await sleep(100);
    const { mockSetStartupEnabled } = await mockModule();
    return mockSetStartupEnabled(id, enabled);
  },

  async listProcesses(): Promise<ProcessItem[]> {
    await sleep(260);
    const { mockProcessItems } = await mockModule();
    return mockProcessItems();
  },

  async terminateProcesses(targets: ProcessTarget[]): Promise<TerminateReport> {
    await sleep(180);
    const { mockTerminate } = await mockModule();
    return mockTerminate(targets);
  },

  async performanceModuleStatus(): Promise<PerfModuleStatus> {
    await sleep(80);
    const { mockPerformanceStatus } = await mockModule();
    return mockPerformanceStatus();
  },

  async performanceModuleInstall(): Promise<PerfModuleStatus> {
    await sleep(320);
    const { mockPerformanceInstall } = await mockModule();
    return mockPerformanceInstall();
  },

  async performanceModuleUninstall(): Promise<PerfModuleStatus> {
    await sleep(180);
    const { mockPerformanceUninstall } = await mockModule();
    return mockPerformanceUninstall();
  },

  async performanceSystemInfo(): Promise<PerfSystemInfo> {
    await sleep(260);
    const { mockPerformanceSystemInfo } = await mockModule();
    return mockPerformanceSystemInfo();
  },

  async performanceDiskUsage(drive?: string): Promise<DiskUsageScan> {
    void drive;
    await sleep(420);
    const { mockDiskUsage } = await mockModule();
    return mockDiskUsage();
  },

  async performanceScanTemp(days: number): Promise<PerfTempScan> {
    void days;
    await sleep(360);
    const { mockPerformanceScanTemp } = await mockModule();
    return mockPerformanceScanTemp();
  },

  async performanceCleanTemp(
    categories: string[],
    days: number,
  ): Promise<PerfCleanResult> {
    void days;
    await sleep(520);
    const { mockPerformanceClean } = await mockModule();
    return mockPerformanceClean(categories);
  },

  async performanceSetPower(guid: string): Promise<PerfPowerInfo> {
    await sleep(240);
    const { mockPerformanceSetPower } = await mockModule();
    return mockPerformanceSetPower(guid);
  },

  async performanceFlushDns(): Promise<string> {
    await sleep(180);
    const { mockPerformanceFlushDns } = await mockModule();
    return mockPerformanceFlushDns();
  },

  async optimizeList(): Promise<OptimizeItem[]> {
    await sleep(120);
    const { mockOptimizeItems } = await mockModule();
    return mockOptimizeItems();
  },

  async optimizeApply(ids: string[]): Promise<OptimizeOutcome> {
    await sleep(520);
    const { mockOptimizeApply } = await mockModule();
    return mockOptimizeApply(ids);
  },

  async optimizeRestore(ids: string[], all: boolean): Promise<OptimizeOutcome> {
    await sleep(320);
    const { mockOptimizeRestore } = await mockModule();
    return mockOptimizeRestore(ids, all);
  },

  async optimizePowerStatus(): Promise<PerfPowerInfo> {
    await sleep(160);
    const { mockOptimizePowerStatus } = await mockModule();
    return mockOptimizePowerStatus();
  },

  async optimizeDnsStatus(): Promise<DnsStatus> {
    await sleep(220);
    const { mockDnsStatus } = await mockModule();
    return mockDnsStatus();
  },

  async optimizeDnsSet(preset: string): Promise<OptimizeOutcome> {
    await sleep(360);
    const { mockDnsSet } = await mockModule();
    return mockDnsSet(preset);
  },

  async optimizeDnsRestore(): Promise<OptimizeOutcome> {
    await sleep(260);
    const { mockDnsRestore } = await mockModule();
    return mockDnsRestore();
  },

  async optimizeNetworkDiag(): Promise<DiagReport> {
    await sleep(620);
    const { mockNetworkDiag } = await mockModule();
    return mockNetworkDiag();
  },

  async elevatedStatus(): Promise<boolean> {
    // 浏览器预览环境模拟管理员权限。
    await sleep(40);
    return true;
  },

  async modules(): Promise<ModuleStatus[]> {
    await sleep(60);
    const { mockModules } = await mockModule();
    return mockModules();
  },

  async installModule(id: ModuleId): Promise<ModuleStatus[]> {
    await sleep(240);
    const { mockInstallModule } = await mockModule();
    return mockInstallModule(id);
  },

  async uninstallModule(id: ModuleId): Promise<ModuleStatus[]> {
    await sleep(160);
    const { mockUninstallModule } = await mockModule();
    return mockUninstallModule(id);
  },

  async memoryStatus(): Promise<MemoryStatus> {
    const { mockMemoryStatus } = await mockModule();
    await sleep(120);
    return mockMemoryStatus();
  },

  async memoryApply(): Promise<MemoryStatus> {
    const { mockMemoryApply } = await mockModule();
    await sleep(200);
    return mockMemoryApply();
  },

  async memoryTrim(): Promise<MemoryStatus> {
    const { mockMemoryTrim } = await mockModule();
    await sleep(260);
    return mockMemoryTrim();
  },

  async memoryTrimApp(name: string, pids: number[]): Promise<MemoryStatus> {
    const { mockMemoryTrimApp } = await mockModule();
    await sleep(200);
    return mockMemoryTrimApp(name, pids);
  },

  async memoryPurgeSystem(): Promise<number> {
    await sleep(480);
    return Math.round(1.4 * 1024 ** 3);
  },

  async autostartStatus(): Promise<boolean> {
    return mockAutostart;
  },

  async setAutostart(enabled: boolean): Promise<boolean> {
    mockAutostart = enabled;
    localStorage.setItem("qidian.mock.autostart", enabled ? "1" : "0");
    await sleep(80);
    return mockAutostart;
  },

  async hotkeyStatus(): Promise<HotkeyStatus> {
    const settings = await loadMockSettings();
    const { mockHotkeyStatus } = await mockModule();
    return mockHotkeyStatus(settings);
  },

  async hotkeyRestoreDefaults(): Promise<void> {
    const settings = await loadMockSettings();
    settings.hotkeyToggle = DEFAULT_SETTINGS.hotkeyToggle;
    settings.appHotkeys = {};
    saveMockSettings(settings);
    await sleep(180);
  },

  async setDoubleCtrl(enabled: boolean): Promise<void> {
    const settings = await loadMockSettings();
    settings.doubleCtrlEnabled = enabled;
    saveMockSettings(settings);
    await sleep(120);
  },

  async scanBrokenShortcuts(): Promise<BrokenShortcut[]> {
    // 与桌面端一致：只读扫描约 1 秒。
    await sleep(1000);
    const { mockScanBrokenShortcuts } = await mockModule();
    return mockScanBrokenShortcuts();
  },

  async relocateShortcut(path: string, newTarget: string): Promise<void> {
    await sleep(220);
    const { mockRelocateShortcut } = await mockModule();
    mockRelocateShortcut(path, newTarget);
  },

  async deleteShortcuts(paths: string[]): Promise<number> {
    await sleep(260);
    const { mockDeleteShortcuts } = await mockModule();
    return mockDeleteShortcuts(paths);
  },

  async createShortcut(spec: CreateShortcutSpec): Promise<string> {
    await sleep(240);
    const { mockCreateShortcut } = await mockModule();
    return mockCreateShortcut(spec);
  },

  async startedHidden(): Promise<boolean> {
    return false;
  },

  async trayStatus(): Promise<boolean> {
    // 浏览器预览没有系统托盘
    return false;
  },

  async quitApp(): Promise<void> {
    await sleep(40);
  },

  async checkUpdate(): Promise<UpdateInfo | null> {
    await sleep(700);
    if (mockUpdateInstalled) return null;
    return {
      version: "9.9.9",
      currentVersion: __APP_VERSION__,
      notes:
        "预览数据：新增更安静的更新流程。\n· 检查更新改为手动触发，默认不联网\n· 下载进度显示百分比并可随时查看\n· 导出诊断包便于反馈问题",
      date: "2026-11-20",
    };
  },

  async installUpdate(): Promise<void> {
    // 预览模式模拟下载进度，方便检查进度条与按钮禁用状态。
    const contentLength = 5_200_000;
    let chunkLength = 0;
    while (chunkLength < contentLength) {
      chunkLength = Math.min(contentLength, chunkLength + 520_000);
      for (const listener of mockUpdateListeners) {
        listener({ chunkLength, contentLength });
      }
      await sleep(120);
    }
    mockUpdateInstalled = true;
  },

  async exportDiagnostics(): Promise<string> {
    await sleep(520);
    return "C:\\Users\\Public\\Desktop\\QiDian-Diagnostics-20261124-120000.txt";
  },
};

const tauriBridge = {
  bootstrap(): Promise<Bootstrap> {
    return tauriInvoke<Bootstrap>("bootstrap");
  },

  async scan(force: boolean, onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
    let unlisten: (() => void) | undefined;
    if (onProgress) {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<ScanProgress>("scan-progress", (event) => onProgress(event.payload));
      } catch {
        unlisten = undefined;
      }
    }
    try {
      return await tauriInvoke<ScanResult>("scan_apps", { force });
    } finally {
      unlisten?.();
    }
  },

  loadIcons(ids: string[]): Promise<IconMap> {
    return tauriInvoke<IconMap>("load_icons", { ids });
  },

  /// 图标的协议地址：由后端按 id 直读磁盘缓存，不必再经 IPC 传 base64。
  iconUrl(id: string): string | null {
    if (!id) return null;
    return `${ICON_PROTOCOL_ORIGIN}/${encodeURIComponent(id)}.png`;
  },

  warmIcons(): Promise<WarmIconsResult> {
    return tauriInvoke<WarmIconsResult>("warm_icons");
  },

  cleanupLegacyAi(): Promise<number> {
    return tauriInvoke<number>("cleanup_legacy_ai");
  },

  async launch(id: string, options?: LaunchOptions): Promise<LaunchResult> {
    try {
      if (options?.admin) {
        await tauriInvoke<void>("launch_app_as_admin", { id });
      } else {
        await tauriInvoke<void>("launch_app", { id });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },

  addCustomApp(path: string): Promise<AppEntry | null> {
    return tauriInvoke<AppEntry | null>("add_custom_app", { path });
  },

  reveal(id: string): Promise<void> {
    return tauriInvoke<void>("reveal_app", { id });
  },

  pruneApps(): Promise<AppEntry[]> {
    return tauriInvoke<AppEntry[]>("prune_missing_apps");
  },

  cleanupScan(): Promise<CleanupScan> {
    return tauriInvoke<CleanupScan>("cleanup_scan");
  },

  cleanupDelete(paths: string[], recycle: boolean): Promise<CleanupDeleteReport> {
    return tauriInvoke<CleanupDeleteReport>("cleanup_delete", { paths, recycle });
  },

  cleanupOpen(path: string): Promise<void> {
    return tauriInvoke<void>("cleanup_open", { path });
  },

  checkPathLocks(paths: string[]): Promise<LockedProcess[]> {
    return tauriInvoke<LockedProcess[]>("check_path_locks", { paths });
  },

  cleanupApps(): Promise<CleanupApp[]> {
    return tauriInvoke<CleanupApp[]>("cleanup_apps");
  },

  cleanupUninstall(id: string, removeLeftovers: boolean): Promise<UninstallReport> {
    return tauriInvoke<UninstallReport>("cleanup_uninstall", { id, removeLeftovers });
  },

  saveSettings(settings: Settings): Promise<void> {
    return tauriInvoke<void>("save_settings", { settings });
  },

  resetSettings(): Promise<Settings> {
    return tauriInvoke<Settings>("reset_settings");
  },

  clearCache(): Promise<void> {
    return tauriInvoke<void>("clear_cache");
  },

  openDataDir(): Promise<void> {
    return tauriInvoke<void>("open_data_dir");
  },

  saveWallpaper(id: string, data: string): Promise<number> {
    return tauriInvoke<number>("save_wallpaper", { id, data });
  },

  readWallpaper(id: string): Promise<string> {
    return tauriInvoke<string>("read_wallpaper", { id });
  },

  deleteWallpaper(id: string): Promise<void> {
    return tauriInvoke<void>("delete_wallpaper", { id });
  },

  listStartup(force = false): Promise<StartupScan> {
    return tauriInvoke<StartupScan>("list_startup", { force });
  },

  setStartupEnabled(id: string, enabled: boolean): Promise<StartupScan> {
    return tauriInvoke<StartupScan>("set_startup_enabled", { id, enabled });
  },

  listProcesses(): Promise<ProcessItem[]> {
    return tauriInvoke<ProcessItem[]>("list_processes");
  },

  terminateProcesses(targets: ProcessTarget[]): Promise<TerminateReport> {
    return tauriInvoke<TerminateReport>("terminate_processes", { targets });
  },

  modules(): Promise<ModuleStatus[]> {
    return tauriInvoke<ModuleStatus[]>("list_modules");
  },

  installModule(id: ModuleId): Promise<ModuleStatus[]> {
    return tauriInvoke<ModuleStatus[]>("install_module", { id });
  },

  uninstallModule(id: ModuleId): Promise<ModuleStatus[]> {
    return tauriInvoke<ModuleStatus[]>("uninstall_module", { id });
  },

  performanceModuleStatus(): Promise<PerfModuleStatus> {
    return tauriInvoke<PerfModuleStatus>("performance_module_status");
  },

  performanceModuleInstall(): Promise<PerfModuleStatus> {
    return tauriInvoke<PerfModuleStatus>("performance_module_install");
  },

  performanceModuleUninstall(): Promise<PerfModuleStatus> {
    return tauriInvoke<PerfModuleStatus>("performance_module_uninstall");
  },

  performanceSystemInfo(): Promise<PerfSystemInfo> {
    return tauriInvoke<PerfSystemInfo>("performance_system_info");
  },

  performanceDiskUsage(drive?: string): Promise<DiskUsageScan> {
    return tauriInvoke<DiskUsageScan>("performance_disk_usage", { drive });
  },

  performanceScanTemp(days: number): Promise<PerfTempScan> {
    return tauriInvoke<PerfTempScan>("performance_scan_temp", { days });
  },

  performanceCleanTemp(categories: string[], days: number): Promise<PerfCleanResult> {
    return tauriInvoke<PerfCleanResult>("performance_clean_temp", { categories, days });
  },

  performanceSetPower(guid: string): Promise<PerfPowerInfo> {
    return tauriInvoke<PerfPowerInfo>("performance_set_power", { guid });
  },

  performanceFlushDns(): Promise<string> {
    return tauriInvoke<string>("performance_flush_dns");
  },

  optimizeList(): Promise<OptimizeItem[]> {
    return tauriInvoke<OptimizeItem[]>("optimize_list");
  },

  optimizeApply(ids: string[]): Promise<OptimizeOutcome> {
    return tauriInvoke<OptimizeOutcome>("optimize_apply", { ids });
  },

  optimizeRestore(ids: string[], all: boolean): Promise<OptimizeOutcome> {
    return tauriInvoke<OptimizeOutcome>("optimize_restore", { ids, all });
  },

  optimizePowerStatus(): Promise<PerfPowerInfo> {
    return tauriInvoke<PerfPowerInfo>("optimize_power_status");
  },

  optimizeDnsStatus(): Promise<DnsStatus> {
    return tauriInvoke<DnsStatus>("optimize_dns_status");
  },

  optimizeDnsSet(preset: string): Promise<OptimizeOutcome> {
    return tauriInvoke<OptimizeOutcome>("optimize_dns_set", { preset });
  },

  optimizeDnsRestore(): Promise<OptimizeOutcome> {
    return tauriInvoke<OptimizeOutcome>("optimize_dns_restore");
  },

  optimizeNetworkDiag(): Promise<DiagReport> {
    return tauriInvoke<DiagReport>("optimize_network_diag");
  },

  elevatedStatus(): Promise<boolean> {
    return tauriInvoke<boolean>("elevated_status");
  },

  autostartStatus(): Promise<boolean> {
    return tauriInvoke<boolean>("autostart_status");
  },

  memoryStatus(): Promise<MemoryStatus> {
    return tauriInvoke<MemoryStatus>("memory_status");
  },

  memoryApply(): Promise<MemoryStatus> {
    return tauriInvoke<MemoryStatus>("memory_apply");
  },

  memoryTrim(): Promise<MemoryStatus> {
    return tauriInvoke<MemoryStatus>("memory_trim");
  },

  memoryTrimApp(name: string, pids: number[]): Promise<MemoryStatus> {
    return tauriInvoke<MemoryStatus>("memory_trim_app", { name, pids });
  },

  memoryPurgeSystem(): Promise<number> {
    return tauriInvoke<number>("memory_purge_system");
  },

  setAutostart(enabled: boolean): Promise<boolean> {
    return tauriInvoke<boolean>("set_autostart", { enabled });
  },

  hotkeyStatus(): Promise<HotkeyStatus> {
    return tauriInvoke<HotkeyStatus>("hotkey_status");
  },

  hotkeyRestoreDefaults(): Promise<void> {
    return tauriInvoke<void>("hotkey_restore_defaults");
  },

  setDoubleCtrl(enabled: boolean): Promise<void> {
    return tauriInvoke<void>("set_double_ctrl", { enabled });
  },

  scanBrokenShortcuts(): Promise<BrokenShortcut[]> {
    return tauriInvoke<BrokenShortcut[]>("scan_broken_shortcuts");
  },

  relocateShortcut(path: string, newTarget: string): Promise<void> {
    return tauriInvoke<void>("relocate_shortcut", { path, newTarget });
  },

  deleteShortcuts(paths: string[]): Promise<number> {
    return tauriInvoke<number>("delete_shortcuts", { paths });
  },

  createShortcut(spec: CreateShortcutSpec): Promise<string> {
    return tauriInvoke<string>("create_shortcut", { spec });
  },

  startedHidden(): Promise<boolean> {
    return tauriInvoke<boolean>("started_hidden");
  },

  trayStatus(): Promise<boolean> {
    return tauriInvoke<boolean>("tray_status");
  },

  async quitApp(): Promise<void> {
    await tauriInvoke<void>("quit_app");
  },

  checkUpdate(): Promise<UpdateInfo | null> {
    return tauriInvoke<UpdateInfo | null>("check_update");
  },

  installUpdate(): Promise<void> {
    return tauriInvoke<void>("install_update");
  },

  exportDiagnostics(): Promise<string> {
    return tauriInvoke<string>("export_diagnostics");
  },
};

export const api = TAURI ? tauriBridge : mockBridge;

async function withWindow<T>(run: (win: import("@tauri-apps/api/window").Window) => Promise<T>): Promise<T> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  return run(win);
}

let mockMaximized = false;

export async function minimizeWindow(): Promise<void> {
  if (!TAURI) return;
  await withWindow((win) => win.minimize());
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  if (!TAURI) {
    mockMaximized = !mockMaximized;
    return mockMaximized;
  }
  return withWindow(async (win) => {
    await win.toggleMaximize();
    return win.isMaximized();
  });
}

export async function closeWindow(): Promise<void> {
  if (!TAURI) return;
  await withWindow((win) => win.close());
}

export async function showWindow(): Promise<void> {
  if (!TAURI) return;
  await withWindow(async (win) => {
    await win.show();
    await win.setFocus();
  });
}

/** 窗口是否真正在前台可见：隐藏到托盘或最小化时返回 false，供后台预热与校验让路。 */
export async function windowActive(): Promise<boolean> {
  if (!TAURI) return true;
  try {
    return await withWindow(async (win) => !(await win.isMinimized()) && (await win.isVisible()));
  } catch {
    return true;
  }
}

export async function hideWindow(): Promise<void> {
  if (!TAURI) return;
  try {
    await setMemorySaver(true);
  } catch {
    // 内存节省不可用时仍然允许隐藏窗口
  }
  await withWindow((win) => win.hide());
}

export async function setMemorySaver(enabled: boolean): Promise<void> {
  if (!TAURI) return;
  await tauriInvoke<void>("set_memory_saver", { enabled });
}

export function watchMinimize(onChange: (minimized: boolean) => void): () => void {
  if (!TAURI) return () => undefined;
  let disposed = false;
  let unlistenResize: (() => void) | undefined;
  let unlistenFocus: (() => void) | undefined;
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      unlistenResize = await win.onResized(async () => {
        if (disposed) return;
        try {
          onChange(await win.isMinimized());
        } catch {
          // 无法读取最小化状态时保持不变
        }
      });
      unlistenFocus = await win.onFocusChanged((event) => {
        if (!disposed && event.payload) onChange(false);
      });
    } catch {
      // 窗口事件不可用时静默降级
    }
  })();
  return () => {
    disposed = true;
    unlistenResize?.();
    unlistenFocus?.();
  };
}

export function watchAppFocus(onFocus: () => void): () => void {
  if (!TAURI) return () => undefined;
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    try {
      const win = await withWindow(async (w) => w);
      unlisten = await win.onFocusChanged((event) => {
        if (!disposed && event.payload) onFocus();
      });
    } catch {
      // 窗口事件不可用时静默降级
    }
  })();
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export function watchMaximize(onChange: (maximized: boolean) => void): () => void {
  if (!TAURI) return () => undefined;
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    try {
      const win = await withWindow(async (w) => w);
      unlisten = await win.onResized(async () => {
        if (disposed) return;
        const maximized = await win.isMaximized();
        onChange(maximized);
      });
      onChange(await win.isMaximized());
    } catch {
      // 窗口事件不可用时静默降级
    }
  })();
  return () => {
    disposed = true;
    unlisten?.();
  };
}

async function watchMemoryEvent(name: string, callback: () => void): Promise<() => void> {
  if (!TAURI) return () => undefined;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen(name, () => callback());
  } catch {
    return () => undefined;
  }
}

export function watchMemorySqueeze(callback: () => void): Promise<() => void> {
  return watchMemoryEvent("memory-squeeze", callback);
}

export function watchMemoryRestore(callback: () => void): Promise<() => void> {
  return watchMemoryEvent("memory-restore", callback);
}

export async function watchAppLaunch(callback: (id: string) => void): Promise<() => void> {
  if (!TAURI) return () => undefined;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<{ id: string }>("app-launched", (event) =>
      callback(event.payload.id),
    );
  } catch {
    return () => undefined;
  }
}

/** 监听更新下载进度；返回取消监听的函数。 */
export function watchUpdateProgress(callback: (progress: UpdateProgress) => void): () => void {
  if (!TAURI) {
    mockUpdateListeners.add(callback);
    return () => mockUpdateListeners.delete(callback);
  }
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen<UpdateProgress>("updater://progress", (event) =>
        callback(event.payload),
      );
      if (disposed) stop();
      else unlisten = stop;
    } catch {
      // 事件接口不可用时静默降级，安装本身仍会继续。
    }
  })();
  return () => {
    disposed = true;
    unlisten?.();
  };
}

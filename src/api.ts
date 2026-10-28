import type {
  AiChatMessage,
  AiModelInfo,
  AiProgress,
  AiStatus,
  AppEntry,
  Bootstrap,
  CleanupApp,
  CleanupDeleteReport,
  CleanupScan,
  CustomTheme,
  DiagReport,
  DiskUsageScan,
  DnsStatus,
  HotkeyStatus,
  IconMap,
  LaunchResult,
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
} from "./types";
import { cloneSettings, DEFAULT_SETTINGS } from "./defaults";

const TAURI = "__TAURI_INTERNALS__" in window;
const MOCK_KEY = "qidian.settings.v1";
let mockModulePromise: Promise<typeof import("./mock")> | null = null;
let mockAutostart = localStorage.getItem("qidian.mock.autostart") === "1";
let mockInstalledModel: string | null = null;
let mockAiRunning = false;
let mockAiModel = "qwen1.5b";

const MOCK_WHISPER_BYTES = 147_951_465;
const AI_TOTAL_BYTES = 1_265_272_291;

/** 与 Rust 侧 MODELS 保持一致的演示数据，仅用于浏览器预览。 */
const MOCK_MODELS: Array<Omit<AiModelInfo, "installed" | "selected">> = [
  {
    id: "qwen0.5b",
    label: "Qwen2.5-0.5B",
    bytes: 491_400_032,
    memory: "内存约 1.2 GB",
    note: "低配电脑首选：下载最小、响应最快，复杂指令偶尔理解不到位",
  },
  {
    id: "qwen1.5b",
    label: "Qwen2.5-1.5B",
    bytes: 1_117_320_736,
    memory: "内存约 2.2 GB",
    note: "默认推荐：问答、工具调用与速度平衡",
  },
  {
    id: "qwen3b",
    label: "Qwen2.5-3B",
    bytes: 2_104_932_768,
    memory: "内存约 3.5 GB",
    note: "性能较好的电脑：理解与工具调用最稳，启动更慢",
  },
];

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
    aiPermissions: {
      ...DEFAULT_SETTINGS.aiPermissions,
      ...(incoming.aiPermissions && typeof incoming.aiPermissions === "object"
        ? incoming.aiPermissions
        : {}),
    },
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
    const { MOCK_APPS, mockModuleInstalled } = await mockModule();
    // 预览环境与桌面端一致：AI 是否启用完全由插件安装状态决定。
    const aiInstalled = mockModuleInstalled("ai");
    return {
      settings: await loadMockSettings(),
      apps: MOCK_APPS,
      scannedAt: Date.now() - 42 * 60 * 1000,
      aiEnabled: aiInstalled,
      aiInstalled: aiInstalled && mockInstalledModel !== null,
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

  async warmIcons(): Promise<number> {
    return 0;
  },

  async launch(id: string): Promise<LaunchResult> {
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

  async aiStatus(): Promise<AiStatus> {
    await sleep(80);
    const { mockModuleInstalled } = await mockModule();
    const enabled = mockModuleInstalled("ai");
    const spec = MOCK_MODELS.find((item) => item.id === mockAiModel) ?? MOCK_MODELS[1];
    return {
      enabled,
      installed: enabled && mockInstalledModel === spec.id,
      running: mockAiRunning,
      downloadedBytes: mockInstalledModel === spec.id ? AI_TOTAL_BYTES : 0,
      totalBytes: spec.bytes + MOCK_WHISPER_BYTES,
      modelLabel: spec.label,
      downloading: false,
      model: spec.id,
      models: MOCK_MODELS.map((item) => ({
        ...item,
        installed: item.id === mockInstalledModel,
        selected: item.id === spec.id,
      })),
    };
  },

  async aiSetEnabled(_enabled: boolean): Promise<void> {
    void _enabled;
    await sleep(20);
  },

  async aiSetModel(model: string): Promise<void> {
    if (!MOCK_MODELS.some((item) => item.id === model)) throw new Error("未知的模型");
    mockAiModel = model;
    mockAiRunning = false;
    await sleep(40);
  },

  async aiDownload(): Promise<void> {
    await sleep(900);
    mockInstalledModel = mockAiModel;
  },

  async aiStart(): Promise<void> {
    await sleep(200);
    mockAiRunning = true;
  },

  async aiStop(): Promise<void> {
    mockAiRunning = false;
  },

  async aiChat(
    messages: AiChatMessage[],
    availableTools: unknown[] = [],
  ): Promise<Record<string, unknown>> {
    await sleep(500);
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const tools = messages.filter((message) => message.role === "tool").length;
    const text = lastUser?.content ?? "";
    const toolNames = (availableTools as Array<{ function?: { name?: string } }>)
      .map((tool) => tool.function?.name ?? "")
      .filter(Boolean);
    if (text.includes("关闭") && text.includes("微信")) {
      if (!toolNames.includes("list_running_apps") || !toolNames.includes("close_app")) {
        return {
          role: "assistant",
          content:
            "当前没有「应用结束」权限。请到 设置 › 插件 › AI 工具权限，先开启「应用结束」大类，再按需开启「查看运行中的应用」与「结束应用」。",
        };
      }
      if (tools >= 2) {
        return { role: "assistant", content: "已结束「微信」，共关闭 2 个进程。" };
      }
      if (tools === 1) {
        return {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "mock-close",
              type: "function",
              function: { name: "close_app", arguments: JSON.stringify({ app: "wechat" }) },
            },
          ],
        };
      }
      return {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "mock-list",
            type: "function",
            function: {
              name: "list_running_apps",
              arguments: JSON.stringify({ query: "微信" }),
            },
          },
        ],
      };
    }
    return {
      role: "assistant",
      content:
        "这是浏览器预览模式。桌面版会把问题交给本地 Qwen2.5-1.5B 模型，并且可以调用应用搜索、启动应用、结束应用与打开设置。",
    };
  },

  async aiTranscribe(): Promise<string> {
    await sleep(300);
    return "打开微信";
  },

  async aiRemove(): Promise<void> {
    mockInstalledModel = null;
    mockAiRunning = false;
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

  async memoryPurgeSystem(): Promise<number> {
    await sleep(480);
    return Math.round(1.4 * 1024 ** 3);
  },

  async openExternal(url: string): Promise<void> {
    await sleep(60);
    // 预览环境不真的拉起浏览器，只记录最后一次调用，方便排查。
    localStorage.setItem("qidian.mock.lastUrl", url);
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
    return {
      toggle: settings.hotkeyToggle,
      toggleOk: true,
      bindings: Object.entries(settings.appHotkeys).map(([appId, accelerator]) => ({
        appId,
        accelerator,
        ok: true,
      })),
      errors: [],
    };
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

  warmIcons(): Promise<number> {
    return tauriInvoke<number>("warm_icons");
  },

  async launch(id: string): Promise<LaunchResult> {
    try {
      await tauriInvoke<void>("launch_app", { id });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
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

  aiStatus(): Promise<AiStatus> {
    return tauriInvoke<AiStatus>("ai_status");
  },

  aiSetEnabled(enabled: boolean): Promise<void> {
    return tauriInvoke<void>("ai_set_enabled", { enabled });
  },

  aiSetModel(model: string): Promise<void> {
    return tauriInvoke<void>("ai_set_model", { model });
  },

  aiDownload(): Promise<void> {
    return tauriInvoke<void>("ai_download");
  },

  aiStart(): Promise<void> {
    return tauriInvoke<void>("ai_start");
  },

  aiStop(): Promise<void> {
    return tauriInvoke<void>("ai_stop");
  },

  aiChat(
    messages: AiChatMessage[],
    tools: unknown[],
  ): Promise<Record<string, unknown>> {
    return tauriInvoke<Record<string, unknown>>("ai_chat", { messages, tools });
  },

  aiTranscribe(wav: string): Promise<string> {
    return tauriInvoke<string>("ai_transcribe", { wav });
  },

  aiRemove(): Promise<void> {
    return tauriInvoke<void>("ai_remove");
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

  memoryPurgeSystem(): Promise<number> {
    return tauriInvoke<number>("memory_purge_system");
  },

  openExternal(url: string): Promise<void> {
    return tauriInvoke<void>("open_external", { url });
  },

  setAutostart(enabled: boolean): Promise<boolean> {
    return tauriInvoke<boolean>("set_autostart", { enabled });
  },

  hotkeyStatus(): Promise<HotkeyStatus> {
    return tauriInvoke<HotkeyStatus>("hotkey_status");
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

export async function watchAiProgress(
  callback: (progress: AiProgress) => void,
): Promise<() => void> {
  if (!TAURI) return () => undefined;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<AiProgress>("ai-progress", (event) => callback(event.payload));
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

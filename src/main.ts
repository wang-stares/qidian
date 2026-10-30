import {
  api,
  isTauri,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  showWindow,
  hideWindow,
  watchMaximize,
  watchMinimize,
  watchMemoryRestore,
  watchMemorySqueeze,
  watchAiProgress,
  watchAppFocus,
  watchAppLaunch,
  setMemorySaver,
  windowActive,
} from "./api";
import { escapeHtml, icon } from "./icons";
import rewardQr from "./assets/reward-qrcode.png";
import { RELEASES, type Release } from "./changelog";
import {
  buildSearchIndex,
  fuzzyMatchScore,
  matchScore,
  normalizeText,
  type SearchIndex,
} from "./search";
import {
  ACCENTS,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  THEME_OPTIONS,
  THEME_PRESETS,
  WALLPAPERS,
  WALLPAPER_FITS,
  categoryColor,
  categoryGlyph,
  cloneSettings,
} from "./defaults";
import type {
  AccentChoice,
  AiChatMessage,
  AiPermissions,
  AiProgress,
  AiStatus,
  AiToolCall,
  AppEntry,
  CleanupApp,
  CleanupCandidate,
  CleanupDeleteReport,
  CleanupScan,
  Category,
  ColorMode,
  CornerStyle,
  BlurLevel,
  CustomPalette,
  CustomTheme,
  Density,
  DiagReport,
  DiskUsageScan,
  DnsStatus,
  HotkeyStatus,
  LaunchResult,
  MemoryLevel,
  MemoryMode,
  MemoryStatus,
  MemoryTrimScope,
  ModuleId,
  ModuleStatus,
  NavKey,
  OptimizeItem,
  PerfCleanResult,
  PerfDiskInfo,
  PerfHog,
  PerfModuleStatus,
  PerfPowerInfo,
  PerfSystemInfo,
  PerfTempCategory,
  PerfTempScan,
  ProcessItem,
  ProcessTarget,
  Settings,
  SortMode,
  StartupItem,
  StartupSource,
  ThemeId,
  WallpaperAsset,
  WallpaperFit,
  WallpaperId,
  UninstallReport,
  ViewMode,
} from "./types";
import {
  buildProcessGroups,
  describeProcess,
  formatMemory,
  riskLabel,
  type ProcessGroup,
} from "./processInfo";

const SETTINGS_TABS = [
  { id: "appearance", label: "外观", glyph: "palette" },
  { id: "wallpaper", label: "壁纸", glyph: "monitor" },
  { id: "categories", label: "分类", glyph: "layers" },
  { id: "apps", label: "应用", glyph: "grid" },
  { id: "boot", label: "启动", glyph: "power" },
  { id: "plugins", label: "插件", glyph: "box" },
  { id: "about", label: "关于", glyph: "info" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

type WorkspaceTab = "launcher" | "ai" | ModuleId;

interface WorkspaceMeta {
  id: WorkspaceTab;
  label: string;
  glyph: string;
  moduleId?: ModuleId;
  title: string;
  description: string;
}

const WORKSPACE_TABS: WorkspaceMeta[] = [
  {
    id: "launcher",
    label: "应用",
    glyph: "grid",
    title: "全部应用",
    description: "扫描、分类与启动本机应用",
  },
  {
    id: "ai",
    label: "AI",
    glyph: "sparkle",
    moduleId: "ai",
    title: "AI 助手",
    description: "本地模型问答、应用操作与语音对话",
  },
  {
    id: "background",
    label: "后台",
    glyph: "shield",
    moduleId: "background",
    title: "后台管理",
    description: "管理开机自启动与运行中的进程，结束前先看清用途",
  },
  {
    id: "performance",
    label: "体检",
    glyph: "monitor",
    moduleId: "performance",
    title: "系统体检",
    description: "健康评分、CPU 与磁盘状态、资源排行与趋势，只看不改",
  },
  {
    id: "optimize",
    label: "优化",
    glyph: "zap",
    moduleId: "optimize",
    title: "系统优化",
    description: "一键优化、临时文件清理、电源计划、DNS 与深层内存清理",
  },
  {
    id: "memory",
    label: "内存",
    glyph: "cpu",
    moduleId: "memory",
    title: "内存管理",
    description: "按本机内存与压力调节启点自身的 WebView2 档位和工作集",
  },
  {
    id: "cleanup",
    label: "应用管理",
    glyph: "trash",
    moduleId: "cleanup",
    title: "应用管理",
    description: "找出已卸载应用留下的文件夹，确认后删除释放空间",
  },
];

type EmptyAction =
  | "scan"
  | "retry-boot"
  | "clear-search"
  | "all"
  | "settings"
  | "settings-scan"
  | "settings-categories";

interface MenuState {
  appId: string;
  x: number;
  y: number;
  mode: "main" | "move";
}

interface UiState {
  settings: Settings;
  apps: AppEntry[];
  scannedAt: number | null;
  loading: boolean;
  bootFailed: boolean;
  scanning: boolean;
  scanPhase: string;
  scanPercent: number;
  scanFound: number;
  scanError: string | null;
  query: string;
  activeNav: NavKey;
  sort: SortMode;
  view: ViewMode;
  cursorIndex: number;
  lastResults: AppEntry[];
  inspectorId: string | null;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  customThemeName: string;
  /** 当前自定义壁纸的 data URL（来自壁纸库或旧配置），仅运行时使用。 */
  wallpaperData: string;
  /** 壁纸库缩略图缓存：asset id → data URL。 */
  wallpaperThumbs: Record<string, string>;
  workspace: WorkspaceTab;
  aiEnabled: boolean;
  aiInstalled: boolean;
  aiStatus: AiStatus | null;
  aiMessages: AiChatMessage[];
  /** 最近一次 search_apps 返回的应用 id，用于强制「先搜索再启动」。 */
  aiSearchIds: string[];
  aiInput: string;
  aiBusy: boolean;
  /** 模型进程正在启动（首次加载或预热）。 */
  aiWarming: boolean;
  aiProgress: AiProgress | null;
  aiError: string | null;
  aiRecording: boolean;
  /** 录音已结束，正在本地转写文字。 */
  aiTranscribing: boolean;
  /** 模型正在为应用自动分类。 */
  aiClassifyBusy: boolean;
  aiClassifyTotal: number;
  aiClassifyDone: number;
  aiSpeak: boolean;
  aiProcessGroups: ProcessGroup[];
  aiPendingClose: {
    group: ProcessGroup;
    resolve: (allowed: boolean) => void;
  } | null;
  editingCategoryId: string | null;
  pendingCategoryDelete: string | null;
  newCategoryDraft: string;
  renameDraft: string;
  menu: MenuState | null;
  dragId: string | null;
  resetScroll: boolean;
  backgroundSection: "startup" | "processes";
  startupItems: StartupItem[];
  startupAdvancedOk: boolean;
  processes: ProcessItem[];
  startupLoading: boolean;
  processesLoading: boolean;
  startupError: string | null;
  /** 启动项排序：影响优先 / 名称 / 来源。 */
  startupSort: "impact" | "name" | "source";
  processesError: string | null;
  startupBusyId: string | null;
  expandedGroups: Set<string>;
  pendingGroupKill: string | null;
  pendingPidKill: number | null;
  killing: boolean;
  perfStatus: PerfModuleStatus | null;
  perfStatusLoading: boolean;
  perfStatusError: string | null;
  perfInstalling: boolean;
  perfUninstalling: boolean;
  perfPendingUninstall: boolean;
  perfSystem: PerfSystemInfo | null;
  perfSystemLoading: boolean;
  perfSystemError: string | null;
  perfTempScan: PerfTempScan | null;
  perfTempLoading: boolean;
  perfTempError: string | null;
  perfTempDays: number;
  perfTempSelected: Set<string>;
  perfTempBusy: boolean;
  perfPendingClean: "safe" | "selected" | null;
  perfLastClean: PerfCleanResult | null;
  /** 磁盘空间分析结果与忙碌态。 */
  diskUsage: DiskUsageScan | null;
  diskUsageLoading: boolean;
  diskUsageError: string | null;
  perfPowerBusy: string | null;
  /** 优化插件的当前电源计划，独立于体检数据。 */
  optPower: PerfPowerInfo | null;
  perfDnsBusy: boolean;
  /** 优化项类别筛选：all/privacy/performance/services/updates。 */
  perfOptCategory: OptimizeCategory;
  /** 最近一次一键优化的结果摘要（含各生效时机数量）。 */
  perfOptimizeSummary: OptimizeSummary | null;
  /** 网络优化：DNS 状态、切换忙碌态与诊断结果。 */
  optDns: DnsStatus | null;
  optDnsLoading: boolean;
  optDnsError: string | null;
  optDnsBusy: boolean;
  optDnsPreset: DnsPresetId;
  optDiag: DiagReport | null;
  optDiagBusy: boolean;
  perfOptimize: OptimizeItem[];
  perfOptimizeLoading: boolean;
  perfOptimizeError: string | null;
  perfOptimizeSelected: Set<string>;
  perfOptimizeBusy: boolean;
  perfOptimizePending: "apply" | "restoreAll" | null;
  perfOptimizeTouched: boolean;
  /** 当前进程是否为管理员权限；null 表示尚未检测。 */
  elevated: boolean | null;
  /** 系统优化插件的安装忙碌态。 */
  optimizeInstalling: boolean;
  memoryStatus: MemoryStatus | null;
  memoryLoading: boolean;
  memoryError: string | null;
  memoryBusy: boolean;
  memoryTrimBusy: boolean;
  memoryPurgeBusy: boolean;
  memoryTop: ProcessGroup[] | null;
  memoryTopLoading: boolean;
  memoryTopError: string | null;
  memorySqueezed: boolean;
  memorySamples: { at: number; used: number }[];
  cleanupScan: CleanupScan | null;
  cleanupLoading: boolean;
  cleanupError: string | null;
  cleanupFilter: "all" | "suspect" | "large";
  cleanupSelected: Set<string>;
  cleanupBusy: boolean;
  cleanupPendingDelete: boolean;
  cleanupLast: CleanupDeleteReport | null;
  cleanupApps: CleanupApp[] | null;
  cleanupAppsLoading: boolean;
  cleanupAppsError: string | null;
  /** 已安装应用列表的搜索词与排序。 */
  cleanupAppQuery: string;
  cleanupAppSort: "name" | "size";
  cleanupUninstallId: string | null;
  cleanupUninstallFull: boolean;
  cleanupUninstallBusy: boolean;
  cleanupLastUninstall: UninstallReport | null;
  modules: ModuleStatus[];
  modulesLoaded: boolean;
  modulesLoading: boolean;
  modulesError: string | null;
  moduleBusy: ModuleId | null;
  modulePendingUninstall: ModuleId | null;
  autoStart: boolean | null;
  autoStartBusy: boolean;
  hotkeyStatus: HotkeyStatus | null;
  hotkeyCapture: { kind: "toggle" } | { kind: "app"; appId: string } | null;
  hotkeyAppPick: string;
  trayAvailable: boolean | null;
  bootLoading: boolean;
  bootError: string | null;
  quitPending: boolean;
}

const state: UiState = {
  settings: cloneSettings(DEFAULT_SETTINGS),
  apps: [],
  scannedAt: null,
  loading: true,
  bootFailed: false,
  scanning: false,
  scanPhase: "prepare",
  scanPercent: 0,
  scanFound: 0,
  scanError: null,
  query: "",
  activeNav: "all",
  sort: "name",
  view: "grid",
  cursorIndex: 0,
  lastResults: [],
  inspectorId: null,
  settingsOpen: false,
  settingsTab: "appearance",
  customThemeName: "",
  wallpaperData: "",
  wallpaperThumbs: {},
  workspace: "launcher",
  aiEnabled: false,
  aiInstalled: false,
  aiStatus: null,
  aiMessages: [],
  aiSearchIds: [],
  aiInput: "",
  aiBusy: false,
  aiWarming: false,
  aiProgress: null,
  aiError: null,
  aiRecording: false,
  aiTranscribing: false,
  aiClassifyBusy: false,
  aiClassifyTotal: 0,
  aiClassifyDone: 0,
  aiSpeak: false,
  aiProcessGroups: [],
  aiPendingClose: null,
  editingCategoryId: null,
  pendingCategoryDelete: null,
  newCategoryDraft: "",
  renameDraft: "",
  menu: null,
  dragId: null,
  resetScroll: false,
  backgroundSection: "startup",
  startupItems: [],
  startupAdvancedOk: true,
  processes: [],
  startupLoading: false,
  processesLoading: false,
  startupError: null,
  startupSort: "impact",
  processesError: null,
  startupBusyId: null,
  expandedGroups: new Set<string>(),
  pendingGroupKill: null,
  pendingPidKill: null,
  killing: false,
  perfStatus: null,
  perfStatusLoading: false,
  perfStatusError: null,
  perfInstalling: false,
  perfUninstalling: false,
  perfPendingUninstall: false,
  perfSystem: null,
  perfSystemLoading: false,
  perfSystemError: null,
  perfTempScan: null,
  perfTempLoading: false,
  perfTempError: null,
  perfTempDays: 7,
  perfTempSelected: new Set<string>(),
  perfTempBusy: false,
  perfPendingClean: null,
  perfLastClean: null,
  diskUsage: null,
  diskUsageLoading: false,
  diskUsageError: null,
  perfPowerBusy: null,
  optPower: null,
  perfDnsBusy: false,
  perfOptCategory: "all",
  perfOptimizeSummary: null,
  optDns: null,
  optDnsLoading: false,
  optDnsError: null,
  optDnsBusy: false,
  optDnsPreset: "ali",
  optDiag: null,
  optDiagBusy: false,
  perfOptimize: [],
  perfOptimizeLoading: false,
  perfOptimizeError: null,
  perfOptimizeSelected: new Set<string>(),
  perfOptimizeBusy: false,
  perfOptimizePending: null,
  perfOptimizeTouched: false,
  elevated: null,
  optimizeInstalling: false,
  memoryStatus: null,
  memoryLoading: false,
  memoryError: null,
  memoryBusy: false,
  memoryTrimBusy: false,
  memoryPurgeBusy: false,
  memoryTop: null,
  memoryTopLoading: false,
  memoryTopError: null,
  memorySqueezed: false,
  memorySamples: [],
  cleanupScan: null,
  cleanupLoading: false,
  cleanupError: null,
  cleanupFilter: "all",
  cleanupSelected: new Set<string>(),
  cleanupBusy: false,
  cleanupPendingDelete: false,
  cleanupLast: null,
  cleanupApps: null,
  cleanupAppsLoading: false,
  cleanupAppsError: null,
  cleanupAppQuery: "",
  cleanupAppSort: "name",
  cleanupUninstallId: null,
  cleanupUninstallFull: false,
  cleanupUninstallBusy: false,
  cleanupLastUninstall: null,
  modules: [],
  modulesLoaded: false,
  modulesLoading: false,
  modulesError: null,
  moduleBusy: null,
  modulePendingUninstall: null,
  autoStart: null,
  autoStartBusy: false,
  hotkeyStatus: null,
  hotkeyCapture: null,
  hotkeyAppPick: "",
  trayAvailable: null,
  bootLoading: false,
  bootError: null,
  quitPending: false,
};

const PHASE_LABELS: Record<string, string> = {
  prepare: "准备扫描",
  shortcuts: "扫描开始菜单",
  registry: "读取卸载注册表",
  uwp: "枚举 Store 应用",
  classify: "自动归类",
  done: "扫描完成",
};

const SOURCE_LABELS: Record<AppEntry["source"], string> = {
  startMenu: "开始菜单",
  desktop: "桌面 / 任务栏",
  appPaths: "App Paths",
  registry: "注册表",
  uwp: "Microsoft Store",
  appsFolder: "开始菜单索引",
  installDir: "安装目录",
};

const APP_VERSION = __APP_VERSION__;
/** 自定义强调色校验；自定义壁纸在设置文件中的字符上限。 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const WALLPAPER_MAX_CHARS = 1_200_000;
/** 自定义主题通过内联变量覆盖的主题令牌；切换回内置风格时需要全部清除。
    必须声明在 `void boot()` 之前：首次 applyAppearance 会同步读取它。 */
const CUSTOM_THEME_VARS = [
  "--app-bg",
  "--app-tint",
  "--panel",
  "--panel-strong",
  "--surface",
  "--surface-solid",
  "--surface-2",
  "--surface-3",
  "--tile-surface",
  "--tile-hover",
  "--tile-active",
  "--stroke",
  "--stroke-2",
  "--divider",
  "--text",
  "--text-2",
  "--text-3",
  "--hover",
  "--hover-strong",
  "--dialog-bg",
  "--flyout-bg",
  "--toast-bg",
  "--toast-text",
  "--window-border",
  "--shadow-tile",
  "--shadow-panel",
  "--shadow-flyout",
  "--shadow-dialog",
  "--shadow-window",
  "--skeleton-a",
  "--skeleton-b",
  "--wc-hover",
  "--wallpaper-scrim",
  "--icon-size",
  "--panel-blur",
  "--tile-radius",
  "--icon-radius",
  "--search-radius",
  "--control-radius",
  "--panel-radius",
  "--dialog-radius",
  "--settings-card-radius",
  "--quickbar-radius",
  "--rail-radius",
  "--rail-item-radius",
  "--checkbox-radius",
];
const ICON_BATCH_SIZE = 40;
/// 允许两批图标同时在途：后端每批内部已并行，滚动时后一批不必等前一批返回。
const ICON_MAX_INFLIGHT = 2;
const REFRESH_OPTIONS: { value: number; label: string }[] = [
  { value: 6, label: "6 小时" },
  { value: 12, label: "12 小时" },
  { value: 24, label: "24 小时" },
  { value: 168, label: "7 天" },
  { value: 0, label: "关闭" },
];

const MEMORY_LOW_OPTIONS = [70, 75, 80, 85, 90];
const MEMORY_RECOVER_OPTIONS = [40, 50, 60, 70];
const MEMORY_INTERVAL_OPTIONS = [15, 30, 60, 120, 300];
const MEMORY_PRESETS = [
  { id: "light", label: "轻度", low: 90, recover: 70, trim: false },
  { id: "balanced", label: "均衡", low: 85, recover: 60, trim: true },
  { id: "aggressive", label: "激进", low: 75, recover: 50, trim: true },
] as const;

const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });
const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

const appRoot = document.getElementById("app") as HTMLElement;
const els = {
  app: appRoot,
  search: document.getElementById("search-input") as HTMLInputElement,
  searchWrap: document.querySelector(".search") as HTMLElement,
  searchClear: document.getElementById("btn-search-clear") as HTMLButtonElement,
  content: document.getElementById("content") as HTMLElement,
  contentBody: document.getElementById("content-body") as HTMLElement,
  skeleton: document.getElementById("skeleton") as HTMLElement,
  railPrimary: document.getElementById("rail-primary") as HTMLElement,
  railCategories: document.getElementById("rail-categories") as HTMLElement,
  surfaceTabs: document.getElementById("surface-tabs") as HTMLElement,
  headActions: document.querySelector(".head-actions") as HTMLElement,
  viewTitle: document.getElementById("view-title") as HTMLElement,
  viewSub: document.getElementById("view-sub") as HTMLElement,
  titlebarCrumb: document.getElementById("titlebar-crumb") as HTMLElement,
  quickbar: document.getElementById("quickbar") as HTMLElement,
  quickbarItems: document.getElementById("quickbar-items") as HTMLElement,
  scanFlag: document.getElementById("scan-flag") as HTMLElement,
  scanFlagText: document.getElementById("scan-flag-text") as HTMLElement,
  scanProgress: document.getElementById("scan-progress") as HTMLElement,
  scanProgressBar: document.getElementById("scan-progress-bar") as HTMLElement,
  scanProgressText: document.getElementById("scan-progress-text") as HTMLElement,
  scanBtn: document.getElementById("btn-scan") as HTMLButtonElement,
  btnSort: document.getElementById("btn-sort") as HTMLButtonElement,
  btnView: document.getElementById("btn-view") as HTMLButtonElement,
  statusCount: document.getElementById("status-count") as HTMLElement,
  statusRight: document.querySelector(".status-right") as HTMLElement,
  inspector: document.getElementById("inspector") as HTMLElement,
  modalLayer: document.getElementById("modal-layer") as HTMLElement,
  menuLayer: document.getElementById("menu-layer") as HTMLElement,
  toastStack: document.getElementById("toast-stack") as HTMLElement,
  themeQuickLabel: document.getElementById("theme-quick-label") as HTMLElement,
  btnMax: document.getElementById("btn-max") as HTMLButtonElement,
};

const iconCache = new Map<string, string>();
const iconRequested = new Set<string>();
const iconQueue: string[] = [];
/** 图标 data URL 的常驻内存上限；超出时淘汰最久未用的（磁盘缓存还在，滚回时秒加载）。 */
const MAX_ICON_CACHE = 600;

/** 应用网格的分帧渲染队列：应用很多时首帧只渲染前几组，其余按帧追加，避免一次性生成几千个节点卡住首帧。 */
let pendingSections: string[] = [];
let sectionFlushTimer = 0;

function cacheIcon(id: string, url: string): void {
  iconCache.set(id, url);
  if (iconCache.size <= MAX_ICON_CACHE) return;
  // Map 迭代顺序即插入顺序：删掉最旧的一批，同时放行对应的请求标记，重新滚动时可重载。
  const overflow = iconCache.size - MAX_ICON_CACHE;
  let removed = 0;
  for (const key of iconCache.keys()) {
    if (removed >= overflow) break;
    iconCache.delete(key);
    iconRequested.delete(key);
    removed += 1;
  }
}
const searchIndexCache = new WeakMap<AppEntry, { key: string; index: SearchIndex }>();
let visibleCache: { apps: AppEntry[]; hidden: string[]; list: AppEntry[] } | null = null;
let appMapCache: { apps: AppEntry[]; map: Map<string, AppEntry> } | null = null;
let resultsQuery = "";
let iconObserver: IntersectionObserver | null = null;
let iconFlushTimer = 0;
let iconInFlight = 0;
let warmIconsTimer = 0;
/** 启动到托盘时挂起的启动后工作：首次回到前台再补做，避免后台白跑扫描与图标提取。 */
let deferredStartup = false;
let deferredWallpaper = false;
let warmPending = false;
let renderRaf = 0;
let renderScopeAll = true;
let previousFocus: HTMLElement | null = null;
let settingsAnimated = false;

/**
 * 排序模式常量必须在 boot() 之前定义：boot 会同步渲染一次界面，
 * 而渲染会读取这两个常量，定义在下方会触发 TDZ（Cannot access before initialization）。
 */
const SORT_MODES: SortMode[] = ["name", "recent", "frequent"];
const SORT_LABELS: Record<SortMode, string> = {
  name: "名称",
  recent: "最近使用",
  frequent: "常用优先",
};

document.documentElement.dataset.runtime = isTauri ? "tauri" : "web";

if (!isTauri) {
  const badge = document.createElement("span");
  badge.className = "demo-badge";
  badge.textContent = "演示数据";
  badge.title = "浏览器预览使用演示应用；Windows 版会读取真实应用名称与图标";
  document.querySelector(".titlebar-actions")?.prepend(badge);
}

const uiPrefs = loadUiPrefs();
state.sort = uiPrefs.sort;
state.view = uiPrefs.view;

/* ── boot ─────────────────────────────────────────────────────── */

function squeezeIconMemory(): void {
  if (!moduleReady("memory") || !state.settings.memoryDropIcons || state.memorySqueezed) return;
  iconCache.clear();
  iconQueue.length = 0;
  iconRequested.clear();
  state.memorySqueezed = true;
  renderAll();
}

function restoreIconMemory(): void {
  if (!state.memorySqueezed) return;
  state.memorySqueezed = false;
  renderAll();
}

void boot();

async function boot(): Promise<void> {
  state.loading = true;
  state.bootFailed = false;
  applyAppearance();
  renderAll();
  let launchHidden = false;
  try {
    launchHidden = await api.startedHidden().catch(() => false);
    const data = await api.bootstrap();
    state.settings = data.settings;
    state.apps = data.apps;
    state.scannedAt = data.scannedAt;
    state.aiEnabled = data.aiEnabled;
    state.aiInstalled = data.aiInstalled;
    state.loading = false;
    applyAppearance();
    renderAll();
    // 启动到托盘（--autostart）时不加载壁纸、不预热图标、不校验应用路径；
    // 这些工作都推迟到窗口第一次真正显示时，避免在后台白跑一遍扫描。
    if (launchHidden) {
      deferredStartup = true;
      deferredWallpaper = true;
    } else {
      void syncWallpaperData();
    }
    void loadModules();
    if (state.aiEnabled || state.aiInstalled) void refreshAiStatus();
    void watchAiProgress((progress) => {
      state.aiProgress = progress;
      if (progress.phase === "done") state.aiProgress = null;
      if (state.workspace === "ai") refreshActive();
    });
    if (!launchHidden) {
      window.setTimeout(() => void pruneMissingApps(true), 1500);
      scheduleWarmIcons(6000);
    }
    const refreshHours = state.settings.autoRefreshHours;
    const stale =
      state.scannedAt === null ||
      (refreshHours > 0 && Date.now() - state.scannedAt > refreshHours * 3_600_000);
    if (state.apps.length === 0 || stale) {
      if (launchHidden) {
        deferredStartup = true;
      } else {
        void runScan(false, true);
      }
    }
    if (!launchHidden) await showWindow();
    void api
      .trayStatus()
      .then((available) => syncCloseHint(available))
      .catch(() => undefined);
    if (isTauri) {
      watchMinimize((minimized) => {
        void setMemorySaver(minimized).catch(() => undefined);
        if (minimized) {
          squeezeIconMemory();
        } else {
          restoreIconMemory();
        }
      });
      watchAppFocus(() => {
        if (deferredStartup) void flushDeferredStartup();
        if (warmPending) {
          warmPending = false;
          scheduleWarmIcons(1200);
        }
        void pruneMissingApps();
        if (state.workspace === "memory" && !state.settingsOpen) void loadMemoryStatus();
      });
      void watchAppLaunch((id) => {
        if (!state.apps.some((item) => item.id === id)) return;
        const recent = [
          { id, at: Date.now() },
          ...state.settings.recent.filter((entry) => entry.id !== id),
        ].slice(0, 20);
        patchSettings({ recent });
      });
      void watchMemorySqueeze(squeezeIconMemory);
      void watchMemoryRestore(restoreIconMemory);
      window.setTimeout(() => {
        els.search.focus({ preventScroll: true });
      }, 120);
    }
  } catch (error) {
    state.loading = false;
    state.bootFailed = true;
    state.scanError = String(error);
    renderAll();
    if (!launchHidden) await showWindow();
  }
}

/* ── appearance ───────────────────────────────────────────────── */

function resolvedMode(): "light" | "dark" {
  if (state.settings.colorMode === "system") {
    return darkMedia.matches ? "dark" : "light";
  }
  return state.settings.colorMode;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX_COLOR.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbaFromHex(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.min(1, Math.max(0, alpha))})`;
}

/** ratio 表示第一个颜色所占比例（0-1）。 */
function mixHex(a: string, b: string, ratio: number): string {
  const first = hexToRgb(a) ?? [0, 0, 0];
  const second = hexToRgb(b) ?? [255, 255, 255];
  const weight = Math.min(1, Math.max(0, ratio));
  const channels = first.map((value, index) =>
    Math.round(value * weight + second[index] * (1 - weight)),
  );
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

/** 按相对亮度挑选强调色上的前景色，保证自定义色也满足对比度。 */
function accentForeground(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const channel = (value: number) => {
    const raw = value / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  return luminance > 0.42 ? "#0b0b0c" : "#ffffff";
}

function applyCustomPalette(palette: CustomPalette): void {
  const dark = resolvedMode() === "dark";
  const bg = dark ? palette.bgDark : palette.bgLight;
  const panel = dark ? palette.panelDark : palette.panelLight;
  const text = dark ? palette.textDark : palette.textLight;
  const opacity = clampNumber(palette.panelOpacity, 30, 100) / 100;
  const radius = clampNumber(palette.radius, 0, 30);
  const iconSize = clampNumber(palette.iconSize, 28, 64);
  const blur = clampNumber(palette.blur, 0, 48);
  const set = (key: string, value: string) => els.app.style.setProperty(key, value);
  const radiusPx = (value: number) => `${Math.round(value)}px`;

  set("--app-bg", rgbaFromHex(bg, 0.94));
  set("--app-tint", rgbaFromHex("#ffffff", dark ? 0.02 : 0.3));
  set("--panel", rgbaFromHex(panel, opacity));
  set("--panel-strong", rgbaFromHex(panel, Math.min(1, opacity + 0.14)));
  set("--surface", rgbaFromHex(panel, Math.min(1, Math.max(0.2, opacity * 0.9))));
  set("--surface-solid", panel);
  set("--surface-2", rgbaFromHex(text, dark ? 0.055 : 0.04));
  set("--surface-3", rgbaFromHex(text, dark ? 0.1 : 0.07));
  set("--tile-surface", "transparent");
  set("--tile-hover", rgbaFromHex(panel, Math.min(1, opacity + 0.08)));
  set("--tile-active", rgbaFromHex(panel, Math.min(1, opacity + 0.16)));
  set("--stroke", rgbaFromHex(text, 0.09));
  set("--stroke-2", rgbaFromHex(text, 0.17));
  set("--divider", rgbaFromHex(text, 0.075));
  set("--text", text);
  set("--text-2", mixHex(text, bg, 0.72));
  set("--text-3", mixHex(text, bg, 0.46));
  set("--hover", rgbaFromHex(text, dark ? 0.06 : 0.045));
  set("--hover-strong", rgbaFromHex(text, dark ? 0.1 : 0.08));
  set("--dialog-bg", mixHex(panel, bg, 0.82));
  set("--flyout-bg", rgbaFromHex(panel, 0.95));
  set("--toast-bg", dark ? "rgba(244, 244, 246, 0.96)" : "rgba(22, 22, 24, 0.95)");
  set("--toast-text", dark ? "#161618" : "#f7f7f9");
  set("--window-border", rgbaFromHex("#ffffff", dark ? 0.08 : 0.55));
  set("--shadow-tile", "none");
  set(
    "--shadow-panel",
    dark
      ? "0 2px 6px rgba(0, 0, 0, 0.22), 0 18px 40px rgba(0, 0, 0, 0.24)"
      : "0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 30px rgba(0, 0, 0, 0.06)",
  );
  set("--shadow-flyout", "0 18px 46px rgba(0, 0, 0, 0.22)");
  set("--shadow-dialog", "0 34px 84px rgba(0, 0, 0, 0.3)");
  set("--shadow-window", "0 32px 90px rgba(0, 0, 0, 0.36)");
  set("--skeleton-a", rgbaFromHex(text, 0.04));
  set("--skeleton-b", rgbaFromHex(text, 0.08));
  set("--wc-hover", rgbaFromHex(text, 0.06));
  set("--wallpaper-scrim", rgbaFromHex(bg, 0.55));
  set("--icon-size", `${iconSize}px`);
  set("--panel-blur", `${blur}px`);
  set("--tile-radius", radiusPx(radius));
  set("--icon-radius", radiusPx(radius * 0.8));
  set("--search-radius", radiusPx(Math.min(999, radius * 2.4)));
  set("--control-radius", radiusPx(Math.max(2, radius * 0.9)));
  set("--panel-radius", radiusPx(radius * 1.5));
  set("--dialog-radius", radiusPx(radius * 1.6));
  set("--settings-card-radius", radiusPx(radius * 1.1));
  set("--quickbar-radius", radiusPx(Math.min(999, radius * 2)));
  set("--rail-radius", radiusPx(radius * 1.4));
  set("--rail-item-radius", radiusPx(radius * 0.9));
  set("--checkbox-radius", radiusPx(Math.max(2, radius * 0.45)));
}

function applyWallpaper(settings: Settings): void {
  const image = state.wallpaperData || settings.wallpaperImage;
  const layer = els.app.style;
  if (settings.wallpaper === "custom" && image) {
    layer.setProperty("--wallpaper-image", `url("${image}")`);
    const size =
      settings.wallpaperFit === "contain"
        ? "contain"
        : settings.wallpaperFit === "tile"
          ? "auto"
          : settings.wallpaperFit === "stretch"
            ? "100% 100%"
            : "cover";
    layer.setProperty("--wallpaper-size", size);
    layer.setProperty(
      "--wallpaper-repeat",
      settings.wallpaperFit === "tile" ? "repeat" : "no-repeat",
    );
    layer.setProperty("--wallpaper-x", `${clampNumber(settings.wallpaperX, 0, 100)}%`);
    layer.setProperty("--wallpaper-y", `${clampNumber(settings.wallpaperY, 0, 100)}%`);
    layer.setProperty(
      "--wallpaper-zoom",
      String(clampNumber(settings.wallpaperZoom, 100, 200) / 100),
    );
    return;
  }
  layer.removeProperty("--wallpaper-image");
  layer.removeProperty("--wallpaper-size");
  layer.removeProperty("--wallpaper-repeat");
  layer.removeProperty("--wallpaper-x");
  layer.removeProperty("--wallpaper-y");
  layer.removeProperty("--wallpaper-zoom");
}

function applyAppearance(): void {
  const settings = state.settings;
  els.app.dataset.theme = settings.theme;
  els.app.dataset.preset = THEME_PRESETS.some((preset) => preset.id === settings.themePreset)
    ? settings.themePreset
    : "default";
  els.app.dataset.mode = resolvedMode();
  els.app.dataset.accent = settings.accent;
  els.app.dataset.density = settings.density;
  els.app.dataset.corners = settings.corners;
  els.app.dataset.blur = settings.blur;
  els.app.dataset.wallpaper = settings.wallpaper;
  els.app.dataset.lowpower = String(settings.lowPower);
  document.documentElement.style.colorScheme = resolvedMode();

  const customAccent = HEX_COLOR.test(settings.customAccent) ? settings.customAccent : "#1b62d6";
  if (settings.accent === "custom") {
    els.app.style.setProperty("--accent-custom", customAccent);
    els.app.style.setProperty("--accent-fg-custom", accentForeground(customAccent));
  } else {
    els.app.style.removeProperty("--accent-custom");
    els.app.style.removeProperty("--accent-fg-custom");
  }

  if (settings.theme === "custom") {
    applyCustomPalette(settings.customPalette);
  } else {
    for (const key of CUSTOM_THEME_VARS) els.app.style.removeProperty(key);
  }

  els.app.style.setProperty(
    "--wallpaper-opacity",
    String(clampNumber(settings.wallpaperOpacity, 20, 100) / 100),
  );
  els.app.style.setProperty("--wallpaper-blur", `${clampNumber(settings.wallpaperBlur, 0, 40)}px`);
  els.app.style.setProperty(
    "--wallpaper-dim",
    String(clampNumber(settings.wallpaperDim, 0, 70) / 100),
  );
  applyWallpaper(settings);

  const current = THEME_OPTIONS.find((theme) => theme.id === settings.theme) ?? THEME_OPTIONS[0];
  els.themeQuickLabel.textContent = current.short;
  const themeBtn = document.getElementById("btn-theme-quick");
  if (themeBtn) {
    themeBtn.title = `当前：${current.name}（${current.note}），点击切换`;
  }
}

/** 把设置里的壁纸来源（壁纸库 id 或旧版内联图片）同步到运行时缓存。 */
async function syncWallpaperData(): Promise<void> {
  const settings = state.settings;
  if (settings.wallpaperAsset) {
    const cached = state.wallpaperThumbs[settings.wallpaperAsset];
    if (cached) {
      state.wallpaperData = cached;
      applyAppearance();
      return;
    }
    try {
      const data = await api.readWallpaper(settings.wallpaperAsset);
      if (data) {
        state.wallpaperThumbs = { ...state.wallpaperThumbs, [settings.wallpaperAsset]: data };
        state.wallpaperData = data;
      } else {
        state.wallpaperData = "";
      }
    } catch {
      state.wallpaperData = "";
    }
    applyAppearance();
    return;
  }
  state.wallpaperData = settings.wallpaperImage ?? "";
  applyAppearance();
}

/** 打开主题页时补齐壁纸库缩略图，只请求尚未缓存的资源。 */
async function ensureWallpaperThumbs(): Promise<void> {
  const assets = state.settings.wallpaperLibrary ?? [];
  const missing = assets.filter((asset) => !state.wallpaperThumbs[asset.id]);
  if (missing.length === 0) return;
  const loaded = await Promise.all(
    missing.map(async (asset) => {
      try {
        return [asset.id, await api.readWallpaper(asset.id)] as const;
      } catch {
        return [asset.id, ""] as const;
      }
    }),
  );
  let changed = false;
  for (const [id, data] of loaded) {
    if (data && !state.wallpaperThumbs[id]) {
      state.wallpaperThumbs = { ...state.wallpaperThumbs, [id]: data };
      changed = true;
    }
  }
  if (changed) refreshActive();
}

darkMedia.addEventListener("change", () => {
  if (state.settings.colorMode === "system") {
    applyAppearance();
    if (state.settingsOpen) renderSettings();
  }
});

let saveChain: Promise<void> = Promise.resolve();

function queueSave(): void {
  if (state.loading) return;
  const snapshot = cloneSettings(state.settings);
  saveChain = saveChain
    .then(() => api.saveSettings(snapshot))
    .catch((error) => {
      showToast(`设置保存失败：${String(error)}`, "error");
    });
}

function patchSettings(patch: Partial<Settings>): void {
  state.settings = { ...state.settings, ...patch };
  applyAppearance();
  queueSave();
  scheduleRender();
}

/* ── render orchestration ─────────────────────────────────────── */

function scheduleRender(scope: "all" | "query" = "all"): void {
  if (scope === "all") renderScopeAll = true;
  if (renderRaf) return;
  renderRaf = window.requestAnimationFrame(() => {
    renderRaf = 0;
    const full = renderScopeAll;
    renderScopeAll = true;
    if (full) renderAll();
    else renderQueryChange();
  });
}

/// 输入搜索词只影响顶栏、常用栏显隐和结果区，
/// 不重建左侧分类和状态栏，长列表输入时明显更轻。
function renderQueryChange(): void {
  if (state.workspace !== "launcher") {
    renderAll();
    return;
  }
  renderHeader();
  renderQuickbar();
  renderContent();
  observeIconHosts();
}

function renderAll(): void {
  resultsQuery = "";
  renderSurfaceTabs();
  renderRail();
  renderHeader();
  renderQuickbar();
  renderSurface();
  renderScanStatus();
  renderInspector();
  renderSettings();
  renderWindowControlsState();
  observeIconHosts();
}

function installedWorkspaceTabs(): WorkspaceMeta[] {
  return WORKSPACE_TABS.filter((tab) => {
    if (tab.id === "ai") {
      // 插件列表还没读回来时先用旧偏好兜底，避免启动瞬间 AI 标签闪烁。
      if (!state.modulesLoaded) return state.aiEnabled || state.aiInstalled;
      return moduleReady("ai");
    }
    return !tab.moduleId || moduleReady(tab.moduleId);
  });
}

function renderSurfaceTabs(): void {
  const tabs = installedWorkspaceTabs();
  if (state.workspace !== "launcher" && !tabs.some((tab) => tab.id === state.workspace)) {
    state.workspace = "launcher";
  }
  if (tabs.length <= 1) {
    els.surfaceTabs.hidden = true;
    els.surfaceTabs.innerHTML = "";
    return;
  }
  els.surfaceTabs.hidden = false;
  els.surfaceTabs.innerHTML = tabs
    .map(
      (tab) => `<button class="surface-tab${state.workspace === tab.id ? " is-active" : ""}" role="tab" aria-selected="${
        state.workspace === tab.id
      }" data-surface="${tab.id}" title="${escapeHtml(tab.title)}">${icon(tab.glyph)}<span>${escapeHtml(
        tab.label,
      )}</span></button>`,
    )
    .join("");
}

function workspaceMeta(id: WorkspaceTab): WorkspaceMeta {
  return WORKSPACE_TABS.find((tab) => tab.id === id) ?? WORKSPACE_TABS[0];
}

function surfacePanel(id: WorkspaceTab): string {
  switch (id) {
    case "background":
      return backgroundPanel();
    case "performance":
      return performancePanel();
    case "optimize":
      return optimizePanel();
    case "memory":
      return memoryPanel();
    case "cleanup":
      return cleanupPanel();
    case "ai":
      return aiPanel();
    default:
      return "";
  }
}

function renderSurface(): void {
  els.content.classList.toggle("is-ai", state.workspace === "ai");
  if (state.workspace === "launcher") {
    renderContent();
    return;
  }
  els.skeleton.hidden = true;
  els.contentBody.hidden = false;

  const previousScroll = els.content.scrollTop;
  const shouldReset = state.resetScroll;
  state.resetScroll = false;
  const activeElement = document.activeElement;
  const activeKey =
    activeElement instanceof HTMLElement && els.contentBody.contains(activeElement)
      ? activeElement.dataset.focusKey
      : undefined;
  els.contentBody.innerHTML = `<div class="surface-panel">${surfacePanel(state.workspace)}</div>`;
  els.content.scrollTop = shouldReset ? 0 : previousScroll;
  if (activeKey) {
    els.contentBody.querySelector<HTMLElement>(`[data-focus-key="${activeKey}"]`)?.focus({
      preventScroll: true,
    });
  }
}

function refreshActive(): void {
  if (state.settingsOpen) {
    renderSurfaceTabs();
    // 在设置里卸载当前插件时，workspace 会被纠正回启动台，
    // 这里同步重渲染内容区，避免关闭设置后还残留已卸载页面的 DOM。
    renderSurface();
    renderSettings();
    return;
  }
  renderSurfaceTabs();
  renderHeader();
  renderSurface();
}

function setWorkspace(id: WorkspaceTab): void {
  if (id !== "launcher" && state.modulesLoaded && !moduleReady(id as ModuleId)) {
    showToast(`${moduleStatus(id as ModuleId)?.name ?? "该功能"}插件未安装，请在设置 › 插件中安装`, "info");
    id = "launcher";
  }
  if (state.workspace === id) {
    if (id === "launcher") clearSearch(false);
    return;
  }
  const leavingAi = state.workspace === "ai" && id !== "ai";
  state.workspace = id;
  state.resetScroll = true;
  state.inspectorId = null;
  closeMenu();
  if (leavingAi) stopAiServer();
  renderAll();
  if (id === "background") loadBackground();
  if (id === "performance") void loadPerformanceStatus();
  if (id === "optimize") {
    void loadPerformanceOptimize();
    void loadOptimizePower();
    void loadOptimizeNetwork();
  }
  if (id === "memory") void loadMemoryStatus();
  if (id === "cleanup") {
    if (!state.cleanupScan) void loadCleanupScan();
    if (!state.cleanupApps) void loadCleanupApps();
  }
  if (id === "boot") loadBootState();
  if (id === "ai") void refreshAiStatus();
}

function visibleApps(): AppEntry[] {
  const hiddenRef = state.settings.hidden;
  if (visibleCache && visibleCache.apps === state.apps && visibleCache.hidden === hiddenRef) {
    return visibleCache.list;
  }
  const hidden = new Set(hiddenRef);
  const list = state.apps.filter((app) => !hidden.has(app.id));
  visibleCache = { apps: state.apps, hidden: hiddenRef, list };
  return list;
}

function appMap(): Map<string, AppEntry> {
  if (appMapCache && appMapCache.apps === state.apps) return appMapCache.map;
  const map = new Map(state.apps.map((app) => [app.id, app]));
  appMapCache = { apps: state.apps, map };
  return map;
}

function categoryById(id: string): Category | undefined {
  return state.settings.categories.find((category) => category.id === id);
}

function effectiveCategory(app: AppEntry): string {
  const override = state.settings.overrides[app.id];
  if (override && categoryById(override)) return override;
  if (categoryById(app.category)) return app.category;
  return state.settings.categories.find((category) => category.id === "other")?.id ?? state.settings.categories[0]?.id ?? "other";
}

function categoryCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  state.settings.categories.forEach((category) => counts.set(category.id, 0));
  visibleApps().forEach((app) => {
    const id = effectiveCategory(app);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  return counts;
}

function recentApps(): AppEntry[] {
  const map = appMap();
  const hidden = new Set(state.settings.hidden);
  const seen = new Set<string>();
  const result: AppEntry[] = [];
  for (const entry of [...state.settings.recent].sort((a, b) => b.at - a.at)) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const app = map.get(entry.id);
    if (app && !hidden.has(app.id)) result.push(app);
    if (result.length >= 20) break;
  }
  return result;
}

function pinnedApps(): AppEntry[] {
  const map = appMap();
  const hidden = new Set(state.settings.hidden);
  const result: AppEntry[] = [];
  for (const id of state.settings.pinned) {
    const app = map.get(id);
    if (app && !hidden.has(app.id)) result.push(app);
  }
  return result.slice(0, 9);
}

function recentRank(): Map<string, number> {
  const rank = new Map<string, number>();
  [...state.settings.recent]
    .sort((a, b) => b.at - a.at)
    .forEach((entry, index) => {
      if (!rank.has(entry.id)) rank.set(entry.id, index);
    });
  return rank;
}

function usageRank(): Map<string, number> {
  const usage = state.settings.usage ?? {};
  return new Map(Object.entries(usage).map(([id, count]) => [id, count]));
}

function sortApps(apps: AppEntry[]): AppEntry[] {
  if (state.sort === "recent") {
    const rank = recentRank();
    return [...apps].sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return collator.compare(a.name, b.name);
    });
  }
  if (state.sort === "frequent") {
    const usage = usageRank();
    return [...apps].sort((a, b) => {
      const ua = usage.get(a.id) ?? 0;
      const ub = usage.get(b.id) ?? 0;
      if (ua !== ub) return ub - ua;
      return collator.compare(a.name, b.name);
    });
  }
  return [...apps].sort((a, b) => collator.compare(a.name, b.name));
}

function cycleSort(): void {
  const index = SORT_MODES.indexOf(state.sort);
  state.sort = SORT_MODES[(index + 1) % SORT_MODES.length];
  state.cursorIndex = 0;
  renderAll();
  showToast(`已按${SORT_LABELS[state.sort]}排序`, "info");
}

function currentNavTitle(): string {
  if (state.query.trim()) return "搜索结果";
  if (state.activeNav === "all") return "全部应用";
  if (state.activeNav === "recent") return "最近使用";
  if (state.activeNav === "pinned") return "常用应用";
  return categoryById(state.activeNav)?.name ?? "全部应用";
}

function relativeTime(timestamp: number | null): string {
  if (!timestamp) return "尚未扫描";
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(timestamp);
}

/* ── rail ─────────────────────────────────────────────────────── */

function renderRail(): void {
  if (
    state.activeNav !== "all" &&
    state.activeNav !== "recent" &&
    state.activeNav !== "pinned" &&
    !categoryById(state.activeNav)
  ) {
    state.activeNav = "all";
  }

  const counts = categoryCounts();
  const total = visibleApps().length;
  const primaryCounts: Record<string, number> = {
    all: total,
    recent: recentApps().length,
    pinned: pinnedApps().length,
  };

  els.railPrimary.querySelectorAll<HTMLElement>("[data-nav]").forEach((item) => {
    const nav = item.dataset.nav ?? "";
    item.classList.toggle("is-active", state.activeNav === nav);
    if (state.activeNav === nav) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
    const count = item.querySelector<HTMLElement>(".rail-count");
    if (count) count.textContent = String(primaryCounts[nav] ?? 0);
  });

  els.railCategories.innerHTML = state.settings.categories
    .map((category) => {
      const count = counts.get(category.id) ?? 0;
      const color = categoryColor(category.id, state.settings.categories);
      const active = state.activeNav === category.id;
      const compactIcon =
        category.builtin === false
          ? `<span class="rail-cat-letter" style="--cat-color:${color}">${escapeHtml(
              category.name.slice(0, 1),
            )}</span>`
          : icon(categoryGlyph(category.id), "rail-cat-glyph");
      return `<button class="rail-item${active ? " is-active" : ""}" data-nav="${escapeHtml(
        category.id,
      )}" data-cat-drop="${escapeHtml(category.id)}" title="拖入应用可归类到「${escapeHtml(
        category.name,
      )}」"${active ? ' aria-current="page"' : ""}>
        <span class="rail-cat-icon"><span class="rail-dot" style="--cat-color:${color}"></span>${compactIcon}</span>
        <span class="rail-text">${escapeHtml(category.name)}</span>
        <span class="rail-count">${count}</span>
      </button>`;
    })
    .join("");

  const settingsBtn = document.getElementById("btn-settings");
  settingsBtn?.classList.toggle("is-active", state.settingsOpen);
}

/* ── header / quickbar ────────────────────────────────────────── */

function renderHeader(): void {
  if (state.workspace !== "launcher") {
    const meta = workspaceMeta(state.workspace);
    els.headActions.hidden = true;
    els.viewTitle.textContent = meta.title;
    els.titlebarCrumb.textContent = meta.title;
    document.title = `${meta.title} · 启点`;
    els.viewSub.innerHTML = `<span>${escapeHtml(meta.description)}</span><span class="sep"></span><span><kbd>Esc</kbd> 返回应用</span>`;
    els.statusCount.textContent = meta.title;
    els.statusRight.innerHTML = "<span><kbd>Esc</kbd> 返回应用</span>";
    return;
  }
  els.headActions.hidden = false;
  const title = currentNavTitle();
  els.viewTitle.textContent = title;
  els.titlebarCrumb.textContent = title;
  document.title = `${title} · 启点`;

  const visible = visibleApps();
  const total = visible.length;
  const parts: string[] = [];
  if (state.query.trim()) {
    parts.push(`${state.lastResults.length} 个匹配`);
    parts.push("↑ ↓ 选择 · Enter 启动");
  } else if (state.activeNav === "recent") {
    parts.push(`${recentApps().length} 个应用`);
    parts.push("按最近启动排序");
  } else if (state.activeNav === "pinned") {
    parts.push(`${pinnedApps().length} 个应用`);
    parts.push("Alt + 1–9 快速启动");
  } else if (state.activeNav !== "all") {
    const category = categoryById(state.activeNav);
    const categoryCount = visible.filter((app) => effectiveCategory(app) === state.activeNav).length;
    parts.push(`${categoryCount} 个应用`);
    if (category) parts.push(`自动归类为「${category.name}」`);
  } else {
    parts.push(`${total} 个应用`);
    const categoriesUsed = new Set(visible.map((app) => effectiveCategory(app))).size;
    if (total > 0) parts.push(`自动归入 ${categoriesUsed} 类`);
    if (state.scanning) parts.push("正在扫描本机");
    else parts.push(`上次扫描 ${relativeTime(state.scannedAt)}`);
  }
  els.viewSub.innerHTML = parts
    .map((part, index) => `${index > 0 ? '<span class="sep"></span>' : ""}${escapeHtml(part)}`)
    .join("");

  els.statusCount.textContent = `${total} 个应用`;

  const sortUse = els.btnSort.querySelector("use");
  sortUse?.setAttribute("href", "#i-sort");
  els.btnSort.classList.toggle("is-on", state.sort !== "name");
  els.btnSort.title = `当前按${SORT_LABELS[state.sort]}排序，点击切换为${
    SORT_LABELS[SORT_MODES[(SORT_MODES.indexOf(state.sort) + 1) % SORT_MODES.length]]
  }`;

  const viewUse = els.btnView.querySelector("use");
  viewUse?.setAttribute("href", state.view === "grid" ? "#i-list" : "#i-grid");
  els.btnView.title = state.view === "grid" ? "切换为列表视图" : "切换为图标视图";

  els.searchWrap.classList.toggle("has-query", state.query.length > 0);
  els.searchClear.hidden = state.query.length === 0;
  els.statusRight.innerHTML = state.query.trim()
    ? "<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 启动</span>"
    : "<span><kbd>Ctrl</kbd><kbd>K</kbd> 搜索</span><span><kbd>右键</kbd> 更多</span><span><kbd>Alt</kbd><kbd>1–9</kbd> 常用</span>";
}

function renderQuickbar(): void {
  const pinned = pinnedApps();
  if (state.workspace !== "launcher" || pinned.length === 0 || state.query.trim()) {
    els.quickbar.hidden = true;
    els.quickbarItems.innerHTML = "";
    return;
  }
  els.quickbar.hidden = false;
  els.quickbarItems.innerHTML = pinned
    .map((app, index) => {
      const iconMarkup = renderIconMarkup(app);
      const hostAttr = iconHostAttr(app);
      return `<button class="quick-item" data-quick-id="${escapeHtml(app.id)}" title="${escapeHtml(
        app.name,
      )} · Alt + ${index + 1}">
        <span class="quick-icon"${hostAttr}>${iconMarkup}</span>
        <span class="quick-name">${escapeHtml(app.name)}</span>
        <kbd class="quick-key">${index + 1}</kbd>
      </button>`;
    })
    .join("");
}

/* ── icons ────────────────────────────────────────────────────── */

function iconHostAttr(app: AppEntry): string {
  if (app.visual || iconCache.has(app.id)) return "";
  return ` data-icon-host="${escapeHtml(app.id)}"`;
}

function renderIconMarkup(app: AppEntry): string {
  const cached = iconCache.get(app.id);
  if (cached) return `<img src="${cached}" alt="" draggable="false" decoding="async" />`;
  if (app.visual) {
    return `<div class="mock-icon" style="--tone:${app.visual.tone}">${icon(app.visual.glyph)}</div>`;
  }
  return `<div class="mock-icon placeholder-icon">${icon("monitor")}</div>`;
}

function observeIconHosts(): void {
  iconObserver?.disconnect();
  const hosts = document.querySelectorAll<HTMLElement>("[data-icon-host]");
  if (hosts.length === 0) return;
  iconObserver = new IntersectionObserver(
    (entries) => {
      const ids = new Set<string>();
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).dataset.iconHost;
        if (id) ids.add(id);
      }
      if (ids.size > 0) enqueueIcons([...ids]);
    },
    { root: null, rootMargin: "800px 0px" },
  );
  hosts.forEach((host) => iconObserver?.observe(host));
}

/** 分帧追加剩余的分类区块，避免首帧一次性生成几千个 DOM 节点。 */
function flushPendingSections(): void {
  if (sectionFlushTimer !== 0) return;
  sectionFlushTimer = window.setTimeout(() => {
    sectionFlushTimer = 0;
    const html = pendingSections.shift();
    if (html === undefined) return;
    els.contentBody.insertAdjacentHTML("beforeend", html);
    observeIconHosts();
    if (pendingSections.length > 0) flushPendingSections();
  }, 16);
}

function enqueueIcons(ids: string[]): void {
  if (state.memorySqueezed) return;
  const map = appMap();
  for (const id of ids) {
    const app = map.get(id);
    if (!app || app.visual || iconCache.has(id) || iconRequested.has(id)) continue;
    if (!iconQueue.includes(id)) iconQueue.push(id);
  }
  if (iconQueue.length === 0) return;
  window.clearTimeout(iconFlushTimer);
  iconFlushTimer = window.setTimeout(() => void flushIconQueue(), 10);
}

/// 启动或扫描完成后延迟预热图标；窗口隐藏 / 最小化时先挂起，回到前台再继续。
function scheduleWarmIcons(delay = 3000): void {
  if (!isTauri) return;
  window.clearTimeout(warmIconsTimer);
  warmIconsTimer = window.setTimeout(() => void warmIconsStep(), delay);
}

async function warmIconsStep(): Promise<void> {
  if (state.loading || state.memorySqueezed) return;
  if (!(await windowActive())) {
    warmPending = true;
    return;
  }
  try {
    const result = await api.warmIcons();
    if (result.processed > 0 && result.pending > 0) {
      // 分批预热：可见时继续下一批，隐藏或最小化时留到下次回到前台。
      if (!(await windowActive())) {
        warmPending = true;
        return;
      }
      window.clearTimeout(warmIconsTimer);
      warmIconsTimer = window.setTimeout(() => void warmIconsStep(), 900);
    }
  } catch {
    // 预热失败不影响列表展示，滚动时仍会按需提取。
  }
}

/** 启动到托盘时挂起的工作：首次回到前台补做壁纸、扫描与图标预热。 */
function flushDeferredStartup(): void {
  if (!deferredStartup) return;
  deferredStartup = false;
  if (deferredWallpaper) {
    deferredWallpaper = false;
    void syncWallpaperData();
  }
  const refreshHours = state.settings.autoRefreshHours;
  const stale =
    state.scannedAt === null ||
    (refreshHours > 0 && Date.now() - state.scannedAt > refreshHours * 3_600_000);
  if (stale) void runScan(false, true);
  window.setTimeout(() => void pruneMissingApps(true), 1200);
  scheduleWarmIcons(1500);
}

async function flushIconQueue(): Promise<void> {
  if (state.memorySqueezed || iconInFlight >= ICON_MAX_INFLIGHT || iconQueue.length === 0) return;
  const batch = iconQueue.splice(0, ICON_BATCH_SIZE);
  iconInFlight += 1;
  batch.forEach((id) => iconRequested.add(id));
  if (iconQueue.length > 0) {
    window.clearTimeout(iconFlushTimer);
    iconFlushTimer = window.setTimeout(() => void flushIconQueue(), 0);
  }
  try {
    const result = await api.loadIcons(batch);
    // 内存回收后这批结果已经不需要，丢弃即可，恢复时重新按需加载。
    if (state.memorySqueezed) return;
    const loaded: string[] = [];
    for (const [id, url] of Object.entries(result)) {
      if (!url) continue;
      cacheIcon(id, url);
      loaded.push(id);
    }
    updateIconHosts(loaded);
  } catch {
    // 图标缺失时保留字母占位，不阻塞主流程
  } finally {
    iconInFlight -= 1;
    if (!state.memorySqueezed && iconQueue.length > 0) {
      window.clearTimeout(iconFlushTimer);
      iconFlushTimer = window.setTimeout(() => void flushIconQueue(), 0);
    }
  }
}

/// 一次性扫描所有待替换节点，避免按图标逐个查询 DOM；
/// 替换后移除 data-icon-host，后续渲染与观察者不会重复处理。
function updateIconHosts(ids: string[]): void {
  if (ids.length === 0) return;
  const pending = new Set(ids);
  document.querySelectorAll<HTMLElement>("[data-icon-host]").forEach((host) => {
    const id = host.dataset.iconHost;
    if (!id || !pending.has(id)) return;
    const url = iconCache.get(id);
    if (!url) return;
    host.innerHTML = `<img src="${url}" alt="" draggable="false" decoding="async" />`;
    host.removeAttribute("data-icon-host");
  });
}

/* ── content ──────────────────────────────────────────────────── */

function searchTokens(): string[] {
  return normalizeText(state.query).split(/\s+/).filter(Boolean);
}

/** 取应用当前的搜索索引；分类、名称或发布者变化时自动重建。 */
function searchIndex(app: AppEntry): SearchIndex {
  const categoryName = categoryById(effectiveCategory(app))?.name ?? "";
  const key = `${categoryName}\u0001${app.name}\u0001${app.publisher ?? ""}\u0001${
    app.version ?? ""
  }`;
  const cached = searchIndexCache.get(app);
  if (cached && cached.key === key) return cached.index;
  const index = buildSearchIndex(app, categoryName);
  searchIndexCache.set(app, { key, index });
  return index;
}

/**
 * 搜索结果按匹配质量降序；同分时保持当前排序偏好（名称 / 最近 / 常用）的相对顺序。
 * 评分覆盖名称、紧凑名、词首缩写、拼音全拼与首字母、发布者、分类、版本与安装路径，
 * 因此「小米」「xiaomi」「xm」「小米互联」都能命中，短拉丁词也不会因为裸子串乱入。
 */
function collectSearchResults(
  tokens: string[],
  phrase: string,
  fuzzy: boolean,
): AppEntry[] {
  const scored: { app: AppEntry; score: number; boost: number; order: number }[] = [];
  // 常用 / 最近使用只用来裁决「评分完全相同」的应用，不参与评分本身，
  // 避免热门但弱相关的应用被抬到强相关结果前面（跨档反转）。
  const usage = usageRank();
  const recent = recentRank();
  sortApps(visibleApps()).forEach((app, order) => {
    const index = searchIndex(app);
    const score = matchScore(index, tokens, phrase) ??
      (fuzzy ? fuzzyMatchScore(index, tokens, phrase) : null);
    if (score === null) return;
    const rank = recent.get(app.id);
    const boost =
      Math.min(usage.get(app.id) ?? 0, 20) * 2 +
      (rank === undefined ? 0 : Math.max(0, 20 - rank));
    scored.push({ app, score, boost, order });
  });
  scored.sort((a, b) => b.score - a.score || b.boost - a.boost || a.order - b.order);
  return scored.map((item) => item.app);
}

function searchResults(tokens = searchTokens()): AppEntry[] {
  if (tokens.length === 0) return [];
  const phrase = normalizeText(state.query);
  // 先走精确 / 前缀 / 拼音 / 路径等常规匹配；一个都没有时才启用模糊兜底，
  // 避免模糊结果混进正常搜索，同时保证拼写略错时不至于完全搜不到。
  const strict = collectSearchResults(tokens, phrase, false);
  return strict.length > 0 ? strict : collectSearchResults(tokens, phrase, true);
}

/** 归一化文本并保留每个字符对应的原文下标，用于高亮定位。 */
function highlightMaps(text: string): {
  value: string;
  map: number[];
  compact: string;
  compactMap: number[];
} {
  let value = "";
  let compact = "";
  const map: number[] = [];
  const compactMap: number[] = [];
  let offset = 0;
  for (const char of text) {
    const start = offset;
    offset += char.length;
    const normalized = char
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const kept = /[\p{L}\p{N}]/u.test(normalized) ? normalized : " ";
    for (const piece of kept) {
      value += piece;
      map.push(start);
      if (piece !== " ") {
        compact += piece;
        compactMap.push(start);
      }
    }
  }
  return { value, map, compact, compactMap };
}

/** 把 token 在归一化串中的所有出现位置换算成原文区间。 */
function collectHighlightRanges(
  haystack: string,
  source: number[],
  token: string,
  ranges: { start: number; end: number }[],
): void {
  let index = haystack.indexOf(token);
  while (index >= 0 && ranges.length < 64) {
    const start = source[index];
    const last = source[index + token.length - 1];
    if (start !== undefined && last !== undefined) ranges.push({ start, end: last + 1 });
    index = haystack.indexOf(token, index + 1);
  }
}

function highlight(text: string, tokens: string[]): string {
  if (tokens.length === 0) return escapeHtml(text);
  const { value, map, compact, compactMap } = highlightMaps(text);
  const ranges: { start: number; end: number }[] = [];
  for (const token of tokens) {
    collectHighlightRanges(value, map, token, ranges);
    collectHighlightRanges(compact, compactMap, token, ranges);
  }
  if (ranges.length === 0) return escapeHtml(text);
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  let html = "";
  let cursor = 0;
  for (const range of merged) {
    html += escapeHtml(text.slice(cursor, range.start));
    html += `<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  return `${html}${escapeHtml(text.slice(cursor))}`;
}

function renderAppTile(app: AppEntry, tokens: string[]): string {
  const category = categoryById(effectiveCategory(app));
  const categoryName = category?.name ?? "其他";
  const pinned = state.settings.pinned.includes(app.id);
  const isCursor = tokens.length > 0 && state.lastResults[state.cursorIndex]?.id === app.id;
  const hostAttr = iconHostAttr(app);
  return `<div class="app-tile${isCursor ? " is-cursor" : ""}" role="button" tabindex="-1" draggable="true" data-app-id="${escapeHtml(
    app.id,
  )}" title="${escapeHtml(app.name)}${app.publisher ? ` · ${escapeHtml(app.publisher)}` : ""}">
    ${pinned ? `<span class="tile-pin">${icon("pin")}</span>` : ""}
    <span class="app-icon"${hostAttr}>${renderIconMarkup(app)}</span>
    <span class="app-name">${highlight(app.name, tokens)}</span>
    <span class="app-sub">${escapeHtml(app.publisher ?? categoryName)}</span>
    <button class="tile-info" data-inspect="${escapeHtml(
      app.id,
    )}" tabindex="-1" aria-label="查看 ${escapeHtml(app.name)} 详情">${icon("info")}</button>
  </div>`;
}

function renderAppRow(app: AppEntry, tokens: string[]): string {
  const category = categoryById(effectiveCategory(app));
  const categoryName = category?.name ?? "其他";
  const color = categoryColor(effectiveCategory(app), state.settings.categories);
  const pinned = state.settings.pinned.includes(app.id);
  const isCursor = tokens.length > 0 && state.lastResults[state.cursorIndex]?.id === app.id;
  const hostAttr = iconHostAttr(app);
  return `<div class="app-row${isCursor ? " is-cursor" : ""}" role="button" tabindex="-1" draggable="true" data-app-id="${escapeHtml(
    app.id,
  )}">
    <span class="app-icon"${hostAttr}>${renderIconMarkup(app)}</span>
    <span class="row-main">
      <span class="row-name">${highlight(app.name, tokens)}${pinned ? ` ${icon("pin", "row-pin")}` : ""}</span>
      <span class="row-sub">${escapeHtml(app.publisher ?? "未知发布者")} · ${escapeHtml(categoryName)}</span>
    </span>
    <span class="row-badge" style="--cat-color:${color}">${escapeHtml(categoryName)}</span>
    <span class="row-version">${app.version ? `v${escapeHtml(app.version)}` : ""}</span>
    <button class="row-info-btn" data-inspect="${escapeHtml(
      app.id,
    )}" tabindex="-1" aria-label="查看 ${escapeHtml(app.name)} 详情">${icon("info")}</button>
    <span class="row-launch">${icon("arrow-up-right")}</span>
  </div>`;
}

function renderApps(list: AppEntry[], tokens: string[] = []): string {
  if (list.length === 0) return "";
  if (state.view === "list") {
    return `<div class="app-list">${list.map((app) => renderAppRow(app, tokens)).join("")}</div>`;
  }
  return `<div class="grid">${list.map((app) => renderAppTile(app, tokens)).join("")}</div>`;
}

function emptyState(
  glyph: string,
  title: string,
  description: string,
  actions: { action: EmptyAction; label: string; primary?: boolean }[],
): string {
  return `<div class="state">
    <div class="state-art">${icon(glyph)}</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(description)}</p>
    <div class="state-actions">${actions
      .map(
        ({ action, label, primary }) =>
          `<button class="${primary ? "primary-btn" : "ghost-btn"}" data-empty-action="${action}">${escapeHtml(
            label,
          )}</button>`,
      )
      .join("")}</div>
  </div>`;
}

function renderContent(): void {
  if (state.loading || (state.apps.length === 0 && state.scanning)) {
    els.skeleton.hidden = false;
    els.contentBody.hidden = true;
    els.contentBody.innerHTML = "";
    pendingSections = [];
    return;
  }
  els.skeleton.hidden = true;
  els.contentBody.hidden = false;

  const previousScroll = els.content.scrollTop;
  const shouldReset = state.resetScroll;
  state.resetScroll = false;
  pendingSections = [];

  const tokens = searchTokens();
  const query = state.query.trim();
  const visible = visibleApps();
  const alertHtml = state.scanError
    ? `<div class="alert">${icon("info")}<div class="alert-copy"><strong>${
        state.bootFailed ? "无法载入本地索引" : "扫描未完成"
      }</strong>${escapeHtml(state.scanError)}</div><button data-empty-action="${
        state.bootFailed ? "retry-boot" : "scan"
      }">重试</button></div>`
    : "";

  let body = "";
  let resultsForCursor: AppEntry[] = [];

  if (query.length > 0) {
    if (resultsQuery !== state.query) {
      state.lastResults = searchResults(tokens);
      resultsQuery = state.query;
    }
    resultsForCursor = state.lastResults;
    state.cursorIndex = Math.min(state.cursorIndex, Math.max(0, resultsForCursor.length - 1));
    body =
      resultsForCursor.length === 0
        ? emptyState(
            "search",
            "没有找到匹配的应用",
            `未找到与「${query}」相关的结果。试试应用名称、发布者或分类，也可以用空格分隔多个关键词。`,
            [{ action: "clear-search", label: "清除搜索", primary: true }],
          )
        : renderApps(resultsForCursor, tokens);
  } else if (visible.length === 0) {
    body = state.bootFailed
      ? emptyState("info", "无法载入应用索引", "请确认应用的数据目录可读写，然后重试。", [
          { action: "retry-boot", label: "重新载入", primary: true },
        ])
      : emptyState(
          "grid",
          "还没有发现应用",
          "扫描开始菜单与卸载注册表，会自动整理出可启动的软件。不会读取文件内容，也不会联网。",
          [
            { action: "scan", label: "扫描本机应用", primary: true },
            { action: "settings-scan", label: "扫描设置" },
          ],
        );
  } else if (state.activeNav === "recent") {
    const recent = recentApps();
    body =
      recent.length === 0
        ? emptyState("clock", "还没有使用记录", "从启点启动过的应用会按时间出现在这里。启动记录只保存在本机。", [
            { action: "all", label: "浏览全部应用", primary: true },
          ])
        : renderApps(recent, tokens);
  } else if (state.activeNav === "pinned") {
    const pinned = pinnedApps();
    body =
      pinned.length === 0
        ? emptyState("pin", "还没有固定应用", "右键任意应用选择「固定到常用」，它会出现在顶部快捷栏，并支持 Alt + 数字快速启动。", [
            { action: "all", label: "浏览全部应用", primary: true },
          ])
        : renderApps(pinned, tokens);
  } else if (state.activeNav !== "all") {
    const category = categoryById(state.activeNav);
    const list = sortApps(visible.filter((app) => effectiveCategory(app) === state.activeNav));
    body =
      list.length === 0
        ? emptyState(
            "layers",
            category ? `「${category.name}」还是空的` : "这个分类还是空的",
            "把应用拖到左侧分类即可归类；也可以右键应用，选择「移动到分类」。",
            [
              { action: "all", label: "查看全部应用", primary: true },
              { action: "settings-categories", label: "管理分类" },
            ],
          )
        : renderApps(list, tokens);
  } else {
    const buckets = new Map<string, AppEntry[]>();
    for (const app of visible) {
      const id = effectiveCategory(app);
      const bucket = buckets.get(id);
      if (bucket) bucket.push(app);
      else buckets.set(id, [app]);
    }
    const groups = state.settings.categories
      .map((category) => {
        const list = sortApps(buckets.get(category.id) ?? []);
        return { category, list };
      })
      .filter((group) => group.list.length > 0);

    if (groups.length === 0) {
      body = emptyState("grid", "还没有分类内容", "扫描完成后，应用会自动落入对应分类。", [
        { action: "scan", label: "重新扫描", primary: true },
      ]);
    } else {
      // 应用很多时首帧只渲染前几组，其余分组按帧追加，首屏更快出现。
      const FIRST_FRAME_GROUPS = 3;
      const renderGroup = ({ category, list }: { category: Category; list: AppEntry[] }) => {
        const color = categoryColor(category.id, state.settings.categories);
        return `<section class="section">
          <div class="section-head">
            <span class="section-dot" style="--cat-color:${color}"></span>
            <span class="section-title">${escapeHtml(category.name)}</span>
            <span class="section-count">${list.length}</span>
            <span class="section-line"></span>
            <button class="section-more" data-section-cat="${escapeHtml(
              category.id,
            )}" title="查看「${escapeHtml(category.name)}」分类">查看 ${icon("chevron-right")}</button>
          </div>
          ${renderApps(list, tokens)}
        </section>`;
      };
      if (groups.length <= FIRST_FRAME_GROUPS) {
        body = groups.map(renderGroup).join("");
      } else {
        body = groups.slice(0, FIRST_FRAME_GROUPS).map(renderGroup).join("");
        pendingSections = groups.slice(FIRST_FRAME_GROUPS).map(renderGroup);
      }
    }
  }

  state.lastResults = resultsForCursor;
  els.contentBody.innerHTML = `${alertHtml}${body}`;
  if (shouldReset) els.content.scrollTop = 0;
  else els.content.scrollTop = previousScroll;
  if (pendingSections.length > 0) flushPendingSections();

  if (tokens.length > 0 && resultsForCursor.length > 0) {
    const current = resultsForCursor[state.cursorIndex];
    els.contentBody.querySelectorAll<HTMLElement>("[data-app-id]").forEach((node) => {
      node.classList.toggle("is-cursor", node.dataset.appId === current?.id);
    });
  }
}

/* ── scan ─────────────────────────────────────────────────────── */

async function runScan(force: boolean, silent = false): Promise<void> {
  if (state.scanning) return;
  state.scanning = true;
  state.scanError = null;
  state.bootFailed = false;
  state.scanPercent = 0;
  state.scanPhase = "prepare";
  state.scanFound = 0;
  if (state.apps.length === 0) state.loading = true;
  renderAll();

  try {
    const result = await api.scan(force, (progress) => {
      state.scanPhase = progress.phase;
      state.scanPercent = progress.percent;
      state.scanFound = progress.found;
      renderScanStatus();
    });
    state.apps = result.apps;
    state.scannedAt = result.scannedAt;
    state.scanPercent = 1;
    state.scanPhase = "done";
    state.scanFound = result.apps.length;
    scheduleWarmIcons(1500);
    if (!silent) {
      showToast(
        result.cached ? `已载入本地索引 · ${result.apps.length} 个应用` : `扫描完成 · ${result.apps.length} 个应用`,
        "success",
      );
    }
  } catch (error) {
    state.scanError = String(error);
    showToast("扫描失败，请检查权限或稍后重试", "error");
  } finally {
    state.scanning = false;
    state.loading = false;
    state.resetScroll = false;
    renderAll();
  }
}

function renderScanStatus(): void {
  const label = PHASE_LABELS[state.scanPhase] ?? "正在扫描";
  els.scanFlag.hidden = !state.scanning;
  els.scanFlagText.textContent = label;
  els.scanProgress.hidden = !state.scanning;
  const percent = Math.max(0, Math.min(1, state.scanPercent));
  els.scanProgressBar.style.width = `${Math.round(percent * 100)}%`;
  els.scanProgressText.textContent = state.scanning
    ? `${label} · ${state.scanFound} 个`
    : "扫描完成";
  els.scanBtn.disabled = state.scanning;
  els.scanBtn.classList.toggle("is-busy", state.scanning);
  const buttonLabel = els.scanBtn.querySelector("span");
  if (buttonLabel) buttonLabel.textContent = state.scanning ? "扫描中" : "重新扫描";

  const modalStatus = els.modalLayer.querySelector<HTMLElement>("[data-settings-scan-status]");
  if (modalStatus) {
    modalStatus.textContent = state.scanning ? `${label} · 已发现 ${state.scanFound} 个` : `上次扫描 ${relativeTime(state.scannedAt)}`;
  }
  els.modalLayer.querySelectorAll<HTMLButtonElement>('[data-settings-action="rescan"]').forEach((btn) => {
    btn.disabled = state.scanning;
  });
}

/* ── inspector ────────────────────────────────────────────────── */

function renderInspector(): void {
  if (state.workspace !== "launcher") {
    els.inspector.hidden = true;
    els.inspector.innerHTML = "";
    return;
  }
  if (!state.inspectorId) {
    els.inspector.hidden = true;
    els.inspector.innerHTML = "";
    return;
  }
  const app = appMap().get(state.inspectorId);
  if (!app) {
    state.inspectorId = null;
    els.inspector.hidden = true;
    els.inspector.innerHTML = "";
    return;
  }
  const category = categoryById(effectiveCategory(app));
  const color = categoryColor(effectiveCategory(app), state.settings.categories);
  const pinned = state.settings.pinned.includes(app.id);
  const hostAttr = iconHostAttr(app);
  const path = app.installLocation || app.shortcutPath || "—";
  const canReveal = app.source !== "uwp" && path !== "—";

  els.inspector.hidden = false;
  els.inspector.innerHTML = `<div class="inspector-head">
      <button class="inspector-close" data-inspector-action="close" aria-label="关闭详情">${icon("close")}</button>
      <div class="inspector-app">
        <span class="inspector-icon"${hostAttr}>${renderIconMarkup(app)}</span>
        <div class="inspector-meta">
          <h2 class="inspector-name" title="${escapeHtml(app.name)}">${escapeHtml(app.name)}</h2>
          <div class="inspector-publisher">${escapeHtml(app.publisher ?? "未知发布者")}</div>
        </div>
      </div>
      <div class="inspector-tags">
        <span class="inspector-tag"><span class="tag-dot" style="--cat-color:${color}"></span>${escapeHtml(
          category?.name ?? "其他",
        )}</span>
        <span class="inspector-tag">${escapeHtml(SOURCE_LABELS[app.source])}</span>
        ${app.version ? `<span class="inspector-tag">v${escapeHtml(app.version)}</span>` : ""}
        ${pinned ? `<span class="inspector-tag is-accent">${icon("pin")}常用</span>` : ""}
      </div>
    </div>
    <div class="inspector-body">
      <div class="detail-block">
        <div class="detail-label">分类</div>
        <div class="category-line">
          <span class="cat-dot" style="--cat-color:${color}"></span>
          <span class="detail-value">${escapeHtml(category?.name ?? "其他")}</span>
          <button class="category-change" data-inspector-action="category">更改</button>
        </div>
      </div>
      <div class="detail-block">
        <div class="detail-label">安装位置</div>
        <div class="detail-value is-mono">${escapeHtml(path)}</div>
      </div>
      <div class="detail-block">
        <div class="detail-label">启动目标</div>
        <div class="detail-value">${escapeHtml(SOURCE_LABELS[app.source])} · ${
          app.launchable ? "可直接启动" : "启动目标不可用"
        }</div>
      </div>
    </div>
    <div class="inspector-actions">
      <button class="primary-btn launch-btn" data-inspector-action="launch"${
        app.launchable ? "" : " disabled"
      }>${icon("arrow-up-right")}启动应用</button>
      <div class="inspector-secondary">
        <button class="ghost-btn" data-inspector-action="reveal"${
          canReveal ? "" : " disabled"
        }>${icon("folder")}位置</button>
        <button class="ghost-btn" data-inspector-action="pin">${icon("pin")}${
          pinned ? "取消固定" : "固定"
        }</button>
        <button class="ghost-btn" data-inspector-action="hide">${icon("eye-off")}隐藏</button>
      </div>
    </div>`;
}

/* ── plugins ──────────────────────────────────────────────────── */

const MODULE_GLYPH: Record<ModuleId, string> = {
  ai: "sparkle",
  background: "shield",
  performance: "monitor",
  optimize: "zap",
  memory: "cpu",
  cleanup: "trash",
  boot: "power",
};

const MODULE_UNINSTALL_NOTE: Record<ModuleId, string> = {
  ai: "卸载后会立即结束本地模型进程，并删除已下载的模型与运行时（最多几个 GB），顶部 AI 标签消失；重新安装需要重新下载模型。",
  background: "卸载后启动项与进程列表不可用，已经改过的自启动设置会保留。",
  performance: "卸载后体检入口停止工作，已记录的健康评分与清理记录保留。",
  optimize: "卸载后一键优化、临时文件清理、电源计划、DNS 与深层内存清理入口停止工作；已应用的注册表优化不会自动回滚，可在重装后还原。",
  memory: "卸载后停止内存监控与自动调节，WebView2 恢复为正常档位，常驻线程退出。",
  cleanup: "卸载后残留扫描入口消失，已删除的文件夹不会恢复。",
  boot: "卸载后关闭窗口会直接退出，全局快捷键与应用快捷键全部失效，开机自启动会被关闭。",
};

function moduleStatus(id: ModuleId): ModuleStatus | null {
  return state.modules.find((module) => module.id === id) ?? null;
}

function moduleReady(id: ModuleId): boolean {
  return moduleStatus(id)?.installed ?? false;
}

function backgroundAction(cls: string, label: string): string {
  if (moduleReady("background")) {
    return `<button class="${cls}" data-surface="background">${label}</button>`;
  }
  return `<span class="surface-missing">安装后台管理后可处理</span>`;
}

function pluginsPanel(): string {
  if (!state.modulesLoaded && state.modulesLoading) {
    return `<section class="settings-section">
      <h3 class="settings-section-title">插件</h3>
      <p class="settings-section-desc">正在读取本机插件状态。</p>
    </section>`;
  }
  if (state.modules.length === 0) {
    return `<section class="settings-section">
      <h3 class="settings-section-title">插件</h3>
      <p class="settings-section-desc">${escapeHtml(
        state.modulesError ?? "暂时读不到插件列表。",
      )}</p>
      <button class="ghost-btn" data-settings-action="plugins-refresh">${icon("refresh")}重新读取</button>
    </section>`;
  }
  const installed = state.modules.filter((module) => module.installed);
  const totalBytes = installed.reduce((sum, module) => sum + module.sizeBytes, 0);
  const cards = state.modules
    .map((module) => {
      const busy = state.moduleBusy === module.id;
      const pending = state.modulePendingUninstall === module.id;
      return `<article class="plugin-card${module.installed ? " is-installed" : ""}">
        <div class="plugin-head">
          <span class="plugin-icon">${icon(MODULE_GLYPH[module.id])}</span>
          <div class="plugin-copy">
            <div class="plugin-title">${escapeHtml(module.name)}<span class="plugin-version">v${escapeHtml(
              module.version,
            )}</span></div>
            <p class="plugin-desc">${escapeHtml(module.description)}</p>
          </div>
          <span class="plugin-state">${module.installed ? "已安装" : "未安装"}</span>
        </div>
        <div class="plugin-chips">${module.features
          .map((feature) => `<span class="plugin-chip">${escapeHtml(feature)}</span>`)
          .join("")}</div>
        <div class="plugin-foot">
          <span class="plugin-size">${
            module.installed ? `插件数据 ${formatMemory(module.sizeBytes)}` : "安装后才生效"
          }</span>
          ${
            module.installed
              ? `<button class="ghost-btn${pending ? " is-danger" : ""}" data-settings-action="module-uninstall" data-value="${
                  module.id
                }"${busy ? " disabled" : ""}>${pending ? "确认卸载" : "卸载"}</button>`
              : `<button class="primary-btn" data-settings-action="module-install" data-value="${
                  module.id
                }"${busy ? " disabled" : ""}>${busy ? "安装中…" : "安装"}</button>`
          }
        </div>
        ${pending ? `<p class="plugin-warn">${escapeHtml(MODULE_UNINSTALL_NOTE[module.id])}</p>` : ""}
      </article>`;
    })
    .join("");

  return `<section class="settings-section">
    <h3 class="settings-section-title">插件</h3>
    <p class="settings-section-desc">启动应用内置；后台、性能、内存、应用管理、本地 AI 助手安装后出现在主界面顶部标签，启动与托盘安装后在设置 › 启动中配置。卸载后立即停用并释放常驻内存。</p>
    <div class="plugin-summary">${icon("box")}已安装 ${installed.length}/${state.modules.length} · 插件数据 ${formatMemory(
      totalBytes,
    )}</div>
    <div class="plugin-list">${cards}</div>
    ${state.aiEnabled || state.aiInstalled ? aiSpeechPanel() : ""}
    ${state.aiEnabled || state.aiInstalled ? aiPermissionPanel() : ""}
  </section>`;
}

function aiSpeechPanel(): string {
  const current = state.settings.aiSpeechLanguage ?? "zh";
  const options: Array<["auto" | "zh" | "en", string]> = [
    ["zh", "中文"],
    ["auto", "自动检测"],
    ["en", "English"],
  ];
  return `<div class="settings-section">
    <h3 class="settings-section-title">语音输入</h3>
    <p class="settings-section-desc">按住说话时的识别语言。说中文却得到同音英文（例如把「翻译」听成 translate），通常是自动检测把中文判成了英文；选「中文」后结果会保持中文。</p>
    <div class="settings-card">
      <div class="setting-row">
        <div class="setting-copy"><div class="setting-title">识别语言</div><div class="setting-desc">中文模式会额外给识别器一句中文提示词，减少同音误判；英文口述请切到 English。</div></div>
        <div class="setting-control"><div class="chips">${options
          .map(
            ([value, label]) =>
              `<button class="chip${current === value ? " is-active" : ""}" data-settings-action="ai-language" data-value="${value}" data-focus-key="ai-language-${value}">${label}</button>`,
          )
          .join("")}</div></div>
      </div>
    </div>
  </div>`;
}

async function loadModules(): Promise<void> {
  if (state.modulesLoading) return;
  state.modulesLoading = true;
  state.modulesError = null;
  refreshActive();
  try {
    state.modules = await api.modules();
    state.modulesLoaded = true;
    state.modulesError = null;
  } catch (error) {
    state.modulesError = String(error);
  } finally {
    state.modulesLoading = false;
    refreshActive();
  }
}

async function installModule(id: ModuleId): Promise<void> {
  if (state.moduleBusy) return;
  state.moduleBusy = id;
  state.modulePendingUninstall = null;
  refreshActive();
  try {
    state.modules = await api.installModule(id);
    state.modulesLoaded = true;
    state.modulesError = null;
    const name = moduleStatus(id)?.name ?? "插件";
    showToast(
      id === "boot" ? `${name}已安装，可在设置 › 启动中配置` : `${name}已安装，已加入顶部标签`,
      "success",
    );
    if (id === "background") loadBackground();
    if (id === "performance") void loadPerformanceStatus();
    if (id === "optimize") {
      void loadPerformanceOptimize();
      void loadOptimizePower();
      void loadOptimizeNetwork();
    }
    if (id === "memory") void loadMemoryStatus();
    if (id === "boot") loadBootState();
    if (id === "ai") {
      state.aiEnabled = true;
      void refreshAiStatus();
    }
  } catch (error) {
    showToast(`插件安装失败：${String(error)}`, "error");
  } finally {
    state.moduleBusy = null;
    refreshActive();
  }
}

async function uninstallModule(id: ModuleId): Promise<void> {
  if (state.moduleBusy) return;
  if (state.modulePendingUninstall !== id) {
    state.modulePendingUninstall = id;
    refreshActive();
    return;
  }
  state.moduleBusy = id;
  state.modulePendingUninstall = null;
  refreshActive();
  try {
    const name = moduleStatus(id)?.name ?? "插件";
    state.modules = await api.uninstallModule(id);
    state.modulesLoaded = true;
    showToast(`${name}已卸载`, "success");
    if (id === "background") {
      state.startupItems = [];
      state.processes = [];
      state.expandedGroups.clear();
    }
    if (id === "performance") {
      state.perfStatus = null;
      state.perfSystem = null;
      state.perfTempScan = null;
      state.perfTempSelected.clear();
      state.perfLastClean = null;
    }
    if (id === "memory") {
      state.memoryStatus = null;
      state.memoryTop = null;
      state.memorySqueezed = false;
    }
    if (id === "ai") {
      state.aiEnabled = false;
      state.aiStatus = null;
      state.aiInstalled = false;
      state.aiMessages = [];
      if (state.workspace === "ai") state.workspace = "launcher";
    }
    if (id === "cleanup") {
      state.cleanupScan = null;
      state.cleanupSelected.clear();
      state.cleanupFilter = "all";
      state.cleanupLast = null;
      state.cleanupError = null;
      state.cleanupPendingDelete = false;
      state.cleanupApps = null;
      state.cleanupAppsError = null;
      state.cleanupUninstallId = null;
      state.cleanupLastUninstall = null;
    }
    if (id === "boot") {
      state.autoStart = false;
      state.hotkeyStatus = null;
      state.hotkeyCapture = null;
      state.trayAvailable = false;
      syncCloseHint(false);
    }
  } catch (error) {
    showToast(`插件卸载失败：${String(error)}`, "error");
  } finally {
    state.moduleBusy = null;
    if (state.workspace === id) state.workspace = "launcher";
    refreshActive();
  }
}

function syncCloseHint(trayAvailable: boolean): void {
  const button = document.getElementById("btn-close");
  if (!button) return;
  const label = trayAvailable ? "关闭窗口（隐藏到系统托盘）" : "关闭窗口（将直接退出）";
  button.title = label;
  button.setAttribute("aria-label", label);
}

function prepareTab(tab: SettingsTab): void {
  if (tab === "plugins" && !state.modulesLoaded) void loadModules();
  if (tab === "boot" && moduleReady("boot")) loadBootState();
  if (tab === "wallpaper") void ensureWallpaperThumbs();
}

function bootSettings(): string {
  if (moduleReady("boot")) return bootPanel();
  const meta = moduleStatus("boot");
  if (!meta) {
    return `<section class="settings-section">
      <h3 class="settings-section-title">启动与托盘</h3>
      <p class="settings-section-desc">正在读取插件状态…</p>
    </section>`;
  }
  return `<section class="settings-section">
    <h3 class="settings-section-title">启动与托盘</h3>
    <p class="settings-section-desc">开机自启动、托盘菜单与全局快捷键属于可选插件，安装统一在「插件」页管理。</p>
    <div class="settings-card">
      <div class="setting-row">
        <div class="setting-copy"><div class="setting-title">${escapeHtml(
          meta.name,
        )} · 未安装</div><div class="setting-desc">安装后，这里会出现开机自启、托盘行为、全局快捷键与应用快捷键设置。</div></div>
        <div class="setting-control"><button class="primary-btn" data-settings-action="tab" data-value="plugins">前往插件安装</button></div>
      </div>
    </div>
  </section>`;
}

/* ── local AI assistant ───────────────────────────────────────── */

const AI_PHASES: Record<string, string> = {
  preparing: "正在准备下载",
  llama: "llama.cpp 运行组件",
  whisper: "whisper.cpp 语音组件",
  model: "Qwen2.5-1.5B 语言模型",
  speech: "Whisper Base 语音模型",
  extract: "正在解压组件",
};

const AI_SYSTEM_PROMPT =
  "你是启点（QiDian）内置的本地 AI 助手。回答要简洁、直接，使用简体中文。" +
  "当用户要求打开、启动或查找某个应用时，调用 launch_app，query 可以直接填应用名称（如「微信」），" +
  "也可以先调用 search_apps 再传候选里的 app_id；" +
  "launch_app 返回多个候选时，把候选名称告诉用户让他选，不要编造应用。" +
  "当用户要求关闭、退出或结束后台应用时，先调用 list_running_apps 找到对应 app 键名，再调用 close_app；" +
  "close_app 会向用户弹出确认卡，用户拒绝时不要重复尝试。" +
  "只有在用户明确要求修改设置时才调用 open_settings。" +
  "用户问内存或电脑状态时调用 system_info；明确要求释放内存时调用 free_memory；" +
  "用户给出网址或要求打开某个网页时调用 open_url；要求切换深色 / 浅色模式时调用 set_theme。" +
  "你只会收到用户已授权的工具；未出现的工具表示用户禁止，不要假装调用或声称已执行。" +
  "你不能执行 shell 命令或删除文件；遇到这类请求要拒绝并说明原因。" +
  "不要声称自己联网，也不要输出工具调用 JSON 让用户手动执行。";

const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_apps",
      description:
        "在本机应用索引里搜索应用，返回最多 8 个候选。启动应用前必须先调用它取得 app_id。",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "应用名称、拼音或发布者关键词" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "launch_app",
      description:
        "启动应用。参数 query 传应用名称（如「微信」）、拼音或 search_apps 返回的 app_id；名称唯一匹配时会直接启动。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "应用名称、拼音或 app_id" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_running_apps",
      description:
        "列出正在运行的桌面应用（已过滤系统与受保护进程），返回 app 键名、显示名、发布者与进程数。结束应用前必须先调用。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "可选：按应用名称或发布者过滤" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_app",
      description:
        "结束 list_running_apps 返回的某个应用的全部进程。执行前会向用户弹出确认卡，必须使用返回的 app 键名。",
      parameters: {
        type: "object",
        properties: { app: { type: "string", description: "list_running_apps 返回的 app 键名" } },
        required: ["app"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_settings",
      description: "打开设置面板的指定页，仅在用户明确要求修改设置时使用。",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["appearance", "wallpaper", "categories", "apps", "boot", "plugins", "about"],
          },
        },
        required: ["section"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "system_info",
      description:
        "读取本机系统状态：物理内存总量、已用与可用、提交内存、空闲时长。用户问「内存多少」「电脑状态怎么样」时使用。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "free_memory",
      description:
        "释放物理内存：整理启点自身工作集并清理系统缓存。用户明确说「释放内存 / 清理内存 / 电脑卡了」时使用。",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["self", "system"],
            description: "self 只释放启点自身；system 同时清理系统缓存，需要管理员权限",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_url",
      description: "用系统默认浏览器打开网页，只支持 http/https 链接。",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "完整网址，例如 https://www.bing.com" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_theme",
      description: "切换启点的明暗模式。",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["light", "dark", "system"] } },
        required: ["mode"],
      },
    },
  },
];

const AI_TOOL_LABELS: Record<string, string> = {
  search_apps: "搜索应用",
  launch_app: "启动应用",
  list_running_apps: "查看运行中的应用",
  close_app: "结束应用",
  open_settings: "打开设置页",
  system_info: "读取系统状态",
  free_memory: "释放内存",
  open_url: "打开网页",
  set_theme: "切换明暗模式",
};

function aiToolAllowed(name: string): boolean {
  const permissions = state.settings.aiPermissions;
  switch (name) {
    case "search_apps":
      return permissions.appLaunch && permissions.appSearch;
    case "launch_app":
      return permissions.appLaunch && permissions.appStart;
    case "list_running_apps":
      return permissions.appControl && permissions.processList;
    case "close_app":
      return permissions.appControl && permissions.processClose;
    case "open_settings":
      return permissions.settingsNav && permissions.settingsOpen;
    case "system_info":
      return permissions.systemInfo;
    case "free_memory":
    case "open_url":
    case "set_theme":
      return permissions.systemAction;
    default:
      return false;
  }
}

function aiAllowedTools(): typeof AI_TOOLS {
  return AI_TOOLS.filter((tool) => aiToolAllowed(tool.function.name));
}

function aiPermissionSwitch(key: keyof AiPermissions, label: string): string {
  const enabled = state.settings.aiPermissions[key];
  return `<button class="switch" role="switch" aria-checked="${enabled}" data-settings-action="ai-perm" data-key="${key}" data-focus-key="ai-perm-${key}" aria-label="${label}"></button>`;
}

function aiPermissionPanel(): string {
  const permissions = state.settings.aiPermissions;
  const groups: Array<{
    key: keyof AiPermissions;
    title: string;
    desc: string;
    children: Array<[keyof AiPermissions, string, string]>;
  }> = [
    {
      key: "appLaunch",
      title: "应用启动",
      desc: "允许模型搜索本机应用并启动它们。",
      children: [
        ["appSearch", "搜索应用", "读取应用索引并返回候选，不启动任何程序。"],
        ["appStart", "启动应用", "启动搜索候选里的应用。"],
      ],
    },
    {
      key: "appControl",
      title: "应用结束",
      desc: "允许模型查看运行中的应用并结束它们。",
      children: [
        ["processList", "查看运行中的应用", "列出非系统进程、发布者与内存占用。"],
        ["processClose", "结束应用", "结束该应用的全部进程；执行前仍会弹出确认卡。"],
      ],
    },
    {
      key: "settingsNav",
      title: "设置导航",
      desc: "允许模型打开设置页。",
      children: [["settingsOpen", "打开设置页", "跳转到外观、应用、关于等设置页。"]],
    },
    {
      key: "systemInfo",
      title: "系统信息",
      desc: "允许模型读取内存、提交内存与空闲时长等本机状态。",
      children: [],
    },
    {
      key: "systemAction",
      title: "系统操作",
      desc: "允许模型释放内存、用默认浏览器打开网页、切换明暗模式。",
      children: [],
    },
  ];
  return `<div class="settings-section">
    <h3 class="settings-section-title">AI 工具权限</h3>
    <p class="settings-section-desc">大类关闭时，其下小类立即失效；只有已授权的工具会发送给模型。即使模型伪造未授权调用，也不会执行。</p>
    <div class="settings-card ai-perm-card">
      ${groups
        .map(
          (group) => `<div class="ai-perm-group">
            <div class="setting-row">
              <div class="setting-copy"><div class="setting-title">${group.title}</div><div class="setting-desc">${group.desc}</div></div>
              <div class="setting-control">${aiPermissionSwitch(group.key, group.title)}</div>
            </div>
            ${
              group.children.length === 0
                ? ""
                : permissions[group.key]
                  ? `<div class="ai-perm-children">${group.children
                      .map(
                        ([key, title, desc]) => `<div class="setting-row is-sub">
                        <div class="setting-copy"><div class="setting-title">${title}</div><div class="setting-desc">${desc}</div></div>
                        <div class="setting-control">${aiPermissionSwitch(key, title)}</div>
                      </div>`,
                      )
                      .join("")}</div>`
                  : `<div class="ai-perm-off">已关闭 · 小类权限不可用</div>`
            }
          </div>`,
        )
        .join("")}
    </div>
  </div>`;
}

async function refreshAiStatus(): Promise<void> {
  try {
    state.aiStatus = await api.aiStatus();
    state.aiInstalled = state.aiStatus.installed;
  } catch (error) {
    state.aiError = String(error);
  }
  refreshActive();
}

const AI_RUNTIME_BYTES = 24_376_086 + 8_928_640;
const AI_WHISPER_BYTES = 147_951_465;

function aiModelCards(): string {
  const models = state.aiStatus?.models ?? [];
  const busy = Boolean(state.aiProgress || state.aiStatus?.downloading);
  return `<div class="ai-models">
    ${models
      .map(
        (model) => `<button class="ai-model-card${model.selected ? " is-selected" : ""}" data-ai-action="model" data-value="${escapeHtml(
          model.id,
        )}" ${busy ? "disabled" : ""}>
          <span class="ai-model-radio" aria-hidden="true"></span>
          <span class="ai-model-copy">
            <span class="ai-model-title"><span>${escapeHtml(model.label)}${
              model.installed ? `<i class="ai-model-badge">已下载</i>` : ""
            }</span><em>${formatBytes(model.bytes)}</em></span>
            <span class="ai-model-note">${escapeHtml(model.memory)} · ${escapeHtml(model.note)}</span>
          </span>
        </button>`,
      )
      .join("")}
  </div>`;
}

function aiSetupPanel(): string {
  const progress = state.aiProgress;
  const downloading = Boolean(progress) || Boolean(state.aiStatus?.downloading);
  const percent = progress?.percent ?? 0;
  const phase = progress ? (AI_PHASES[progress.phase] ?? progress.phase) : "";
  const models = state.aiStatus?.models ?? [];
  const selected = models.find((model) => model.selected);
  const modelBytes = selected?.bytes ?? 0;
  const total = AI_RUNTIME_BYTES + modelBytes + AI_WHISPER_BYTES;
  const others = models.filter((model) => model.installed && !model.selected);
  return `<div class="ai-shell ai-setup">
    <div class="ai-setup-hero">
      <span class="ai-avatar is-large">${icon("sparkle")}</span>
      <div class="ai-setup-copy">
        <h2>本地 AI 助手</h2>
        <p>一个可选的小模型组件：问答、启动应用、语音对话，全部在本机运行，不联网、不上传。</p>
      </div>
    </div>
    <div class="ai-capabilities">
      <span>${icon("chat")}问答</span>
      <span>${icon("grid")}操作应用</span>
      <span>${icon("mic")}语音对话</span>
      <span>${icon("shield")}完全离线</span>
    </div>
    <div class="ai-models-head">
      <strong>选择模型</strong>
      <span>低配电脑选 0.5B，性能越好越可以往上选</span>
    </div>
    ${aiModelCards()}
    <div class="ai-pack">
      <div class="ai-pack-row"><span>推理与语音运行时（llama.cpp + whisper.cpp）</span><span>33 MB</span></div>
      <div class="ai-pack-row"><span>${escapeHtml(selected?.label ?? "语言模型")}（Q4）</span><span>${formatBytes(
        modelBytes,
      )}</span></div>
      <div class="ai-pack-row"><span>Whisper Base 语音识别模型</span><span>141 MB</span></div>
      <div class="ai-pack-row is-total"><span>合计</span><span>${formatBytes(total)}</span></div>
    </div>
    ${
      others.length > 0
        ? `<p class="ai-pack-hint">切换模型后会在新模型下载完成时删除旧模型文件：${escapeHtml(
            others.map((model) => model.label).join("、"),
          )}。</p>`
        : ""
    }
    ${
      downloading
        ? `<div class="ai-download-state">
            <div class="ai-download-copy"><span>${escapeHtml(phase || "正在准备下载")}</span><span>${Math.round(
              percent,
            )}%</span></div>
            <div class="ai-progress"><span style="width:${Math.max(1.5, percent)}%"></span></div>
            <p>${
              progress && progress.total > 0
                ? `${formatBytes(progress.done)} / ${formatBytes(progress.total)} · `
                : ""
            }支持断点续传：中断后再次点击会从已下载的位置继续。</p>
          </div>`
        : ""
    }
    ${state.aiError ? `<div class="ai-error">${escapeHtml(state.aiError)}</div>` : ""}
    <div class="ai-setup-actions">
      <button class="primary-btn ai-download" data-ai-action="download" ${
        downloading ? "disabled" : ""
      }>${downloading ? "正在下载…" : `下载并安装（约 ${formatBytes(total)}）`}</button>
      <button class="ghost-btn" data-ai-action="refresh">重新检测</button>
    </div>
    <p class="ai-footnote">未下载时不会写入任何模型文件，也不占用内存；模型只在打开 AI 页输入时启动，离开或空闲后自动释放。下载失败会自动换源并保留断点。</p>
  </div>`;
}

function aiSuggestions(): string {
  const prompts = ["打开微信", "帮我找剪辑软件", "列出最近常用的应用"];
  return `<div class="ai-empty">
    <span class="ai-empty-icon">${icon("sparkle")}</span>
    <h3>本地 AI 助手</h3>
    <p>可以问答，也可以让它启动应用。语音按钮支持按住说话。</p>
    <div class="ai-prompts">${prompts
      .map(
        (prompt) =>
          `<button data-ai-action="prompt" data-value="${escapeHtml(prompt)}">${escapeHtml(
            prompt,
          )}</button>`,
      )
      .join("")}</div>
  </div>`;
}

function aiMessageHtml(message: AiChatMessage): string {
  if (message.role === "user") {
    return `<div class="ai-row is-user"><div class="ai-bubble is-user">${escapeHtml(
      message.content,
    )}</div></div>`;
  }
  if (message.role !== "assistant" || !message.content.trim()) return "";
  return `<div class="ai-row"><span class="ai-avatar">${icon("sparkle")}</span><div class="ai-bubble">${escapeHtml(
    message.content,
  )}</div></div>`;
}

function aiCloseConfirmHtml(): string {
  const pending = state.aiPendingClose;
  if (!pending) return "";
  const group = pending.group;
  return `<div class="ai-confirm">
    <div class="ai-confirm-copy">
      <span class="ai-confirm-icon">${icon("power")}</span>
      <div>
        <strong>结束「${escapeHtml(group.title)}」？</strong>
        <p>将结束 ${group.items.length} 个进程，未保存的内容可能丢失。</p>
      </div>
    </div>
    <div class="ai-confirm-actions">
      <button class="ghost-btn" data-ai-action="close-cancel">取消</button>
      <button class="primary-btn" data-ai-action="close-confirm">允许结束</button>
    </div>
  </div>`;
}

function aiPanel(): string {
  const status = state.aiStatus;
  const installed = status?.installed ?? state.aiInstalled;
  if (!installed) {
    return status
      ? aiSetupPanel()
      : `<div class="ai-shell"><div class="ai-loading"><span class="inline-spinner"></span>正在检测本地 AI 组件…</div></div>`;
  }
  const messages = state.aiMessages.map(aiMessageHtml).join("");
  const models = status?.models ?? [];
  const modelOptions = models
    .map(
      (model) =>
        `<option value="${escapeHtml(model.id)}"${model.selected ? " selected" : ""}>${escapeHtml(
          model.label,
        )}${model.installed ? " · 已下载" : " · 需下载"}</option>`,
    )
    .join("");
  const headState = state.aiWarming
    ? "正在加载本地模型…"
    : status?.running
      ? "本地模型已启动"
      : "本地模型 · 输入时启动";
  return `<div class="ai-shell ai-chat">
    <header class="ai-head">
      <div class="ai-head-copy">
        <span class="ai-avatar">${icon("sparkle")}</span>
        <div>
          <div class="ai-head-status${status?.running ? " is-on" : ""}"><span class="ai-dot"></span>${headState}</div>
          <p>${escapeHtml(status?.modelLabel ?? "Qwen2.5-1.5B")} · Whisper Base · 完全离线</p>
        </div>
      </div>
      <div class="ai-head-actions">
        <select class="ai-model-select" data-ai-model title="切换模型">${modelOptions}</select>
        <button class="ai-icon-btn" data-ai-action="permissions" title="AI 工具权限">${icon(
          "shield",
        )}</button>
        <button class="ai-icon-btn${state.aiSpeak ? " is-on" : ""}" data-ai-action="toggle-speak" title="${
          state.aiSpeak ? "关闭语音朗读" : "开启语音朗读"
        }">${icon("volume")}</button>
        <button class="ai-icon-btn" data-ai-action="clear" title="清空对话">${icon("trash")}</button>
      </div>
    </header>
    <div class="ai-messages">
      ${messages || aiSuggestions()}
      ${state.aiPendingClose ? aiCloseConfirmHtml() : ""}
      ${
        state.aiWarming
          ? `<div class="ai-warm"><span class="inline-spinner"></span>正在加载本地模型，第一次约需几秒…</div>`
          : ""
      }
      ${
        state.aiBusy
          ? `<div class="ai-typing"><span></span><span></span><span></span></div>`
          : ""
      }
      ${state.aiError ? `<div class="ai-error">${escapeHtml(state.aiError)}</div>` : ""}
    </div>
    <div class="ai-composer">
      <textarea rows="1" data-ai-input placeholder="问点什么，或让启点打开某个应用…" ${
        state.aiBusy ? "disabled" : ""
      }>${escapeHtml(state.aiInput)}</textarea>
      <button class="ai-mic${state.aiRecording ? " is-recording" : ""}${state.aiTranscribing ? " is-transcribing" : ""}" data-ai-action="mic" title="${
        state.aiTranscribing ? "正在识别…" : state.aiRecording ? "停止录音" : "语音输入"
      }" aria-label="${
        state.aiTranscribing ? "正在识别语音" : state.aiRecording ? "停止录音" : "语音输入"
      }"${state.aiTranscribing ? " disabled" : ""}>${icon(
        state.aiTranscribing ? "refresh" : state.aiRecording ? "stop" : "mic",
      )}</button>
      <button class="ai-send" data-ai-action="send" ${state.aiBusy ? "disabled" : ""}>${icon(
        "send",
      )}</button>
    </div>
    <p class="ai-footnote">对话与录音只在本机处理；离开 AI 页或空闲 2 分钟后模型会自动退出以释放内存。<button class="ai-link" data-ai-action="remove">删除本地组件</button></p>
  </div>`;
}

function aiSearchApps(query: string): Array<Record<string, string>> {
  const needle = normalizeText(query);
  if (!needle) return [];
  const tokens = needle.split(/\s+/).filter(Boolean);
  const scored: Array<{ app: AppEntry; score: number }> = [];
  for (const app of visibleApps()) {
    const index = searchIndex(app);
    const score = matchScore(index, tokens, needle) ?? fuzzyMatchScore(index, tokens, needle);
    if (score !== null && score > 0) scored.push({ app, score });
  }
  scored.sort((left, right) => right.score - left.score || left.app.name.localeCompare(right.app.name));
  return scored.slice(0, 8).map(({ app }) => ({
    app_id: app.id,
    name: app.name,
    category: app.category,
    publisher: app.publisher ?? "",
  }));
}

/**
 * 把模型给的应用名 / app_id 解析成唯一应用。
 * 名称完全一致，或搜索结果只有一个时才直接启动；多个候选返回名字让模型追问。
 */
function resolveAiApp(raw: string): { app?: AppEntry; error?: string; ambiguous?: string[] } {
  const target = raw.trim();
  if (!target) return { error: "请提供应用名称" };
  const byId = state.apps.find((item) => item.id === target);
  if (byId) return { app: byId };
  const candidates = aiSearchApps(target);
  if (candidates.length === 0) {
    return { error: `没有找到「${target}」，请换一个名称或先确认应用已安装` };
  }
  const needle = normalizeText(target);
  const exact = candidates.find((item) => normalizeText(String(item.name)) === needle);
  const pick = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!pick) {
    return { ambiguous: candidates.slice(0, 3).map((item) => String(item.name)) };
  }
  const app = state.apps.find((item) => item.id === pick.app_id);
  return app ? { app } : { error: "应用索引里没有这个应用" };
}

async function runAiTool(call: AiToolCall): Promise<Record<string, unknown>> {
  if (!aiToolAllowed(call.function.name)) {
    const label = AI_TOOL_LABELS[call.function.name] ?? call.function.name;
    state.aiError = `已阻止「${label}」：用户未授权该权限`;
    return { ok: false, error: "用户未授权该工具，操作已拒绝" };
  }
  let args: Record<string, unknown> = {};
  try {
    const raw = call.function.arguments as unknown;
    args = (
      typeof raw === "string" ? JSON.parse(raw || "{}") : (raw ?? {})
    ) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "参数不是合法 JSON" };
  }
  switch (call.function.name) {
    case "search_apps": {
      const query = typeof args.query === "string" ? args.query : "";
      const apps = aiSearchApps(query);
      state.aiSearchIds = apps.map((app) => String(app.app_id));
      return { ok: true, apps, count: apps.length };
    }
    case "launch_app": {
      const raw =
        typeof args.query === "string"
          ? args.query
          : typeof args.app_id === "string"
            ? args.app_id
            : typeof args.name === "string"
              ? args.name
              : "";
      const resolved = resolveAiApp(raw);
      if (!resolved.app) {
        if (resolved.ambiguous) {
          return {
            ok: false,
            error: `找到多个候选：${resolved.ambiguous.join("、")}，请让用户确认要启动哪一个`,
            candidates: resolved.ambiguous,
          };
        }
        return { ok: false, error: resolved.error ?? "没有找到这个应用" };
      }
      const result = await api.launch(resolved.app.id);
      if (result.ok) {
        state.aiSearchIds = [resolved.app.id];
      }
      return {
        ok: result.ok,
        name: resolved.app.name,
        error: result.ok ? "" : (result.error ?? "启动失败"),
      };
    }
    case "list_running_apps": {
      const processes = await api.listProcesses();
      const groups = buildProcessGroups(processes)
        .filter((group) => !group.protectedGroup && group.level !== "system")
        .sort((left, right) => right.memoryBytes - left.memoryBytes);
      state.aiProcessGroups = groups;
      const query = typeof args.query === "string" ? args.query.toLowerCase().trim() : "";
      const filtered = query
        ? groups.filter((group) =>
            `${group.title} ${group.name} ${group.publisher}`.toLowerCase().includes(query),
          )
        : groups;
      return {
        ok: true,
        total: groups.length,
        apps: filtered.slice(0, 12).map((group) => ({
          app: group.key,
          title: group.title,
          publisher: group.publisher,
          processes: group.items.length,
          memory_bytes: group.memoryBytes,
        })),
      };
    }
    case "close_app": {
      const key = typeof args.app === "string" ? args.app : "";
      const group = state.aiProcessGroups.find((item) => item.key === key);
      if (!group) {
        return { ok: false, error: "找不到该应用，请先调用 list_running_apps 获取 app 键名" };
      }
      if (group.protectedGroup || group.level === "system") {
        return { ok: false, error: "该进程属于系统或受保护进程，不能结束" };
      }
      const allowed = await new Promise<boolean>((resolve) => {
        state.aiPendingClose = { group, resolve };
        refreshActive();
        scrollAiToBottom();
      });
      state.aiPendingClose = null;
      refreshActive();
      if (!allowed) return { ok: false, error: "用户取消了结束操作" };
      const report = await api.terminateProcesses(
        group.items.map((item) => ({ pid: item.pid, name: item.name })),
      );
      state.aiProcessGroups = state.aiProcessGroups.filter((item) => item.key !== key);
      return {
        ok: report.terminated > 0,
        app: group.title,
        terminated: report.terminated,
        failed: report.failed.map((item) => item.name),
      };
    }
    case "open_settings": {
      const section = typeof args.section === "string" ? args.section : "appearance";
      const allowed: SettingsTab[] = [
        "appearance",
        "wallpaper",
        "categories",
        "apps",
        "boot",
        "plugins",
        "about",
      ];
      const target = (allowed.includes(section as SettingsTab) ? section : "appearance") as SettingsTab;
      openSettings(target);
      return { ok: true, section: target };
    }
    case "system_info": {
      const status = await api.memoryStatus();
      return {
        ok: true,
        memory_total_bytes: status.systemTotalBytes,
        memory_available_bytes: status.systemAvailBytes,
        memory_used_percent: status.systemUsedPercent,
        commit_used_percent: status.systemCommitUsedPercent,
        battery_percent: status.batteryPercent,
        idle_seconds: status.userIdleSeconds,
        self_working_set_bytes: status.selfWorkingSetBytes,
      };
    }
    case "free_memory": {
      const before = await api.memoryStatus();
      await api.memoryTrim();
      if ((args.scope as string | undefined) === "system") {
        await api.memoryPurgeSystem();
      }
      const after = await api.memoryStatus();
      const freed = after.systemAvailBytes - before.systemAvailBytes;
      return {
        ok: true,
        scope: (args.scope as string | undefined) === "system" ? "system" : "self",
        freed_bytes: Math.max(freed, 0),
        available_bytes: after.systemAvailBytes,
        used_percent: after.systemUsedPercent,
      };
    }
    case "open_url": {
      const raw = typeof args.url === "string" ? args.url.trim() : "";
      const url = /^[a-z]+:\/\//i.test(raw) ? raw : raw ? `https://${raw}` : "";
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, error: "请提供以 http:// 或 https:// 开头的网址" };
      }
      try {
        await api.openExternal(url);
        return { ok: true, url };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
    case "set_theme": {
      const mode = args.mode === "light" || args.mode === "dark" ? args.mode : "system";
      patchSettings({ colorMode: mode as Settings["colorMode"] });
      return { ok: true, mode };
    }
    default:
      return { ok: false, error: `未知工具：${call.function.name}` };
  }
}

let aiStartPromise: Promise<void> | null = null;
/** 正在进行的停止操作：启动前必须等它结束，否则会撞车。 */
let aiStopPromise: Promise<void> | null = null;
let aiWarmTimer: number | undefined;
/** 离开 AI 页时还有请求在跑：等请求结束再释放模型。 */
let aiLeavePending = false;

/** 停止模型并刷新状态；同一时刻只允许一次停止。 */
function requestAiStop(): Promise<void> {
  if (aiStopPromise) return aiStopPromise;
  aiStopPromise = api
    .aiStop()
    .then(() => refreshAiStatusQuiet())
    .then(() => updateAiWarmUi())
    .catch(() => undefined)
    .finally(() => {
      aiStopPromise = null;
    });
  return aiStopPromise;
}

/** 只更新「加载中」提示，避免预热时整页重绘打断输入。 */
function updateAiWarmUi(): void {
  const head = document.querySelector<HTMLElement>(".ai-head-status");
  if (head) {
    const running = Boolean(state.aiStatus?.running);
    head.classList.toggle("is-on", running);
    head.innerHTML = `<span class="ai-dot"></span>${
      state.aiWarming ? "正在加载本地模型…" : running ? "本地模型已启动" : "本地模型 · 输入时启动"
    }`;
  }
  const panel = document.querySelector<HTMLElement>(".ai-messages");
  if (!panel) return;
  const existing = panel.querySelector(".ai-warm");
  if (state.aiWarming && !existing) {
    const node = document.createElement("div");
    node.className = "ai-warm";
    node.innerHTML = `<span class="inline-spinner"></span>正在加载本地模型，第一次约需几秒…`;
    panel.appendChild(node);
  } else if (!state.aiWarming && existing) {
    existing.remove();
  }
}

async function refreshAiStatusQuiet(): Promise<void> {
  try {
    state.aiStatus = await api.aiStatus();
    state.aiInstalled = state.aiStatus.installed;
  } catch (error) {
    state.aiError = String(error);
  }
}

async function ensureAiServer(): Promise<void> {
  window.clearTimeout(aiIdleTimer);
  if (aiStartPromise) return aiStartPromise;
  // 模型正在被释放：等它彻底退出再启动，避免刚预热就被停掉。
  if (aiStopPromise) await aiStopPromise;
  if (state.aiStatus?.running) return;
  state.aiWarming = true;
  if (state.workspace === "ai") updateAiWarmUi();
  aiStartPromise = (async () => {
    try {
      await api.aiStart();
      await refreshAiStatusQuiet();
    } finally {
      aiStartPromise = null;
      state.aiWarming = false;
      if (state.workspace === "ai") {
        updateAiWarmUi();
      } else {
        // 启动期间已经离开 AI 页：立即释放，不把模型常驻在内存里。
        void requestAiStop();
      }
    }
  })();
  return aiStartPromise;
}

/** 用户一开始输入就预热模型，避免「发一条 → 等加载 → 再发一条」。 */
function scheduleAiWarm(): void {
  if (!state.aiInstalled || state.aiBusy) return;
  if (state.aiStatus?.running) {
    // 已经在跑：每次输入只顺延释放时间，不再重复启动。
    scheduleAiIdleStop();
    return;
  }
  if (state.aiWarming || aiStartPromise) return;
  window.clearTimeout(aiWarmTimer);
  aiWarmTimer = window.setTimeout(() => {
    if (state.workspace !== "ai" || !state.aiInstalled) return;
    void ensureAiServer()
      .then(() => scheduleAiIdleStop())
      .catch((error) => {
        state.aiError = String(error);
        refreshActive();
      });
  }, 450);
}

/** 离开 AI 页或长时间不输入时释放模型进程。 */
function stopAiServer(): void {
  window.clearTimeout(aiIdleTimer);
  window.clearTimeout(aiWarmTimer);
  if (state.aiBusy || aiStartPromise) {
    // 请求或加载还在进行：记下来，等这一轮结束后立刻释放。
    aiLeavePending = true;
    return;
  }
  if (!state.aiStatus?.running && !aiStopPromise) return;
  void requestAiStop();
}

/**
 * 「打开 / 启动 / 运行某个应用」是明确指令，直接检索并启动，不依赖模型工具调用，
 * 既保证成功率，也避免为一条启动命令加载整个模型。
 */
const AI_LAUNCH_RE =
  /^(?:请|麻烦|帮我|能不能|能否|可以|可以帮我)?\s*(?:打开一下|打开|启动一下|启动|运行一下|运行|开一下)\s*(.+?)(?:吧|呗|呀|啊)?$/;
const AI_LAUNCH_REVERSE = /^把\s*(.+?)\s*(?:打开|启动|运行)(?:一下)?$/;
const AI_LAUNCH_QUESTION = /怎么|如何|为什么|为啥|吗[？?]?$|能不能不/;

async function tryDirectLaunch(text: string): Promise<boolean> {
  if (!aiToolAllowed("search_apps") || !aiToolAllowed("launch_app")) return false;
  const body = text.trim();
  if (AI_LAUNCH_QUESTION.test(body)) return false;
  const match = body.match(AI_LAUNCH_RE) ?? body.match(AI_LAUNCH_REVERSE);
  if (!match) return false;
  const query = match[1].trim().replace(/[。.!！?？]+$/, "");
  if (!query || query.length > 24) return false;
  const resolved = resolveAiApp(query);
  if (!resolved.app) return false;
  return runDirectReply(body, async () => {
    const result = await api.launch(resolved.app!.id);
    return result.ok
      ? `已为你启动「${resolved.app!.name}」。`
      : `启动「${resolved.app!.name}」失败：${result.error ?? "未知原因"}`;
  });
}

/** 不需要模型也能完成的明确指令：释放内存、打开网址、切换明暗模式。 */
const AI_FREE_RE =
  /^(?:帮我|请|麻烦)?\s*(?:清理|释放|整理)(?:一下)?\s*(?:内存|内存占用|运行内存)[。.!！]?$/;
const AI_URL_RE = /^(?:打开|访问|浏览)\s*(https?:\/\/\S+|(?:[\w-]+\.)+[a-z]{2,}\S*)[。.!！]?$/i;
const AI_THEME_DARK_RE =
  /^(?:切换(?:到|成)|改用|换成|开启)?\s*(?:深色|暗色|夜间)(?:模式|主题)?[。.!！]?$/;
const AI_THEME_LIGHT_RE =
  /^(?:切换(?:到|成)|改用|换成|开启)?\s*(?:浅色|亮色|日间)(?:模式|主题)?[。.!！]?$/;

async function tryDirectCommand(text: string): Promise<boolean> {
  const body = text.trim();
  if (AI_FREE_RE.test(body) && aiToolAllowed("free_memory")) {
    return runDirectReply(body, async () => {
      const before = await api.memoryStatus();
      await api.memoryTrim();
      await api.memoryPurgeSystem();
      const after = await api.memoryStatus();
      const freed = Math.max(after.systemAvailBytes - before.systemAvailBytes, 0);
      return freed > 0
        ? `已释放 ${formatBytes(freed)} 内存，当前可用 ${formatBytes(after.systemAvailBytes)}。`
        : `内存已经很宽裕，当前可用 ${formatBytes(after.systemAvailBytes)}。`;
    });
  }
  const url = body.match(AI_URL_RE)?.[1];
  if (url && aiToolAllowed("open_url")) {
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return runDirectReply(body, async () => {
      await api.openExternal(full);
      return `已用默认浏览器打开 ${full}`;
    });
  }
  if (AI_THEME_DARK_RE.test(body) || AI_THEME_LIGHT_RE.test(body)) {
    const mode = AI_THEME_DARK_RE.test(body) ? "dark" : "light";
    return runDirectReply(body, async () => {
      patchSettings({ colorMode: mode });
      return mode === "dark" ? "已切换到深色模式。" : "已切换到浅色模式。";
    });
  }
  return false;
}

/** 直接执行明确指令：把用户消息与结果写进对话，不经过模型。 */
async function runDirectReply(body: string, action: () => Promise<string>): Promise<boolean> {
  state.aiInput = "";
  state.aiMessages.push({ role: "user", content: body });
  state.aiBusy = true;
  state.aiError = null;
  refreshActive();
  try {
    state.aiMessages.push({ role: "assistant", content: await action() });
  } catch (error) {
    state.aiMessages.push({ role: "assistant", content: `操作失败：${String(error)}` });
  } finally {
    state.aiBusy = false;
    refreshActive();
    scrollAiToBottom();
  }
  return true;
}

async function sendAiMessage(text: string, speak = false): Promise<void> {
  const content = text.trim();
  if (!content || state.aiBusy) return;
  if (await tryDirectLaunch(content)) return;
  if (await tryDirectCommand(content)) return;
  state.aiInput = "";
  state.aiError = null;
  state.aiMessages.push({ role: "user", content });
  state.aiBusy = true;
  refreshActive();
  scrollAiToBottom();
  try {
    await ensureAiServer();
    let finalText = "";
    for (let step = 0; step < 4; step += 1) {
      const reply = await api.aiChat(
        [
          { role: "system", content: AI_SYSTEM_PROMPT },
          ...state.aiMessages.slice(-16),
        ],
        aiAllowedTools(),
      );
      const toolCalls = Array.isArray(reply.tool_calls) ? (reply.tool_calls as AiToolCall[]) : [];
      const replyContent = typeof reply.content === "string" ? reply.content : "";
      if (toolCalls.length > 0) {
        state.aiMessages.push({
          role: "assistant",
          content: replyContent,
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          const result = await runAiTool(call);
          // launch_app 已在工具里写入一条空 tool 消息，避免重复。
          if (!state.aiMessages.some((message) => message.tool_call_id === call.id)) {
            state.aiMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }
        }
        refreshActive();
        scrollAiToBottom();
        continue;
      }
      finalText = replyContent.trim();
      if (finalText) {
        state.aiMessages.push({ role: "assistant", content: finalText });
      }
      break;
    }
    if (!finalText && state.aiMessages.length > 0) {
      state.aiError = "模型没有给出回答，请换个说法再试";
    }
    if ((speak || state.aiSpeak) && finalText) speakAi(finalText);
    scheduleAiIdleStop();
  } catch (error) {
    state.aiError = String(error);
  } finally {
    state.aiBusy = false;
    // 请求期间用户已离开 AI 页：这一轮结束后立刻释放模型。
    if (aiLeavePending || state.workspace !== "ai") {
      aiLeavePending = false;
      void requestAiStop();
    }
    refreshActive();
    scrollAiToBottom();
  }
}

let aiIdleTimer: number | undefined;

function scheduleAiIdleStop(): void {
  window.clearTimeout(aiIdleTimer);
  aiIdleTimer = window.setTimeout(() => {
    if (state.aiBusy) return;
    if (state.workspace !== "ai") return;
    void requestAiStop();
  }, 2 * 60 * 1000);
}

function scrollAiToBottom(): void {
  window.requestAnimationFrame(() => {
    const panel = document.querySelector<HTMLElement>(".ai-messages");
    panel?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  });
}

function speakAi(text: string): void {
  if (!("speechSynthesis" in window)) return;
  const plain = text
    .replace(/[`*#_>~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
  if (!plain) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(plain.slice(0, 600));
  utterance.lang = "zh-CN";
  utterance.rate = 1.04;
  window.speechSynthesis.speak(utterance);
}

async function switchAiModel(id: string): Promise<void> {
  if (!id || state.aiBusy || state.aiProgress) return;
  if (id === state.aiStatus?.model) return;
  const model = state.aiStatus?.models.find((item) => item.id === id);
  if (!model) return;
  try {
    state.aiError = null;
    // 预热还在启动中时先等它结束，否则切换会把刚拉起的进程打断成超时。
    if (aiStartPromise) {
      try {
        await aiStartPromise;
      } catch {
        /* 预热失败不影响切换 */
      }
    }
    await api.aiSetModel(id);
    await refreshAiStatus();
    showToast(
      state.aiStatus?.installed
        ? `已切换到 ${model.label}`
        : `已选择 ${model.label}，下载后即可使用`,
      state.aiStatus?.installed ? "success" : "info",
    );
  } catch (error) {
    state.aiError = String(error);
    refreshActive();
  }
}

async function downloadAiPack(): Promise<void> {
  if (state.aiProgress || state.aiStatus?.downloading) return;
  state.aiError = null;
  state.aiProgress = { phase: "preparing", done: 0, total: 0, percent: 0 };
  refreshActive();
  try {
    await api.aiDownload();
    await refreshAiStatus();
    showToast("AI 组件已就绪，可以开始对话", "success");
  } catch (error) {
    state.aiError = String(error);
  } finally {
    state.aiProgress = null;
    refreshActive();
  }
}

async function removeAiPack(): Promise<void> {
  const used = state.aiStatus?.downloadedBytes ?? 0;
  if (!window.confirm(`删除本地 AI 组件？将释放约 ${formatBytes(used)} 空间，对话记录也会清空。`)) return;
  try {
    await api.aiRemove();
    state.aiInstalled = false;
    state.aiMessages = [];
    state.aiProgress = null;
    await refreshAiStatus();
    showToast("已删除本地 AI 组件", "info");
  } catch (error) {
    state.aiError = String(error);
    refreshActive();
  }
}

let aiRecorder: MediaRecorder | null = null;
let aiStream: MediaStream | null = null;
let aiChunks: Blob[] = [];

async function toggleAiRecording(): Promise<void> {
  if (state.aiTranscribing) return;
  if (state.aiRecording) {
    aiRecorder?.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    state.aiError = "当前 WebView2 不支持录音，请把 Microsoft Edge WebView2 运行时更新到最新版本";
    refreshActive();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    aiStream = stream;
    aiChunks = [];
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(
      (candidate) => MediaRecorder.isTypeSupported?.(candidate),
    );
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    aiRecorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) aiChunks.push(event.data);
    };
    recorder.onstop = async () => {
      state.aiRecording = false;
      aiStream?.getTracks().forEach((track) => track.stop());
      aiStream = null;
      const blob = new Blob(aiChunks, { type: recorder.mimeType || "audio/webm" });
      aiChunks = [];
      if (blob.size < 2000) {
        state.aiError = "录音太短，请把话说完再点停止";
        refreshActive();
        return;
      }
      state.aiTranscribing = true;
      refreshActive();
      try {
        const wav = await blobToWavBase64(blob);
        const text = await api.aiTranscribe(wav, state.settings.aiSpeechLanguage ?? "zh");
        if (text.trim()) {
          state.aiInput = text.trim();
          state.aiTranscribing = false;
          refreshActive();
          void sendAiMessage(text, true);
          return;
        }
        state.aiError = "没有识别到语音内容，请靠近麦克风重试";
      } catch (error) {
        state.aiError = String(error);
      } finally {
        state.aiTranscribing = false;
        refreshActive();
      }
    };
    recorder.start();
    state.aiRecording = true;
    state.aiError = null;
    refreshActive();
  } catch (error) {
    state.aiError =
      "无法访问麦克风，请在 Windows 隐私设置里允许启点使用麦克风：" + String(error);
    refreshActive();
  }
}

/** 让本地模型把未手动分类的应用归类，按 20 个一批调用后端。 */
async function runAiClassifyApps(): Promise<void> {
  if (state.aiClassifyBusy) return;
  if (!state.aiInstalled) {
    showToast("请先在「设置 › 插件」里安装本地 AI 助手", "info");
    return;
  }
  const targets = visibleApps().filter((app) => !state.settings.overrides[app.id]);
  if (targets.length === 0) {
    showToast("所有应用都已手动归类，没有需要自动分类的项", "info");
    return;
  }
  if (
    !window.confirm(
      `让本地模型为 ${targets.length} 个未手动归类的应用自动分类？首次会加载模型，可能需要几十秒。`,
    )
  ) {
    return;
  }
  const categories: [string, string][] = state.settings.categories.map((category) => [
    category.id,
    category.name,
  ]);
  const overrides: Record<string, string> = { ...state.settings.overrides };
  let applied = 0;
  let skipped = 0;
  state.aiClassifyBusy = true;
  state.aiClassifyTotal = targets.length;
  state.aiClassifyDone = 0;
  refreshActive();
  try {
    const batchSize = 20;
    for (let index = 0; index < targets.length; index += batchSize) {
      const batch = targets.slice(index, index + batchSize);
      const payload = batch.map(
        (app) =>
          [
            app.id,
            app.publisher ? `${app.name}（${app.publisher}）` : app.name,
          ] as [string, string],
      );
      const result = await api.aiClassify(payload, categories);
      for (const entry of result.assignments) {
        if (categoryById(entry.category)) overrides[entry.id] = entry.category;
      }
      applied += result.assignments.length;
      skipped += result.skipped;
      state.aiClassifyDone = Math.min(targets.length, index + batch.length);
      refreshActive();
    }
    patchSettings({ overrides });
    showToast(
      `已用模型归类 ${applied} 个应用${skipped > 0 ? `，${skipped} 个未能判断` : ""}`,
      "success",
    );
  } catch (error) {
    patchSettings({ overrides });
    showToast(`自动分类失败：${String(error)}`, "error");
  } finally {
    state.aiClassifyBusy = false;
    refreshActive();
  }
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const array = await blob.arrayBuffer();
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(array);
  await context.close();
  const rate = 16000;
  const length = Math.max(1, Math.ceil(decoded.duration * rate));
  const offline = new OfflineAudioContext(1, length, rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function handleAiAction(action: string, element: HTMLElement): Promise<void> {
  switch (action) {
    case "download":
      void downloadAiPack();
      return;
    case "refresh":
      await refreshAiStatus();
      return;
    case "send":
      void sendAiMessage(state.aiInput);
      return;
    case "prompt":
      void sendAiMessage(element.dataset.value ?? "");
      return;
    case "model":
      void switchAiModel(element.dataset.value ?? "");
      return;
    case "mic":
      void toggleAiRecording();
      return;
    case "permissions":
      openSettings("plugins");
      window.setTimeout(() => {
        document.querySelector(".ai-perm-card")?.scrollIntoView({ block: "center" });
      }, 160);
      return;
    case "toggle-speak":
      state.aiSpeak = !state.aiSpeak;
      if (!state.aiSpeak) window.speechSynthesis?.cancel();
      refreshActive();
      return;
    case "close-confirm": {
      const pending = state.aiPendingClose;
      state.aiPendingClose = null;
      pending?.resolve(true);
      refreshActive();
      return;
    }
    case "close-cancel": {
      const pending = state.aiPendingClose;
      state.aiPendingClose = null;
      pending?.resolve(false);
      refreshActive();
      return;
    }
    case "clear":
      state.aiPendingClose?.resolve(false);
      state.aiPendingClose = null;
      state.aiMessages = [];
      state.aiSearchIds = [];
      state.aiProcessGroups = [];
      state.aiError = null;
      refreshActive();
      return;
    case "remove":
      void removeAiPack();
      return;
  }
}

/* ── settings ─────────────────────────────────────────────────── */

function settingsHtml(): string {
  const modalClass = `modal${settingsAnimated ? " no-enter" : ""}`;
  const tabButtons = SETTINGS_TABS.map(
    (tab) => `<button class="tab${state.settingsTab === tab.id ? " is-active" : ""}" role="tab" aria-selected="${
      state.settingsTab === tab.id
    }" data-settings-action="tab" data-value="${tab.id}" data-focus-key="tab-${tab.id}">${icon(tab.glyph)}${
      tab.label
    }</button>`,
  ).join("");

  return `<div class="${modalClass}" role="dialog" aria-modal="true" aria-label="设置">
    <div class="modal-head">
      <div>
        <h2 class="modal-title">设置</h2>
        <p class="modal-sub">外观、壁纸、分类、应用索引、启动、插件与关于 · 已安装插件的入口在主界面顶部标签</p>
      </div>
      <button class="modal-close" data-settings-action="close" data-close-settings aria-label="关闭设置">${icon(
        "close",
      )}</button>
    </div>
    <div class="tabs" role="tablist">${tabButtons}</div>
    <div class="modal-body">
      <div class="tab-panel" data-panel="appearance"${state.settingsTab === "appearance" ? "" : " hidden"}>
        ${appearancePanel()}
      </div>
      <div class="tab-panel" data-panel="wallpaper"${state.settingsTab === "wallpaper" ? "" : " hidden"}>
        ${wallpaperPanel()}
      </div>
      <div class="tab-panel" data-panel="categories"${state.settingsTab === "categories" ? "" : " hidden"}>
        ${categoriesPanel()}
      </div>
      <div class="tab-panel" data-panel="apps"${state.settingsTab === "apps" ? "" : " hidden"}>
        ${scanPanel()}
      </div>
      <div class="tab-panel" data-panel="boot"${state.settingsTab === "boot" ? "" : " hidden"}>
        ${bootSettings()}
      </div>
      <div class="tab-panel" data-panel="plugins"${state.settingsTab === "plugins" ? "" : " hidden"}>
        ${pluginsPanel()}
      </div>
      <div class="tab-panel" data-panel="about"${state.settingsTab === "about" ? "" : " hidden"}>
        ${aboutPanel()}
      </div>
    </div>
    <div class="modal-foot">
      <div class="modal-foot-left">${icon("shield")}<span>数据仅保存在本机 · 默认不联网 · 无遥测</span></div>
      <div class="modal-foot-right"><span>v${APP_VERSION}</span></div>
    </div>
  </div>`;
}

function themeOption(theme: (typeof THEME_OPTIONS)[number]): string {
  const selected = state.settings.theme === theme.id;
  const dark = resolvedMode() === "dark" ? " is-dark" : "";
  return `<button class="theme-option${selected ? " is-selected" : ""}" data-settings-action="theme" data-value="${theme.id}" aria-pressed="${selected}" data-focus-key="theme-${theme.id}">
    <div class="theme-preview preview-${theme.id}${dark}" aria-hidden="true">
      <div class="p-rail"><span class="p-nav is-active"></span><span class="p-nav"></span><span class="p-nav"></span><span class="p-nav"></span></div>
      <div class="p-main"><span class="p-title"></span><span class="p-sub"></span><div class="p-grid"><span class="p-tile is-accent"></span><span class="p-tile"></span><span class="p-tile"></span><span class="p-tile"></span><span class="p-tile"></span><span class="p-tile"></span><span class="p-tile"></span><span class="p-tile"></span></div></div>
    </div>
    <span class="theme-option-name"><span>${theme.name}<small>${theme.note}</small></span><span class="theme-check">${icon("check")}</span></span>
  </button>`;
}

function themePresetOption(preset: (typeof THEME_PRESETS)[number]): string {
  const selected = state.settings.themePreset === preset.id;
  return `<button class="preset-option${selected ? " is-selected" : ""}" data-settings-action="preset" data-value="${
    preset.id
  }" aria-pressed="${selected}" data-focus-key="preset-${preset.id}">
    <span class="preset-preview preset-${preset.id}" aria-hidden="true"></span>
    <span class="preset-copy"><strong>${preset.name}</strong><small>${preset.note}</small></span>
    <span class="theme-check preset-check">${icon("check")}</span>
  </button>`;
}

type WallpaperSliderKey = "opacity" | "blur" | "dim" | "x" | "y" | "zoom";

function wallpaperRangeRow(
  title: string,
  key: WallpaperSliderKey,
  value: number,
  min: number,
  max: number,
  unit: string,
  desc: string,
): string {
  return `<div class="setting-row">
    <div class="setting-copy"><div class="setting-title">${title}</div><div class="setting-desc">${desc}</div></div>
    <div class="setting-control">
      <span class="range-value" data-wallpaper-value="${key}">${value}${unit}</span>
      <input class="range-input" type="range" min="${min}" max="${max}" step="1" value="${value}" data-wallpaper-range="${key}" data-focus-key="wallpaper-${key}" aria-label="${title}" />
    </div>
  </div>`;
}

function wallpaperOption(item: (typeof WALLPAPERS)[number]): string {
  const settings = state.settings;
  const selected = settings.wallpaper === item.id;
  const customImage =
    item.id === "custom" ? state.wallpaperData || settings.wallpaperImage : "";
  const previewClass = [
    "wallpaper-preview",
    item.id === "custom" ? "is-custom" : `wp-${item.id}`,
    customImage ? "has-image" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = customImage ? ` style="background-image:url(&quot;${customImage}&quot;)"` : "";
  const inner = item.id === "custom" && !customImage ? icon("plus") : "";
  return `<button class="wallpaper-option${selected ? " is-selected" : ""}" data-settings-action="wallpaper" data-value="${item.id}" aria-pressed="${selected}" data-focus-key="wallpaper-${item.id}">
    <span class="${previewClass}" aria-hidden="true"${style}>${inner}</span>
    <span class="wallpaper-copy">${item.name}<small>${item.note}</small></span>
    <span class="theme-check wallpaper-check">${icon("check")}</span>
  </button>`;
}

function wallpaperAssetCard(asset: WallpaperAsset): string {
  const active =
    state.settings.wallpaper === "custom" && state.settings.wallpaperAsset === asset.id;
  const thumb = state.wallpaperThumbs[asset.id] ?? "";
  const style = thumb ? ` style="background-image:url(&quot;${thumb}&quot;)"` : "";
  const size = asset.bytes > 0 ? `${Math.max(1, Math.round(asset.bytes / 1024))} KB` : "本地文件";
  return `<div class="wallpaper-asset${active ? " is-active" : ""}">
    <button class="wallpaper-asset-pick" data-settings-action="wallpaper-asset" data-id="${
      asset.id
    }" data-focus-key="wallpaper-asset-${asset.id}" title="${escapeHtml(asset.name)}">
      <span class="wallpaper-asset-thumb${thumb ? " has-image" : ""}"${style}>${
        thumb ? "" : icon("plus")
      }</span>
      <span class="wallpaper-asset-name">${escapeHtml(asset.name)}</span>
      <span class="wallpaper-asset-size">${size}</span>
    </button>
    <button class="wallpaper-asset-del" data-settings-action="wallpaper-asset-delete" data-id="${
      asset.id
    }" data-focus-key="wallpaper-asset-del-${asset.id}" title="从壁纸库删除">${icon("close")}</button>
  </div>`;
}

function wallpaperPanel(): string {
  const settings = state.settings;
  const library = settings.wallpaperLibrary ?? [];
  const customActive = settings.wallpaper === "custom";
  return `<div class="settings-section">
      <h3 class="settings-section-title">壁纸</h3>
      <p class="settings-section-desc">壁纸铺在主题氛围层下方，可与任意界面风格、配色自由组合；上传的图片保存在本机数据目录。</p>
      <div class="wallpaper-options">${WALLPAPERS.map(wallpaperOption).join("")}</div>
      <div class="wallpaper-actions">
        <button data-settings-action="wallpaper-upload" data-focus-key="wallpaper-upload">${icon(
          "plus",
        )}上传图片到壁纸库</button>
        <input type="file" accept="image/*" multiple hidden data-wallpaper-file />
      </div>
    </div>
    <div class="settings-section">
      <h3 class="settings-section-title">壁纸库</h3>
      <p class="settings-section-desc">最多保留 12 张，点缩略图切换当前壁纸，右上角 × 删除；文件存放在数据目录的 wallpapers 文件夹。</p>
      <div class="wallpaper-library">${
        library.length === 0
          ? `<div class="wallpaper-library-empty">还没有上传过壁纸，点上方「上传图片到壁纸库」添加。</div>`
          : library.map(wallpaperAssetCard).join("")
      }</div>
    </div>
    ${
      customActive
        ? `<div class="settings-section">
      <h3 class="settings-section-title">图片壁纸调节</h3>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">铺放方式</div><div class="setting-desc">填充会裁切边缘，适应会完整显示，平铺适合纹理图。</div></div>
          <div class="setting-control"><div class="chips">${WALLPAPER_FITS.map(
            (fit) =>
              `<button class="chip${settings.wallpaperFit === fit.id ? " is-active" : ""}" data-settings-action="wallpaper-fit" data-value="${fit.id}" data-focus-key="wallpaper-fit-${fit.id}">${fit.label}</button>`,
          ).join("")}</div></div>
        </div>
        ${wallpaperRangeRow("水平位置", "x", settings.wallpaperX, 0, 100, "%", "调整图片的横向焦点，数值越小越偏左。")}
        ${wallpaperRangeRow("垂直位置", "y", settings.wallpaperY, 0, 100, "%", "调整图片的纵向焦点，数值越小越偏上。")}
        ${wallpaperRangeRow("缩放", "zoom", settings.wallpaperZoom, 100, 200, "%", "在铺放基础上继续放大，便于裁掉不想显示的部分。")}
      </div>
    </div>`
        : ""
    }
    <div class="settings-section">
      <h3 class="settings-section-title">壁纸强度</h3>
      <div class="settings-card wallpaper-sliders">
        ${wallpaperRangeRow("不透明度", "opacity", settings.wallpaperOpacity, 20, 100, "%", "越低越接近纯色背景，兼顾氛围与可读性。")}
        ${wallpaperRangeRow("模糊", "blur", settings.wallpaperBlur, 0, 40, "px", "柔化照片类壁纸，减少文字干扰；低功耗模式自动关闭。")}
        ${wallpaperRangeRow("明暗", "dim", settings.wallpaperDim, 0, 70, "%", "浅色模式提亮、深色模式压暗，提升内容对比度。")}
      </div>
    </div>`;
}

type PaletteColorKey = "bgLight" | "bgDark" | "panelLight" | "panelDark" | "textLight" | "textDark";
type PaletteRangeKey = "radius" | "panelOpacity" | "blur" | "iconSize";

function paletteColorField(label: string, key: PaletteColorKey, value: string): string {
  return `<label class="palette-field"><span>${label}</span><input type="color" data-palette-color="${key}" value="${value}" aria-label="${label}" data-focus-key="palette-${key}" /></label>`;
}

function paletteRangeRow(
  title: string,
  key: PaletteRangeKey,
  value: number,
  min: number,
  max: number,
  unit: string,
  desc: string,
): string {
  return `<div class="setting-row">
    <div class="setting-copy"><div class="setting-title">${title}</div><div class="setting-desc">${desc}</div></div>
    <div class="setting-control">
      <span class="range-value" data-palette-value="${key}">${value}${unit}</span>
      <input class="range-input" type="range" min="${min}" max="${max}" step="1" value="${value}" data-palette-range="${key}" data-focus-key="palette-range-${key}" aria-label="${title}" />
    </div>
  </div>`;
}

function palettePanel(): string {
  const palette = state.settings.customPalette;
  const active = state.settings.theme === "custom";
  return `<div class="settings-section">
      <h3 class="settings-section-title">自定义配色与形状</h3>
      <p class="settings-section-desc">${
        active
          ? "当前使用「自定义」风格，下面的颜色与形状会实时生效。"
          : "仅在选择「自定义」风格时生效；修改任意一项会自动切换过去，浅色与深色分别设置。"
      }</p>
      <div class="settings-card">
        <div class="palette-grid">
          ${paletteColorField("浅色背景", "bgLight", palette.bgLight)}
          ${paletteColorField("浅色面板", "panelLight", palette.panelLight)}
          ${paletteColorField("浅色文字", "textLight", palette.textLight)}
          ${paletteColorField("深色背景", "bgDark", palette.bgDark)}
          ${paletteColorField("深色面板", "panelDark", palette.panelDark)}
          ${paletteColorField("深色文字", "textDark", palette.textDark)}
        </div>
        ${paletteRangeRow("圆角", "radius", palette.radius, 0, 30, "px", "同时作用于图标、卡片、面板与弹窗。")}
        ${paletteRangeRow("面板透明度", "panelOpacity", palette.panelOpacity, 30, 100, "%", "侧栏、卡片与设置面板的不透明程度。")}
        ${paletteRangeRow("面板模糊", "blur", palette.blur, 0, 48, "px", "自定义主题下由这里控制，替代外观页的模糊档位。")}
        ${paletteRangeRow("图标大小", "iconSize", palette.iconSize, 28, 64, "px", "启动台与列表中的图标尺寸。")}
      </div>
    </div>`;
}

function customThemeItem(theme: CustomTheme): string {
  const themeName = THEME_OPTIONS.find((item) => item.id === theme.theme)?.short ?? "自定义";
  const presetName = THEME_PRESETS.find((item) => item.id === theme.preset)?.name ?? "默认";
  const wallpaperName = WALLPAPERS.find((item) => item.id === theme.wallpaper)?.name ?? "无壁纸";
  const cornerName =
    theme.corners === "sharp" ? "直角" : theme.corners === "round" ? "大圆角" : "跟随主题";
  const accentColor =
    theme.accent === "custom"
      ? theme.customAccent
      : (ACCENTS.find((item) => item.id === theme.accent)?.color ?? "#1b62d6");
  return `<div class="custom-theme-item">
    <span class="custom-theme-swatch" style="background:${accentColor}"></span>
    <div class="custom-theme-copy">
      <div class="custom-theme-name">${escapeHtml(theme.name)}</div>
      <div class="custom-theme-meta">${themeName} · ${presetName} · ${wallpaperName} · ${cornerName}</div>
    </div>
    <button data-settings-action="custom-theme-apply" data-id="${escapeHtml(theme.id)}" data-focus-key="custom-theme-apply-${theme.id}">应用</button>
    <button class="is-danger" data-settings-action="custom-theme-delete" data-id="${escapeHtml(
      theme.id,
    )}" data-focus-key="custom-theme-delete-${theme.id}">删除</button>
  </div>`;
}

function customThemesPanel(): string {
  const themes = state.settings.customThemes ?? [];
  return `<div class="settings-section">
      <h3 class="settings-section-title">我的主题</h3>
      <p class="settings-section-desc">把当前的主题、配色、壁纸、圆角与模糊保存成方案，之后一键还原；最多保留 12 套。</p>
      <div class="settings-card">
        <div class="custom-theme-new">
          <input data-custom-theme-name maxlength="16" placeholder="主题名称，例如「夜间极光」" value="${escapeHtml(
            state.customThemeName,
          )}" aria-label="主题名称" data-focus-key="custom-theme-name" />
          <button data-settings-action="custom-theme-save" data-focus-key="custom-theme-save">保存当前外观</button>
        </div>
        ${
          themes.length === 0
            ? `<div class="custom-theme-empty">还没有保存的主题：先调好外观，再点「保存当前外观」。</div>`
            : themes.map(customThemeItem).join("")
        }
      </div>
    </div>`;
}

function themePanel(): string {
  const modes: { id: ColorMode; label: string }[] = [
    { id: "system", label: "跟随系统" },
    { id: "light", label: "浅色" },
    { id: "dark", label: "深色" },
  ];
  const settings = state.settings;
  return `<div class="settings-section">
      <h3 class="settings-section-title">界面风格</h3>
      <p class="settings-section-desc">决定布局、圆角与字体：Windows 原生、Miuix 柔和、macOS 通透、Mono 直角，或完全自定义。</p>
      <div class="theme-options">${THEME_OPTIONS.map(themeOption).join("")}</div>
    </div>
    <div class="settings-section">
      <h3 class="settings-section-title">主题配色</h3>
      <p class="settings-section-desc">主题决定窗口背景氛围，并同步推荐强调色；应用后仍可在下方单独调整。</p>
      <div class="preset-options">${THEME_PRESETS.map(themePresetOption).join("")}</div>
    </div>
    <div class="settings-section">
      <h3 class="settings-section-title">明暗与强调色</h3>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">明暗模式</div><div class="setting-desc">跟随系统时会自动响应 Windows 主题切换。</div></div>
          <div class="setting-control"><div class="chips">${modes
            .map(
              (mode) =>
                `<button class="chip${settings.colorMode === mode.id ? " is-active" : ""}" data-settings-action="mode" data-value="${mode.id}" data-focus-key="mode-${mode.id}">${mode.label}</button>`,
            )
            .join("")}</div></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">强调色</div><div class="setting-desc">用于选中态、快捷按钮与分类点缀；支持直接取色，前景色按亮度自动适配。</div></div>
          <div class="setting-control"><div class="swatches">${ACCENTS.map(
            (accent) =>
              `<button class="swatch${settings.accent === accent.id ? " is-selected" : ""}" style="--swatch-color:${
                accent.color
              }" data-settings-action="accent" data-value="${accent.id}" data-focus-key="accent-${accent.id}" title="${accent.name}" aria-label="${accent.name}" aria-pressed="${
                settings.accent === accent.id
              }">${icon("check")}</button>`,
          ).join("")}<label class="accent-picker${
            settings.accent === "custom" ? " is-selected" : ""
          }" title="自定义强调色" data-focus-key="accent-custom"><input type="color" data-custom-accent value="${
            HEX_COLOR.test(settings.customAccent) ? settings.customAccent : "#1b62d6"
          }" aria-label="自定义强调色" /></label></div></div>
        </div>
      </div>
    </div>
    ${palettePanel()}`;
}

function appearancePanel(): string {
  return `${themePanel()}${displayPanel()}${customThemesPanel()}`;
}

function displayPanel(): string {
  const densities: { id: Density; label: string }[] = [
    { id: "cozy", label: "舒适" },
    { id: "compact", label: "紧凑" },
  ];
  const corners: { id: CornerStyle; label: string }[] = [
    { id: "soft", label: "跟随主题" },
    { id: "sharp", label: "直角" },
    { id: "round", label: "大圆角" },
  ];
  const blurs: { id: BlurLevel; label: string }[] = [
    { id: "off", label: "关闭" },
    { id: "standard", label: "标准" },
    { id: "strong", label: "加强" },
  ];
  return `<div class="settings-section">
      <h3 class="settings-section-title">显示细节</h3>
      <p class="settings-section-desc">控制密度、圆角、模糊与能耗；「自定义」风格下，圆角与模糊由上方自定义配色接管。</p>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">信息密度</div><div class="setting-desc">紧凑模式会缩小图标与间距，单屏显示更多应用。</div></div>
          <div class="setting-control"><div class="chips">${densities
            .map(
              (density) =>
                `<button class="chip${state.settings.density === density.id ? " is-active" : ""}" data-settings-action="density" data-value="${density.id}" data-focus-key="density-${density.id}">${density.label}</button>`,
            )
            .join("")}</div></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">圆角</div><div class="setting-desc">跟随主题使用各风格默认形状；直角更利落，大圆角更柔和，对全部面板生效。</div></div>
          <div class="setting-control"><div class="chips">${corners
            .map(
              (corner) =>
                `<button class="chip${state.settings.corners === corner.id ? " is-active" : ""}" data-settings-action="corners" data-value="${corner.id}" data-focus-key="corners-${corner.id}">${corner.label}</button>`,
            )
            .join("")}</div></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">面板模糊</div><div class="setting-desc">侧栏、设置与浮层的背景模糊强度；关闭后最省 GPU，加强后壁纸更通透。</div></div>
          <div class="setting-control"><div class="chips">${blurs
            .map(
              (blur) =>
                `<button class="chip${state.settings.blur === blur.id ? " is-active" : ""}" data-settings-action="blur" data-value="${blur.id}" data-focus-key="blur-${blur.id}">${blur.label}</button>`,
            )
            .join("")}</div></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">低功耗模式</div><div class="setting-desc">关闭背景模糊、阴影与过渡动画，降低 GPU 与电量占用；空闲时不运行任何轮询任务。</div></div>
          <div class="setting-control"><button class="switch" role="switch" aria-checked="${
            state.settings.lowPower
          }" data-settings-action="toggle" data-key="lowPower" data-focus-key="toggle-lowPower" aria-label="低功耗模式"></button></div>
        </div>
      </div>
      <p class="settings-section-desc" style="margin-top:10px;padding-left:4px">图标按需提取并缓存，窗口隐藏时不会后台刷新；空闲时不运行任何轮询任务。</p>
    </div>`;
}

function categoriesPanel(): string {
  const counts = categoryCounts();
  const rows = state.settings.categories
    .map((category, index) => {
      const builtin = category.builtin !== false;
      const color = categoryColor(category.id, state.settings.categories);
      const editing = state.editingCategoryId === category.id;
      const pending = state.pendingCategoryDelete === category.id;
      const nameHtml = editing
        ? `<input class="cat-name-input" data-cat-rename-input data-category-id="${escapeHtml(
            category.id,
          )}" data-focus-key="rename-${category.id}" maxlength="16" value="${escapeHtml(
            state.renameDraft,
          )}" aria-label="分类名称" />`
        : `<span class="cat-name">${escapeHtml(category.name)}</span>`;
      const actions = editing
        ? `<button class="cat-action" data-settings-action="category-rename-save" data-category-id="${escapeHtml(
            category.id,
          )}" title="保存">${icon("check")}</button>
           <button class="cat-action" data-settings-action="category-rename-cancel" title="取消">${icon("close")}</button>`
        : `<button class="cat-action" data-settings-action="category-up" data-category-id="${escapeHtml(
            category.id,
          )}" data-focus-key="cat-up-${escapeHtml(category.id)}" title="上移" ${
            index === 0 ? "disabled" : ""
          }>${icon("arrow-up")}</button>
           <button class="cat-action" data-settings-action="category-down" data-category-id="${escapeHtml(
             category.id,
           )}" data-focus-key="cat-down-${escapeHtml(category.id)}" title="下移" ${
             index === state.settings.categories.length - 1 ? "disabled" : ""
           }>${icon("arrow-down")}</button>
           <button class="cat-action" data-settings-action="category-rename" data-category-id="${escapeHtml(
             category.id,
           )}" data-focus-key="cat-rename-${escapeHtml(category.id)}" title="重命名">${icon(
             "edit",
           )}</button>
           ${
             builtin
               ? ""
               : `<button class="cat-action is-danger" data-settings-action="category-delete" data-category-id="${escapeHtml(
                   category.id,
                 )}" data-focus-key="cat-delete-${escapeHtml(
                   category.id,
                 )}" title="${pending ? "再次点击确认删除" : "删除分类"}">${
                   pending ? icon("check") : icon("trash")
                 }</button>`
           }`;
      return `<div class="cat-row">
        <span class="cat-dot" style="--cat-color:${color}"></span>
        ${nameHtml}
        <span class="cat-count">${counts.get(category.id) ?? 0}</span>
        <div class="cat-actions">${actions}</div>
      </div>`;
    })
    .join("");

  return `<div class="settings-section">
      <h3 class="settings-section-title">应用分类</h3>
      <div class="settings-card"><div class="cat-list">${rows}</div></div>
      <div class="cat-add">
        <input class="text-input" id="new-category-name" data-new-category-input maxlength="16" placeholder="新分类名称…" value="${escapeHtml(
          state.newCategoryDraft,
        )}" aria-label="新分类名称" />
        <button class="primary-btn" data-settings-action="category-add">添加分类</button>
      </div>
    </div>
    <div class="settings-section">
      <h3 class="settings-section-title">使用方式</h3>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">拖拽归类</div><div class="setting-desc">把任意应用拖到左侧分类即可；右键应用也可以选择「移动到分类」。内置分类可重命名和排序，自定义分类可删除。</div></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">恢复默认分类</div><div class="setting-desc">恢复内置分类的名称与顺序，并移除自定义分类；应用的自动分类不受影响。</div></div>
          <div class="setting-control"><button class="ghost-btn" data-settings-action="categories-reset">恢复默认</button></div>
        </div>
      </div>
    </div>`;
}

function scanPanel(): string {
  const hiddenApps = state.settings.hidden
    .map((id) => appMap().get(id))
    .filter((app): app is AppEntry => Boolean(app));
  const sourceCounts = new Map<AppEntry["source"], number>();
  for (const app of state.apps) {
    sourceCounts.set(app.source, (sourceCounts.get(app.source) ?? 0) + 1);
  }
  const sourceRows = (Object.keys(SOURCE_LABELS) as AppEntry["source"][])
    .filter((key) => (sourceCounts.get(key) ?? 0) > 0)
    .map(
      (key) =>
        `<div class="scan-source-row"><span>${SOURCE_LABELS[key]}</span><span>${sourceCounts.get(
          key,
        )}</span></div>`,
    )
    .join("");
  const hiddenHtml =
    hiddenApps.length > 0
      ? `<div class="settings-section">
          <h3 class="settings-section-title">已隐藏的应用 · ${hiddenApps.length}</h3>
          <div class="settings-card"><div class="cat-list">${hiddenApps
            .map(
              (app) => `<div class="cat-row hidden-row">
                <span class="cat-dot" style="--cat-color:${categoryColor(
                  effectiveCategory(app),
                  state.settings.categories,
                )}"></span>
                <span class="cat-name">${escapeHtml(app.name)}</span>
                <button class="ghost-btn" data-settings-action="restore-hidden" data-app-id="${escapeHtml(
                  app.id,
                )}">恢复</button>
              </div>`,
            )
            .join("")}</div></div>
        </div>`
      : "";

  return `<div class="settings-section">
      <h3 class="settings-section-title">扫描范围</h3>
      <p class="settings-section-desc">决定收录哪些来源；切换开关后会自动重新扫描。</p>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">Microsoft Store 应用</div><div class="setting-desc">读取已注册的 UWP / Microsoft Store 应用。关闭后会跳过该来源。</div></div>
          <div class="setting-control"><button class="switch" role="switch" aria-checked="${
            state.settings.scanUwp
          }" data-settings-action="toggle" data-key="scanUwp" data-focus-key="toggle-scanUwp" aria-label="扫描 Microsoft Store 应用"></button></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">系统内置应用</div><div class="setting-desc">包含计算器、设置等系统 UWP 应用；关闭时只显示用户安装的应用。</div></div>
          <div class="setting-control"><button class="switch" role="switch" aria-checked="${
            state.settings.includeSystemApps
          }" data-settings-action="toggle" data-key="includeSystemApps" data-focus-key="toggle-includeSystemApps" aria-label="显示系统内置应用"></button></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">安装目录补充扫描</div><div class="setting-desc">额外扫描 Program Files 与 LocalAppData\Programs，找回没有快捷方式和注册表记录的绿色软件；只收录带版本信息的主程序，首次扫描会稍慢。</div></div>
          <div class="setting-control"><button class="switch" role="switch" aria-checked="${
            state.settings.scanInstallDirs
          }" data-settings-action="toggle" data-key="scanInstallDirs" data-focus-key="toggle-scanInstallDirs" aria-label="安装目录补充扫描"></button></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">自动刷新索引</div><div class="setting-desc">每次打开时检查缓存年龄；超过间隔就在后台重新扫描，不常驻后台。</div></div>
          <div class="setting-control"><div class="chips">${REFRESH_OPTIONS.map(
            (option) =>
              `<button class="chip${
                state.settings.autoRefreshHours === option.value ? " is-active" : ""
              }" data-settings-action="refresh" data-value="${option.value}" data-focus-key="refresh-${option.value}">${option.label}</button>`,
          ).join("")}</div></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">应用索引</div><div class="setting-desc">已收录 ${visibleApps().length} 个应用 · <span data-settings-scan-status>上次扫描 ${relativeTime(
            state.scannedAt,
          )}</span></div></div>
          <div class="setting-control"><button class="ghost-btn" data-settings-action="rescan" ${
            state.scanning ? "disabled" : ""
          }>${icon("refresh")}立即扫描</button></div>
        </div>
      </div>
      <p class="setting-desc" style="margin-top:8px;padding-left:4px">扫描读取开始菜单快捷方式、卸载注册表键值与 Store 应用清单；开启补充扫描时还会读取 Program Files 下 exe 的版本资源。不读取文件内容，也不发起网络请求。</p>
    </div>
    <div class="settings-section">
      <h3 class="settings-section-title">AI 自动分类</h3>
      <p class="settings-section-desc">让本地模型按应用名称与发布者归类；只处理没有手动调整过分类的应用，手动结果优先。</p>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">模型自动归类应用</div><div class="setting-desc">${
            state.aiClassifyBusy
              ? `正在处理 ${state.aiClassifyDone} / ${state.aiClassifyTotal} 个应用…`
              : state.aiInstalled
                ? "分类完全在本机完成，不联网；识别失败的应用保持原分类。"
                : "需要先安装「本地 AI 助手」，安装后即可离线分类。"
          }</div></div>
          <div class="setting-control"><button class="ghost-btn" data-settings-action="ai-classify" data-focus-key="ai-classify"${
            state.aiClassifyBusy ? " disabled" : ""
          }>${state.aiClassifyBusy ? "分类中…" : "开始分类"}</button></div>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <h3 class="settings-section-title">扫描来源</h3>
      <p class="settings-section-desc">共 ${state.apps.length} 个应用。开始菜单索引与任务栏搜索同源（shell:AppsFolder）；若某个应用缺失，请先在 Windows 开始菜单确认它是否可见，再回到这里重新扫描。</p>
      <div class="settings-card">
        <div class="scan-source-list">${
          sourceRows || `<div class="scan-source-row"><span>尚未扫描</span><span>0</span></div>`
        }</div>
      </div>
    </div>
    ${hiddenHtml}
    <div class="settings-section">
      <h3 class="settings-section-title">本地缓存</h3>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">图标与扫描缓存</div><div class="setting-desc">删除本地图标缓存，下次显示时按需重新提取；不会删除应用分类与偏好。</div></div>
          <div class="setting-control"><button class="ghost-btn" data-settings-action="clear-cache">清除缓存</button></div>
        </div>
      </div>
    </div>`;
}

const STARTUP_SOURCE_LABELS: Record<StartupSource, string> = {
  registry: "注册表 Run",
  runOnce: "注册表 RunOnce",
  policy: "组策略 Run",
  startupFolder: "启动文件夹",
  scheduledTask: "计划任务",
  service: "自动服务",
};

const STARTUP_SOURCE_ICONS: Record<StartupSource, string> = {
  registry: "power",
  runOnce: "refresh",
  policy: "shield",
  startupFolder: "folder",
  scheduledTask: "clock",
  service: "settings",
};

function startupSourceLabel(source: StartupSource): string {
  return STARTUP_SOURCE_LABELS[source] ?? "启动项";
}

function startupImpact(item: StartupItem): string {
  if (item.source === "scheduledTask") {
    return "登录或开机时由任务计划程序触发；启点只读展示，请在任务计划程序中修改。";
  }
  if (item.source === "service") {
    return "Windows 自动启动服务，开机即加载；启点只读展示，修改需要管理员权限。";
  }
  if (item.source === "runOnce") {
    return "一次性启动项，下次登录执行一次后会自动移除；启点只读展示。";
  }
  if (item.source === "policy") {
    return "由组策略或管理软件写入的启动项；启点只读展示。";
  }
  if (item.editable) {
    return "登录 Windows 后自动运行。关闭只取消自启动，不会卸载应用，之后仍可从启点打开。";
  }
  return "系统级启动项，所有用户共用。修改需要管理员权限，请在任务管理器或 Windows 设置中调整。";
}

function startupRow(item: StartupItem): string {
  const busy = state.startupBusyId === item.id;
  const scope = item.scope === "user" ? "当前用户" : "所有用户";
  const readOnly = !item.editable;
  const lockLabel = item.source === "registry" || item.source === "startupFolder" ? "系统级" : "只读";
  const toggleLabel = item.editable
    ? `${item.name} 的自启动，当前${item.enabled ? "已启用" : "已禁用"}，点击${
        item.enabled ? "禁用" : "启用"
      }`
    : `${item.name}，只读启动项，不可修改`;
  return `<div class="startup-row${item.enabled ? "" : " is-off"}">
    <div class="startup-symbol">${icon(STARTUP_SOURCE_ICONS[item.source] ?? "power")}</div>
    <div class="startup-copy">
      <div class="startup-head">
        <span class="startup-name">${escapeHtml(item.name)}</span>
        <span class="startup-source">${scope} · ${startupSourceLabel(item.source)}</span>
        ${item.recommendation === "disable" && item.enabled ? `<span class="startup-tag is-disable">建议关闭</span>` : ""}
        ${item.recommendation === "keep" ? `<span class="startup-tag is-keep">建议保留</span>` : ""}
        ${item.impact === "high" && item.enabled ? `<span class="startup-tag is-high">高影响</span>` : ""}
        ${readOnly ? `<span class="startup-lock">${icon("shield")}${lockLabel}</span>` : ""}
      </div>
      <div class="startup-command" title="${escapeHtml(item.command)}">${escapeHtml(item.command)}</div>
      <div class="startup-impact">${startupImpact(item)}</div>
    </div>
    <button class="switch" role="switch" aria-checked="${item.enabled}" aria-label="${escapeHtml(
      toggleLabel,
    )}" data-settings-action="startup-toggle" data-id="${escapeHtml(
      item.id,
    )}" data-focus-key="startup-${escapeHtml(item.id)}"${
      readOnly || busy ? " disabled" : ""
    }${readOnly ? ` title="只读项，请在 Windows 中修改"` : ""}></button>
  </div>`;
}

function processRow(item: ProcessItem): string {
  const info = describeProcess(item);
  const pending = state.pendingPidKill === item.pid;
  const detail =
    item.description && item.description !== info.title
      ? `${item.description}${item.company ? ` · ${item.company}` : ""}`
      : "同一应用的进程实例；结束它只影响这一份运行。";
  return `<div class="process-row${item.protected ? " is-protected" : ""}">
    <div class="process-row-main">
      <span class="process-row-name">${escapeHtml(item.name)}.exe</span>
      <span class="process-row-pid">PID ${item.pid}</span>
      <span class="process-row-memory">${formatMemory(item.memoryBytes)}</span>
      ${
        item.protected
          ? `<span class="process-lock-small">${icon("shield")}已保护</span>`
          : `<button class="mini-danger${pending ? " is-confirming" : ""}" data-settings-action="kill-process" data-pid="${
              item.pid
            }" data-focus-key="kill-pid-${item.pid}"${state.killing ? " disabled" : ""}>${
              pending ? "确认" : "结束"
            }</button>`
      }
    </div>
    <p class="process-row-explain">${escapeHtml(detail)}</p>
  </div>`;
}

function processGroupCard(group: ProcessGroup): string {
  const expanded = state.expandedGroups.has(group.key);
  const pending = state.pendingGroupKill === group.key;
  const locked = group.protectedGroup || group.level === "system";
  return `<article class="process-card risk-${group.level}">
    <div class="process-head">
      <div class="process-avatar">${icon("cpu")}</div>
      <div class="process-copy">
        <div class="process-title-row">
          <span class="process-title">${escapeHtml(group.title)}</span>
          <span class="risk-badge risk-${group.level}">${riskLabel(group.level)}</span>
        </div>
        <div class="process-meta">${group.items.length} 个进程 · ${formatMemory(
          group.memoryBytes,
        )}${
          group.publisher && group.publisher !== group.title
            ? ` · ${escapeHtml(group.publisher)}`
            : ""
        }</div>
        <p class="process-explain">${escapeHtml(group.explain)}</p>
        <button class="process-expand" data-settings-action="toggle-process-group" data-group="${escapeHtml(
          group.key,
        )}" data-focus-key="expand-${escapeHtml(group.key)}">
          ${icon("chevron-down", expanded ? "is-open" : "")}${expanded ? "收起进程" : "查看每个进程"}
        </button>
      </div>
      <div class="process-actions">
        ${
          locked
            ? `<span class="process-lock">${icon("shield")}已保护</span>`
            : `<button class="mini-danger${pending ? " is-confirming" : ""}" data-settings-action="kill-group" data-group="${escapeHtml(
                group.key,
              )}" data-focus-key="kill-group-${escapeHtml(group.key)}"${
                state.killing ? " disabled" : ""
              }>${pending ? "确认结束" : "结束应用"}</button>`
        }
      </div>
    </div>
    ${expanded ? `<div class="process-children">${group.items.map(processRow).join("")}</div>` : ""}
  </article>`;
}

function backgroundState(message: string, error = false): string {
  return `<div class="background-state${error ? " is-error" : ""}">${
    error ? icon("info") : '<span class="inline-spinner"></span>'
  }<div><p>${escapeHtml(message)}</p>${
    error
      ? `<button class="ghost-btn" data-settings-action="background-refresh">重新读取</button>`
      : ""
  }</div></div>`;
}

const STARTUP_IMPACT_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };
const STARTUP_SOURCE_ORDER: Record<string, number> = {
  registry: 0,
  runOnce: 1,
  policy: 2,
  startupFolder: 3,
  scheduledTask: 4,
  service: 5,
};

/** 切换排序只影响展示顺序，不改变启用状态。 */
function sortedStartupItems(): StartupItem[] {
  const items = [...state.startupItems];
  if (state.startupSort === "name") {
    return items.sort((a, b) => collator.compare(a.name, b.name));
  }
  if (state.startupSort === "source") {
    return items.sort((a, b) => {
      const sa = STARTUP_SOURCE_ORDER[a.source] ?? 9;
      const sb = STARTUP_SOURCE_ORDER[b.source] ?? 9;
      if (sa !== sb) return sa - sb;
      return collator.compare(a.name, b.name);
    });
  }
  // 影响优先：已启用的高影响项排最前，只读项后置。
  return items.sort((a, b) => {
    const wa = a.enabled ? (STARTUP_IMPACT_WEIGHT[a.impact] ?? 1) : 0;
    const wb = b.enabled ? (STARTUP_IMPACT_WEIGHT[b.impact] ?? 1) : 0;
    if (wa !== wb) return wb - wa;
    if (a.editable !== b.editable) return a.editable ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

function setStartupSort(mode: string): void {
  if (mode !== "impact" && mode !== "name" && mode !== "source") return;
  state.startupSort = mode;
  refreshActive();
}

function startupContent(): string {
  if (state.startupLoading && state.startupItems.length === 0) {
    return backgroundState("正在读取启动项…");
  }
  if (state.startupError) {
    return backgroundState(`读取启动项失败：${state.startupError}`, true);
  }
  if (state.startupItems.length === 0) {
    return `<div class="background-state">${icon("power")}<div><p>${
      state.startupAdvancedOk
        ? "没有发现注册表、启动文件夹、计划任务或自动服务中的自启动项。"
        : "只读到注册表与启动文件夹，计划任务和自动服务读取失败。"
    }</p></div></div>`;
  }
  const enabled = state.startupItems.filter((item) => item.enabled).length;
  const editable = state.startupItems.filter((item) => item.editable).length;
  const suggestCount = state.startupItems.filter(
    (item) => item.enabled && item.editable && item.recommendation === "disable",
  ).length;
  const countOf = (source: StartupSource) =>
    state.startupItems.filter((item) => item.source === source).length;
  const counts = {
    registry: countOf("registry"),
    runOnce: countOf("runOnce"),
    policy: countOf("policy"),
    startupFolder: countOf("startupFolder"),
    scheduledTask: countOf("scheduledTask"),
    service: countOf("service"),
  };
  const advancedWarning = state.startupAdvancedOk
    ? ""
    : `<div class="background-note is-warn">${icon("info")}<span>计划任务或自动服务读取失败，当前只显示注册表与启动文件夹；点右上角“刷新”重试。</span></div>`;
  const highImpact = state.startupItems.filter((item) => item.enabled && item.impact === "high").length;
  const keepCount = state.startupItems.filter(
    (item) => item.recommendation === "keep" && item.enabled,
  ).length;
  const sortOptions: { id: UiState["startupSort"]; label: string }[] = [
    { id: "impact", label: "影响优先" },
    { id: "name", label: "名称" },
    { id: "source", label: "来源" },
  ];
  return `<div class="background-summary">
      <span><strong>${enabled}</strong> / ${state.startupItems.length} 个已启用</span>
      <span class="${highImpact > 0 ? "is-warn" : ""}">${
        highImpact > 0 ? `${highImpact} 个高影响项` : "没有高影响项"
      }</span>
      <span>${suggestCount > 0 ? `${suggestCount} 个建议关闭` : "没有建议关闭项"}${
        keepCount > 0 ? ` · ${keepCount} 个建议保留` : ""
      }</span>
      <span>注册表 ${counts.registry} · 运行一次 ${counts.runOnce} · 组策略 ${counts.policy}</span>
      <span>启动文件夹 ${counts.startupFolder} · 计划任务 ${counts.scheduledTask} · 自动服务 ${counts.service}</span>
      <span>${editable} 个可在启点修改</span>
    </div>
    ${
      suggestCount > 0 || highImpact > 0
        ? `<div class="background-suggest">${icon("zap")}<div><strong>${
            suggestCount > 0 ? `建议关闭 ${suggestCount} 项` : `有 ${highImpact} 个高影响启动项`
          }</strong><span>更新器、游戏平台、云盘等不随登录启动也能正常工作；关闭只取消自启动，不卸载应用。</span></div>${
            suggestCount > 0
              ? `<button class="ghost-btn is-accent" data-settings-action="startup-close-suggest" data-focus-key="startup-close-suggest"${
                  state.startupBusyId ? " disabled" : ""
                }>${state.startupBusyId ? "处理中…" : "一键关闭建议项"}</button>`
              : ""
          }</div>`
        : ""
    }
    ${advancedWarning}
    <div class="background-guide">
      <div class="guide-head">${icon("power")}<strong>自启动是什么？</strong></div>
      <p>登录 Windows 后自动运行的程序，来源包括注册表 Run / RunOnce、启动文件夹、第三方计划任务和自动服务。关闭它只取消下次自动启动，不会卸载软件；系统级与只读项需要到 Windows 中修改。</p>
    </div>
    <div class="startup-sort">
      <span>排序</span>
      <div class="chips">${sortOptions
        .map(
          (option) =>
            `<button class="chip${state.startupSort === option.id ? " is-active" : ""}" data-settings-action="startup-sort" data-value="${option.id}" data-focus-key="startup-sort-${option.id}">${option.label}</button>`,
        )
        .join("")}</div>
    </div>
    <div class="startup-list">${sortedStartupItems().map(startupRow).join("")}</div>
    <div class="background-note">${icon("info")}<span>计划任务与自动服务为只读展示；Store 应用的启动项由系统管理，暂不在此列出。开关修改在下次登录时生效。</span></div>`;
}

function processContent(): string {
  if (state.processesLoading && state.processes.length === 0) {
    return backgroundState("正在读取运行中的进程…");
  }
  if (state.processesError) {
    return backgroundState(`读取进程失败：${state.processesError}`, true);
  }
  const groups = buildProcessGroups(state.processes);
  if (groups.length === 0) {
    return `<div class="background-state">${icon("cpu")}<div><p>当前没有可显示的进程。</p></div></div>`;
  }
  const totalMemory = state.processes.reduce((sum, item) => sum + item.memoryBytes, 0);
  const protectedGroups = groups.filter((group) => group.protectedGroup).length;
  return `<div class="background-guide">
      <div class="guide-head">${icon("info")}<strong>进程是什么？</strong></div>
      <p>进程就是正在运行的一次程序。一个软件可能开多个进程：主程序、标签页或插件、后台更新。结束子进程通常只影响对应功能，结束整组会退出整个应用。</p>
      <ul class="guide-list">
        <li><strong>可安全结束</strong>：浏览器、聊天、音乐等前台应用；结束前请保存正在编辑的内容。</li>
        <li><strong>谨慎结束</strong>：更新器、索引、云同步等后台工具；关闭后相应功能会暂时失效。</li>
        <li><strong>已保护</strong>：Windows 系统进程和启点界面依赖的进程，启点不允许误关。</li>
      </ul>
    </div>
    <div class="background-summary">
      <span>${state.processes.length} 个进程 · ${groups.length} 个应用 · 内存合计 ${formatMemory(
        totalMemory,
      )}</span>
      <span>${protectedGroups} 个受保护</span>
    </div>
    <div class="process-list">${groups.map(processGroupCard).join("")}</div>
    <div class="background-note">${icon("shield")}<span>结束进程会立即丢失未保存的内容，且不会卸载应用。系统进程和启点自身依赖的进程已被保护，不提供结束按钮。</span></div>`;
}

function backgroundPanel(): string {
  const enabled = state.startupItems.filter((item) => item.enabled).length;
  const groups = buildProcessGroups(state.processes);
  return `<div class="settings-section">
      <div class="background-head">
        <div>
          <h3 class="settings-section-title">启动与后台</h3>
          <p class="background-lead">管理登录自启动和正在运行的进程；只在本机操作，不联网。</p>
        </div>
        <button class="ghost-btn" data-settings-action="background-refresh" data-focus-key="background-refresh">${
          icon("refresh")
        }刷新</button>
      </div>
      <div class="chips background-tabs">
        <button class="chip${state.backgroundSection === "startup" ? " is-active" : ""}" data-settings-action="background-section" data-value="startup">自启动 ${
          state.startupLoading ? "…" : `${enabled} 已启用 / 共 ${state.startupItems.length}`
        }</button>
        <button class="chip${state.backgroundSection === "processes" ? " is-active" : ""}" data-settings-action="background-section" data-value="processes">运行中 ${
          state.processesLoading ? "…" : `${groups.length} 组 / ${state.processes.length} 个`
        }</button>
      </div>
    </div>
    ${state.backgroundSection === "startup" ? startupContent() : processContent()}`;
}

async function loadStartup(force = false): Promise<void> {
  if (state.startupLoading) return;
  state.startupLoading = true;
  state.startupError = null;
  refreshActive();
  try {
    const scan = await api.listStartup(force);
    state.startupItems = scan.items;
    state.startupAdvancedOk = scan.advancedOk;
  } catch (error) {
    state.startupError = String(error);
  } finally {
    state.startupLoading = false;
    refreshActive();
  }
}

async function loadProcesses(): Promise<void> {
  if (state.processesLoading) return;
  state.processesLoading = true;
  state.processesError = null;
  refreshActive();
  try {
    state.processes = await api.listProcesses();
  } catch (error) {
    state.processesError = String(error);
  } finally {
    state.processesLoading = false;
    refreshActive();
  }
}

function loadBackground(): void {
  if (state.workspace !== "background" || !moduleReady("background")) return;
  void loadStartup();
  void loadProcesses();
}

function armGroupKill(key: string): void {
  state.pendingGroupKill = key;
  state.pendingPidKill = null;
  refreshActive();
  window.setTimeout(() => {
    if (state.pendingGroupKill === key) {
      state.pendingGroupKill = null;
      refreshActive();
    }
  }, 4000);
}

function armPidKill(pid: number): void {
  state.pendingPidKill = pid;
  state.pendingGroupKill = null;
  refreshActive();
  window.setTimeout(() => {
    if (state.pendingPidKill === pid) {
      state.pendingPidKill = null;
      refreshActive();
    }
  }, 4000);
}

async function toggleStartup(item: StartupItem): Promise<void> {
  if (!item.editable || state.startupBusyId) return;
  state.startupBusyId = item.id;
  refreshActive();
  try {
    const scan = await api.setStartupEnabled(item.id, !item.enabled);
    state.startupItems = scan.items;
    state.startupAdvancedOk = scan.advancedOk;
    showToast(
      item.enabled
        ? `已关闭「${item.name}」的自启动，不会卸载应用`
        : `已恢复「${item.name}」的自启动`,
      "success",
    );
  } catch (error) {
    showToast(`修改启动项失败：${String(error)}`, "error");
  } finally {
    state.startupBusyId = null;
    refreshActive();
  }
}

/** 一键关闭「建议关闭」的启动项：只关可编辑、当前启用且被评估为建议关闭的项。 */
async function closeSuggestedStartup(): Promise<void> {
  if (state.startupBusyId) return;
  const targets = state.startupItems.filter(
    (item) => item.enabled && item.editable && item.recommendation === "disable",
  );
  if (targets.length === 0) {
    showToast("没有可关闭的建议项", "info");
    return;
  }
  state.startupBusyId = "__batch__";
  refreshActive();
  let done = 0;
  let failed = 0;
  for (const item of targets) {
    try {
      const scan = await api.setStartupEnabled(item.id, false);
      state.startupItems = scan.items;
      state.startupAdvancedOk = scan.advancedOk;
      done += 1;
    } catch {
      failed += 1;
    }
  }
  state.startupBusyId = null;
  refreshActive();
  showToast(
    `已关闭 ${done} 项建议项${failed > 0 ? `，${failed} 项失败` : ""}，可在下次登录生效`,
    failed > 0 ? "error" : "success",
  );
}

async function terminateGroup(key: string): Promise<void> {
  if (state.killing) return;
  const group = buildProcessGroups(state.processes).find((item) => item.key === key);
  if (!group || group.protectedGroup || group.level === "system") return;
  if (state.pendingGroupKill !== key) {
    armGroupKill(key);
    return;
  }
  state.pendingGroupKill = null;
  state.killing = true;
  refreshActive();
  try {
    const targets: ProcessTarget[] = group.items.map((item) => ({
      pid: item.pid,
      name: item.name,
    }));
    const report = await api.terminateProcesses(targets);
    if (report.terminated > 0) {
      showToast(`已结束「${group.title}」的 ${report.terminated} 个进程`, "success");
    }
    if (report.failed.length > 0) {
      showToast(
        `${report.failed.length} 个进程未能结束：${report.failed[0].error}`,
        "error",
      );
    }
    await loadProcesses();
  } catch (error) {
    showToast(`结束应用失败：${String(error)}`, "error");
  } finally {
    state.killing = false;
    refreshActive();
  }
}

async function terminateProcess(pid: number): Promise<void> {
  if (state.killing) return;
  const item = state.processes.find((process) => process.pid === pid);
  if (!item || item.protected) return;
  if (state.pendingPidKill !== pid) {
    armPidKill(pid);
    return;
  }
  state.pendingPidKill = null;
  state.killing = true;
  refreshActive();
  try {
    const targets: ProcessTarget[] = [{ pid: item.pid, name: item.name }];
    const report = await api.terminateProcesses(targets);
    if (report.terminated > 0) {
      showToast(`已结束 ${item.name}.exe（PID ${pid}）`, "success");
    }
    if (report.failed.length > 0) {
      showToast(`未能结束进程：${report.failed[0].error}`, "error");
    }
    await loadProcesses();
  } catch (error) {
    showToast(`结束进程失败：${String(error)}`, "error");
  } finally {
    state.killing = false;
    refreshActive();
  }
}

interface PowerPlanOption {
  guid: string;
  name: string;
  desc: string;
  /** 卓越性能：激活后 GUID 是系统新建的真实方案，按名称匹配当前档位。 */
  ultimate?: boolean;
}

const PERF_POWER_PLANS: PowerPlanOption[] = [
  {
    guid: "a1841308-3541-4fab-bc81-f71556f20b4a",
    name: "省电",
    desc: "降低性能，延长电池续航",
  },
  {
    guid: "381b4222-f694-41f0-9685-ff5bb260df2e",
    name: "均衡",
    desc: "性能与功耗平衡，推荐",
  },
  {
    guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
    name: "高性能",
    desc: "释放性能，增加耗电和发热",
  },
  {
    guid: "e9a42b02-d5df-448d-aa00-03f14749eb61",
    name: "卓越性能",
    desc: "Windows 隐藏的极致方案，最小化微延迟；首次启用会自动创建",
    ultimate: true,
  },
];

/// 一键清理覆盖的安全项：缓存、转储、临时目录与回收站。
/// 不含系统日志（可能用于排查问题）、事件日志、诊断转储与 Windows.old（体积大、需手动确认）。
const SAFE_CLEAN_IDS = [
  "userTemp",
  "windowsTemp",
  "systemTemp32",
  "updateCache",
  "prefetch",
  "d3dCache",
  "dxCache",
  "glCache",
  "inetCache",
  "transferCache",
  "wer",
  "werSystem",
  "crashDumps",
  "thumbnailCache",
  "chromeCache",
  "edgeCache",
  "braveCache",
  "firefoxCache",
  "teamsCache",
  "discordCache",
  "slackCache",
] as const;

const PERF_TEMP_DESCRIPTIONS: Record<string, string> = {
  userTemp: "应用运行时留下的临时文件；缓存类全部清理，被占用的自动安排重启后删除。",
  windowsTemp: "Windows 安装和更新临时文件；被占用的文件会自动安排重启后删除。",
  updateCache: "Windows 更新下载缓存，清理后不影响已安装的更新。",
  logs: "系统日志目录里超过保留天数的 .log 文件，删除不影响系统运行。",
  prefetch: "应用启动预读取缓存，删除后下次启动会重新生成。",
  d3dCache: "显卡着色器缓存，删除后游戏或应用首次启动会重新编译。",
  dxCache: "DirectX 渲染缓存，删除后自动重建。",
  glCache: "OpenGL 着色器缓存，删除后自动重建。",
  inetCache: "IE 与兼容性视图的网络缓存，删除后自动重建。",
  transferCache: "Windows 更新 P2P 传递缓存，常见几个 GB；清理后仍可正常更新。",
  wer: "用户级 Windows 崩溃报告，删除不影响系统和应用。",
  werSystem: "系统级 Windows 错误报告队列，删除不影响系统运行。",
  crashDumps: "应用崩溃时留下的转储文件，删除不影响应用运行。",
  minidump: "蓝屏小转储，仅在需要排查蓝屏时有用。",
  liveKernel: "内核实时转储，用于诊断驱动问题。",
  eventLogs: "系统事件日志 .evtx；排查故障时会用到，建议按保留期清理。",
  thumbnailCache: "资源管理器生成的缩略图与图标缓存，删除后会自动重建；被占用时会自动跳过。",
  systemTemp32: "32 位子系统临时目录，可安全清理。",
  chromeCache: "Chrome 各 profile 的 Cache / Code Cache / GPUCache，清理后首次打开网页稍慢。",
  edgeCache: "Edge 各 profile 的缓存目录，清理后首次打开网页稍慢。",
  braveCache: "Brave 浏览器缓存，未安装时自动跳过。",
  firefoxCache: "Firefox 各 profile 的 cache2 目录，清理后首次打开网页稍慢。",
  teamsCache: "Teams 桌面端缓存，清理后首次启动需重新加载数据。",
  discordCache: "Discord 缓存，清理后首次启动需重新加载头像与图片。",
  slackCache: "Slack 缓存，清理后首次启动需重新同步频道。",
  windowsOld: "升级 Windows 后遗留的旧系统，通常 10 GB 以上；删除后无法回滚到旧版本。",
  recycleBin: "清空后无法恢复；一键安全清理默认不包含回收站，请手动勾选。",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} 小时 ${minutes} 分钟`;
}

function formatPerfDate(value: number | null): string {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "—";
}

function perfMediaLabel(mediaType: string): string {
  const value = mediaType.toLowerCase();
  if (value === "ssd") return "SSD";
  if (value === "hdd") return "HDD";
  if (value.includes("scm")) return "SCM";
  return "磁盘";
}

function perfHealthLabel(health: string): { label: string; tone: string } {
  const value = health.toLowerCase();
  if (value === "healthy") return { label: "健康", tone: "ok" };
  if (value === "warning") return { label: "需注意", tone: "warn" };
  if (value === "unhealthy") return { label: "异常", tone: "bad" };
  return { label: "未知", tone: "muted" };
}

function perfState(message: string, error = false, action = "perf-refresh"): string {
  return `<div class="background-state${error ? " is-error" : ""}">${
    error ? icon("info") : '<span class="inline-spinner"></span>'
  }<div><p>${escapeHtml(message)}</p>${
    error
      ? `<button class="ghost-btn" data-settings-action="${action}">重试</button>`
      : ""
  }</div></div>`;
}

function performanceInstallCard(): string {
  const version = state.perfStatus?.availableVersion ?? "1.4.0";
  return `<div class="perf-install-card">
    <div class="perf-hero">
      <div class="perf-hero-icon">${icon("monitor")}</div>
      <div class="perf-hero-copy">
        <h3>系统体检</h3>
        <p>只体检不优化：健康评分、CPU 与磁盘状态、资源排行与趋势。安装前不运行、不常驻内存。</p>
      </div>
      <span class="perf-version">v${escapeHtml(version)}</span>
    </div>
    <div class="perf-feature-grid">
      <div class="perf-feature">${icon("monitor")}<div><strong>健康评分</strong><span>CPU、内存、磁盘、启动项综合评分与最近 7 天趋势。</span></div></div>
      <div class="perf-feature">${icon("hard-drive")}<div><strong>磁盘健康</strong><span>所有固定磁盘占用与物理磁盘健康、介质类型。</span></div></div>
      <div class="perf-feature">${icon("cpu")}<div><strong>资源排行</strong><span>0.3 秒采样，列出占用最高的进程与应用。</span></div></div>
    </div>
    <div class="perf-note">${icon("info")}<span>清理、一键优化、电源计划与 DNS 等优化动作已拆分到「系统优化」插件，避免把体检和优化混在一起。模块由启点主程序内置，点击安装时才写入本地模块清单，不联网、0 常驻内存。</span></div>
    <div class="perf-install-actions">
      <button class="primary-btn" data-settings-action="perf-install" data-focus-key="perf-install"${
        state.perfInstalling ? " disabled" : ""
      }>${state.perfInstalling ? "正在安装…" : "安装模块"}</button>
      <span>无需联网下载 · 0 后台进程</span>
    </div>
  </div>`;
}

function optimizeInstallCard(): string {
  const version = moduleStatus("optimize")?.version ?? "1.0.0";
  return `<div class="perf-install-card">
    <div class="perf-hero">
      <div class="perf-hero-icon">${icon("zap")}</div>
      <div class="perf-hero-copy">
        <h3>系统优化</h3>
        <p>集中所有主动优化动作：一键优化、临时文件清理、电源计划、DNS 与深层内存清理。安装前不运行、不常驻内存。</p>
      </div>
      <span class="perf-version">v${escapeHtml(version)}</span>
    </div>
    <div class="perf-feature-grid">
      <div class="perf-feature">${icon("shield")}<div><strong>一键优化</strong><span>51 项可撤销的系统策略，写入前先备份原值。</span></div></div>
      <div class="perf-feature">${icon("trash")}<div><strong>临时文件清理</strong><span>27 个位置：系统缓存、浏览器与聊天软件缓存、转储、Windows.old。</span></div></div>
      <div class="perf-feature">${icon("power")}<div><strong>电源计划</strong><span>省电、均衡、高性能与隐藏的卓越性能之间切换。</span></div></div>
      <div class="perf-feature">${icon("globe")}<div><strong>刷新 DNS</strong><span>处理域名解析异常，不影响网络配置。</span></div></div>
      <div class="perf-feature">${icon("cpu")}<div><strong>深层内存清理</strong><span>清空系统待机列表与已修改页面，不关闭应用。</span></div></div>
    </div>
    <div class="perf-note">${icon("info")}<span>参考 Winhance 的优化模块：优化动作与体检监控分开。被占用或权限不足的文件会自动取回所有权并安排重启后删除。点击安装只写入本地模块清单，不联网、0 常驻内存。</span></div>
    <div class="perf-install-actions">
      <button class="primary-btn" data-settings-action="opt-install" data-focus-key="opt-install"${
        state.optimizeInstalling ? " disabled" : ""
      }>${state.optimizeInstalling ? "正在安装…" : "安装模块"}</button>
      <span>无需联网下载 · 0 后台进程</span>
    </div>
  </div>`;
}

function performanceMetrics(): string {
  if (state.perfSystemLoading && !state.perfSystem) {
    return perfState("正在读取系统状态…");
  }
  if (state.perfSystemError) {
    return perfState(`系统体检失败：${state.perfSystemError}`, true);
  }
  if (!state.perfSystem) {
    return perfState("正在读取系统状态…");
  }
  const info = state.perfSystem;
  const memoryPercent = info.memory.totalBytes
    ? Math.min(100, (info.memory.usedBytes / info.memory.totalBytes) * 100)
    : 0;
  const cpuPercent = Math.min(100, Math.max(0, info.cpu.usagePercent));
  const diskPercent = info.disk.totalBytes
    ? Math.min(100, (info.disk.usedBytes / info.disk.totalBytes) * 100)
    : 0;
  const meterTone = (percent: number): string =>
    percent >= 90 ? " is-high" : percent >= 80 ? " is-warn" : "";
  const disks = info.disks.length > 0 ? info.disks : [info.disk];
  const diskFree = disks.reduce((sum, disk) => sum + disk.freeBytes, 0);
  const diskTotal = disks.reduce((sum, disk) => sum + disk.totalBytes, 0);
  const power = info.power;
  let advice = "";
  let adviceAction = "";
  if (cpuPercent >= 85) {
    advice = `CPU 占用较高（${Math.round(cpuPercent)}%），可查看下方资源排行或前往后台结束占用高的应用。`;
    adviceAction = backgroundAction("control-link", "打开后台管理 →");
  } else if (memoryPercent >= 80) {
    advice = `内存使用较高（${Math.round(memoryPercent)}%），可前往后台关闭暂时不用的应用。`;
    adviceAction = backgroundAction("control-link", "打开后台管理 →");
  } else if (diskPercent >= 90) {
    advice = `系统盘空间偏紧（已用 ${Math.round(diskPercent)}%），可用下方临时文件清理释放空间。`;
    adviceAction = `<button class="control-link" data-settings-action="perf-temp-scan" data-focus-key="perf-scan">扫描清理项 →</button>`;
  }
  return `<div class="perf-metrics">
      <div class="perf-metric">
        <div class="perf-metric-head">${icon("cpu")}<span>CPU</span><strong>${Math.round(
          cpuPercent,
        )}%</strong></div>
        <div class="perf-metric-value">${info.cpu.logical} 线程</div>
        <div class="perf-meter"><span style="width:${cpuPercent.toFixed(1)}%" class="${meterTone(cpuPercent)}"></span></div>
        <div class="perf-metric-sub" title="${escapeHtml(info.cpu.name)}">${escapeHtml(
          info.cpu.name,
        )}</div>
      </div>
      <div class="perf-metric">
        <div class="perf-metric-head">${icon("cpu")}<span>内存</span><strong>${Math.round(
          memoryPercent,
        )}%</strong></div>
        <div class="perf-metric-value">${formatBytes(info.memory.usedBytes)} / ${formatBytes(
          info.memory.totalBytes,
        )}</div>
        <div class="perf-meter"><span style="width:${memoryPercent.toFixed(1)}%" class="${meterTone(memoryPercent)}"></span></div>
        <div class="perf-metric-sub">可用 ${formatBytes(info.memory.freeBytes)}</div>
      </div>
      <div class="perf-metric">
        <div class="perf-metric-head">${icon("hard-drive")}<span>系统盘 ${escapeHtml(
          info.disk.drive,
        )}</span><strong>${Math.round(diskPercent)}%</strong></div>
        <div class="perf-metric-value">${formatBytes(info.disk.usedBytes)} / ${formatBytes(
          info.disk.totalBytes,
        )}</div>
        <div class="perf-meter"><span style="width:${diskPercent.toFixed(1)}%" class="${meterTone(diskPercent)}"></span></div>
        <div class="perf-metric-sub">可用 ${formatBytes(info.disk.freeBytes)}</div>
      </div>
      <div class="perf-metric">
        <div class="perf-metric-head">${icon("hard-drive")}<span>固定磁盘</span><strong>${
          disks.length
        } 块</strong></div>
        <div class="perf-metric-value">可用 ${formatBytes(diskFree)}</div>
        <div class="perf-metric-sub">共 ${formatBytes(diskTotal)} · 含系统盘</div>
      </div>
      <div class="perf-metric">
        <div class="perf-metric-head">${icon("power")}<span>电源计划</span></div>
        <div class="perf-metric-value">${escapeHtml(power.name)}</div>
        <div class="perf-metric-sub">${
          power.error ? escapeHtml(power.error) : "切换选项在下方，随时可恢复"
        }</div>
      </div>
      <div class="perf-metric">
        <div class="perf-metric-head">${icon("zap")}<span>自启动</span></div>
        <div class="perf-metric-value">${info.startupEnabled} / ${info.startupTotal} 已启用</div>
        ${backgroundAction("control-link perf-inline-link", "去后台管理 →")}
      </div>
    </div>
    <div class="perf-os-line">${icon("monitor")}<span>${escapeHtml(
      info.os.caption,
    )}${info.os.version ? ` ${escapeHtml(info.os.version)}` : ""}${
      info.os.build ? ` · 构建 ${escapeHtml(info.os.build)}` : ""
    } · 已运行 ${formatUptime(info.os.uptimeSeconds)}</span></div>
    ${advice ? `<div class="perf-advice">${icon("info")}<span>${escapeHtml(advice)}</span>${adviceAction}</div>` : ""}`;
}

function perfIssueAction(id: string): string {
  if (id === "memory" || id === "startup" || id === "cpu") {
    return backgroundAction(
      "control-link",
      id === "startup" ? "管理启动项 →" : "去后台管理 →",
    );
  }
  if (id === "disk") {
    return `<button class="control-link" data-settings-action="perf-temp-scan" data-focus-key="perf-scan">扫描清理项 →</button>`;
  }
  return "";
}

/** 把当前体检结果整理成可粘贴求助的纯文本报告。 */
function buildPerformanceReport(): string {
  const info = state.perfSystem;
  if (!info) return "";
  const percent = (used: number, total: number) =>
    total > 0 ? `${((used / total) * 100).toFixed(0)}%` : "—";
  const lines: string[] = [];
  lines.push(`启点 · 系统体检报告`);
  lines.push(`时间：${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(Date.now())}`);
  lines.push(`系统：${info.os.caption} ${info.os.version}（Build ${info.os.build}）`);
  lines.push(`运行时长：${Math.floor(info.os.uptimeSeconds / 3600)} 小时`);
  lines.push(`健康评分：${info.score} 分（${info.scoreLabel}）`);
  lines.push("");
  lines.push(`CPU：${info.cpu.name} · ${info.cpu.logical} 线程 · 占用 ${info.cpu.usagePercent}%`);
  lines.push(
    `内存：${formatBytes(info.memory.usedBytes)} / ${formatBytes(info.memory.totalBytes)}（${percent(
      info.memory.usedBytes,
      info.memory.totalBytes,
    )}）`,
  );
  for (const disk of info.disks) {
    lines.push(
      `磁盘 ${disk.drive}${disk.system ? "（系统盘）" : ""}：${formatBytes(
        disk.usedBytes,
      )} / ${formatBytes(disk.totalBytes)}（${percent(disk.usedBytes, disk.totalBytes)}）`,
    );
  }
  for (const physical of info.physicalDisks) {
    lines.push(
      `物理磁盘 ${physical.name}：${physical.mediaType || "未知介质"} · ${formatBytes(
        physical.sizeBytes,
      )} · 健康 ${physical.health || "未知"}`,
    );
  }
  lines.push(`启动项：${info.startupEnabled} / ${info.startupTotal} 项启用`);
  lines.push(`电源计划：${info.power.name}`);
  lines.push("");
  lines.push(info.issues.length > 0 ? "扣分项：" : "扣分项：无");
  for (const issue of info.issues) {
    lines.push(
      `· ${issue.title}${issue.points > 0 ? `（-${issue.points} 分）` : ""}：${issue.detail}`,
    );
  }
  if (info.hogs.length > 0) {
    lines.push("");
    lines.push("占用最高的进程：");
    for (const hog of [...info.hogs].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, 5)) {
      lines.push(
        `· ${hog.name}：内存 ${formatBytes(hog.memoryBytes)} · CPU ${hog.cpuPercent.toFixed(1)}%`,
      );
    }
  }
  lines.push("");
  lines.push(`累计清理：${formatBytes(info.cleanupTotalBytes)} · ${info.cleanupCount} 次`);
  return lines.join("\n");
}

async function copyPerformanceReport(): Promise<void> {
  const text = buildPerformanceReport();
  if (!text) {
    showToast("还没有体检数据，先刷新一次", "info");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("体检报告已复制到剪贴板，可直接粘贴给他人", "success");
  } catch (error) {
    showToast(`复制失败：${String(error)}`, "error");
  }
}

function performanceScoreCard(): string {
  const info = state.perfSystem;
  if (!info) return "";
  const circumference = 2 * Math.PI * 31;
  const offset = circumference * (1 - info.score / 100);
  const scoreTone = info.score >= 90 ? " is-good" : info.score >= 65 ? "" : " is-bad";
  const lost = info.issues.reduce((sum, issue) => sum + (issue.points ?? 0), 0);
  return `<div class="perf-score">
    <div class="perf-score-ring">
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle class="perf-score-track" cx="36" cy="36" r="31" />
        <circle class="perf-score-value${scoreTone}" cx="36" cy="36" r="31" stroke-dasharray="${circumference.toFixed(
          1,
        )}" stroke-dashoffset="${offset.toFixed(1)}" />
      </svg>
      <div class="perf-score-number"><strong>${info.score}</strong><small>分</small></div>
    </div>
    <div class="perf-score-copy">
      <div class="perf-score-title"><strong>${escapeHtml(info.scoreLabel)}</strong><span>性能体检${
        lost > 0 ? ` · 共扣 ${lost} 分` : ""
      }</span></div>
      <div class="perf-issues">${info.issues
        .map(
          (issue) => `<div class="perf-issue is-${escapeHtml(issue.severity)}">
            <span class="perf-issue-dot"></span>
            <div class="perf-issue-copy"><strong>${escapeHtml(issue.title)}</strong><small>${escapeHtml(
              issue.detail,
            )}</small></div>
            ${
              issue.points > 0
                ? `<span class="perf-issue-points" title="这一项扣掉的分数">-${issue.points}</span>`
                : ""
            }
            ${perfIssueAction(issue.id)}
          </div>`,
        )
        .join("")}</div>
    </div>
    <div class="perf-score-clean">累计清理 ${formatBytes(info.cleanupTotalBytes)}<span>${
      info.cleanupCount
    } 次 · ${info.lastCleanAt ? `上次 ${formatPerfDate(info.lastCleanAt)}` : "还没有清理记录"}</span></div>
  </div>`;
}

function perfDiskRow(disk: PerfDiskInfo): string {
  const percent = disk.totalBytes
    ? Math.min(100, (disk.usedBytes / disk.totalBytes) * 100)
    : 0;
  return `<div class="perf-disk-row">
    <div class="perf-disk-name"><strong>${escapeHtml(disk.drive)}</strong>${
      disk.system ? `<span class="perf-disk-tag">系统盘</span>` : ""
    }</div>
    <div class="perf-disk-bar"><div class="perf-meter"><span style="width:${percent.toFixed(
      1,
    )}%"></span></div></div>
    <div class="perf-disk-size"><strong>${Math.round(percent)}%</strong><span>${formatBytes(
      disk.freeBytes,
    )} 可用 / ${formatBytes(disk.totalBytes)}</span></div>
  </div>`;
}

function performanceDiskCard(): string {
  const info = state.perfSystem;
  if (!info) return "";
  const disks = info.disks.length > 0 ? info.disks : [info.disk];
  return `<div class="perf-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("hard-drive")}<div><strong>存储与磁盘健康</strong><p>逐个显示固定磁盘占用；物理磁盘信息每 7 天读取一次，不常驻后台。</p></div></div>
    </div>
    <div class="perf-disk-list">${disks.map(perfDiskRow).join("")}</div>
    ${
      info.physicalDisks.length > 0
        ? `<div class="perf-hardware-list">${info.physicalDisks
            .map((disk) => {
              const health = perfHealthLabel(disk.health);
              return `<div class="perf-hw-row">
                <span class="perf-hw-name" title="${escapeHtml(disk.name)}">${escapeHtml(
                  disk.name,
                )}</span>
                <span class="perf-hw-tag">${perfMediaLabel(disk.mediaType)}</span>
                <span class="perf-hw-health is-${health.tone}">${health.label}</span>
                <span class="perf-hw-size">${formatBytes(disk.sizeBytes)}</span>
              </div>`;
            })
            .join("")}</div>`
        : `<div class="perf-note">${icon("info")}<span>未能读取物理磁盘信息，部分虚拟机或精简系统不提供该接口；上面的分区占用仍可正常使用。</span></div>`
    }
  </div>`;
}

function perfHogRow(hog: PerfHog, index: number): string {
  return `<div class="perf-hog-row">
    <span class="perf-hog-rank">${index + 1}</span>
    <span class="perf-hog-name" title="${escapeHtml(hog.name)}">${escapeHtml(hog.name)}${
      hog.protected ? `<span class="perf-hog-protected">受保护</span>` : ""
    }</span>
    <span class="perf-hog-cpu"><i style="width:${Math.min(100, hog.cpuPercent)}%"></i><strong>${
      hog.cpuPercent
    }%</strong></span>
    <span class="perf-hog-mem">${formatBytes(hog.memoryBytes)}</span>
  </div>`;
}

function performanceHogsCard(): string {
  const hogs = state.perfSystem?.hogs ?? [];
  if (hogs.length === 0) return "";
  return `<div class="perf-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("cpu")}<div><strong>资源占用排行</strong><p>0.3 秒采样；CPU 为整机占比，进程内多线程占用已合并。结束进程请到后台管理。</p></div></div>
      ${backgroundAction("control-link", "去后台管理 →")}
    </div>
    <div class="perf-hog-list">${hogs.map(perfHogRow).join("")}</div>
  </div>`;
}

function performanceHistoryCard(): string {
  const info = state.perfSystem;
  if (!info) return "";
  const history = info.history;
  const cleans = info.recentCleans;
  if (history.length === 0 && cleans.length === 0) return "";
  const scores = history.map((point) => point.score);
  const min = scores.length > 0 ? Math.min(...scores) : 0;
  const max = scores.length > 0 ? Math.max(...scores) : 0;
  const latest = scores.length > 0 ? scores[scores.length - 1] : 0;
  const width = 600;
  const height = 88;
  const points =
    history.length >= 2
      ? history
          .map((point, index) => {
            const x = (index / (history.length - 1)) * width;
            const span = Math.max(1, max - min);
            const y = height - 10 - ((point.score - min) / span) * (height - 20);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ")
      : "";
  return `<div class="perf-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("zap")}<div><strong>体检趋势与清理记录</strong><p>每天记录一次评分，最多保留 30 天；清理记录保留最近 10 次。</p></div></div>
    </div>
    <div class="perf-history-grid">
      <div class="perf-history-main">
        ${
          points
            ? `<svg class="perf-history-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" vector-effect="non-scaling-stroke" /></svg>`
            : `<div class="perf-history-empty">评分点不足，明天再打开性能页就能看到趋势。</div>`
        }
        <div class="perf-history-meta"><span>${
          points ? `最近 ${history.length} 天` : "趋势"
        }</span><span>${points ? `最低 ${min} · 最高 ${max} · 最新 ${latest}` : ""}</span></div>
      </div>
      <div class="perf-clean-list">
        ${
          cleans.length > 0
            ? cleans
                .slice(0, 5)
                .map(
                  (record) =>
                    `<div class="perf-clean-row"><span>${formatPerfDate(record.at)}</span><strong>${formatBytes(
                      record.freedBytes,
                    )}</strong><small>${record.files} 个文件</small></div>`,
                )
                .join("")
            : `<div class="perf-clean-empty">还没有清理记录</div>`
        }
      </div>
    </div>
  </div>`;
}

function performanceSafeClean(): string {
  const pending = state.perfPendingClean === "safe";
  const last = state.perfLastClean;
  return `<div class="perf-card perf-safe-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("zap")}<div><strong>安全清理</strong><p>一键清理 21 项：系统临时目录、更新与 P2P 缓存、浏览器与聊天软件缓存、各类转储、缩略图缓存，并刷新 DNS。不含回收站与系统日志，不结束应用、不改启动项或电源计划。</p></div></div>
      <button class="primary-btn perf-safe-btn" data-settings-action="perf-clean-safe" data-focus-key="perf-safe-clean"${
        state.perfTempBusy ? " disabled" : ""
      }>${state.perfTempBusy ? "正在清理…" : pending ? "确认安全清理" : "一键安全清理"}</button>
    </div>
    ${
      last
        ? `<div class="perf-result">${icon("check")}<span>已释放 ${formatBytes(
            last.freedBytes,
          )} · ${last.files} 个文件${last.failed > 0 ? ` · ${last.failed} 项未能清理` : ""}</span></div>`
        : ""
    }
    <div class="perf-note">${icon("info")}<span>一键清理覆盖 21 项缓存与临时目录，但保留回收站、系统日志、蓝屏与内核转储、Windows.old，这些请在下方临时文件清理中手动勾选。被占用或无权限的文件会取回所有权重试，仍占用则安排重启后删除。</span></div>
  </div>`;
}

const OPTIMIZE_STATE_LABEL: Record<string, { label: string; tone: string }> = {
  applied: { label: "已优化", tone: "ok" },
  default: { label: "默认", tone: "muted" },
  custom: { label: "外部设置", tone: "warn" },
  unknown: { label: "读取受限", tone: "muted" },
};

/** 优化项类别筛选与 DNS 预设档位。 */
type OptimizeCategory = "all" | "privacy" | "performance" | "services" | "updates";
type DnsPresetId = "auto" | "ali" | "tencent" | "google" | "cloudflare";

interface OptimizeSummary {
  applied: number;
  immediate: number;
  explorer: number;
  restart: number;
  relogin: number;
}

const OPT_CATEGORIES: { id: OptimizeCategory; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "privacy", label: "隐私" },
  { id: "performance", label: "性能" },
  { id: "services", label: "服务" },
  { id: "updates", label: "更新" },
];

/** 网络优化 DNS 预设，与 Rust 端 network.rs 保持一致。 */
const OPT_DNS_PRESETS: { id: DnsPresetId; label: string; primary?: string; secondary?: string }[] = [
  { id: "auto", label: "自动获取" },
  { id: "ali", label: "阿里", primary: "223.5.5.5", secondary: "223.6.6.6" },
  { id: "tencent", label: "腾讯", primary: "119.29.29.29", secondary: "119.28.28.28" },
  { id: "google", label: "Google", primary: "8.8.8.8", secondary: "8.8.4.4" },
  { id: "cloudflare", label: "Cloudflare", primary: "1.1.1.1", secondary: "1.0.0.1" },
];

function optimizeValueLine(item: OptimizeItem): string {
  return item.values
    .map((value) => {
      if (value.error) {
        return `${value.hive}\\${value.path}\\${value.name} 读取受限`;
      }
      const current = value.current === null ? "未设置" : String(value.current);
      return `${value.hive}\\${value.path}\\${value.name} = ${value.target}（当前 ${current}）`;
    })
    .join(" · ");
}

function optimizeRow(item: OptimizeItem): string {
  const selected = state.perfOptimizeSelected.has(item.id);
  const status = item.available
    ? (OPTIMIZE_STATE_LABEL[item.state] ?? OPTIMIZE_STATE_LABEL.custom)
    : { label: "不适用", tone: "muted" };
  const valueLine = item.available
    ? optimizeValueLine(item)
    : (item.unavailableReason ?? "当前系统不适用");
  const selectable = item.available && item.state !== "unknown" && item.state !== "applied";
  return `<div class="perf-opt-row${selected ? " is-selected" : ""}${
    item.available ? "" : " is-unavailable"
  }">
    <button class="perf-check" role="checkbox" aria-checked="${selected}" aria-label="选择 ${escapeHtml(
      item.name,
    )}" data-settings-action="perf-opt-toggle" data-id="${escapeHtml(item.id)}"${
      state.perfOptimizeBusy || !selectable ? " disabled" : ""
    }>${icon("check")}</button>
    <div class="perf-opt-copy">
      <div class="perf-opt-name">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="perf-opt-tag is-${status.tone}">${status.label}</span>
      </div>
      <div class="perf-opt-desc">${escapeHtml(item.description)}</div>
      <div class="perf-opt-meta">
        ${item.available ? `<span>${escapeHtml(item.applies)}</span>` : ""}
        ${item.requiresAdmin ? `<span>需管理员</span>` : ""}
        ${item.backedUp ? `<span>已备份原值</span>` : ""}
      </div>
      <div class="perf-opt-path" title="${escapeHtml(valueLine)}">${escapeHtml(valueLine)}</div>
    </div>
    ${
      item.backedUp
        ? `<button class="ghost-btn perf-opt-restore" data-settings-action="perf-opt-restore" data-id="${escapeHtml(
            item.id,
          )}"${state.perfOptimizeBusy ? " disabled" : ""} data-focus-key="perf-opt-restore-${escapeHtml(
            item.id,
          )}">还原</button>`
        : ""
    }
  </div>`;
}

/** 最近一次一键优化的结果摘要条（可关闭），应用成功后的生效时机一目了然。 */
function optimizeSummaryHtml(): string {
  const summary = state.perfOptimizeSummary;
  if (!summary) return "";
  const parts: string[] = [];
  if (summary.immediate > 0) parts.push(`${summary.immediate} 项立即生效`);
  if (summary.explorer > 0) parts.push(`${summary.explorer} 项需重启资源管理器`);
  if (summary.relogin > 0) parts.push(`${summary.relogin} 项需重新登录`);
  if (summary.restart > 0) parts.push(`${summary.restart} 项需重启生效`);
  const empty = summary.applied === 0;
  return `<div class="perf-opt-result${empty ? " is-muted" : ""}">
    ${icon("check")}
    <div>
      <strong>${empty ? "没有项目被改动" : `已应用 ${summary.applied} 项，开始生效`}</strong>
      <span>${
        empty
          ? "所选项目已处于优化状态、当前系统不适用或被跳过"
          : (parts.length > 0 ? parts.join(" · ") : "全部立即生效")
      }</span>
    </div>
    <button class="ghost-btn is-quiet" data-settings-action="perf-opt-summary-dismiss" data-focus-key="perf-opt-summary-dismiss" aria-label="关闭提示">${icon("close")}</button>
  </div>`;
}

function performanceOptimizeCard(): string {
  if (state.perfOptimizeError) {
    return perfState(`读取优化项失败：${state.perfOptimizeError}`, true, "perf-opt-refresh");
  }
  if (state.perfOptimizeLoading && state.perfOptimize.length === 0) {
    return perfState("正在读取系统优化项…", false, "perf-opt-refresh");
  }
  const items = state.perfOptimize;
  if (items.length === 0) return "";
  const selected = items.filter((item) => state.perfOptimizeSelected.has(item.id));
  const backed = items.filter((item) => item.backedUp);
  const hasAdmin = selected.some((item) => item.requiresAdmin);
  const pending = state.perfOptimizePending === "apply";
  const restorePending = state.perfOptimizePending === "restoreAll";
  const smartCount = items.filter(
    (item) =>
      item.available &&
      item.state !== "applied" &&
      item.state !== "unknown" &&
      (item.group === "safe" || SMART_EXTRA_IDS.has(item.id)),
  ).length;
  const groups = [
    { id: "safe", title: "安全项", note: "不改变系统功能，随时可还原" },
    { id: "advanced", title: "进阶项", note: "会关闭部分系统功能，按需选择" },
  ];
  const category = state.perfOptCategory;
  // 类别筛选只影响列表显示，勾选、计数与智能优化始终按全部项目计算。
  const visible = category === "all" ? items : items.filter((item) => item.category === category);
  const summary = optimizeSummaryHtml();
  const categoryChips = `<div class="chips perf-opt-cats">${OPT_CATEGORIES.map((option) => {
    const count =
      option.id === "all"
        ? items.length
        : items.filter((item) => item.category === option.id).length;
    return `<button class="chip${state.perfOptCategory === option.id ? " is-active" : ""}" data-settings-action="perf-opt-category" data-value="${option.id}" data-focus-key="perf-opt-cat-${option.id}">${option.label}<span class="chips-count">${count}</span></button>`;
  }).join("")}</div>`;
  return `<div class="perf-card perf-opt-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("zap")}<div><strong>一键优化（可撤销）</strong><p>每项写入前先备份原值，写入后回读校验，可单项或全部还原。系统级项目需要管理员权限。</p></div></div>
      <div class="perf-card-actions">
        <button class="primary-btn perf-opt-btn" data-settings-action="perf-opt-smart" data-focus-key="perf-opt-smart"${
          state.perfOptimizeBusy || smartCount === 0 ? " disabled" : ""
        }>${
          state.perfOptimizeBusy
            ? "正在优化…"
            : pending
              ? `确认智能优化 ${smartCount} 项`
              : "智能优化"
        }</button>
      </div>
    </div>
    <div class="perf-opt-toolbar">
      <span>勾选下面的项目后手动应用，或直接使用上方的「智能优化」。</span>
      <div>
        <button class="ghost-btn" data-settings-action="perf-opt-select-safe"${
          state.perfOptimizeBusy ? " disabled" : ""
        }>选中推荐项</button>
        <button class="primary-btn perf-opt-btn" data-settings-action="perf-opt-apply" data-focus-key="perf-opt-apply"${
          state.perfOptimizeBusy || selected.length === 0 ? " disabled" : ""
        }>${
          state.perfOptimizeBusy
            ? "正在应用…"
            : pending
              ? `确认应用 ${selected.length} 项`
              : `应用选中项（${selected.length}）`
        }</button>
      </div>
    </div>
    ${summary}
    ${categoryChips}
    ${groups
      .map((group) => {
        const list = visible.filter((item) => item.group === group.id);
        if (list.length === 0) return "";
        return `<div class="perf-opt-group">
          <div class="perf-opt-group-head"><strong>${group.title}</strong><span>${group.note}</span></div>
          <div class="perf-opt-list">${list.map(optimizeRow).join("")}</div>
        </div>`;
      })
      .join("")}
    ${
      visible.length === 0
        ? `<div class="perf-empty-inline">${icon("info")}<span>该类别下没有优化项目，请切换到其它类别。</span></div>`
        : ""
    }
    <div class="perf-opt-foot">
      <span>${
        backed.length > 0 ? `已记录 ${backed.length} 项的原始值，可随时还原` : "还没有应用任何优化项"
      }${hasAdmin ? " · 系统级项目需要管理员权限" : ""}</span>
      ${
        backed.length > 0
          ? `<button class="ghost-btn${restorePending ? " is-confirming" : ""}" data-settings-action="perf-opt-restore-all" data-focus-key="perf-opt-restore-all"${
              state.perfOptimizeBusy ? " disabled" : ""
            }>${restorePending ? "确认全部还原" : "全部还原"}</button>`
          : ""
      }
    </div>
    <div class="perf-note">${icon("info")}<span>只修改策略键，不卸载组件、不关闭服务，也不改文件权限。每项写入后都会回读校验，读回值不一致会自动回滚，不会只改界面；标注「不适用」的项目在当前系统版本上不会被系统读取。还原只写回被启点备份过的值。</span></div>
  </div>`;
}

function performanceTempCategory(row: PerfTempCategory): string {
  const selected = state.perfTempSelected.has(row.id);
  const disabled = !row.accessible || row.bytes === 0;
  const description = PERF_TEMP_DESCRIPTIONS[row.id] ?? "临时文件目录。";
  return `<div class="perf-temp-row${row.accessible ? "" : " is-unavailable"}">
    <button class="perf-check" role="checkbox" aria-checked="${selected}" aria-label="选择 ${escapeHtml(
      row.name,
    )}" data-settings-action="perf-toggle-category" data-category="${row.id}"${
      disabled ? " disabled" : ""
    }>${icon("check")}</button>
    <div class="perf-temp-copy">
      <div class="perf-temp-name">${escapeHtml(row.name)}</div>
      <div class="perf-temp-desc">${escapeHtml(description)}</div>
      <div class="perf-temp-path" title="${escapeHtml(row.path)}">${escapeHtml(row.path || "路径不可用")}</div>
      ${
        row.accessible
          ? ""
          : `<div class="perf-temp-error">${icon("info")}${escapeHtml(
              row.error || "目录不可访问，可能需要管理员权限",
            )}</div>`
      }
    </div>
    <div class="perf-temp-size">
      <strong>${row.accessible ? formatBytes(row.bytes) : "—"}</strong>
      <span>${row.accessible ? `${row.files} 个文件` : "不可访问"}</span>
    </div>
  </div>`;
}

function performanceTempCard(): string {
  const scan = state.perfTempScan;
  const selected = scan?.categories.filter(
    (category) => state.perfTempSelected.has(category.id) && category.accessible,
  ) ?? [];
  const selectedBytes = selected.reduce((sum, category) => sum + category.bytes, 0);
  const pending = state.perfPendingClean === "selected";
  return `<div class="perf-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("trash")}<div><strong>临时文件清理</strong><p>27 个清理位置：系统临时文件、更新缓存、浏览器与聊天软件缓存、转储与旧系统目录。缓存类不受保留期限制，删掉会自动重建。</p></div></div>
      <div class="perf-card-actions">
        <div class="chips perf-day-chips">${[7, 30, 90]
          .map(
            (days) =>
              `<button class="chip${state.perfTempDays === days ? " is-active" : ""}" data-settings-action="perf-temp-days" data-value="${days}" data-focus-key="perf-days-${days}">${days} 天</button>`,
          )
          .join("")}</div>
        <button class="ghost-btn" data-settings-action="perf-temp-scan" data-focus-key="perf-scan"${
          state.perfTempLoading ? " disabled" : ""
        }>${state.perfTempLoading ? "扫描中…" : "扫描"}</button>
      </div>
    </div>
    ${
      state.perfTempError
        ? perfState(`扫描失败：${state.perfTempError}`, true, "perf-temp-scan")
        : state.perfTempLoading && !scan
          ? perfState("正在扫描临时文件…")
          : scan
            ? `<div class="perf-scan-summary"><span>共发现 <strong>${formatBytes(
                scan.totalBytes,
              )}</strong> · ${scan.totalFiles} 个文件 · 日志按 ${scan.days} 天，缓存与转储全部清理，回收站按全部</span><span>${selected.length} 项已选择</span></div>
              <div class="perf-temp-list">${scan.categories
                .map(performanceTempCategory)
                .join("")}</div>
              <div class="perf-clean-actions">
                <span>选中 ${formatBytes(selectedBytes)}${scan.totalFiles === 0 ? " · 当前没有可清理文件" : ""}</span>
                <button class="mini-danger${pending ? " is-confirming" : ""}" data-settings-action="perf-clean-selected" data-focus-key="perf-clean-selected"${
                  state.perfTempBusy || selected.length === 0 ? " disabled" : ""
                }>${state.perfTempBusy ? "清理中…" : pending ? "确认清理" : "清理选中"}</button>
              </div>`
            : `<div class="perf-empty-scan">${icon("info")}<span>点击“扫描”查看可清理内容。日志按 ${state.perfTempDays} 天保留，缓存、转储与 Windows.old 会全部计入。扫描只读，不会删除任何内容。</span></div>`
    }
  </div>`;
}

/** 磁盘空间分析：C 盘顶层目录占用排行（“空间去哪了”）。 */
function performanceUsageCard(): string {
  const scan = state.diskUsage;
  return `<div class="perf-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("hard-drive")}<div><strong>磁盘空间分析</strong><p>找出系统盘里真正占用空间的大目录，再决定清理什么。</p></div></div>
      <button class="ghost-btn" data-settings-action="perf-disk-scan" data-focus-key="perf-disk-scan"${
        state.diskUsageLoading ? " disabled" : ""
      }>${state.diskUsageLoading ? "分析中…" : scan ? "重新分析" : "分析"}</button>
    </div>
    ${
      state.diskUsageError
        ? perfState(`磁盘分析失败：${state.diskUsageError}`, true, "perf-disk-scan")
        : state.diskUsageLoading && !scan
          ? perfState("正在统计目录占用，大容量磁盘可能需要一点时间…")
          : scan
            ? `<div class="perf-scan-summary"><span>${escapeHtml(
                scan.drive,
              )} 盘已用 <strong>${formatBytes(scan.usedBytes)}</strong> / ${formatBytes(
                scan.totalBytes,
              )}</span><span>按占用从大到小</span></div>
              <div class="perf-disk-list">${scan.entries
                .slice(0, 12)
                .map((entry) => {
                  const width = scan.usedBytes
                    ? Math.max(2, Math.min(100, (entry.bytes / scan.usedBytes) * 100))
                    : 0;
                  return `<div class="perf-disk-row" title="${escapeHtml(entry.path)}">
                    <div class="perf-disk-name">${escapeHtml(entry.name)}<span>${formatBytes(
                      entry.bytes,
                    )}</span></div>
                    <div class="perf-meter perf-disk-meter"><span style="width:${width.toFixed(1)}%"></span></div>
                  </div>`;
                })
                .join("")}</div>
              <div class="perf-note">${icon("info")}<span>只统计顶层目录，不会改动任何文件。看到 Windows.old、hiberfil.sys 占大头时，可在上方临时文件清理中勾选对应项，或到电源设置关闭休眠释放 hiberfil.sys。</span></div>`
            : perfState("点击“分析”查看系统盘被什么占用了。分析只读，不会删除任何文件。")
    }
  </div>`;
}

async function loadDiskUsage(): Promise<void> {
  if (!moduleReady("optimize") || state.diskUsageLoading) return;
  state.diskUsageLoading = true;
  state.diskUsageError = null;
  refreshActive();
  try {
    state.diskUsage = await api.performanceDiskUsage();
  } catch (error) {
    state.diskUsageError = String(error);
  } finally {
    state.diskUsageLoading = false;
    refreshActive();
  }
}

function performancePowerCard(): string {
  const power = state.optPower;
  const current = power?.guid ?? "";
  const currentName = power?.name ?? "读取中";
  return `<div class="perf-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("power")}<div><strong>电源计划</strong><p>当前：${escapeHtml(
        currentName,
      )}。高性能与卓越性能会增加耗电和发热，笔记本建议均衡或省电。</p></div></div>
    </div>
    <div class="perf-power-options">${PERF_POWER_PLANS.map((plan) => {
      // 卓越性能激活后 GUID 是系统新建的真实方案，按名称匹配当前档位。
      const active =
        current.toLowerCase() === plan.guid ||
        (plan.ultimate && currentName.includes("卓越性能"));
      return `<button class="perf-power-option${active ? " is-active" : ""}" aria-pressed="${active}" data-settings-action="perf-power" data-guid="${
        plan.guid
      }" data-focus-key="perf-power-${plan.guid}"${
        state.perfPowerBusy ? " disabled" : ""
      }>
        <span class="perf-power-name">${plan.name}${active ? `<span class="perf-current">当前</span>` : ""}</span>
        <span class="perf-power-desc">${plan.desc}</span>
      </button>`;
    }).join("")}</div>
    <div class="perf-note">${icon("info")}<span>切换使用 Windows 自带的 powercfg，操作后立即生效；可随时切回均衡。卓越性能是系统隐藏方案，首次启用会自动创建；部分设备可能没有高性能计划。</span></div>
  </div>`;
}

function dnsPresetName(id: string): string {
  return OPT_DNS_PRESETS.find((option) => option.id === id)?.label ?? id;
}

function networkDiagHtml(): string {
  const report = state.optDiag;
  if (!report) return "";
  const okCount = report.probes.filter((probe) => probe.ok).length;
  const allOk = okCount === report.probes.length;
  return `<div class="perf-diag is-${allOk ? "ok" : "warn"}">
    <div class="perf-diag-head">${icon(allOk ? "check" : "info")}<span>${
      allOk ? "网络基本正常，可以正常上网" : `${okCount}/${report.probes.length} 项正常，部分目标不可达`
    }</span></div>
    <div class="perf-diag-list">${report.probes
      .map(
        (probe) =>
          `<div class="perf-diag-row${probe.ok ? "" : " is-fail"}">
        <span class="perf-diag-name">${escapeHtml(probe.label)}</span>
        <span class="perf-diag-value">${
          probe.target === "resolve"
            ? probe.ok
              ? "解析成功"
              : "解析失败"
            : probe.ok && probe.ms !== null
              ? `${probe.ms} ms`
              : "超时/失败"
        }</span>
      </div>`,
      )
      .join("")}</div>
  </div>`;
}

function performanceNetworkCard(): string {
  const dns = state.optDns;
  const backup = dns?.backup ?? null;
  const activePreset = backup?.preset ?? null;
  const busy = state.optDnsBusy || state.perfDnsBusy;
  const addr =
    dns && dns.interfaces.length > 0
      ? dns.interfaces
          .map(
            (iface) =>
              `${escapeHtml(iface.alias) || `接口 ${iface.index}`}：${iface.servers.join(" / ")}`,
          )
          .join("；")
      : "";
  const applyLabel =
    state.optDnsPreset === "auto"
      ? activePreset !== null
        ? "恢复自动获取"
        : "当前已是自动获取"
      : `应用${dnsPresetName(state.optDnsPreset)}`;
  return `<div class="perf-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("globe")}<div><strong>网络优化</strong><p>网页打不开或解析异常时先点「网络诊断」；需要稳定 DNS 时选定档位一键切换，随时可还原。切换需要管理员权限。</p></div></div>
      <button class="ghost-btn" data-settings-action="perf-dns" data-focus-key="perf-dns"${
        state.perfDnsBusy ? " disabled" : ""
      }>${state.perfDnsBusy ? "刷新中…" : "刷新 DNS 缓存"}</button>
    </div>
    <div class="perf-dns">
      <div class="perf-dns-head">
        <span>当前 DNS${activePreset ? `：${dnsPresetName(activePreset)}（已切换，可还原）` : ""}</span>
        ${
          activePreset
            ? `<button class="ghost-btn is-accent" data-settings-action="perf-dns-restore" data-focus-key="perf-dns-restore"${
                busy ? " disabled" : ""
              }>${state.optDnsBusy ? "还原中…" : "还原 DNS"}</button>`
            : `<span class="perf-dns-default">${state.optDnsLoading ? "读取中…" : "DHCP 自动获取"}</span>`
        }
      </div>
      <div class="perf-dns-addr">${
        state.optDnsLoading
          ? ""
          : state.optDnsError
            ? `<span class="perf-dns-err">${escapeHtml(state.optDnsError)}</span>`
            : addr
      }</div>
      <div class="perf-dns-presets">${OPT_DNS_PRESETS.map((option) => {
        const active = state.optDnsPreset === option.id;
        return `<button class="perf-power-option${active ? " is-active" : ""}" aria-pressed="${active}" data-settings-action="perf-dns-preset" data-value="${option.id}" data-focus-key="perf-dns-preset-${option.id}"${
          busy ? " disabled" : ""
        }>
          <span class="perf-power-name">${option.label}${active ? '<span class="perf-current">当前</span>' : ""}</span>
          <span class="perf-power-desc">${
            option.primary ? `${option.primary} · ${option.secondary}` : "使用路由器分配的 DNS"
          }</span>
        </button>`;
      }).join("")}</div>
      <div class="perf-dns-actions">
        <button class="primary-btn" data-settings-action="perf-dns-apply" data-focus-key="perf-dns-apply"${
          busy || (state.optDnsPreset === "auto" && activePreset === null) ? " disabled" : ""
        }>${state.optDnsBusy ? "切换中…" : applyLabel}</button>
        <button class="ghost-btn" data-settings-action="perf-dns-diag" data-focus-key="perf-dns-diag"${
          state.optDiagBusy ? " disabled" : ""
        }>${state.optDiagBusy ? "诊断中…" : "网络诊断"}</button>
      </div>
      ${state.optDiag ? networkDiagHtml() : ""}
    </div>
    <div class="perf-note">${icon("info")}<span>切换前会备份当前配置，原配置随时可还原；诊断只发探测包、不改设置。切换或诊断后建议点「刷新 DNS 缓存」让新地址立即生效。</span></div>
  </div>`;
}

function performanceModuleFooter(): string {
  const status = state.perfStatus;
  if (!status) return "";
  const pending = state.perfPendingUninstall;
  return `<div class="perf-module-footer">
    <div class="perf-module-info">${icon("box")}<div><strong>体检模块 v${escapeHtml(
      status.installedVersion ?? status.availableVersion,
    )}</strong><span>安装于 ${formatPerfDate(status.installedAt)} · 模块清单 ${formatBytes(
      status.sizeBytes,
    )} · 功能代码随主程序内置 · 0 常驻内存</span><span class="perf-module-path" title="${escapeHtml(
      status.path ?? "",
    )}">${escapeHtml(status.path ?? "")}</span></div></div>
    <button class="mini-danger${pending ? " is-confirming" : ""}" data-settings-action="perf-uninstall" data-focus-key="perf-uninstall"${
      state.perfUninstalling ? " disabled" : ""
    }>${state.perfUninstalling ? "卸载中…" : pending ? "确认卸载" : "卸载模块"}</button>
    <div class="perf-uninstall-note">卸载只会删除模块清单和状态，体检评分与历史记录保留；已应用的优化项归属「系统优化」插件，不受影响。</div>
  </div>`;
}

function optimizeModuleFooter(): string {
  const status = moduleStatus("optimize");
  if (!status) return "";
  return `<div class="perf-module-footer">
    <div class="perf-module-info">${icon("box")}<div><strong>优化模块 v${escapeHtml(
      status.version,
    )}</strong><span>安装于 ${formatPerfDate(status.installedAt)} · 模块清单 ${formatBytes(
      status.sizeBytes,
    )} · 功能代码随主程序内置 · 0 常驻内存</span></div></div>
    <button class="mini-danger${state.modulePendingUninstall === "optimize" ? " is-confirming" : ""}" data-settings-action="module-uninstall" data-value="optimize" data-focus-key="opt-uninstall"${
      state.moduleBusy === "optimize" ? " disabled" : ""
    }>${state.moduleBusy === "optimize" ? "卸载中…" : state.modulePendingUninstall === "optimize" ? "确认卸载" : "卸载模块"}</button>
    <div class="perf-uninstall-note">卸载只删除模块清单和状态；已应用的注册表优化不会自动回滚，可重装后在“一键优化”里还原，已清理的临时文件不会恢复。</div>
  </div>`;
}

function optimizeMemoryCard(): string {
  return `<div class="perf-card">
    <div class="perf-card-head">
      <div class="perf-card-title">${icon("cpu")}<div><strong>深层内存清理</strong><p>清空 Windows 待机页、低优先级待机页与已修改页面列表，释放物理内存，不关闭应用。需要管理员权限。</p></div></div>
      <button class="ghost-btn" data-settings-action="memory-purge" data-focus-key="opt-memory-purge"${
        state.memoryPurgeBusy ? " disabled" : ""
      }>${state.memoryPurgeBusy ? "正在清理…" : "清理系统缓存与待机列表"}</button>
    </div>
  </div>`;
}

function performanceDashboard(): string {
  return `<div class="settings-section perf-shell">
    <div class="perf-head">
      <div>
        <h3 class="settings-section-title">系统体检</h3>
        <p class="background-lead">模块已安装 · 只体检不优化 · 按需读取 · 无后台进程</p>
      </div>
      <div class="perf-head-actions">
        ${performancePrivilegeBadge()}
        <button class="ghost-btn" data-settings-action="perf-copy-report" data-focus-key="perf-copy-report"${
          state.perfSystem ? "" : " disabled"
        }>${icon("doc")}复制报告</button>
        <button class="ghost-btn" data-settings-action="perf-refresh" data-focus-key="perf-refresh">${
          icon("refresh")
        }刷新</button>
      </div>
    </div>
    ${performanceMetrics()}
    ${performanceScoreCard()}
    ${performanceDiskCard()}
    ${performanceHogsCard()}
    ${performanceHistoryCard()}
    ${performanceModuleFooter()}
  </div>`;
}

function optimizeDashboard(): string {
  return `<div class="settings-section perf-shell">
    <div class="perf-head">
      <div>
        <h3 class="settings-section-title">系统优化</h3>
        <p class="background-lead">模块已安装 · 参考 Winhance 优化分类 · 动作与体检分开 · 无后台进程</p>
      </div>
      <div class="perf-head-actions">
        ${performancePrivilegeBadge()}
        <button class="ghost-btn" data-settings-action="opt-refresh" data-focus-key="opt-refresh">${
          icon("refresh")
        }刷新</button>
      </div>
    </div>
    ${performanceOptimizeCard()}
    ${performanceSafeClean()}
    ${performanceTempCard()}
    ${performanceUsageCard()}
    ${optimizeMemoryCard()}
    ${performancePowerCard()}
    ${performanceNetworkCard()}
    ${optimizeModuleFooter()}
  </div>`;
}

function performancePanel(): string {
  if (state.perfStatusError) {
    return perfState(`读取性能模块失败：${state.perfStatusError}`, true);
  }
  if (!moduleReady("performance")) {
    return `<div class="settings-section">${performanceInstallCard()}</div>`;
  }
  return performanceDashboard();
}

function optimizePanel(): string {
  if (!moduleReady("optimize")) {
    return `<div class="settings-section">${optimizeInstallCard()}</div>`;
  }
  return optimizeDashboard();
}

function performancePrivilegeBadge(): string {
  if (state.elevated === null) return "";
  return `<span class="perf-privilege is-${state.elevated ? "ok" : "warn"}">${
    state.elevated
      ? "管理员权限"
      : "普通权限 · 系统级清理（Windows 临时文件、更新缓存）会受限，可在设置里以管理员身份重启"
  }</span>`;
}

async function loadPerformanceStatus(): Promise<void> {
  if (state.perfStatusLoading || !moduleReady("performance")) return;
  state.perfStatusLoading = true;
  state.perfStatusError = null;
  refreshActive();
  try {
    if (state.elevated === null) {
      api
        .elevatedStatus()
        .then((elevated) => {
          state.elevated = elevated;
          refreshActive();
        })
        .catch(() => {
          state.elevated = false;
          refreshActive();
        });
    }
    const status = await api.performanceModuleStatus();
    state.perfStatus = status;
    if (!status.installed) {
      state.perfSystem = null;
      state.perfSystemError = null;
      state.perfTempScan = null;
      state.perfLastClean = null;
      state.perfTempSelected = new Set<string>();
      state.perfOptimize = [];
      state.perfOptimizeError = null;
      state.perfOptimizeSelected = new Set<string>();
      state.perfOptimizeTouched = false;
    }
  } catch (error) {
    state.perfStatusError = String(error);
  } finally {
    state.perfStatusLoading = false;
    refreshActive();
    if (state.perfStatus?.installed) {
      void loadPerformanceSystem();
      void loadPerformanceOptimize();
    }
  }
}

async function loadPerformanceSystem(): Promise<void> {
  if (!moduleReady("performance") || state.perfSystemLoading) return;
  state.perfSystemLoading = true;
  state.perfSystemError = null;
  refreshActive();
  try {
    state.perfSystem = await api.performanceSystemInfo();
  } catch (error) {
    state.perfSystemError = String(error);
  } finally {
    state.perfSystemLoading = false;
    refreshActive();
  }
}

async function installPerformance(): Promise<void> {
  if (state.perfInstalling) return;
  state.perfInstalling = true;
  refreshActive();
  try {
    state.perfStatus = await api.performanceModuleInstall();
    showToast("性能优化模块已安装", "success");
    await loadPerformanceSystem();
  } catch (error) {
    showToast(`安装性能模块失败：${String(error)}`, "error");
  } finally {
    state.perfInstalling = false;
    refreshActive();
  }
}

function requestPerformanceUninstall(): void {
  if (state.perfUninstalling) return;
  if (!state.perfPendingUninstall) {
    state.perfPendingUninstall = true;
    refreshActive();
    window.setTimeout(() => {
      if (state.perfPendingUninstall) {
        state.perfPendingUninstall = false;
        refreshActive();
      }
    }, 4000);
    return;
  }
  void uninstallPerformance();
}

async function uninstallPerformance(): Promise<void> {
  state.perfPendingUninstall = false;
  state.perfUninstalling = true;
  refreshActive();
  try {
    state.perfStatus = await api.performanceModuleUninstall();
    state.perfSystem = null;
    state.perfTempScan = null;
    state.perfTempSelected = new Set<string>();
    state.perfLastClean = null;
    state.perfOptimize = [];
    state.perfOptimizeError = null;
    state.perfOptimizeSelected = new Set<string>();
    state.perfOptimizeTouched = false;
    showToast("性能优化模块已卸载，工具已停用", "success");
  } catch (error) {
    showToast(`卸载性能模块失败：${String(error)}`, "error");
  } finally {
    state.perfUninstalling = false;
    refreshActive();
  }
}

async function scanPerformanceTemp(): Promise<void> {
  if (!moduleReady("optimize") || state.perfTempLoading) return;
  state.perfTempLoading = true;
  state.perfTempError = null;
  refreshActive();
  try {
    const scan = await api.performanceScanTemp(state.perfTempDays);
    state.perfTempScan = scan;
    state.perfTempSelected = new Set(
      scan.categories
        .filter((category) => category.accessible && category.bytes > 0)
        .map((category) => category.id),
    );
  } catch (error) {
    state.perfTempError = String(error);
  } finally {
    state.perfTempLoading = false;
    refreshActive();
  }
}

function setPerformanceDays(days: number): void {
  if (![7, 30, 90].includes(days)) return;
  state.perfTempDays = days;
  state.perfTempScan = null;
  state.perfTempSelected = new Set<string>();
  state.perfTempError = null;
  refreshActive();
}

function togglePerformanceCategory(id: string): void {
  const row = state.perfTempScan?.categories.find((category) => category.id === id);
  if (!row || !row.accessible || row.bytes === 0) return;
  if (state.perfTempSelected.has(id)) state.perfTempSelected.delete(id);
  else state.perfTempSelected.add(id);
  refreshActive();
}

function requestPerformanceClean(mode: "safe" | "selected"): void {
  if (state.perfTempBusy) return;
  if (mode === "selected") {
    const selected = state.perfTempScan?.categories.filter(
      (category) => state.perfTempSelected.has(category.id) && category.accessible,
    );
    if (!selected || selected.length === 0) {
      showToast("请先扫描并选择要清理的项目", "info");
      return;
    }
  }
  if (state.perfPendingClean !== mode) {
    state.perfPendingClean = mode;
    refreshActive();
    window.setTimeout(() => {
      if (state.perfPendingClean === mode) {
        state.perfPendingClean = null;
        refreshActive();
      }
    }, 4000);
    return;
  }
  void runPerformanceClean(mode);
}

async function runPerformanceClean(mode: "safe" | "selected"): Promise<void> {
  state.perfPendingClean = null;
  state.perfTempBusy = true;
  refreshActive();
  const days = mode === "safe" ? 7 : state.perfTempDays;
  const selectedIds =
    mode === "safe"
      ? [...SAFE_CLEAN_IDS]
      : state.perfTempScan?.categories
          .filter((category) => state.perfTempSelected.has(category.id) && category.accessible)
          .map((category) => category.id) ?? [];
  if (selectedIds.length === 0) {
    state.perfTempBusy = false;
    refreshActive();
    return;
  }
  try {
    const result = await api.performanceCleanTemp(selectedIds, days);
    state.perfLastClean = result;
    if (state.perfTempScan) {
      const categories = state.perfTempScan.categories.map((category) => {
        const cleaned = result.categories.find((item) => item.id === category.id);
        if (!cleaned || cleaned.freedBytes === 0) return category;
        return {
          ...category,
          bytes: Math.max(0, category.bytes - cleaned.freedBytes),
          files: Math.max(0, category.files - cleaned.files),
        };
      });
      state.perfTempScan = {
        ...state.perfTempScan,
        categories,
        totalBytes: categories.reduce((sum, category) => sum + category.bytes, 0),
        totalFiles: categories.reduce((sum, category) => sum + category.files, 0),
      };
      state.perfTempSelected = new Set(
        categories
          .filter(
            (category) =>
              category.accessible && category.bytes > 0 && state.perfTempSelected.has(category.id),
          )
          .map((category) => category.id),
      );
    }
    let message = `已释放 ${formatBytes(result.freedBytes)}，清理 ${result.files} 个文件`;
    if (result.pendingReboot > 0) {
      message += `，${result.pendingReboot} 个文件被占用，已安排重启后删除`;
    }
    if (result.failed > 0) message += `，${result.failed} 项未清理`;
    if (mode === "safe") {
      try {
        const dns = await api.performanceFlushDns();
        message += ` · ${dns}`;
      } catch (error) {
        message += ` · DNS 刷新失败：${String(error)}`;
      }
    }
    showToast(message, result.freedBytes > 0 ? "success" : "info");
  } catch (error) {
    showToast(`清理失败：${String(error)}`, "error");
  } finally {
    state.perfTempBusy = false;
    if (state.perfStatus?.installed) void loadPerformanceSystem();
    refreshActive();
  }
}

async function setPerformancePower(guid: string): Promise<void> {
  if (state.perfPowerBusy) return;
  if (state.optPower && state.optPower.guid.toLowerCase() === guid.toLowerCase()) return;
  state.perfPowerBusy = guid;
  refreshActive();
  try {
    const power = await api.performanceSetPower(guid);
    state.optPower = power;
    showToast(`已切换到「${power.name}」电源计划`, "success");
  } catch (error) {
    showToast(`切换电源计划失败：${String(error)}`, "error");
  } finally {
    state.perfPowerBusy = null;
    refreshActive();
  }
}

async function loadOptimizePower(): Promise<void> {
  if (!moduleReady("optimize") || state.optPower !== null || state.perfPowerBusy) return;
  try {
    state.optPower = await api.optimizePowerStatus();
  } catch {
    state.optPower = null;
  } finally {
    refreshActive();
  }
}

async function loadPerformanceOptimize(): Promise<void> {
  if (!moduleReady("optimize") || state.perfOptimizeLoading) return;
  state.perfOptimizeLoading = true;
  state.perfOptimizeError = null;
  refreshActive();
  try {
    const items = await api.optimizeList();
    state.perfOptimize = items;
    // 系统版本或权限变化后，勾选集合里不能留下已不可用的项；已生效的项也不需要再选。
    const selectable = new Set(
      items
        .filter((item) => item.available && item.state !== "applied")
        .map((item) => item.id),
    );
    state.perfOptimizeSelected = new Set(
      [...state.perfOptimizeSelected].filter((id) => selectable.has(id)),
    );
    if (!state.perfOptimizeTouched) {
      state.perfOptimizeSelected = new Set(
        items
          .filter(
            (item) => item.group === "safe" && item.available && item.state !== "applied",
          )
          .map((item) => item.id),
      );
      state.perfOptimizeTouched = true;
    }
  } catch (error) {
    state.perfOptimizeError = String(error);
  } finally {
    state.perfOptimizeLoading = false;
    refreshActive();
  }
}

let optimizeConfirmTimer: number | null = null;

function clearOptimizeConfirm(): void {
  if (optimizeConfirmTimer !== null) {
    window.clearTimeout(optimizeConfirmTimer);
    optimizeConfirmTimer = null;
  }
}

function toggleOptimizeItem(id: string): void {
  const item = state.perfOptimize.find((entry) => entry.id === id);
  if (!item || item.state === "unknown" || item.state === "applied" || !item.available)
    return;
  if (state.perfOptimizeSelected.has(id)) state.perfOptimizeSelected.delete(id);
  else state.perfOptimizeSelected.add(id);
  clearOptimizeConfirm();
  state.perfOptimizePending = null;
  refreshActive();
}

function selectSafeOptimizeItems(): void {
  state.perfOptimizeSelected = new Set(
    state.perfOptimize
      .filter(
        (item) => item.group === "safe" && item.available && item.state !== "applied",
      )
      .map((item) => item.id),
  );
  clearOptimizeConfirm();
  state.perfOptimizePending = null;
  refreshActive();
}

/** 智能优化额外勾选的服务：禁用后不影响日常使用的轻量后台服务。 */
const SMART_EXTRA_IDS = new Set([
  "svc-diagtrack",
  "svc-retail-demo",
  "svc-fax",
  "svc-wmp-network",
  "svc-maps-broker",
  "svc-geolocation",
]);

/** 一键智能优化：自动勾选全部安全项 + 明确安全的服务项，一步进入确认。 */
function requestSmartOptimize(): void {
  if (state.perfOptimizeBusy) return;
  const selected = new Set<string>();
  for (const item of state.perfOptimize) {
    if (!item.available || item.state === "applied" || item.state === "unknown") continue;
    if (item.group === "safe" || SMART_EXTRA_IDS.has(item.id)) selected.add(item.id);
  }
  state.perfOptimizeSelected = selected;
  clearOptimizeConfirm();
  if (selected.size === 0) {
    showToast("没有需要优化的项目", "info");
    return;
  }
  if (state.perfOptimizePending !== "apply") {
    state.perfOptimizePending = "apply";
    refreshActive();
    optimizeConfirmTimer = window.setTimeout(() => {
      if (state.perfOptimizePending === "apply") {
        state.perfOptimizePending = null;
        optimizeConfirmTimer = null;
        refreshActive();
      }
    }, 4000);
    return;
  }
  void runOptimize("apply");
}

function requestOptimize(mode: "apply" | "restoreAll"): void {
  if (state.perfOptimizeBusy) return;
  if (mode === "apply") {
    const selected = state.perfOptimizeSelected.size;
    if (selected === 0) {
      showToast("请先选择要优化的项目", "info");
      return;
    }
  } else {
    const backed = state.perfOptimize.filter((item) => item.backedUp).length;
    if (backed === 0) {
      showToast("没有已优化并备份过原值的项目，无需还原", "info");
      return;
    }
  }
  if (state.perfOptimizePending !== mode) {
    clearOptimizeConfirm();
    state.perfOptimizePending = mode;
    refreshActive();
    optimizeConfirmTimer = window.setTimeout(() => {
      if (state.perfOptimizePending === mode) {
        state.perfOptimizePending = null;
        optimizeConfirmTimer = null;
        refreshActive();
      }
    }, 4000);
    return;
  }
  void runOptimize(mode);
}

async function runOptimize(mode: "apply" | "restoreAll"): Promise<void> {
  clearOptimizeConfirm();
  state.perfOptimizePending = null;
  state.perfOptimizeBusy = true;
  refreshActive();
  try {
    const ids =
      mode === "apply"
        ? [...state.perfOptimizeSelected]
        : state.perfOptimize.filter((item) => item.backedUp).map((item) => item.id);
    const outcome =
      mode === "apply" ? await api.optimizeApply(ids) : await api.optimizeRestore([], true);
    if (mode === "apply") {
      if (outcome.changed.length > 0 || outcome.message !== "") {
        state.perfOptimizeSummary = buildOptimizeSummary(outcome.changed);
      }
      const changed = new Set(outcome.changed);
      state.perfOptimizeSelected = new Set(
        [...state.perfOptimizeSelected].filter((id) => !changed.has(id)),
      );
    } else {
      state.perfOptimizeSummary = null;
    }
    showToast(
      outcome.message,
      outcome.cancelled ? "info" : outcome.changed.length > 0 ? "success" : "info",
    );
    if (!outcome.cancelled) {
      await loadPerformanceOptimize();
    }
  } catch (error) {
    showToast(`${mode === "apply" ? "应用优化项失败" : "还原失败"}：${String(error)}`, "error");
  } finally {
    state.perfOptimizeBusy = false;
    refreshActive();
  }
}

/** 按各项目的生效时机汇总最近一次一键优化的结果。 */
function buildOptimizeSummary(changed: string[]): OptimizeSummary {
  const summary: OptimizeSummary = {
    applied: changed.length,
    immediate: 0,
    explorer: 0,
    restart: 0,
    relogin: 0,
  };
  for (const id of changed) {
    const item = state.perfOptimize.find((entry) => entry.id === id);
    if (!item) {
      summary.immediate += 1;
      continue;
    }
    const applies = item.applies;
    if (applies.includes("资源管理器")) summary.explorer += 1;
    else if (applies.includes("登录")) summary.relogin += 1;
    else if (applies.includes("重启") || applies.includes("开机")) summary.restart += 1;
    else summary.immediate += 1;
  }
  return summary;
}

async function restoreSingleOptimizeItem(id: string): Promise<void> {
  if (state.perfOptimizeBusy) return;
  state.perfOptimizeBusy = true;
  refreshActive();
  try {
    const outcome = await api.optimizeRestore([id], false);
    showToast(
      outcome.message,
      outcome.cancelled ? "info" : outcome.changed.length > 0 ? "success" : "info",
    );
    if (!outcome.cancelled) void loadPerformanceOptimize();
  } catch (error) {
    showToast(`还原失败：${String(error)}`, "error");
  } finally {
    state.perfOptimizeBusy = false;
    refreshActive();
  }
}

async function flushPerformanceDns(): Promise<void> {
  if (state.perfDnsBusy) return;
  state.perfDnsBusy = true;
  refreshActive();
  try {
    const message = await api.performanceFlushDns();
    showToast(message, "success");
  } catch (error) {
    showToast(`刷新 DNS 失败：${String(error)}`, "error");
  } finally {
    state.perfDnsBusy = false;
    refreshActive();
  }
}

/* ── network optimization（DNS 切换 / 诊断） ─────────────────── */

async function loadOptimizeNetwork(): Promise<void> {
  if (!moduleReady("optimize") || state.optDnsLoading || state.optDns !== null) return;
  state.optDnsLoading = true;
  state.optDnsError = null;
  refreshActive();
  try {
    state.optDns = await api.optimizeDnsStatus();
  } catch (error) {
    state.optDnsError = String(error);
  } finally {
    state.optDnsLoading = false;
    refreshActive();
  }
}

function setOptimizeCategory(category: string): void {
  const valid: OptimizeCategory[] = ["all", "privacy", "performance", "services", "updates"];
  if (!valid.includes(category as OptimizeCategory)) return;
  state.perfOptCategory = category as OptimizeCategory;
  refreshActive();
}

function setDnsPreset(preset: string): void {
  const valid: DnsPresetId[] = ["auto", "ali", "tencent", "google", "cloudflare"];
  if (!valid.includes(preset as DnsPresetId)) return;
  state.optDnsPreset = preset as DnsPresetId;
  state.optDiag = null;
  refreshActive();
}

async function applyOptimizeDns(): Promise<void> {
  if (state.optDnsBusy) return;
  state.optDnsBusy = true;
  state.optDiag = null;
  refreshActive();
  try {
    const outcome = await api.optimizeDnsSet(state.optDnsPreset);
    if (!outcome.cancelled) {
      state.optDns = await api.optimizeDnsStatus();
      void flushPerformanceDns();
    }
    showToast(outcome.message, outcome.cancelled ? "info" : "success");
  } catch (error) {
    showToast(`切换 DNS 失败：${String(error)}`, "error");
  } finally {
    state.optDnsBusy = false;
    refreshActive();
  }
}

async function restoreOptimizeDns(): Promise<void> {
  if (state.optDnsBusy) return;
  state.optDnsBusy = true;
  refreshActive();
  try {
    const outcome = await api.optimizeDnsRestore();
    if (!outcome.cancelled) {
      state.optDns = await api.optimizeDnsStatus();
      void flushPerformanceDns();
    }
    showToast(outcome.message, outcome.cancelled ? "info" : "success");
  } catch (error) {
    showToast(`还原 DNS 失败：${String(error)}`, "error");
  } finally {
    state.optDnsBusy = false;
    refreshActive();
  }
}

async function runNetworkDiagnose(): Promise<void> {
  if (state.optDiagBusy) return;
  state.optDiagBusy = true;
  refreshActive();
  try {
    state.optDiag = await api.optimizeNetworkDiag();
  } catch (error) {
    showToast(`网络诊断失败：${String(error)}`, "error");
  } finally {
    state.optDiagBusy = false;
    refreshActive();
  }
}

/* ── cleanup / app management ────────────────────────────────── */

function formatCleanupDate(timestamp: number): string {
  if (!timestamp) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

async function loadCleanupScan(): Promise<void> {
  if (state.cleanupLoading || !moduleReady("cleanup")) return;
  state.cleanupLoading = true;
  state.cleanupError = null;
  state.cleanupPendingDelete = false;
  refreshActive();
  try {
    const scan = await api.cleanupScan();
    state.cleanupScan = scan;
    state.cleanupSelected = new Set<string>();
  } catch (error) {
    state.cleanupError = String(error);
  } finally {
    state.cleanupLoading = false;
    refreshActive();
  }
}

async function loadCleanupApps(): Promise<void> {
  if (state.cleanupAppsLoading || !moduleReady("cleanup")) return;
  state.cleanupAppsLoading = true;
  state.cleanupAppsError = null;
  refreshActive();
  try {
    state.cleanupApps = await api.cleanupApps();
  } catch (error) {
    state.cleanupAppsError = String(error);
  } finally {
    state.cleanupAppsLoading = false;
    refreshActive();
  }
}

function cleanupAppRow(app: CleanupApp): string {
  const open = app.uninstallable && state.cleanupUninstallId === app.id;
  const meta = [app.publisher, app.version ? `v${app.version}` : null, app.scope]
    .filter(Boolean)
    .join(" · ");
  const action = app.uninstallable
    ? `<button class="ghost-btn" data-settings-action="cleanup-uninstall-open" data-id="${escapeHtml(
        app.id,
      )}"${state.cleanupUninstallBusy ? " disabled" : ""}>${open ? "收起" : "卸载"}</button>`
    : `<button class="ghost-btn" data-settings-action="cleanup-open" data-path="${escapeHtml(
        app.installLocation ?? "",
      )}"${!app.installLocation || state.cleanupUninstallBusy ? " disabled" : ""}>打开目录</button>`;
  return `<div class="cleanup-app-row${open ? " is-open" : ""}">
    <span class="cleanup-app-glyph">${icon("box")}</span>
    <div class="cleanup-copy">
      <div class="cleanup-name">${escapeHtml(app.name)}${
        app.uninstallable
          ? ""
          : `<span class="cleanup-badge is-portable" aria-hidden="true">便携版 / 未登记</span>`
      }</div>
      <div class="cleanup-meta">${escapeHtml(meta)}${app.quiet ? " · 支持静默卸载" : ""}</div>
      <div class="cleanup-path" title="${escapeHtml(app.installLocation ?? "")}">${escapeHtml(
        app.installLocation ?? "未记录安装目录",
      )}</div>
    </div>
    <div class="cleanup-size">${app.sizeBytes > 0 ? formatBytes(app.sizeBytes) : "—"}</div>
    ${action}
  </div>${
    open
      ? `<div class="cleanup-uninstall">
          <button class="cleanup-choice${state.cleanupUninstallFull ? " is-on" : ""}" role="checkbox" aria-checked="${
            state.cleanupUninstallFull
          }" data-settings-action="cleanup-uninstall-full"${
            state.cleanupUninstallBusy ? " disabled" : ""
          }>
            <span class="cleanup-choice-box">${icon("check")}</span>
            <span><strong>完全清除</strong><small>卸载完成后删除安装文件夹${
              app.installLocation ? `（${escapeHtml(app.installLocation)}）` : ""
            }，并移除残留的卸载注册表项</small></span>
          </button>
          <p class="cleanup-warn">${
            state.cleanupUninstallFull
              ? "会先调用应用自带卸载程序，成功后再删除安装文件夹；删除不可恢复。"
              : "仅运行应用自带卸载程序，安装文件夹会保留，可稍后在下方残留列表中处理。"
          }</p>
          <div class="cleanup-actions">
            <span>${
              state.cleanupUninstallBusy
                ? "卸载程序运行中，请勿关闭启点；完成后会自动刷新列表。"
                : `将卸载 ${escapeHtml(app.name)}`
            }</span>
            <button class="ghost-btn" data-settings-action="cleanup-uninstall-cancel"${
              state.cleanupUninstallBusy ? " disabled" : ""
            }>取消</button>
            <button class="mini-danger" data-settings-action="cleanup-uninstall-confirm"${
              state.cleanupUninstallBusy ? " disabled" : ""
            }>${state.cleanupUninstallBusy ? "卸载中…" : state.cleanupUninstallFull ? "卸载并彻底删除" : "仅卸载"}</button>
          </div>
        </div>`
      : ""
  }`;
}

/** 已安装应用按搜索词与排序过滤，供列表与计数共用。 */
function filteredCleanupApps(): CleanupApp[] {
  const apps = state.cleanupApps ?? [];
  const query = state.cleanupAppQuery.trim().toLowerCase();
  return [...apps]
    .filter((app) =>
      query.length === 0
        ? true
        : `${app.name} ${app.publisher ?? ""}`.toLowerCase().includes(query),
    )
    .sort((a, b) =>
      state.cleanupAppSort === "size"
        ? b.sizeBytes - a.sizeBytes || collator.compare(a.name, b.name)
        : collator.compare(a.name, b.name),
    );
}

function cleanupAppListHtml(): string {
  const visible = filteredCleanupApps();
  if (visible.length === 0) {
    return `<div class="perf-empty-scan">${icon("search")}<span>没有匹配「${escapeHtml(
      state.cleanupAppQuery.trim(),
    )}」的应用。</span></div>`;
  }
  return `<div class="cleanup-list cleanup-app-list">${visible.map(cleanupAppRow).join("")}</div>`;
}

/** 只替换列表容器，避免搜索时重建输入框导致焦点与光标丢失。 */
function refreshCleanupAppList(): void {
  const wrap = document.querySelector<HTMLElement>(".cleanup-app-list-wrap");
  if (wrap) wrap.innerHTML = cleanupAppListHtml();
}

function cleanupAppsSection(): string {
  const apps = state.cleanupApps;
  const last = state.cleanupLastUninstall;
  const visible = filteredCleanupApps();
  const lastParts = last
    ? [
        last.removedDirs.length > 0
          ? `删除 ${last.removedDirs.length} 个文件夹，释放 ${formatBytes(last.freedBytes)}`
          : last.registryRemoved
            ? "未找到可删除的安装目录"
            : "",
        last.registryRemoved ? "卸载注册表项已移除" : "",
      ].filter(Boolean)
    : [];
  const lastNote = last
    ? `<div class="cleanup-result" role="status">${icon("check")}<span>${escapeHtml(last.appName)} 已卸载${
        lastParts.length > 0 ? `，${lastParts.join("，")}` : ""
      }${last.errors.length > 0 ? `；${last.errors.length} 项未能清理。` : "。"}</span></div>`
    : "";
  const body = state.cleanupAppsLoading && !apps
    ? perfState("正在读取本机已安装应用……")
    : state.cleanupAppsError
      ? perfState(`读取已安装应用失败：${state.cleanupAppsError}`, true, "cleanup-apps-refresh")
      : !apps
        ? `<div class="perf-empty-scan">${icon("box")}<span>读取后会列出注册表中登记的应用；卸载会调用应用自带的卸载程序。</span></div>`
        : apps.length === 0
          ? `<div class="perf-empty-scan">${icon("check")}<span>没有找到可卸载的已安装应用。</span></div>`
          : `<div class="cleanup-summary"><span>共 ${apps.length} 个应用 · ${
              apps.filter((app) => app.uninstallable).length
            } 个带卸载程序${
              state.cleanupAppQuery.trim().length > 0 ? ` · 匹配 ${visible.length} 个` : ""
            }</span><span>便携版可直接打开安装目录</span></div>
             <div class="cleanup-toolbar">
               <label class="cleanup-search">
                 ${icon("search")}
                 <input type="search" placeholder="搜索应用名称或发布者" value="${escapeHtml(
                   state.cleanupAppQuery,
                 )}" data-app-search aria-label="搜索已安装应用" />
               </label>
               <div class="chips">
                 <button class="chip${state.cleanupAppSort === "name" ? " is-active" : ""}" data-settings-action="cleanup-app-sort" data-value="name" data-focus-key="cleanup-app-sort-name">名称</button>
                 <button class="chip${state.cleanupAppSort === "size" ? " is-active" : ""}" data-settings-action="cleanup-app-sort" data-value="size" data-focus-key="cleanup-app-sort-size">占用大小</button>
               </div>
             </div>
             <div class="cleanup-app-list-wrap">${cleanupAppListHtml()}</div>`;

  return `<div class="settings-section">
    <div class="perf-head">
      <div>
        <h3 class="settings-section-title">已安装应用</h3>
        <p class="background-lead">注册表应用可调用自带卸载程序并选择完全清除；启动台识别的便携版/未登记应用会一并列出，可直接打开安装目录。</p>
      </div>
      <button class="ghost-btn" data-settings-action="cleanup-apps-refresh" data-focus-key="cleanup-apps-refresh"${
        state.cleanupAppsLoading ? " disabled" : ""
      }>${icon("refresh")}${state.cleanupAppsLoading ? "读取中…" : "刷新列表"}</button>
    </div>
    ${lastNote}
    ${body}
    <div class="background-note">${icon("info")}<span>只列出注册表中带卸载命令的应用；绿色版、便携版与部分 Store 应用没有卸载登记，可在下方“应用文件夹与空间清理”中按目录查看。完全清除只删除 Program Files、Program Files (x86)、ProgramData 与 LocalAppData\\Programs 下的安装目录，且会再次核对其它应用、快捷方式与运行中进程的引用。</span></div>
  </div>`;
}

const LARGE_FOLDER_BYTES = 500 * 1024 ** 2;

function cleanupCandidates(): CleanupCandidate[] {
  const list = state.cleanupScan?.candidates ?? [];
  if (state.cleanupFilter === "suspect") {
    return list.filter((candidate) => !candidate.referenced);
  }
  if (state.cleanupFilter === "large") {
    return list.filter((candidate) => candidate.sizeBytes >= LARGE_FOLDER_BYTES);
  }
  return list;
}

function cleanupRow(candidate: CleanupCandidate): string {
  const selected = state.cleanupSelected.has(candidate.id);
  const kindLabel = candidate.kind === "data" ? "应用数据" : "安装目录";
  const badge = candidate.referenced
    ? `<span class="cleanup-badge is-referenced">${icon("shield")}已安装</span>`
    : `<span class="cleanup-badge is-suspect">疑似残留</span>`;
  const check = candidate.referenced
    ? `<button class="perf-check" role="checkbox" aria-checked="false" aria-label="受保护，不能删除" disabled>${icon(
        "shield",
      )}</button>`
    : `<button class="perf-check" role="checkbox" aria-checked="${selected}" aria-label="选择 ${escapeHtml(
        candidate.name,
      )}" data-settings-action="cleanup-toggle" data-id="${escapeHtml(
        candidate.id,
      )}"${state.cleanupBusy ? " disabled" : ""}>${icon("check")}</button>`;
  return `<div class="cleanup-row${selected ? " is-selected" : ""}${
    candidate.referenced ? " is-referenced" : ""
  }">
    ${check}
    <div class="cleanup-copy">
      <div class="cleanup-name">${escapeHtml(candidate.name)}${badge}</div>
      <div class="cleanup-path" title="${escapeHtml(candidate.path)}">${escapeHtml(candidate.path)}</div>
      <div class="cleanup-meta">${escapeHtml(candidate.root)} · ${kindLabel} · ${
        candidate.files
      } 个文件 · 最后修改 ${formatCleanupDate(candidate.lastModified)}</div>
    </div>
    <div class="cleanup-size">${formatBytes(candidate.sizeBytes)}</div>
    <button class="ghost-btn cleanup-open" data-settings-action="cleanup-open" data-path="${escapeHtml(
      candidate.path,
    )}"${state.cleanupBusy ? " disabled" : ""}>打开</button>
  </div>`;
}

function cleanupPanel(): string {
  const scan = state.cleanupScan;
  const candidates = cleanupCandidates();
  const selectable = candidates.filter((candidate) => !candidate.referenced);
  const selected = selectable.filter((candidate) => state.cleanupSelected.has(candidate.id));
  const selectedBytes = selected.reduce((sum, candidate) => sum + candidate.sizeBytes, 0);
  const filteredBytes = candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0);
  const pending = state.cleanupPendingDelete;
  const filters: { id: UiState["cleanupFilter"]; label: string; count: number }[] = [
    { id: "all", label: "全部", count: scan?.candidates.length ?? 0 },
    { id: "suspect", label: "疑似残留", count: scan?.suspects ?? 0 },
    {
      id: "large",
      label: "大文件夹",
      count:
        scan?.candidates.filter((item) => item.sizeBytes >= LARGE_FOLDER_BYTES).length ?? 0,
    },
  ];

  const last = state.cleanupLast
    ? `<div class="cleanup-result" role="status">${icon("check")}<span>${
        state.cleanupLast.recycled ? "已移入回收站" : "已永久删除"
      } ${state.cleanupLast.deleted.length} 个文件夹，共 ${formatBytes(
        state.cleanupLast.freedBytes,
      )}；${state.cleanupLast.files} 个文件。${
        state.cleanupLast.recycled ? "清空回收站后释放空间。" : ""
      }${
        state.cleanupLast.errors.length > 0
          ? ` ${state.cleanupLast.errors.length} 项未能删除。`
          : ""
      }</span></div>`
    : "";

  const emptyText =
    state.cleanupFilter === "suspect"
      ? "当前没有疑似残留文件夹，列出的目录都仍被应用引用。"
      : state.cleanupFilter === "large"
        ? `没有超过 ${formatBytes(LARGE_FOLDER_BYTES)} 的文件夹。`
        : "没有扫描到应用文件夹。";
  const body = state.cleanupLoading && !scan
    ? perfState("正在扫描安装目录与应用数据并核对引用……首次扫描可能需要几秒。")
    : state.cleanupError
      ? perfState(`扫描失败：${state.cleanupError}`, true, "cleanup-refresh")
      : !scan
        ? `<div class="perf-empty-scan">${icon("trash")}<span>扫描后会列出安装目录与应用数据文件夹，并标注是否仍被应用引用。</span></div>`
        : !scan.advancedOk
          ? `<div class="background-note is-warn">${icon("info")}<span>无法读取开始菜单快捷方式或运行中进程，不能安全判断哪些文件夹仍被引用；为避免误删，本次不提供列表。请点右上角“重新扫描”重试。</span></div>`
          : candidates.length === 0
            ? `<div class="perf-empty-scan">${icon("check")}<span>${emptyText}</span></div>`
            : `<div class="cleanup-summary">
                <span>扫描 ${scan.scannedDirs} 个目录 · ${scan.candidates.length} 个文件夹 · 合计 ${formatBytes(
                  scan.totalBytes,
                )}</span>
                <span>疑似残留 ${scan.suspects} 个 · ${filteredBytes > 0 ? `当前列表 ${formatBytes(filteredBytes)}` : "当前列表为空"}</span>
              </div>
              <div class="cleanup-filters">${filters
                .map(
                  (filter) =>
                    `<button class="cleanup-filter${
                      state.cleanupFilter === filter.id ? " is-active" : ""
                    }" data-settings-action="cleanup-filter" data-value="${filter.id}" aria-pressed="${
                      state.cleanupFilter === filter.id
                    }">${filter.label}<small>${filter.count}</small></button>`,
                )
                .join("")}</div>
              <div class="cleanup-roots">${scan.roots
                .map((root) => `<span class="cleanup-root">${escapeHtml(root)}</span>`)
                .join("")}</div>
              <div class="cleanup-list">${candidates.map(cleanupRow).join("")}</div>
              <button class="cleanup-choice${state.settings.cleanupRecycleBin ? " is-on" : ""}" role="checkbox" aria-checked="${
                state.settings.cleanupRecycleBin
              }" data-settings-action="cleanup-recycle-toggle"${
                state.cleanupBusy ? " disabled" : ""
              }>
                <span class="cleanup-choice-box">${icon("check")}</span>
                <span><strong>删除到回收站</strong><small>${
                  state.settings.cleanupRecycleBin
                    ? "可从回收站恢复；清空回收站后才释放磁盘空间"
                    : "直接永久删除，不进入回收站，删除后不可恢复"
                }</small></span>
              </button>
              <div class="cleanup-actions">
                <button class="ghost-btn" data-settings-action="cleanup-select-all"${
                  state.cleanupBusy || selectable.length === 0 ? " disabled" : ""
                }>${selectable.length > 0 && selected.length === selectable.length ? "取消全选" : "全选可清理"}</button>
                <span>已选 ${selected.length} 个 · ${formatBytes(selectedBytes)}</span>
                <button class="mini-danger${pending ? " is-confirming" : ""}" data-settings-action="cleanup-delete"${
                  state.cleanupBusy || selected.length === 0 ? " disabled" : ""
                }>${state.cleanupBusy ? "删除中…" : pending ? (state.settings.cleanupRecycleBin ? "确认移入回收站" : "确认永久删除") : "删除选中"}</button>
              </div>`;

  return `${cleanupAppsSection()}<div class="settings-section">
    <div class="perf-head">
      <div>
        <h3 class="settings-section-title">应用文件夹与空间清理</h3>
        <p class="background-lead">列出安装目录与应用数据文件夹；被应用引用的目录只读，未被引用的标记为疑似残留。删除会按下方选项移入回收站或永久生效。</p>
      </div>
      <button class="ghost-btn" data-settings-action="cleanup-refresh" data-focus-key="cleanup-refresh"${
        state.cleanupLoading ? " disabled" : ""
      }>${icon("refresh")}${state.cleanupLoading ? "扫描中…" : "重新扫描"}</button>
    </div>
    ${last}
    ${body}
    <div class="background-note">${icon("info")}<span>扫描 Program Files、Program Files (x86)、ProgramData、LocalAppData\\Programs 及 LocalAppData / AppData\\Roaming 的一级应用数据目录；厂商目录会自动展开到产品级。Windows、Microsoft、Packages、Temp 等系统目录不扫描，也不允许删除。建议先点“打开”确认内容。</span></div>
  </div>`;
}

function toggleCleanupCandidate(id: string): void {
  if (state.cleanupBusy) return;
  const candidate = state.cleanupScan?.candidates.find((item) => item.id === id);
  if (!candidate || candidate.referenced) return;
  if (state.cleanupSelected.has(id)) state.cleanupSelected.delete(id);
  else state.cleanupSelected.add(id);
  state.cleanupPendingDelete = false;
  refreshActive();
}

function toggleCleanupSelectAll(): void {
  if (state.cleanupBusy) return;
  const selectable = cleanupCandidates().filter((candidate) => !candidate.referenced);
  const selectedVisible = selectable.filter((candidate) =>
    state.cleanupSelected.has(candidate.id),
  );
  if (selectable.length > 0 && selectedVisible.length === selectable.length) {
    state.cleanupSelected = new Set<string>();
  } else {
    state.cleanupSelected = new Set(selectable.map((candidate) => candidate.id));
  }
  state.cleanupPendingDelete = false;
  refreshActive();
}

function requestCleanupDelete(): void {
  if (state.cleanupBusy) return;
  const paths = cleanupCandidates()
    .filter((candidate) => state.cleanupSelected.has(candidate.id))
    .map((candidate) => candidate.path);
  if (paths.length === 0) {
    showToast("请先选择要删除的文件夹", "info");
    return;
  }
  if (!state.cleanupPendingDelete) {
    state.cleanupPendingDelete = true;
    refreshActive();
    window.setTimeout(() => {
      if (state.cleanupPendingDelete) {
        state.cleanupPendingDelete = false;
        refreshActive();
      }
    }, 5000);
    return;
  }
  void runCleanupDelete(paths);
}

async function runCleanupDelete(paths: string[]): Promise<void> {
  state.cleanupPendingDelete = false;
  state.cleanupBusy = true;
  refreshActive();
  try {
    const report = await api.cleanupDelete(paths, state.settings.cleanupRecycleBin);
    state.cleanupLast = report;
    const deleted = new Set(report.deleted);
    if (state.cleanupScan) {
      const candidates = state.cleanupScan.candidates.filter(
        (candidate) => !deleted.has(candidate.path),
      );
      state.cleanupScan = {
        ...state.cleanupScan,
        candidates,
        suspects: candidates.filter((candidate) => !candidate.referenced).length,
        totalBytes: candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0),
      };
    }
    state.cleanupSelected = new Set<string>();
    let summary = `${report.recycled ? "已移入回收站" : "已删除"} ${
      report.deleted.length
    } 个，共 ${formatBytes(report.freedBytes)}`;
    if (report.pendingReboot.length > 0) {
      summary += `；${report.pendingReboot.length} 个文件夹被占用，已安排重启后删除`;
    }
    if (report.errors.length > 0) {
      showToast(
        `${summary}；${report.errors.length} 项未能删除：${report.errors[0]}`,
        report.deleted.length > 0 ? "info" : "error",
      );
    } else {
      showToast(
        `${report.recycled ? "已移入回收站" : "已删除"} ${report.deleted.length} 个文件夹，共 ${formatBytes(
          report.freedBytes,
        )}${
          report.pendingReboot.length > 0
            ? `；${report.pendingReboot.length} 个被占用，已安排重启后删除`
            : ""
        }`,
        report.recycled ? "info" : "success",
      );
    }
  } catch (error) {
    showToast(`删除残留文件夹失败：${String(error)}`, "error");
  } finally {
    state.cleanupBusy = false;
    refreshActive();
  }
}

async function openCleanupFolder(path: string): Promise<void> {
  try {
    await api.cleanupOpen(path);
  } catch (error) {
    showToast(`无法打开文件夹：${String(error)}`, "error");
  }
}

function openCleanupUninstall(id: string): void {
  if (state.cleanupUninstallBusy) return;
  state.cleanupUninstallId = state.cleanupUninstallId === id ? null : id;
  state.cleanupUninstallFull = false;
  refreshActive();
}

function toggleCleanupFullRemove(): void {
  if (state.cleanupUninstallBusy) return;
  state.cleanupUninstallFull = !state.cleanupUninstallFull;
  refreshActive();
}

async function runCleanupUninstall(): Promise<void> {
  const app = state.cleanupApps?.find((item) => item.id === state.cleanupUninstallId);
  if (!app || state.cleanupUninstallBusy) return;
  const full = state.cleanupUninstallFull;
  state.cleanupUninstallBusy = true;
  refreshActive();
  try {
    const report = await api.cleanupUninstall(app.id, full);
    state.cleanupLastUninstall = report;
    state.cleanupApps = (state.cleanupApps ?? []).filter((item) => item.id !== app.id);
    state.cleanupUninstallId = null;
    if (report.errors.length > 0) {
      showToast(
        `${app.name} 已卸载，但彻底清理未全部完成：${report.errors[0]}`,
        "error",
      );
    } else if (full) {
      showToast(
        report.removedDirs.length > 0
          ? `已卸载 ${app.name}，删除 ${report.removedDirs.length} 个文件夹，释放 ${formatBytes(
              report.freedBytes,
            )}`
          : `已卸载 ${app.name}，未找到可删除的安装目录，可在残留列表中检查`,
        "success",
      );
    } else {
      showToast(`已卸载 ${app.name}`, "success");
    }
    if (report.removedDirs.length > 0 && state.cleanupScan) {
      const removed = new Set(report.removedDirs);
      state.cleanupScan = {
        ...state.cleanupScan,
        candidates: state.cleanupScan.candidates.filter(
          (candidate) => !removed.has(candidate.path),
        ),
      };
    }
    void pruneMissingApps(true);
  } catch (error) {
    showToast(`卸载失败：${String(error)}`, "error");
  } finally {
    state.cleanupUninstallBusy = false;
    // 卸载结果条位于面板顶部，回到顶部才能看到释放量与失败原因。
    state.resetScroll = true;
    refreshActive();
  }
}

/* ── memory ─────────────────────────────────────────────────── */

function memoryModeCard(mode: MemoryMode, glyphName: string, title: string, desc: string): string {
  const active = state.settings.memoryMode === mode;
  return `<button class="mem-mode${active ? " is-active" : ""}" data-settings-action="memory-mode" data-value="${mode}" aria-pressed="${active}"${
    state.memoryBusy ? " disabled" : ""
  }>
    <span class="mem-mode-icon">${icon(glyphName)}</span>
    <span><strong>${title}</strong><small>${desc}</small></span>
  </button>`;
}

function memoryMetrics(): string {
  if (state.memoryError && !state.memoryStatus) {
    return perfState(`读取内存状态失败：${state.memoryError}`, true, "memory-refresh");
  }
  if (!state.memoryStatus) {
    return perfState("正在读取内存状态…", false, "memory-refresh");
  }
  const status = state.memoryStatus;
  const used = Math.max(0, Math.min(100, status.systemUsedPercent));
  const pressure = used >= 90 ? "紧张" : used >= 80 ? "偏高" : used >= 60 ? "正常" : "充足";
  const last = status.lastAction;
  const powerLabel =
    status.powerSource === "battery"
      ? `电池${status.batteryPercent != null ? ` ${status.batteryPercent}%` : ""}`
      : status.powerSource === "ac"
        ? "已接通电源"
        : "电源未知";
  const monitor =
    status.monitor === "event"
      ? "系统通知 · 零轮询"
      : status.monitor === "timer"
        ? `每 ${status.effectiveIntervalSec} 秒检查`
        : "手动固定";
  const commitPercent = Math.max(
    0,
    Math.min(100, status.systemCommitUsedPercent),
  );
  const commitUsed = Math.max(
    0,
    status.systemCommitTotalBytes - status.systemCommitAvailBytes,
  );
  const idleMinutes = Math.floor(status.userIdleSeconds / 60);
  const idleText = idleMinutes >= 1 ? `${idleMinutes} 分钟未操作` : "刚刚有操作";
  const meterTone = (percent: number): string =>
    percent >= 90 ? " is-high" : percent >= 80 ? " is-warn" : "";
  return `<div class="perf-metrics">
    <div class="perf-metric">
      <div class="perf-metric-head">${icon("cpu")}系统内存<strong>${used}%</strong></div>
      <div class="perf-metric-value">${formatBytes(status.systemAvailBytes)} 可用</div>
      <div class="perf-meter"><span style="width:${used}%" class="${meterTone(used)}"></span></div>
      <div class="perf-metric-sub">共 ${formatBytes(status.systemTotalBytes)} · 压力${pressure} · ${powerLabel}</div>
    </div>
    <div class="perf-metric">
      <div class="perf-metric-head">${icon("hard-drive")}启点占用<strong>工作集</strong></div>
      <div class="perf-metric-value">${formatBytes(status.selfWorkingSetBytes)}</div>
      <div class="perf-metric-sub">私有 ${formatBytes(status.selfPrivateBytes)}</div>
    </div>
    <div class="perf-metric">
      <div class="perf-metric-head">${icon("zap")}当前档位<strong>${monitor}</strong></div>
      <div class="perf-metric-value">${status.level === "low" ? "低占用" : "正常"}</div>
      <div class="perf-metric-sub">${
        status.level === "low" ? "后台与低内存时优先省内存" : "优先保证界面响应速度"
      }</div>
    </div>
    <div class="perf-metric">
      <div class="perf-metric-head">${icon("refresh")}上次调节<strong>本次运行</strong></div>
      <div class="perf-metric-value">${last ? escapeHtml(last.reason) : "暂无记录"}</div>
      <div class="perf-metric-sub">${
        last
          ? `${last.level === "low" ? "切到低占用" : "恢复正常"}${
              last.releasedBytes > 0 ? ` · 释放 ${formatBytes(last.releasedBytes)}` : ""
            }`
          : "本次运行尚未记录"
      }</div>
    </div>
    <div class="perf-metric">
      <div class="perf-metric-head">${icon("layers")}提交内存<strong>${commitPercent}%</strong></div>
      <div class="perf-metric-value">${formatBytes(commitUsed)} / ${formatBytes(
        status.systemCommitTotalBytes,
      )}</div>
      <div class="perf-meter"><span style="width:${commitPercent}%" class="${meterTone(commitPercent)}"></span></div>
      <div class="perf-metric-sub">${
        status.commitPressure ? "接近上限，建议关闭占用高的应用" : "页面文件与物理内存合计"
      }</div>
    </div>
    <div class="perf-metric">
      <div class="perf-metric-head">${icon("clock")}空闲释放<strong>${
        status.idleTrim ? "已开启" : "已关闭"
      }</strong></div>
      <div class="perf-metric-value">${idleText}</div>
      <div class="perf-metric-sub">离开 5 分钟后，内存 ≥60% 自动释放一次</div>
    </div>
  </div>`;
}

function memoryTrendCard(): string {
  const samples = state.memorySamples;
  if (samples.length < 2) {
    return `<div class="mem-trend">
      <div class="mem-trend-head">内存趋势<span>刷新后开始采样</span></div>
      <div class="mem-trend-empty">刷新一次或等待自动调节，就能看到使用率变化</div>
    </div>`;
  }
  const width = 360;
  const height = 52;
  const pad = 4;
  const values = samples.map((sample) => sample.used);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const step = (width - pad * 2) / (samples.length - 1);
  const points = samples.map((sample, index) => {
    const x = pad + index * step;
    const y = height - pad - ((sample.used - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = samples[samples.length - 1];
  return `<div class="mem-trend">
    <div class="mem-trend-head">内存趋势<span>最近 ${samples.length} 次采样 · 最高 ${max}% · 最低 ${min}%</span></div>
    <svg class="mem-trend-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="内存使用率趋势">
      <polygon class="mem-trend-area" points="${pad},${height - pad} ${points.join(" ")} ${width - pad},${height - pad}" />
      <polyline class="mem-trend-line" points="${points.join(" ")}" />
      <circle class="mem-trend-dot" cx="${(pad + (samples.length - 1) * step).toFixed(1)}" cy="${
        height - pad - ((last.used - min) / span) * (height - pad * 2)
      }" r="2.6" />
    </svg>
    <div class="mem-trend-foot">最新 ${last.used}% · ${new Date(last.at).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}</div>
  </div>`;
}

function memoryThresholdCard(): string {
  const lowOptions = MEMORY_LOW_OPTIONS;
  const recoverOptions = MEMORY_RECOVER_OPTIONS;
  const intervalOptions = MEMORY_INTERVAL_OPTIONS;
  const status = state.memoryStatus;
  const smart = state.settings.memorySmartThresholds;
  const chips = (action: string, values: number[], current: number, suffix: string) =>
    values
      .map(
        (value) =>
          `<button class="chip${value === current ? " is-active" : ""}" data-settings-action="${action}" data-value="${value}" data-focus-key="${action}-${value}">${value}${suffix}</button>`,
      )
      .join("");
  const totalGb = status ? status.systemTotalBytes / 1024 ** 3 : 0;
  const totalLabel =
    totalGb >= 10 ? `${Math.round(totalGb)} GB` : totalGb > 0 ? `${totalGb.toFixed(1)} GB` : "读取中";
  const manualRows = `<div class="setting-row">
      <div class="setting-copy"><div class="setting-title">策略预设</div><div class="setting-desc">一键套用阈值与释放偏好，之后仍可逐项调整。</div></div>
      <div class="setting-control"><div class="chips">${MEMORY_PRESETS.map((preset) => {
        const active =
          state.settings.memoryLowPercent === preset.low &&
          state.settings.memoryRecoverPercent === preset.recover &&
          state.settings.memoryTrimWorkingSet === preset.trim;
        return `<button class="chip${active ? " is-active" : ""}" data-settings-action="memory-preset" data-value="${preset.id}" data-focus-key="memory-preset-${preset.id}">${preset.label}</button>`;
      }).join("")}</div></div>
    </div>
    <div class="setting-row">
      <div class="setting-copy"><div class="setting-title">按本机推荐</div><div class="setting-desc">根据物理内存总量给出一组阈值，适合不想手动调的情况。</div></div>
      <div class="setting-control"><button class="ghost-btn" data-settings-action="memory-recommend" data-focus-key="memory-recommend">使用推荐值</button></div>
    </div>
    <div class="setting-row">
      <div class="setting-copy"><div class="setting-title">降档阈值</div><div class="setting-desc">系统内存使用率达到该值时，启点切到低占用。</div></div>
      <div class="setting-control"><div class="chips">${chips("memory-low", lowOptions, state.settings.memoryLowPercent, "%")}</div></div>
    </div>
    <div class="setting-row">
      <div class="setting-copy"><div class="setting-title">恢复阈值</div><div class="setting-desc">内存回落到该值以下后恢复正常档位，两个阈值会保留间隔避免反复切换。</div></div>
      <div class="setting-control"><div class="chips">${chips("memory-recover", recoverOptions, state.settings.memoryRecoverPercent, "%")}</div></div>
    </div>`;
  const smartRows = `<div class="setting-row">
      <div class="setting-copy"><div class="setting-title">本机识别</div><div class="setting-desc">物理内存 ${totalLabel}，当前可用 ${
        status ? formatBytes(status.systemAvailBytes) : "读取中"
      }；阈值随总内存和供电状态自动调整。</div></div>
      <div class="setting-control"><span class="mem-auto-value">降档 ${status?.effectiveLowPercent ?? "—"}% · 恢复 ${
        status?.effectiveRecoverPercent ?? "—"
      }%</span></div>
    </div>`;
  return `<div class="settings-card">
    <div class="setting-row">
      <div class="setting-copy"><div class="setting-title">按本机内存自动调整阈值</div><div class="setting-desc">自动识别物理内存总量与当前可用量；8 / 12 / 16 / 32 / 128 GB 会得到不同阈值，换内存后自动变化。</div></div>
      <div class="setting-control"><button class="switch" role="switch" aria-checked="${smart}" aria-label="按本机内存自动调整阈值，当前${
        smart ? "已开启" : "已关闭"
      }" data-settings-action="memory-smart-toggle" data-focus-key="memory-smart-toggle"></button></div>
    </div>
    ${smart ? smartRows : manualRows}
    ${
      state.settings.memoryMode === "custom"
        ? `<div class="setting-row">
            <div class="setting-copy"><div class="setting-title">检查间隔</div><div class="setting-desc">自定义模式会按这个间隔读取一次内存状态；自动模式不轮询。</div></div>
            <div class="setting-control"><div class="chips">${chips("memory-interval", intervalOptions, state.settings.memoryIntervalSec, " 秒")}</div></div>
          </div>
          <div class="setting-row">
            <div class="setting-copy"><div class="setting-title">自适应检查间隔</div><div class="setting-desc">${
              state.settings.memoryAdaptiveInterval
                ? `压力高时缩短到 15 秒，压力低时拉长到 120 秒；当前实际约 ${
                    state.memoryStatus?.effectiveIntervalSec ?? state.settings.memoryIntervalSec
                  } 秒。`
                : "固定按上面选择的间隔检查，不随压力变化。"
            }</div></div>
            <div class="setting-control"><button class="switch" role="switch" aria-checked="${
              state.settings.memoryAdaptiveInterval
            }" aria-label="自适应检查间隔，当前${
              state.settings.memoryAdaptiveInterval ? "已开启" : "已关闭"
            }" data-settings-action="memory-adaptive-toggle" data-focus-key="memory-adaptive-toggle"></button></div>
          </div>`
        : ""
    }
  </div>`;
}

function memoryManualCard(): string {
  const levels: { id: MemoryLevel; label: string; desc: string }[] = [
    { id: "low", label: "低占用", desc: "优先省内存，界面切换稍慢" },
    { id: "normal", label: "正常", desc: "优先响应速度" },
  ];
  return `<div class="settings-card">
    <div class="setting-row">
      <div class="setting-copy"><div class="setting-title">固定档位</div><div class="setting-desc">手动模式下不跟随系统内存压力变化。</div></div>
      <div class="setting-control"><div class="chips">${levels
        .map(
          (level) =>
            `<button class="chip${state.settings.memoryLevel === level.id ? " is-active" : ""}" data-settings-action="memory-level" data-value="${level.id}" data-focus-key="memory-level-${level.id}" title="${level.desc}">${level.label}</button>`,
        )
        .join("")}</div></div>
    </div>
  </div>`;
}

function memoryHistoryCard(): string {
  const history = state.memoryStatus?.history ?? [];
  if (!history.length) {
    return `<div class="settings-card mem-history">
      <div class="mem-history-head">调节记录<span>本次运行</span></div>
      <div class="mem-event"><div class="mem-event-copy"><strong>还没有调节记录</strong><small>触发自动调节或手动操作后会记在这里</small></div></div>
    </div>`;
  }
  const rows = history
    .slice(0, 5)
    .map(
      (action) => `<div class="mem-event">
        <span class="mem-event-dot${action.level === "low" ? " is-low" : ""}"></span>
        <div class="mem-event-copy"><strong>${escapeHtml(action.reason)}</strong><small>${
          action.level === "low" ? "切到低占用" : "恢复正常"
        }${action.releasedBytes > 0 ? ` · 释放 ${formatBytes(action.releasedBytes)}` : " · 未释放工作集"}</small></div>
      </div>`,
    )
    .join("");
  return `<div class="settings-card mem-history">
    <div class="mem-history-head">调节记录<span>本次运行 · 最近 ${history.length} 条</span></div>
    ${rows}
  </div>`;
}

function memoryTopCard(): string {
  if (state.memoryTopError && !state.memoryTop) {
    return `<div class="settings-card mem-history">
      <div class="mem-history-head">内存占用最高的应用<span>读取失败</span></div>
      <div class="mem-event"><div class="mem-event-copy"><strong>暂时读不到进程列表</strong><small>${escapeHtml(
        state.memoryTopError,
      )}</small></div></div>
    </div>`;
  }
  if (!state.memoryTop?.length) {
    return `<div class="settings-card mem-history">
      <div class="mem-history-head">内存占用最高的应用<span>${state.memoryTopLoading ? "读取中…" : "暂无数据"}</span></div>
    </div>`;
  }
  const skip = state.settings.memorySkipApps ?? [];
  const rows = state.memoryTop
    .slice(0, 4)
    .map((group) => {
      const guarded = processKeys(group).some((key) => skip.includes(key));
      const key = escapeHtml(group.key);
      const note = [
        `${group.items.length} 个进程`,
        group.protectedGroup ? "系统保护" : "",
        guarded ? "已保护 · 批量释放跳过" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<div class="mem-app-row">
        <span class="mem-app-icon">${escapeHtml(group.name.slice(0, 1).toUpperCase())}</span>
        <div class="mem-app-copy"><strong>${escapeHtml(group.title)}</strong><small>${note}</small></div>
        <span class="mem-app-size">${formatBytes(group.memoryBytes)}</span>
        <div class="mem-app-actions">
          <button class="mem-app-btn" data-settings-action="memory-app-trim" data-value="${key}" data-focus-key="memory-app-trim-${key}" title="只收缩工作集，不结束应用"${
            group.protectedGroup || state.memoryTrimBusy ? " disabled" : ""
          }>释放</button>
          <button class="mem-app-btn is-icon${guarded ? " is-on" : ""}" data-settings-action="memory-skip" data-value="${key}" data-focus-key="memory-skip-${key}" aria-pressed="${guarded}" aria-label="${
            guarded ? "从释放保护名单移除" : "加入释放保护名单"
          }" title="${
            guarded ? "从释放保护名单移除" : "加入释放保护名单：批量释放时跳过"
          }">${icon("shield")}</button>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="settings-card mem-history">
    <div class="mem-history-head">内存占用最高的应用<span>可单独释放工作集</span></div>
    ${rows}
    <div class="mem-top-foot">${backgroundAction(
      "ghost-btn",
      "去后台管理",
    )}<span>释放不结束应用；盾牌 = 批量释放时跳过</span></div>
  </div>`;
}

function memorySkipCard(): string {
  const skip = state.settings.memorySkipApps ?? [];
  if (!skip.length) {
    return `<div class="settings-card mem-history">
      <div class="mem-history-head">释放保护名单<span>暂无</span></div>
      <div class="mem-event"><div class="mem-event-copy"><strong>批量释放目前不会跳过任何应用</strong><small>在下方「内存占用最高的应用」里点盾牌，把游戏、编辑器、虚拟机等加入名单；「全部应用」与空闲释放都会跳过它们。</small></div></div>
    </div>`;
  }
  const chips = skip
    .map(
      (key) =>
        `<button class="chip is-active" data-settings-action="memory-skip-remove" data-value="${escapeHtml(
          key,
        )}" data-focus-key="memory-skip-list-${escapeHtml(key)}" title="点击移出保护名单">${escapeHtml(
          key,
        )} ×</button>`,
    )
    .join("");
  return `<div class="settings-card">
    <div class="setting-row">
      <div class="setting-copy"><div class="setting-title">释放保护名单</div><div class="setting-desc">「全部应用」与空闲释放会跳过这些应用，避免让正在使用的工具重新载入；点一下即可移除。仅启点范围不受影响。</div></div>
      <div class="setting-control"><div class="chips">${chips}</div></div>
    </div>
  </div>`;
}

function memoryPanel(): string {
  const trim = state.settings.memoryTrimWorkingSet;
  const trimScope = state.settings.memoryTrimScope;
  const pressure = state.memoryStatus?.systemUsedPercent ?? 0;
  const paused = state.memoryStatus?.fullscreenPaused ?? false;
  const emergency = state.memoryStatus?.emergencyLow ?? false;
  const emergencyAlert = emergency
    ? `<div class="mem-alert">${icon("info")}<span>可用内存已低于安全线，启点已强制进入低占用；恢复到安全线以上后自动解除。</span></div>`
    : "";
  const commitAlert = state.memoryStatus?.commitPressure
    ? `<div class="mem-alert">${icon("info")}<span>提交内存接近上限（${
        state.memoryStatus.systemCommitUsedPercent
      }%），页面文件也快用满；建议关闭占用高的应用或调大虚拟内存。</span>${backgroundAction(
        "ghost-btn",
        "查看应用",
      )}</div>`
    : "";
  const alert =
    pressure >= 80
      ? `<div class="mem-alert">${icon("info")}<span>系统内存压力${pressure >= 90 ? "紧张" : "偏高"}，已用 ${pressure}%。可以先处理占用最高的应用。</span>${backgroundAction("ghost-btn", "查看应用")}</div>`
      : "";
  const pauseAlert = paused
    ? `<div class="mem-alert">${icon("eye-off")}<span>检测到全屏应用，后台释放与图标缓存清理已暂停；退出全屏后自动恢复。</span></div>`
    : "";
  const powerNote =
    state.memoryStatus?.powerSource === "battery" && state.memoryStatus.powerAware
      ? `<div class="mem-power">${icon("power")}<span>电池供电，降档阈值临时下调为 ${state.memoryStatus.effectiveLowPercent}%，恢复阈值 ${state.memoryStatus.effectiveRecoverPercent}%。</span></div>`
      : "";
  return `<div class="settings-section">
    <div class="perf-head">
      <div>
        <h3 class="settings-section-title">内存动态管理</h3>
        <p class="background-lead">默认只调节启点自身；选择“全部应用”时会释放其它程序的空闲工作集，不结束应用。</p>
      </div>
      <button class="ghost-btn" data-settings-action="memory-refresh" data-focus-key="memory-refresh"${
        state.memoryLoading ? " disabled" : ""
      }>${icon("refresh")}刷新</button>
    </div>
    ${memoryMetrics()}
    ${memoryTrendCard()}
    ${
      state.memoryStatus
        ? `<div class="mem-summary"><span class="mem-summary-dot"></span>累计释放 ${formatBytes(
            state.memoryStatus.totalReleasedBytes,
          )} · 今日释放 ${formatBytes(state.memoryStatus.todayReleasedBytes)}（调节 ${
            state.memoryStatus.todayAdjustCount
          } 次）· 今日峰值 ${state.memoryStatus.todayPeakPercent}% · 最低可用 ${formatBytes(
            state.memoryStatus.todayMinAvailBytes,
          )}</div>`
        : ""
    }
    ${emergencyAlert}
    ${commitAlert}
    ${alert}
    ${pauseAlert}
    ${powerNote}
    <div class="settings-card">
      <div class="mem-modes">
        ${memoryModeCard("auto", "zap", "自动", "低内存通知直接降档，不轮询")}
        ${memoryModeCard("custom", "settings", "自定义", "按阈值与间隔检查并调节")}
        ${memoryModeCard("manual", "cpu", "手动", "固定档位，不随系统变化")}
      </div>
    </div>
    ${state.settings.memoryMode === "manual" ? memoryManualCard() : memoryThresholdCard()}
    <div class="settings-card">
      <div class="setting-row">
        <div class="setting-copy"><div class="setting-title">隐藏或低内存时释放工作集</div><div class="setting-desc">窗口隐藏或内存紧张时调用 EmptyWorkingSet，按下面的释放范围执行；重新打开时可能多一次载入。</div></div>
        <div class="setting-control"><button class="switch" role="switch" aria-checked="${trim}" aria-label="隐藏或低内存时释放工作集，当前${
          trim ? "已开启" : "已关闭"
        }" data-settings-action="memory-trim-toggle" data-focus-key="memory-trim-toggle"></button></div>
      </div>
      <div class="setting-row">
        <div class="setting-copy"><div class="setting-title">释放范围</div><div class="setting-desc">仅启点最安全；全部应用会释放其它程序的工作集，下次访问时重新载入，可能短暂变慢。电池供电或全屏时自动退回仅启点。</div></div>
        <div class="setting-control"><div class="chips">
          <button class="chip${trimScope === "self" ? " is-active" : ""}" data-settings-action="memory-scope" data-value="self" data-focus-key="memory-scope-self">仅启点</button>
          <button class="chip${trimScope === "system" ? " is-active" : ""}" data-settings-action="memory-scope" data-value="system" data-focus-key="memory-scope-system">全部应用</button>
        </div></div>
      </div>
      <div class="setting-row">
        <div class="setting-copy"><div class="setting-title">空闲时自动释放</div><div class="setting-desc">键鼠 5 分钟无操作且内存使用率 ≥60% 时，按释放范围执行一次，最多每 10 分钟一次；全屏时跳过。</div></div>
        <div class="setting-control"><button class="switch" role="switch" aria-checked="${
          state.settings.memoryIdleTrim
        }" aria-label="空闲时自动释放，当前${
          state.settings.memoryIdleTrim ? "已开启" : "已关闭"
        }" data-settings-action="memory-idle-toggle" data-focus-key="memory-idle-toggle"></button></div>
      </div>
      <div class="setting-row">
        <div class="setting-copy"><div class="setting-title">隐藏时清理图标缓存</div><div class="setting-desc">隐藏或低内存时清空界面图标缓存，只影响启点；再次打开会重新读取图标，可能短暂显示占位。</div></div>
        <div class="setting-control"><button class="switch" role="switch" aria-checked="${
          state.settings.memoryDropIcons
        }" aria-label="隐藏时清理图标缓存，当前${
          state.settings.memoryDropIcons ? "已开启" : "已关闭"
        }" data-settings-action="memory-icons-toggle" data-focus-key="memory-icons-toggle"></button></div>
      </div>
      <div class="setting-row">
        <div class="setting-copy"><div class="setting-title">全屏/游戏时暂停释放</div><div class="setting-desc">检测到前台全屏应用时，暂不释放工作集、不清理图标缓存；退出全屏后自动恢复。</div></div>
        <div class="setting-control"><button class="switch" role="switch" aria-checked="${
          state.settings.memoryPauseFullscreen
        }" aria-label="全屏或游戏时暂停释放，当前${
          state.settings.memoryPauseFullscreen ? "已开启" : "已关闭"
        }" data-settings-action="memory-fullscreen-toggle" data-focus-key="memory-fullscreen-toggle"></button></div>
      </div>
      <div class="setting-row">
        <div class="setting-copy"><div class="setting-title">电池供电时更积极降档</div><div class="setting-desc">使用电池时降档与恢复阈值各下调 5 个百分点；接通电源后按设定值执行。</div></div>
        <div class="setting-control"><button class="switch" role="switch" aria-checked="${
          state.settings.memoryPowerAware
        }" aria-label="电池供电时更积极降档，当前${
          state.settings.memoryPowerAware ? "已开启" : "已关闭"
        }" data-settings-action="memory-power-toggle" data-focus-key="memory-power-toggle"></button></div>
      </div>
    </div>
    ${memorySkipCard()}
    ${memoryHistoryCard()}
    ${memoryTopCard()}
    <div class="boot-actions">
      <button class="primary-btn" data-settings-action="memory-apply" data-focus-key="memory-apply"${
        state.memoryBusy ? " disabled" : ""
      }>${state.memoryBusy ? "正在调节…" : "立即检查并调节"}</button>
      <button class="ghost-btn" data-settings-action="memory-trim" data-focus-key="memory-trim"${
        state.memoryTrimBusy ? " disabled" : ""
      }>${state.memoryTrimBusy ? "正在释放…" : "释放一次内存"}</button>
    </div>
    <div class="background-note">${icon("info")}<span>“释放一次内存”只收缩进程工作集，不会关闭应用；上方列表里的“释放”只作用于该应用，盾牌把它加入保护名单后批量释放会跳过。系统级深度清理（待机列表、已修改页面）已移动到「系统优化」插件。自动模式由 Windows 低内存/恢复通知触发，低内存通知会直接降档，恢复通知会直接尝试回升，不依赖使用率是否刚好越过阈值；定时检查的档位切换至少间隔 15 秒，系统通知不受冷却影响。提交内存接近上限时也会直接降档。释放范围默认仅启点，选择全部应用后会影响其它程序的下次载入速度。窗口隐藏时还会挂起 WebView2，显示前自动恢复。今日峰值与最低可用每分钟落盘一次，只保存在本机。</span></div>
  </div>`;
}

function setMemoryStatus(status: MemoryStatus): void {
  state.memoryStatus = status;
  const now = Date.now();
  const last = state.memorySamples[state.memorySamples.length - 1];
  if (last && now - last.at < 10_000) {
    last.at = now;
    last.used = status.systemUsedPercent;
  } else {
    state.memorySamples.push({ at: now, used: status.systemUsedPercent });
  }
  if (state.memorySamples.length > 40) {
    state.memorySamples.splice(0, state.memorySamples.length - 40);
  }
}

async function loadMemoryStatus(forceTop = false): Promise<void> {
  if (state.memoryLoading || !moduleReady("memory")) return;
  state.memoryLoading = true;
  state.memoryError = null;
  refreshActive();
  try {
    setMemoryStatus(await api.memoryStatus());
    if (forceTop || !state.memoryTop) void loadMemoryTop();
  } catch (error) {
    state.memoryError = String(error);
  } finally {
    state.memoryLoading = false;
    refreshActive();
  }
}

async function loadMemoryTop(): Promise<void> {
  if (state.memoryTopLoading) return;
  state.memoryTopLoading = true;
  state.memoryTopError = null;
  refreshActive();
  try {
    const items = await api.listProcesses();
    state.memoryTop = buildProcessGroups(items)
      .sort((a, b) => b.memoryBytes - a.memoryBytes)
      .slice(0, 4);
  } catch (error) {
    state.memoryTopError = String(error);
  } finally {
    state.memoryTopLoading = false;
    refreshActive();
  }
}

function patchMemory(patch: Partial<Settings>): void {
  let next = { ...patch };
  if (next.memoryLowPercent !== undefined) {
    const low = next.memoryLowPercent;
    const valid = MEMORY_RECOVER_OPTIONS.filter((value) => value + 5 <= low);
    const current = next.memoryRecoverPercent ?? state.settings.memoryRecoverPercent;
    next = {
      ...next,
      memoryRecoverPercent: Math.min(current, valid[valid.length - 1] ?? MEMORY_RECOVER_OPTIONS[0]),
    };
  } else if (next.memoryRecoverPercent !== undefined) {
    const recover = next.memoryRecoverPercent;
    const low = next.memoryLowPercent ?? state.settings.memoryLowPercent;
    if (recover + 5 > low) {
      const valid = MEMORY_RECOVER_OPTIONS.filter((value) => value + 5 <= low);
      next = {
        ...next,
        memoryRecoverPercent: valid[valid.length - 1] ?? MEMORY_RECOVER_OPTIONS[0],
      };
    }
  }
  patchSettings(next);
  saveChain = saveChain.then(async () => {
    try {
      setMemoryStatus(await api.memoryStatus());
      state.memoryError = null;
    } catch (error) {
      state.memoryError = String(error);
    }
    refreshActive();
  });
}

async function applyMemoryNow(): Promise<void> {
  if (state.memoryBusy) return;
  state.memoryBusy = true;
  refreshActive();
  try {
    const status = await api.memoryApply();
    setMemoryStatus(status);
    state.memoryError = null;
    showToast(
      `已检查，当前为${status.level === "low" ? "低占用" : "正常"}档位`,
      "success",
    );
  } catch (error) {
    showToast(`调节内存档位失败：${String(error)}`, "error");
  } finally {
    state.memoryBusy = false;
    refreshActive();
  }
}

async function trimMemoryNow(): Promise<void> {
  if (state.memoryTrimBusy) return;
  state.memoryTrimBusy = true;
  refreshActive();
  try {
    const status = await api.memoryTrim();
    setMemoryStatus(status);
    state.memoryError = null;
    const freed = status.lastAction?.releasedBytes ?? 0;
    showToast(
      freed > 0 ? `已释放 ${formatBytes(freed)} 工作集` : "工作集已在低位，本次没有可释放的部分",
      "success",
    );
  } catch (error) {
    showToast(`释放内存失败：${String(error)}`, "error");
  } finally {
    state.memoryTrimBusy = false;
    refreshActive();
  }
}

async function trimMemoryApp(group: ProcessGroup): Promise<void> {
  if (state.memoryTrimBusy) return;
  state.memoryTrimBusy = true;
  refreshActive();
  try {
    const status = await api.memoryTrimApp(
      group.title,
      group.items.map((item) => item.pid),
    );
    setMemoryStatus(status);
    state.memoryError = null;
    const freed = status.lastAction?.releasedBytes ?? 0;
    showToast(
      freed > 0
        ? `${group.title} 已释放 ${formatBytes(freed)} 工作集，应用不会退出`
        : `${group.title} 的工作集已在低位，本次没有可释放的部分`,
      freed > 0 ? "success" : "info",
    );
    void loadMemoryTop();
  } catch (error) {
    showToast(`释放 ${group.title} 失败：${String(error)}`, "error");
  } finally {
    state.memoryTrimBusy = false;
    refreshActive();
  }
}

function processKeys(group: ProcessGroup): string[] {
  const keys = new Set<string>();
  for (const item of group.items) {
    const key = item.name.trim().toLowerCase().replace(/\.exe$/, "") || item.name;
    keys.add(key);
  }
  return [...keys];
}

function toggleSkipApp(group: ProcessGroup): void {
  const current = state.settings.memorySkipApps ?? [];
  const keys = processKeys(group);
  const guarded = keys.some((key) => current.includes(key));
  const next = guarded
    ? current.filter((item) => !keys.includes(item))
    : [...current, ...keys.filter((key) => !current.includes(key))];
  patchMemory({ memorySkipApps: next });
  showToast(
    guarded
      ? `已把 ${group.title} 移出释放保护名单`
      : `已保护 ${group.title}：「全部应用」与空闲释放会跳过它`,
    "info",
  );
}

function removeSkipKey(key: string): void {
  if (!key) return;
  const next = (state.settings.memorySkipApps ?? []).filter((item) => item !== key);
  patchMemory({ memorySkipApps: next });
}

async function purgeMemorySystem(): Promise<void> {
  if (state.memoryPurgeBusy) return;
  state.memoryPurgeBusy = true;
  refreshActive();
  try {
    const freed = await api.memoryPurgeSystem();
    showToast(
      freed > 0
        ? `已清理系统缓存与待机列表，可用内存增加约 ${formatBytes(freed)}`
        : "系统缓存与待机列表已清理",
      "success",
    );
    await loadMemoryStatus(true);
    state.memoryError = null;
  } catch (error) {
    showToast(`清理系统缓存失败：${String(error)}`, "error");
  } finally {
    state.memoryPurgeBusy = false;
    refreshActive();
  }
}

function smartThresholdsFor(total: number): [number, number] {
  const gb = total / 1024 ** 3;
  if (gb > 0 && gb <= 8.5) return [80, 50];
  if (gb > 0 && gb <= 12.5) return [82, 52];
  if (gb > 0 && gb <= 16.5) return [85, 55];
  if (gb > 0 && gb <= 24.5) return [87, 60];
  if (gb > 0 && gb <= 32.5) return [88, 62];
  if (gb > 0 && gb <= 64.5) return [90, 65];
  return [90, 70];
}

function recommendMemory(): void {
  const total = state.memoryStatus?.systemTotalBytes ?? 0;
  const [low, recover] = smartThresholdsFor(total);
  patchMemory({
    memoryLowPercent: low,
    memoryRecoverPercent: recover,
    memoryTrimWorkingSet: true,
  });
  const gb = total / 1024 ** 3;
  showToast(
    `已按本机${gb > 0 ? ` ${Math.round(gb)} GB ` : " "}内存应用推荐阈值`,
    "success",
  );
}

function bootStatus(value: boolean | null, good: string, bad: string): string {
  if (value === null) {
    return `<span class="boot-status is-pending"><span class="inline-spinner"></span>检测中</span>`;
  }
  return `<span class="boot-status ${value ? "is-good" : "is-bad"}">${value ? good : bad}</span>`;
}

function hotkeyKbd(accelerator: string): string {
  if (!accelerator.trim()) return `<span class="hotkey-empty">未设置</span>`;
  return accelerator
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part.toLowerCase() === "super" ? "Win" : part,
    )
    .map((part) => `<kbd>${escapeHtml(part)}</kbd>`)
    .join(`<i>+</i>`);
}

function hotkeyBindingRow(appId: string, accelerator: string): string {
  const app = state.apps.find((item) => item.id === appId);
  const status = state.hotkeyStatus?.bindings.find((item) => item.appId === appId);
  const listening =
    state.hotkeyCapture?.kind === "app" && state.hotkeyCapture.appId === appId;
  const stateLabel = listening
    ? `<span class="hotkey-state is-live">录制中</span>`
    : status
      ? `<span class="hotkey-state ${status.ok ? "is-good" : "is-bad"}">${
          status.ok ? "已生效" : "未生效"
        }</span>`
      : `<span class="hotkey-state">待应用</span>`;
  return `<div class="hotkey-row${listening ? " is-listening" : ""}">
    <div class="hotkey-app-name" title="${escapeHtml(app?.name ?? appId)}">${escapeHtml(
      app?.name ?? "已移除的应用",
    )}</div>
    <div class="hotkey-combo">${
      listening ? `<span class="hotkey-live">按下组合键…</span>` : hotkeyKbd(accelerator)
    }</div>
    ${stateLabel}
    <div class="hotkey-actions">
      <button class="ghost-btn" data-settings-action="${
        listening ? "boot-hotkey-cancel" : "boot-hotkey-app-edit"
      }" data-id="${escapeHtml(appId)}">${listening ? "取消" : "修改"}</button>
      <button class="mini-danger" data-settings-action="boot-hotkey-app-delete" data-id="${escapeHtml(
        appId,
      )}"${listening ? " disabled" : ""}>删除</button>
    </div>
  </div>`;
}

function hotkeyCaptureBar(label: string): string {
  return `<div class="hotkey-capture-bar">${icon("zap")}<span>正在为 ${escapeHtml(
    label,
  )} 录制快捷键，按下组合键（Esc 取消）</span></div>`;
}

function bootPanel(): string {
  if (state.bootError) {
    return perfState(`读取启动设置失败：${state.bootError}`, true, "boot-refresh");
  }
  const autoStart = state.autoStart === true;
  const autoBusy = state.autoStart === null || state.bootLoading || state.autoStartBusy;
  const settings = state.settings;
  const hotkey = state.hotkeyStatus;
  const capture = state.hotkeyCapture;
  const bindings = Object.entries(settings.appHotkeys);
  const availableApps = state.apps.filter((app) => !(app.id in settings.appHotkeys));
  const toggleListening = capture?.kind === "toggle";
  const captureApp =
    capture?.kind === "app"
      ? state.apps.find((app) => app.id === capture.appId)
      : null;
  const hotkeyErrors = hotkey?.errors.length
    ? `<div class="background-note is-warn">${icon("info")}<span>${escapeHtml(
        hotkey.errors.join("；"),
      )}</span></div>`
    : "";
  const appOptions = availableApps
    .map(
      (app) =>
        `<option value="${escapeHtml(app.id)}"${
          state.hotkeyAppPick === app.id ? " selected" : ""
        }>${escapeHtml(app.name)}</option>`,
    )
    .join("");

  return `<div class="settings-section">
    <div class="perf-head">
      <div>
        <h3 class="settings-section-title">启动与托盘</h3>
        <p class="background-lead">${
          isTauri
            ? `关闭窗口${settings.closeToTray ? "隐藏到托盘" : "直接退出"}；按 ${escapeHtml(
                settings.hotkeyToggle,
              )} 或点击托盘图标唤出启点。`
            : "此页为桌面版能力预览；托盘、全局快捷键和开机登录启动仅在 Windows 桌面客户端生效。"
        }</p>
      </div>
      <button class="ghost-btn" data-settings-action="boot-refresh" data-focus-key="boot-refresh"${
        state.bootLoading ? " disabled" : ""
      }>${icon("refresh")}刷新</button>
    </div>
    <div class="settings-card">
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-title">开机自启动</div>
          <div class="setting-desc">${
            !isTauri
              ? `浏览器预览仅演示开关状态，不会写入注册表；桌面版开启后登录 Windows 会自动在系统托盘运行。`
              : autoStart
                ? "已启用：登录 Windows 后自动隐藏到系统托盘，不弹出主窗口。"
                : "启用后登录 Windows 时自动在系统托盘运行，需要时按快捷键唤出。"
          }</div>
        </div>
        <div class="setting-control">
          <button class="switch" role="switch" aria-checked="${autoStart}" aria-label="开机自启动，当前${
            autoStart ? "已开启" : "已关闭"
          }" data-settings-action="autostart-toggle" data-focus-key="autostart-toggle"${
            autoBusy ? " disabled" : ""
          }></button>
        </div>
      </div>
    </div>

    <div class="perf-head">
      <div>
        <h3 class="settings-section-title">全局快捷键</h3>
        <p class="background-lead">在任意程序中生效；修改后自动保存并重新注册。</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-title">显示 / 隐藏启点</div>
          <div class="setting-desc">${
            !isTauri
              ? "浏览器预览不注册全局热键；桌面版可自定义组合键。"
              : toggleListening
                ? "按下新的组合键，Esc 取消。"
                : "点击“修改”后按下组合键；至少包含 Ctrl / Alt / Win 之一（Shift 可叠加）。"
          }</div>
        </div>
        <div class="setting-control hotkey-control">
          <span class="boot-key">${
            toggleListening
              ? `<span class="hotkey-live">按下组合键…</span>`
              : hotkeyKbd(settings.hotkeyToggle)
          }</span>
          ${
            !isTauri
              ? `<span class="boot-status is-pending">仅桌面版</span>`
              : bootStatus(hotkey?.toggleOk ?? null, "可用", "被占用")
          }
          <button class="ghost-btn" data-settings-action="${
            toggleListening ? "boot-hotkey-cancel" : "boot-hotkey-edit"
          }">${toggleListening ? "取消" : "修改"}</button>
          <button class="ghost-btn" data-settings-action="boot-hotkey-reset">恢复默认</button>
        </div>
      </div>
      ${toggleListening ? hotkeyCaptureBar("显示 / 隐藏启点") : ""}
      ${hotkeyErrors}
    </div>

    <div class="perf-head">
      <div>
        <h3 class="settings-section-title">应用快捷键</h3>
        <p class="background-lead">最多 20 个；按下后直接启动对应应用，不打开启点窗口。</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="hotkey-add">
        <select class="hotkey-select" data-hotkey-app-pick aria-label="选择要绑定快捷键的应用"${
          capture ? " disabled" : ""
        }>
          <option value="">选择应用…</option>
          ${appOptions}
        </select>
        <button class="ghost-btn" data-settings-action="boot-hotkey-app-add"${
          capture || bindings.length >= 20 || availableApps.length === 0
            ? " disabled"
            : ""
        }>${bindings.length >= 20 ? "已达上限" : "录制快捷键"}</button>
      </div>
      ${capture?.kind === "app" ? hotkeyCaptureBar(captureApp?.name ?? "该应用") : ""}
      ${
        bindings.length === 0
          ? `<div class="hotkey-empty-note">${icon("info")}<span>还没有应用快捷键。选择应用后点击“录制快捷键”，按下组合键即可。</span></div>`
          : `<div class="hotkey-list">${bindings
              .map(([appId, accelerator]) => hotkeyBindingRow(appId, accelerator))
              .join("")}</div>`
      }
    </div>

    <div class="perf-head">
      <div>
        <h3 class="settings-section-title">系统托盘</h3>
        <p class="background-lead">托盘常驻，关闭窗口时可选择隐藏或退出。</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-title">托盘状态</div>
          <div class="setting-desc">${
            !isTauri
              ? "浏览器预览没有系统托盘；桌面版左键点击托盘图标显示窗口。"
              : `左键点击托盘图标显示窗口；右键菜单可显示、隐藏、退出，并列出常用应用的快捷启动。${
                  state.trayAvailable === false ? "当前托盘图标创建失败。" : ""
                }`
          }</div>
        </div>
        <div class="setting-control">${
          !isTauri
            ? `<span class="boot-status is-pending">仅桌面版</span>`
            : bootStatus(state.trayAvailable, "已启用", "不可用")
        }</div>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-title">关闭窗口时隐藏到托盘</div>
          <div class="setting-desc">${
            !isTauri
              ? "浏览器预览关闭标签页即结束；桌面版可自行选择关闭行为。"
              : state.trayAvailable === false
                ? "系统托盘不可用，关闭窗口会直接退出启点。"
                : settings.closeToTray
                  ? "点击关闭按钮或 Alt+F4 时隐藏到托盘，程序继续运行。"
                  : "点击关闭按钮或 Alt+F4 直接退出启点，托盘图标同时消失。"
          }</div>
        </div>
        <div class="setting-control">
          <button class="switch" role="switch" aria-checked="${settings.closeToTray}" aria-label="关闭窗口时隐藏到托盘" data-settings-action="boot-close-toggle"${
            isTauri && state.trayAvailable === false ? " disabled" : ""
          }></button>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-title">托盘快捷启动</div>
          <div class="setting-desc">${
            !isTauri
              ? "浏览器预览无托盘菜单；桌面版可在右键菜单顶部直接启动常用应用。"
              : state.trayAvailable === false
                ? "系统托盘不可用，无法显示快捷启动菜单。"
                : "右键菜单顶部列出常用应用（最多 6 个）；未固定任何应用时显示最近使用。"
          }</div>
        </div>
        <div class="setting-control">
          <button class="switch" role="switch" aria-checked="${settings.trayQuickApps}" aria-label="托盘快捷启动" data-settings-action="boot-tray-quick"${
            isTauri && state.trayAvailable === false ? " disabled" : ""
          }></button>
        </div>
      </div>
    </div>
    <div class="boot-actions">
      <button class="ghost-btn" data-settings-action="boot-hide" data-focus-key="boot-hide"${
        state.trayAvailable === false
          ? ` disabled aria-disabled="true" title="${
              isTauri ? "系统托盘不可用，无法隐藏窗口" : "浏览器预览没有系统托盘"
            }"`
          : ""
      }>${icon("eye-off")}立即隐藏到托盘</button>
      <button class="mini-danger${state.quitPending ? " is-confirming" : ""}" data-settings-action="boot-quit" data-focus-key="boot-quit">${
        state.quitPending ? "确认退出" : "退出启点"
      }</button>
    </div>
    <div class="background-note">${icon("info")}<span>${
      isTauri
        ? `退出后托盘图标会消失，开机自启动设置仍保留。以后可在任务栏右下角托盘或按 ${escapeHtml(
            settings.hotkeyToggle,
          )} 找回启点。`
        : "浏览器预览退出只会关闭标签页；桌面版退出后会移除托盘图标，开机自启动设置仍然保留。"
    }</span></div>
  </div>`;
}

async function loadBootState(): Promise<void> {
  if (state.bootLoading || !moduleReady("boot")) return;
  state.bootLoading = true;
  state.bootError = null;
  refreshActive();
  try {
    const [autoStart, hotkey, trayAvailable] = await Promise.all([
      api.autostartStatus(),
      api.hotkeyStatus(),
      api.trayStatus(),
    ]);
    state.autoStart = autoStart;
    state.hotkeyStatus = hotkey;
    state.trayAvailable = trayAvailable;
    if (!state.hotkeyAppPick) {
      const first = state.apps.find(
        (app) => !(app.id in state.settings.appHotkeys),
      );
      state.hotkeyAppPick = first?.id ?? "";
    }
    syncCloseHint(trayAvailable);
  } catch (error) {
    state.bootError = String(error);
  } finally {
    state.bootLoading = false;
    refreshActive();
  }
}

async function toggleAutostart(): Promise<void> {
  if (state.autoStart === null || state.autoStartBusy) return;
  state.autoStartBusy = true;
  refreshActive();
  try {
    const enabled = await api.setAutostart(!state.autoStart);
    state.autoStart = enabled;
    showToast(
      enabled
        ? "已开启开机自启动，登录后将隐藏到系统托盘"
        : "已关闭开机自启动",
      "success",
    );
  } catch (error) {
    showToast(`修改开机自启动失败：${String(error)}`, "error");
  } finally {
    state.autoStartBusy = false;
    refreshActive();
  }
}

async function loadHotkeyStatus(): Promise<void> {
  try {
    state.hotkeyStatus = await api.hotkeyStatus();
    refreshActive();
  } catch {
    // 状态读取失败不阻塞设置修改
  }
}

function startHotkeyCapture(
  target: { kind: "toggle" } | { kind: "app"; appId: string },
): void {
  state.hotkeyCapture = target;
  refreshActive();
}

function cancelHotkeyCapture(): void {
  state.hotkeyCapture = null;
  refreshActive();
}

function acceleratorFromEvent(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");

  const code = event.code;
  let name: string | null = null;
  if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) name = code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) name = code;
  else if (event.key === " ") name = "Space";
  else if (
    ["Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown"].includes(
      event.key,
    )
  ) {
    name = event.key;
  } else if (event.key === "ArrowUp") name = "Up";
  else if (event.key === "ArrowDown") name = "Down";
  else if (event.key === "ArrowLeft") name = "Left";
  else if (event.key === "ArrowRight") name = "Right";

  if (!name) return null;
  const strong = event.ctrlKey || event.altKey || event.metaKey;
  if (!strong && !/^F\d+$/.test(name)) return null;
  return [...parts, name].join("+");
}

async function commitHotkey(combo: string): Promise<void> {
  const capture = state.hotkeyCapture;
  state.hotkeyCapture = null;
  if (!capture) return;
  const lower = combo.toLowerCase();
  if (capture.kind === "toggle") {
    const conflict = Object.entries(state.settings.appHotkeys).find(
      ([, accelerator]) => accelerator.toLowerCase() === lower,
    );
    if (conflict) {
      showToast("这个组合已经用于应用快捷键，请换一个", "error");
      refreshActive();
      return;
    }
    state.settings = { ...state.settings, hotkeyToggle: combo };
  } else {
    const conflict =
      state.settings.hotkeyToggle.toLowerCase() === lower ||
      Object.entries(state.settings.appHotkeys).some(
        ([id, accelerator]) =>
          id !== capture.appId && accelerator.toLowerCase() === lower,
      );
    if (conflict) {
      showToast("这个组合已被其它快捷键占用，请换一个", "error");
      refreshActive();
      return;
    }
    state.settings = {
      ...state.settings,
      appHotkeys: { ...state.settings.appHotkeys, [capture.appId]: combo },
    };
    const next = state.apps.find((app) => !(app.id in state.settings.appHotkeys));
    state.hotkeyAppPick = next?.id ?? "";
  }
  refreshActive();
  await queueSaveAndWait();
  await loadHotkeyStatus();
  const ok =
    capture.kind === "toggle"
      ? state.hotkeyStatus?.toggleOk !== false
      : state.hotkeyStatus?.bindings.find((item) => item.appId === capture.appId)?.ok !==
        false;
  showToast(
    ok ? `已设置快捷键：${combo}` : `${combo} 未能注册，可能已被其它程序占用`,
    ok ? "success" : "error",
  );
}

async function deleteAppHotkey(appId: string): Promise<void> {
  if (!(appId in state.settings.appHotkeys)) return;
  const next = { ...state.settings.appHotkeys };
  delete next[appId];
  state.settings = { ...state.settings, appHotkeys: next };
  if (state.hotkeyCapture?.kind === "app" && state.hotkeyCapture.appId === appId) {
    state.hotkeyCapture = null;
  }
  refreshActive();
  await queueSaveAndWait();
  await loadHotkeyStatus();
  showToast("已移除该应用的快捷键", "info");
}

async function resetToggleHotkey(): Promise<void> {
  state.hotkeyCapture = null;
  state.settings = { ...state.settings, hotkeyToggle: "Ctrl+Alt+Q" };
  refreshActive();
  await queueSaveAndWait();
  await loadHotkeyStatus();
  showToast("已恢复默认快捷键 Ctrl + Alt + Q", "info");
}

function toggleCloseToTray(): void {
  if (isTauri && state.trayAvailable === false) return;
  const closeToTray = !state.settings.closeToTray;
  patchSettings({ closeToTray });
  showToast(
    closeToTray ? "关闭窗口时将隐藏到托盘" : "关闭窗口时将直接退出启点",
    "info",
  );
}

function toggleTrayQuickApps(): void {
  if (isTauri && state.trayAvailable === false) return;
  const trayQuickApps = !state.settings.trayQuickApps;
  patchSettings({ trayQuickApps });
  showToast(
    trayQuickApps ? "托盘右键菜单将显示常用应用" : "已关闭托盘快捷启动",
    "info",
  );
}

async function hideToTray(): Promise<void> {
  if (!isTauri) {
    showToast("预览模式不会隐藏窗口；桌面版会隐藏到系统托盘", "info");
    return;
  }
  if (state.trayAvailable === false) {
    showToast("系统托盘不可用，当前无法隐藏窗口", "error");
    return;
  }
  closeSettings();
  try {
    await hideWindow();
  } catch (error) {
    showToast(`隐藏窗口失败：${String(error)}`, "error");
  }
}

function requestQuitApp(): void {
  if (!state.quitPending) {
    state.quitPending = true;
    refreshActive();
    window.setTimeout(() => {
      if (state.quitPending) {
        state.quitPending = false;
        refreshActive();
      }
    }, 4000);
    return;
  }
  state.quitPending = false;
  if (!isTauri) {
    refreshActive();
    showToast("预览模式不会退出启点；桌面版会结束进程并移除托盘图标", "info");
    return;
  }
  void api.quitApp().catch((error) => showToast(`退出失败：${String(error)}`, "error"));
}

function releaseCard(release: Release, current: boolean): string {
  const sections = release.sections
    .map(
      (section) => `<div class="release-section">
        <h4>${escapeHtml(section.title)}</h4>
        <ul class="release-list">${section.items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>
      </div>`,
    )
    .join("");
  return `<article class="release-card${current ? " is-current" : ""}">
    <div class="release-head">
      <div class="release-title"><span class="release-version">v${escapeHtml(
        release.version,
      )}</span><span class="release-date">${escapeHtml(release.date)}</span></div>
      ${current ? '<span class="release-badge">当前版本</span>' : ""}
    </div>
    ${sections}
  </article>`;
}

function updatesPanel(): string {
  const current = RELEASES.find((release) => release.version === APP_VERSION) ?? RELEASES[0];
  const older = current
    ? RELEASES.filter((release) => release.version !== current.version)
    : [];
  return `<div class="settings-section">
      <h3 class="settings-section-title">当前版本</h3>
      <div class="update-hero">
        <div>
          <div class="update-version">v${escapeHtml(APP_VERSION)}</div>
          <div class="update-sub">构建于 ${escapeHtml(__APP_BUILD_DATE__)} · Windows x64</div>
        </div>
        <span class="update-status">${icon("shield")}本地离线更新</span>
      </div>
      <div class="update-note">${icon("info")}<span>启点不访问网络，也不会自动检查或下载更新。运行新版本安装程序覆盖安装即可；分类、固定与索引会保留。</span></div>
    </div>
    <div class="settings-section">
      <h3 class="settings-section-title">最新更新公告</h3>
      ${current ? releaseCard(current, true) : `<div class="settings-card"><div class="setting-row"><div class="setting-copy"><div class="setting-desc">暂无更新公告。</div></div></div></div>`}
    </div>
    ${
      older.length > 0
        ? `<div class="settings-section"><details class="release-history"><summary>历史版本 · ${older.length}</summary>${older
            .map((release) => releaseCard(release, false))
            .join("")}</details></div>`
        : ""
    }
    <div class="settings-section">
      <h3 class="settings-section-title">更新方式</h3>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">覆盖安装</div><div class="setting-desc">运行新版本安装程序即可，安装器会自动关闭正在运行的启点。便携版直接替换 QiDian.exe。应用数据保存在本机，卸载时默认保留。</div></div>
        </div>
      </div>
    </div>`;
}

function aboutPanel(): string {
  return `<div class="about-card">
      <div class="about-hero">
        <div class="about-logo">${icon("brand")}</div>
        <div><h3 class="about-name">启点</h3><div class="about-version">LaunchDeck · v${APP_VERSION} · 构建于 ${__APP_BUILD_DATE__}</div></div>
      </div>
      <p class="about-desc">把桌面快捷方式收进一个安静的分类启动台。启动快、占用小、空闲不耗电；所有扫描与启动记录只留在本机。</p>
      <div class="about-points">
        <span class="about-point">${icon("zap")}按需加载</span>
        <span class="about-point">${icon("hard-drive")}本地索引</span>
        <span class="about-point">${icon("cpu")}零后台轮询</span>
        <span class="about-point">${icon("shield")}无遥测</span>
      </div>
      <div class="shortcut-table">
        <div class="kbd-group"><kbd>Ctrl</kbd><kbd>K</kbd></div><span>聚焦搜索</span>
        <div class="kbd-group"><kbd>↑</kbd><kbd>↓</kbd></div><span>在搜索结果中选择</span>
        <div class="kbd-group"><kbd>Enter</kbd></div><span>启动选中的应用</span>
        <div class="kbd-group"><kbd>Alt</kbd><kbd>1–9</kbd></div><span>启动顶部常用应用</span>
        <div class="kbd-group"><kbd>Ctrl</kbd><kbd>R</kbd></div><span>重新扫描</span>
        <div class="kbd-group"><kbd>Ctrl</kbd><kbd>,</kbd></div><span>打开设置</span>
        <div class="kbd-group"><kbd>Esc</kbd></div><span>关闭详情 / 清除搜索</span>
      </div>
    </div>
    <div class="setting-row" style="margin-top:12px;padding:12px 4px 0;border-top:1px solid var(--divider)">
      <div class="setting-copy"><div class="setting-title">技术栈</div><div class="setting-desc">Tauri 2 · Rust · Windows WebView2 · 无前端框架 · 无后台服务</div></div>
    </div>
    ${updatesPanel()}
    <div class="settings-section">
      <h3 class="settings-section-title">赞赏</h3>
      <div class="settings-card about-reward">
        <img class="about-reward-img" src="${rewardQr}" alt="微信赞赏码" loading="lazy" />
        <div class="setting-copy">
          <div class="setting-title">请作者喝杯奶茶</div>
          <div class="setting-desc">微信扫一扫即可赞赏。完全自愿，不影响任何功能与后续更新。</div>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <h3 class="settings-section-title">重置与数据</h3>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">数据目录</div><div class="setting-desc">设置、分类、图标缓存与壁纸都保存在本机；卸载时默认保留。</div></div>
          <div class="setting-control"><button class="ghost-btn" data-settings-action="open-data">打开目录</button></div>
        </div>
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-title">恢复默认设置</div><div class="setting-desc">重置外观、分类、固定与启动记录；不会卸载任何应用。</div></div>
          <div class="setting-control"><button class="ghost-btn" data-settings-action="reset-settings">恢复默认</button></div>
        </div>
      </div>
    </div>`;
}

function renderSettings(): void {
  if (!state.settingsOpen) {
    els.modalLayer.hidden = true;
    els.modalLayer.innerHTML = "";
    return;
  }
  const entering = !settingsAnimated;
  const previousBody = els.modalLayer.querySelector<HTMLElement>(".modal-body");
  const previousScroll = entering ? 0 : (previousBody?.scrollTop ?? 0);
  const activeElement = document.activeElement;
  const activeKey =
    activeElement instanceof HTMLElement && els.modalLayer.contains(activeElement)
      ? activeElement.dataset.focusKey
      : undefined;

  els.modalLayer.innerHTML = settingsHtml();
  els.modalLayer.hidden = false;
  settingsAnimated = true;
  const body = els.modalLayer.querySelector<HTMLElement>(".modal-body");
  if (body) body.scrollTop = previousScroll;

  if (activeKey) {
    const target = els.modalLayer.querySelector<HTMLElement>(`[data-focus-key="${activeKey}"]`);
    target?.focus({ preventScroll: true });
  }
  if (state.editingCategoryId) {
    window.requestAnimationFrame(() => {
      const input = els.modalLayer.querySelector<HTMLInputElement>("[data-cat-rename-input]");
      if (input && document.activeElement !== input) {
        input.focus();
        input.select();
      }
    });
  }
}

function openSettings(tab?: SettingsTab): void {
  if (state.settingsOpen && !tab) {
    closeSettings();
    return;
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.settingsOpen = true;
  settingsAnimated = false;
  if (tab) state.settingsTab = tab;
  state.editingCategoryId = null;
  state.pendingCategoryDelete = null;
  state.newCategoryDraft = "";
  state.pendingGroupKill = null;
  state.pendingPidKill = null;
  state.perfPendingUninstall = false;
  state.perfPendingClean = null;
  state.quitPending = false;
  state.modulePendingUninstall = null;
  renderAll();
  prepareTab(state.settingsTab);
  if (!state.modulesLoaded) void loadModules();
  window.requestAnimationFrame(() => {
    const close = els.modalLayer.querySelector<HTMLElement>("[data-close-settings]");
    close?.focus({ preventScroll: true });
  });
}

function closeSettings(): void {
  if (!state.settingsOpen) return;
  state.settingsOpen = false;
  state.editingCategoryId = null;
  state.pendingCategoryDelete = null;
  state.pendingGroupKill = null;
  state.pendingPidKill = null;
  state.perfPendingUninstall = false;
  state.perfPendingClean = null;
  state.quitPending = false;
  state.modulePendingUninstall = null;
  renderAll();
  queueSave();
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  else if (state.workspace === "launcher") els.search.focus({ preventScroll: true });
}

/* ── modal actions ────────────────────────────────────────────── */

async function onModalClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;
  if (target === els.modalLayer) {
    closeSettings();
    return;
  }
  const actionEl = target.closest<HTMLElement>("[data-settings-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.settingsAction;

  switch (action) {
    case "close":
      closeSettings();
      return;
    case "tab": {
      const tab = actionEl.dataset.value as SettingsTab | undefined;
      if (tab) {
        const previousTab = state.settingsTab;
        state.settingsTab = tab;
        state.editingCategoryId = null;
        state.pendingCategoryDelete = null;
        state.pendingGroupKill = null;
        state.pendingPidKill = null;
        state.perfPendingUninstall = false;
        state.perfPendingClean = null;
        state.quitPending = false;
        state.modulePendingUninstall = null;
        refreshActive();
        const body = els.modalLayer.querySelector<HTMLElement>(".modal-body");
        if (body) body.scrollTop = 0;
        if (tab !== previousTab) prepareTab(tab);
      }
      return;
    }
    case "ai-enable": {
      try {
        state.modules = await api.installModule("ai");
        state.modulesLoaded = true;
        state.aiEnabled = true;
        closeSettings();
        setWorkspace("ai");
        void refreshAiStatus();
        showToast("已安装本地 AI 助手，请在 AI 页选择模型并下载", "success");
      } catch (error) {
        showToast(`启用失败：${String(error)}`, "error");
      }
      return;
    }
    case "ai-open":
      closeSettings();
      setWorkspace("ai");
      return;
    case "ai-perm": {
      const key = actionEl.dataset.key as keyof AiPermissions | undefined;
      if (!key) return;
      const permissions = state.settings.aiPermissions;
      if (!(key in permissions)) return;
      const next = !permissions[key];
      const children: Partial<Record<keyof AiPermissions, Array<keyof AiPermissions>>> = {
        appLaunch: ["appSearch", "appStart"],
        appControl: ["processList", "processClose"],
        settingsNav: ["settingsOpen"],
      };
      const updated = { ...permissions, [key]: next };
      // 大类开关是强制闸门：开启时默认放行全部小类，关闭时同步清空小类。
      for (const child of children[key] ?? []) updated[child] = next;
      patchSettings({ aiPermissions: updated });
      return;
    }
    case "ai-language": {
      const value = actionEl.dataset.value;
      if (value === "zh" || value === "en" || value === "auto") {
        patchSettings({ aiSpeechLanguage: value });
      }
      return;
    }
    case "plugins-refresh":
      void loadModules();
      return;
    case "module-install": {
      const id = actionEl.dataset.value as ModuleId | undefined;
      if (id) void installModule(id);
      return;
    }
    case "module-uninstall": {
      const id = actionEl.dataset.value as ModuleId | undefined;
      if (id) void uninstallModule(id);
      return;
    }
    case "cleanup-apps-refresh":
      void loadCleanupApps();
      return;
    case "cleanup-uninstall-open": {
      const id = actionEl.dataset.id;
      if (id) openCleanupUninstall(id);
      return;
    }
    case "cleanup-uninstall-full":
      toggleCleanupFullRemove();
      return;
    case "cleanup-uninstall-cancel":
      if (!state.cleanupUninstallBusy) {
        state.cleanupUninstallId = null;
        refreshActive();
      }
      return;
    case "cleanup-uninstall-confirm":
      void runCleanupUninstall();
      return;
    case "cleanup-refresh":
      void loadCleanupScan();
      return;
    case "cleanup-filter": {
      const value = actionEl.dataset.value as UiState["cleanupFilter"] | undefined;
      if (value === "all" || value === "suspect" || value === "large") {
        state.cleanupFilter = value;
        state.cleanupPendingDelete = false;
        refreshActive();
      }
      return;
    }
    case "cleanup-app-sort": {
      const value = actionEl.dataset.value;
      if (value !== "name" && value !== "size") return;
      if (state.cleanupAppSort === value) return;
      state.cleanupAppSort = value;
      for (const chip of document.querySelectorAll<HTMLElement>('[data-settings-action="cleanup-app-sort"]')) {
        chip.classList.toggle("is-active", chip.dataset.value === value);
        chip.setAttribute("aria-pressed", String(chip.dataset.value === value));
      }
      refreshCleanupAppList();
      return;
    }
    case "cleanup-recycle-toggle": {
      const cleanupRecycleBin = !state.settings.cleanupRecycleBin;
      patchSettings({ cleanupRecycleBin });
      showToast(
        cleanupRecycleBin
          ? "删除的文件夹会移入回收站，可恢复"
          : "删除将永久生效，不进入回收站",
        "info",
      );
      return;
    }
    case "cleanup-toggle": {
      const id = actionEl.dataset.id;
      if (id) toggleCleanupCandidate(id);
      return;
    }
    case "cleanup-select-all":
      toggleCleanupSelectAll();
      return;
    case "cleanup-open": {
      const path = actionEl.dataset.path;
      if (path) void openCleanupFolder(path);
      return;
    }
    case "cleanup-delete":
      requestCleanupDelete();
      return;
    case "boot-refresh":
      void loadBootState();
      return;
    case "autostart-toggle":
      void toggleAutostart();
      return;
    case "boot-hotkey-edit":
      startHotkeyCapture({ kind: "toggle" });
      return;
    case "boot-hotkey-cancel":
      cancelHotkeyCapture();
      return;
    case "boot-hotkey-reset":
      void resetToggleHotkey();
      return;
    case "boot-hotkey-app-add": {
      const appId = state.hotkeyAppPick;
      if (!appId) {
        showToast("请先选择要绑定快捷键的应用", "info");
        return;
      }
      if (!state.apps.some((app) => app.id === appId)) {
        state.hotkeyAppPick = "";
        showToast("该应用已不在列表中，请重新选择", "error");
        refreshActive();
        return;
      }
      startHotkeyCapture({ kind: "app", appId });
      return;
    }
    case "boot-hotkey-app-edit": {
      const appId = actionEl.dataset.id;
      if (appId) startHotkeyCapture({ kind: "app", appId });
      return;
    }
    case "boot-hotkey-app-delete": {
      const appId = actionEl.dataset.id;
      if (appId) void deleteAppHotkey(appId);
      return;
    }
    case "boot-close-toggle":
      toggleCloseToTray();
      return;
    case "boot-tray-quick":
      toggleTrayQuickApps();
      return;
    case "boot-hide":
      void hideToTray();
      return;
    case "boot-quit":
      requestQuitApp();
      return;
    case "memory-refresh":
      void loadMemoryStatus(true).then(() => showToast("内存状态已刷新", "success"));
      return;
    case "memory-preset": {
      const preset = MEMORY_PRESETS.find((item) => item.id === actionEl.dataset.value);
      if (preset) {
        patchMemory({
          memoryLowPercent: preset.low,
          memoryRecoverPercent: preset.recover,
          memoryTrimWorkingSet: preset.trim,
        });
      }
      return;
    }
    case "memory-mode": {
      const mode = actionEl.dataset.value as MemoryMode | undefined;
      if (mode) patchMemory({ memoryMode: mode });
      return;
    }
    case "memory-low": {
      const value = Number(actionEl.dataset.value);
      if (Number.isFinite(value)) patchMemory({ memoryLowPercent: value });
      return;
    }
    case "memory-recover": {
      const value = Number(actionEl.dataset.value);
      if (Number.isFinite(value)) patchMemory({ memoryRecoverPercent: value });
      return;
    }
    case "memory-interval": {
      const value = Number(actionEl.dataset.value);
      if (Number.isFinite(value)) patchMemory({ memoryIntervalSec: value });
      return;
    }
    case "memory-level": {
      const level = actionEl.dataset.value as MemoryLevel | undefined;
      if (level) patchMemory({ memoryLevel: level });
      return;
    }
    case "memory-trim-toggle":
      patchMemory({ memoryTrimWorkingSet: !state.settings.memoryTrimWorkingSet });
      return;
    case "memory-scope": {
      const scope = actionEl.dataset.value as MemoryTrimScope | undefined;
      if (scope === "self" || scope === "system") {
        patchMemory({ memoryTrimScope: scope });
        showToast(
          scope === "system"
            ? "已允许释放全部应用的空闲工作集；电池与全屏时仍退回仅启点"
            : "释放范围已改为仅启点",
          "info",
        );
      }
      return;
    }
    case "memory-idle-toggle":
      patchMemory({ memoryIdleTrim: !state.settings.memoryIdleTrim });
      return;
    case "memory-icons-toggle":
      patchMemory({ memoryDropIcons: !state.settings.memoryDropIcons });
      return;
    case "memory-fullscreen-toggle":
      patchMemory({ memoryPauseFullscreen: !state.settings.memoryPauseFullscreen });
      return;
    case "memory-smart-toggle":
      patchMemory({ memorySmartThresholds: !state.settings.memorySmartThresholds });
      return;
    case "memory-power-toggle":
      patchMemory({ memoryPowerAware: !state.settings.memoryPowerAware });
      return;
    case "memory-adaptive-toggle":
      patchMemory({ memoryAdaptiveInterval: !state.settings.memoryAdaptiveInterval });
      return;
    case "memory-recommend":
      recommendMemory();
      return;
    case "memory-apply":
      void applyMemoryNow();
      return;
    case "memory-trim":
      void trimMemoryNow();
      return;
    case "memory-app-trim": {
      const key = actionEl.dataset.value;
      const group = state.memoryTop?.find((item) => item.key === key);
      if (group) void trimMemoryApp(group);
      return;
    }
    case "memory-skip": {
      const key = actionEl.dataset.value ?? "";
      const group = state.memoryTop?.find((item) => item.key === key);
      if (group) toggleSkipApp(group);
      return;
    }
    case "memory-skip-remove":
      removeSkipKey(actionEl.dataset.value ?? "");
      return;
    case "memory-purge":
      void purgeMemorySystem();
      return;
    case "perf-install":
      void installPerformance();
      return;
    case "opt-install":
      void installModule("optimize");
      return;
    case "opt-refresh":
      state.perfPendingClean = null;
      state.perfOptimizePending = null;
      state.optPower = null;
      state.optDns = null;
      state.optDnsError = null;
      state.optDiag = null;
      clearOptimizeConfirm();
      void loadPerformanceOptimize();
      void loadOptimizePower();
      void loadOptimizeNetwork();
      return;
    case "perf-copy-report":
      void copyPerformanceReport();
      return;
    case "perf-refresh":
      state.perfPendingUninstall = false;
      state.perfPendingClean = null;
      state.perfOptimizePending = null;
      clearOptimizeConfirm();
      void loadPerformanceStatus();
      return;
    case "perf-uninstall":
      requestPerformanceUninstall();
      return;
    case "perf-temp-days": {
      const days = Number(actionEl.dataset.value ?? "7");
      setPerformanceDays(days);
      return;
    }
    case "perf-temp-scan":
      void scanPerformanceTemp();
      return;
    case "perf-disk-scan":
      void loadDiskUsage();
      return;
    case "perf-toggle-category": {
      const id = actionEl.dataset.category;
      if (id) togglePerformanceCategory(id);
      return;
    }
    case "perf-clean-selected":
      requestPerformanceClean("selected");
      return;
    case "perf-clean-safe":
      requestPerformanceClean("safe");
      return;
    case "perf-power": {
      const guid = actionEl.dataset.guid;
      if (guid) void setPerformancePower(guid);
      return;
    }
    case "perf-dns":
      void flushPerformanceDns();
      return;
    case "perf-dns-preset": {
      const preset = actionEl.dataset.value;
      if (preset) setDnsPreset(preset);
      return;
    }
    case "perf-dns-apply":
      void applyOptimizeDns();
      return;
    case "perf-dns-restore":
      void restoreOptimizeDns();
      return;
    case "perf-dns-diag":
      void runNetworkDiagnose();
      return;
    case "perf-opt-category": {
      const category = actionEl.dataset.value;
      if (category) setOptimizeCategory(category);
      return;
    }
    case "perf-opt-summary-dismiss":
      state.perfOptimizeSummary = null;
      refreshActive();
      return;
    case "perf-opt-toggle": {
      const id = actionEl.dataset.id;
      if (id) toggleOptimizeItem(id);
      return;
    }
    case "perf-opt-select-safe":
      selectSafeOptimizeItems();
      return;
    case "perf-opt-smart":
      requestSmartOptimize();
      return;
    case "perf-opt-apply":
      requestOptimize("apply");
      return;
    case "perf-opt-restore-all":
      requestOptimize("restoreAll");
      return;
    case "perf-opt-restore": {
      const id = actionEl.dataset.id;
      if (id) void restoreSingleOptimizeItem(id);
      return;
    }
    case "perf-opt-refresh":
      void loadPerformanceOptimize();
      return;
    case "background-section": {
      const section = actionEl.dataset.value;
      if (section === "startup" || section === "processes") {
        state.backgroundSection = section;
        state.pendingGroupKill = null;
        state.pendingPidKill = null;
        refreshActive();
        if (section === "startup") loadStartup();
        else loadProcesses();
      }
      return;
    }
    case "background-refresh": {
      state.pendingGroupKill = null;
      state.pendingPidKill = null;
      if (state.backgroundSection === "startup") void loadStartup(true);
      else void loadProcesses();
      return;
    }
    case "startup-toggle": {
      const id = actionEl.dataset.id;
      const item = state.startupItems.find((entry) => entry.id === id);
      if (item) void toggleStartup(item);
      return;
    }
    case "startup-close-suggest":
      void closeSuggestedStartup();
      return;
    case "startup-sort": {
      const mode = actionEl.dataset.value;
      if (mode) setStartupSort(mode);
      return;
    }
    case "toggle-process-group": {
      const key = actionEl.dataset.group;
      if (!key) return;
      if (state.expandedGroups.has(key)) state.expandedGroups.delete(key);
      else state.expandedGroups.add(key);
      state.pendingPidKill = null;
      refreshActive();
      return;
    }
    case "kill-group": {
      const key = actionEl.dataset.group;
      if (key) void terminateGroup(key);
      return;
    }
    case "kill-process": {
      const pid = Number(actionEl.dataset.pid ?? "0");
      if (pid > 0) void terminateProcess(pid);
      return;
    }
    case "theme": {
      const theme = actionEl.dataset.value as ThemeId;
      if (theme !== state.settings.theme) {
        const next = THEME_OPTIONS.find((item) => item.id === theme);
        patchSettings({ theme });
        showToast(`已切换到 ${next?.name ?? theme}`, "info");
      }
      return;
    }
    case "mode": {
      const mode = actionEl.dataset.value as ColorMode;
      patchSettings({ colorMode: mode });
      return;
    }
    case "density": {
      const density = actionEl.dataset.value as Density;
      patchSettings({ density });
      return;
    }
    case "corners": {
      const corners = actionEl.dataset.value as CornerStyle;
      if (corners === "soft" || corners === "sharp" || corners === "round") {
        patchSettings({ corners });
      }
      return;
    }
    case "blur": {
      const blur = actionEl.dataset.value as BlurLevel;
      if (blur === "off" || blur === "standard" || blur === "strong") {
        patchSettings({ blur });
      }
      return;
    }
    case "refresh": {
      const hours = Number(actionEl.dataset.value ?? "12");
      const safeHours = REFRESH_OPTIONS.some((option) => option.value === hours) ? hours : 12;
      patchSettings({ autoRefreshHours: safeHours });
      showToast(
        safeHours === 0
          ? "已关闭自动刷新，仍可随时手动扫描"
          : `已设置为每 ${safeHours === 168 ? "7 天" : `${safeHours} 小时`}检查一次索引`,
        "info",
      );
      return;
    }
    case "accent": {
      const accent = actionEl.dataset.value as AccentChoice;
      patchSettings({ accent });
      return;
    }
    case "preset": {
      const preset = THEME_PRESETS.find((item) => item.id === actionEl.dataset.value);
      if (!preset) return;
      patchSettings({ themePreset: preset.id, accent: preset.accent });
      showToast(`已应用「${preset.name}」主题`, "info");
      return;
    }
    case "wallpaper": {
      const wallpaper = actionEl.dataset.value as WallpaperId;
      if (wallpaper === "custom") {
        const library = state.settings.wallpaperLibrary ?? [];
        const active = state.settings.wallpaperAsset;
        if (!active && !state.settings.wallpaperImage) {
          if (library.length === 0) {
            els.modalLayer.querySelector<HTMLInputElement>("[data-wallpaper-file]")?.click();
            return;
          }
          const latest = library[library.length - 1];
          patchSettings({ wallpaper: "custom", wallpaperAsset: latest.id });
          state.wallpaperData = state.wallpaperThumbs[latest.id] ?? "";
          applyAppearance();
          void syncWallpaperData();
          return;
        }
        patchSettings({ wallpaper: "custom" });
        void syncWallpaperData();
        return;
      }
      patchSettings({ wallpaper });
      return;
    }
    case "wallpaper-upload":
      els.modalLayer.querySelector<HTMLInputElement>("[data-wallpaper-file]")?.click();
      return;
    case "wallpaper-asset": {
      const id = actionEl.dataset.id;
      if (!id) return;
      patchSettings({ wallpaper: "custom", wallpaperAsset: id, wallpaperImage: "" });
      state.wallpaperData = state.wallpaperThumbs[id] ?? "";
      applyAppearance();
      void syncWallpaperData();
      return;
    }
    case "wallpaper-asset-delete": {
      const id = actionEl.dataset.id;
      if (!id) return;
      const library = (state.settings.wallpaperLibrary ?? []).filter((asset) => asset.id !== id);
      const wasActive = state.settings.wallpaperAsset === id;
      const nextThumbs = { ...state.wallpaperThumbs };
      delete nextThumbs[id];
      state.wallpaperThumbs = nextThumbs;
      const settingsPatch: Partial<Settings> = { wallpaperLibrary: library };
      if (wasActive) {
        settingsPatch.wallpaperAsset = "";
        settingsPatch.wallpaper = "none";
        state.wallpaperData = "";
      }
      patchSettings(settingsPatch);
      applyAppearance();
      refreshActive();
      void api.deleteWallpaper(id).catch(() => undefined);
      showToast("已从壁纸库删除", "info");
      return;
    }
    case "wallpaper-fit": {
      const fit = actionEl.dataset.value as WallpaperFit;
      if (fit === "cover" || fit === "contain" || fit === "tile" || fit === "stretch") {
        patchSettings({ wallpaperFit: fit });
      }
      return;
    }
    case "custom-theme-save":
      saveCustomTheme();
      return;
    case "custom-theme-apply": {
      const id = actionEl.dataset.id;
      if (id) applyCustomTheme(id);
      return;
    }
    case "custom-theme-delete": {
      const id = actionEl.dataset.id;
      if (!id) return;
      const next = (state.settings.customThemes ?? []).filter((item) => item.id !== id);
      patchSettings({ customThemes: next });
      refreshActive();
      showToast("已删除该主题", "info");
      return;
    }
    case "toggle": {
      const key = actionEl.dataset.key;
      if (key === "lowPower") {
        patchSettings({ lowPower: !state.settings.lowPower });
      } else if (key === "scanUwp") {
        patchSettings({ scanUwp: !state.settings.scanUwp });
        void saveChain.then(() => runScan(true, true));
      } else if (key === "includeSystemApps") {
        patchSettings({ includeSystemApps: !state.settings.includeSystemApps });
        void saveChain.then(() => runScan(true, true));
      } else if (key === "scanInstallDirs") {
        patchSettings({ scanInstallDirs: !state.settings.scanInstallDirs });
        void saveChain.then(() => runScan(true, true));
      }
      return;
    }
    case "category-up":
    case "category-down": {
      const id = actionEl.dataset.categoryId;
      if (!id) return;
      const index = state.settings.categories.findIndex((category) => category.id === id);
      const targetIndex = action === "category-up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= state.settings.categories.length) return;
      const categories = [...state.settings.categories];
      [categories[index], categories[targetIndex]] = [categories[targetIndex], categories[index]];
      patchSettings({ categories });
      return;
    }
    case "category-rename": {
      const id = actionEl.dataset.categoryId;
      const category = id ? categoryById(id) : undefined;
      if (!category) return;
      state.editingCategoryId = category.id;
      state.renameDraft = category.name;
      state.pendingCategoryDelete = null;
      refreshActive();
      window.requestAnimationFrame(() => {
        const input = els.modalLayer.querySelector<HTMLInputElement>("[data-cat-rename-input]");
        input?.focus();
        input?.select();
      });
      return;
    }
    case "category-rename-save": {
      commitCategoryRename();
      return;
    }
    case "category-rename-cancel": {
      state.editingCategoryId = null;
      state.renameDraft = "";
      refreshActive();
      return;
    }
    case "category-delete": {
      const id = actionEl.dataset.categoryId;
      if (!id) return;
      const category = categoryById(id);
      if (!category || category.builtin !== false) return;
      if (state.pendingCategoryDelete !== id) {
        state.pendingCategoryDelete = id;
        refreshActive();
        return;
      }
      const categories = state.settings.categories.filter((item) => item.id !== id);
      const overrides = { ...state.settings.overrides };
      for (const [appId, categoryId] of Object.entries(overrides)) {
        if (categoryId === id) delete overrides[appId];
      }
      patchSettings({ categories, overrides });
      state.pendingCategoryDelete = null;
      showToast(`已删除分类「${category.name}」，相关应用回到自动分类`, "info");
      return;
    }
    case "category-add": {
      addCategory();
      return;
    }
    case "categories-reset": {
      const builtinIds = new Set(DEFAULT_CATEGORIES.map((category) => category.id));
      const overrides = Object.fromEntries(
        Object.entries(state.settings.overrides).filter(([, categoryId]) => builtinIds.has(categoryId)),
      );
      patchSettings({
        categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
        overrides,
      });
      state.pendingCategoryDelete = null;
      state.editingCategoryId = null;
      showToast("已恢复默认分类", "info");
      return;
    }
    case "rescan": {
      void runScan(true);
      return;
    }
    case "ai-classify": {
      void runAiClassifyApps();
      return;
    }
    case "clear-cache": {
      try {
        await api.clearCache();
        iconCache.clear();
        iconRequested.clear();
        iconQueue.length = 0;
        showToast("图标缓存已清除，滚动时会按需重新提取", "success");
        scheduleRender();
      } catch (error) {
        showToast(`清除缓存失败：${String(error)}`, "error");
      }
      return;
    }
    case "open-data": {
      try {
        await api.openDataDir();
      } catch (error) {
        showToast(`无法打开数据目录：${String(error)}`, "error");
      }
      return;
    }
    case "restore-hidden": {
      const id = actionEl.dataset.appId;
      if (!id) return;
      patchSettings({ hidden: state.settings.hidden.filter((hiddenId) => hiddenId !== id) });
      const app = appMap().get(id);
      showToast(`已恢复${app ? `「${app.name}」` : "应用"}`, "success");
      return;
    }
    case "reset-settings": {
      try {
        const settings = await api.resetSettings();
        state.settings = settings;
        state.activeNav = "all";
        state.settingsTab = "appearance";
        applyAppearance();
        showToast("已恢复默认设置", "info");
        renderAll();
      } catch (error) {
        showToast(`恢复默认设置失败：${String(error)}`, "error");
      }
      return;
    }
  }
}

function addCategory(): void {
  const input = els.modalLayer.querySelector<HTMLInputElement>("[data-new-category-input]");
  const name = (input?.value ?? state.newCategoryDraft).trim();
  if (!name) {
    showToast("请输入分类名称", "error");
    input?.focus();
    return;
  }
  if (name.length > 16) {
    showToast("分类名称最多 16 个字符", "error");
    return;
  }
  if (state.settings.categories.length >= 20) {
    showToast("分类数量已达上限（20 个）", "error");
    return;
  }
  if (state.settings.categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
    showToast("已存在同名分类", "error");
    return;
  }
  const category: Category = {
    id: `custom-${Date.now().toString(36)}`,
    name,
    builtin: false,
  };
  state.newCategoryDraft = "";
  patchSettings({ categories: [...state.settings.categories, category] });
  showToast(`已添加分类「${name}」`, "success");
  window.requestAnimationFrame(() => {
    els.modalLayer.querySelector<HTMLInputElement>("[data-new-category-input]")?.focus();
  });
}

function commitCategoryRename(): void {
  const id = state.editingCategoryId;
  if (!id) return;
  const category = categoryById(id);
  if (!category) return;
  const input = els.modalLayer.querySelector<HTMLInputElement>("[data-cat-rename-input]");
  const name = (input?.value ?? state.renameDraft).trim();
  if (!name) {
    showToast("分类名称不能为空", "error");
    input?.focus();
    return;
  }
  if (name.length > 16) {
    showToast("分类名称最多 16 个字符", "error");
    return;
  }
  if (
    state.settings.categories.some(
      (item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    showToast("已存在同名分类", "error");
    return;
  }
  const categories = state.settings.categories.map((item) =>
    item.id === id ? { ...item, name } : item,
  );
  state.editingCategoryId = null;
  state.renameDraft = "";
  patchSettings({ categories });
  showToast(`已重命名为「${name}」`, "success");
}

function saveCustomTheme(): void {
  const settings = state.settings;
  const fallback = `我的主题 ${(settings.customThemes?.length ?? 0) + 1}`;
  const name = (state.customThemeName.trim() || fallback).slice(0, 16);
  const theme: CustomTheme = {
    id: `ct-${Date.now().toString(36)}`,
    name,
    theme: settings.theme,
    preset: settings.themePreset,
    accent: settings.accent,
    customAccent: settings.customAccent,
    wallpaper: settings.wallpaper,
    // 壁纸像素由后端文件保存，方案里只记录引用与调节参数。
    wallpaperImage: "",
    wallpaperAsset: settings.wallpaperAsset,
    wallpaperFit: settings.wallpaperFit,
    wallpaperX: settings.wallpaperX,
    wallpaperY: settings.wallpaperY,
    wallpaperZoom: settings.wallpaperZoom,
    wallpaperOpacity: settings.wallpaperOpacity,
    wallpaperBlur: settings.wallpaperBlur,
    wallpaperDim: settings.wallpaperDim,
    corners: settings.corners,
    blur: settings.blur,
    colorMode: settings.colorMode,
    density: settings.density,
    palette: { ...settings.customPalette },
  };
  const next = [...(settings.customThemes ?? []), theme].slice(-12);
  state.customThemeName = "";
  patchSettings({ customThemes: next });
  refreshActive();
  showToast(`已保存主题「${name}」`, "success");
}

function applyCustomTheme(id: string): void {
  const current = state.settings;
  const theme = (current.customThemes ?? []).find((item) => item.id === id);
  if (!theme) return;
  const library = current.wallpaperLibrary ?? [];
  const assetExists = library.some((asset) => asset.id === theme.wallpaperAsset);
  const wallpaperAsset = assetExists ? theme.wallpaperAsset : "";
  const wallpaperImage = theme.wallpaperImage || current.wallpaperImage;
  const wallpaper =
    theme.wallpaper === "custom" && !wallpaperAsset && !wallpaperImage
      ? "none"
      : theme.wallpaper;
  patchSettings({
    theme: theme.theme,
    themePreset: theme.preset,
    accent: theme.accent,
    customAccent: theme.customAccent,
    customPalette: { ...theme.palette },
    wallpaper,
    wallpaperImage,
    wallpaperAsset,
    wallpaperFit: theme.wallpaperFit,
    wallpaperX: theme.wallpaperX,
    wallpaperY: theme.wallpaperY,
    wallpaperZoom: theme.wallpaperZoom,
    wallpaperOpacity: theme.wallpaperOpacity,
    wallpaperBlur: theme.wallpaperBlur,
    wallpaperDim: theme.wallpaperDim,
    corners: theme.corners,
    blur: theme.blur,
    colorMode: theme.colorMode,
    density: theme.density,
  });
  void syncWallpaperData();
  refreshActive();
  showToast(`已应用主题「${theme.name}」`, "info");
}

/** 压缩到最长边 2560 × 1600，并按体积自动降质，最终以 JPEG data URL 返回。 */
async function compressWallpaper(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / bitmap.width, 1600 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建画布");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let quality = 0.86;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > WALLPAPER_MAX_CHARS && quality > 0.42) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length > WALLPAPER_MAX_CHARS) throw new Error("图片压缩后仍超出大小限制");
  return dataUrl;
}

/** 支持一次上传多张：逐张压缩、写入后端，最后激活最后一张。 */
async function importWallpapers(files: File[]): Promise<void> {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (images.length === 0) {
    showToast("请选择图片文件", "error");
    return;
  }
  let library = [...(state.settings.wallpaperLibrary ?? [])];
  const thumbs = { ...state.wallpaperThumbs };
  let activeId = "";
  let activeData = "";
  let added = 0;
  for (const file of images) {
    try {
      const dataUrl = await compressWallpaper(file);
      const id = `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const bytes = await api.saveWallpaper(id, dataUrl);
      const name = (file.name.replace(/\.[^.]+$/, "").trim() || "本地壁纸").slice(0, 24);
      library.push({ id, name, addedAt: Date.now(), bytes });
      thumbs[id] = dataUrl;
      activeId = id;
      activeData = dataUrl;
      added += 1;
    } catch (error) {
      showToast(`「${file.name}」处理失败：${String(error)}`, "error");
    }
  }
  if (!activeId) return;
  const overflow = Math.max(0, library.length - 12);
  const evicted = library.slice(0, overflow);
  library = library.slice(-12);
  for (const asset of evicted) {
    delete thumbs[asset.id];
    void api.deleteWallpaper(asset.id).catch(() => undefined);
  }
  state.wallpaperThumbs = thumbs;
  state.wallpaperData = activeData;
  patchSettings({
    wallpaperLibrary: library,
    wallpaper: "custom",
    wallpaperAsset: activeId,
    wallpaperImage: "",
  });
  applyAppearance();
  refreshActive();
  showToast(added > 1 ? `已添加 ${added} 张壁纸` : "壁纸已添加", "success");
}

function onModalInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  if (target.matches("[data-new-category-input]")) {
    state.newCategoryDraft = target.value;
  } else if (target.matches("[data-cat-rename-input]")) {
    state.renameDraft = target.value;
  } else if (target.matches("[data-custom-theme-name]")) {
    state.customThemeName = target.value;
  } else if (target.matches("[data-custom-accent]")) {
    if (!HEX_COLOR.test(target.value)) return;
    state.settings = { ...state.settings, accent: "custom", customAccent: target.value };
    applyAppearance();
    els.modalLayer.querySelectorAll(".swatch.is-selected").forEach((swatch) => {
      swatch.classList.remove("is-selected");
      swatch.setAttribute("aria-pressed", "false");
    });
    target.closest(".accent-picker")?.classList.add("is-selected");
  } else if (target.matches("[data-palette-color]")) {
    const key = target.dataset.paletteColor as PaletteColorKey | undefined;
    if (!key || !HEX_COLOR.test(target.value)) return;
    state.settings = {
      ...state.settings,
      theme: "custom",
      customPalette: { ...state.settings.customPalette, [key]: target.value },
    };
    applyAppearance();
  } else if (target.matches("[data-palette-range]")) {
    const key = target.dataset.paletteRange as PaletteRangeKey | undefined;
    if (key !== "radius" && key !== "panelOpacity" && key !== "blur" && key !== "iconSize") {
      return;
    }
    const limits =
      key === "radius"
        ? { min: 0, max: 30, unit: "px" }
        : key === "panelOpacity"
          ? { min: 30, max: 100, unit: "%" }
          : key === "blur"
            ? { min: 0, max: 48, unit: "px" }
            : { min: 28, max: 64, unit: "px" };
    const value = clampNumber(Number(target.value), limits.min, limits.max);
    state.settings = {
      ...state.settings,
      theme: "custom",
      customPalette: { ...state.settings.customPalette, [key]: value },
    };
    applyAppearance();
    const label = els.modalLayer.querySelector<HTMLElement>(`[data-palette-value="${key}"]`);
    if (label) label.textContent = `${value}${limits.unit}`;
  } else if (target.matches("[data-wallpaper-range]")) {
    const key = target.dataset.wallpaperRange as WallpaperSliderKey | undefined;
    if (key !== "opacity" && key !== "blur" && key !== "dim" && key !== "x" && key !== "y" && key !== "zoom") {
      return;
    }
    const limits =
      key === "opacity"
        ? { min: 20, max: 100, unit: "%" }
        : key === "blur"
          ? { min: 0, max: 40, unit: "px" }
          : key === "dim"
            ? { min: 0, max: 70, unit: "%" }
            : key === "zoom"
              ? { min: 100, max: 200, unit: "%" }
              : { min: 0, max: 100, unit: "%" };
    const value = clampNumber(Number(target.value), limits.min, limits.max);
    const next: Settings = { ...state.settings };
    if (key === "opacity") next.wallpaperOpacity = value;
    else if (key === "blur") next.wallpaperBlur = value;
    else if (key === "dim") next.wallpaperDim = value;
    else if (key === "x") next.wallpaperX = value;
    else if (key === "y") next.wallpaperY = value;
    else next.wallpaperZoom = value;
    state.settings = next;
    applyAppearance();
    const label = els.modalLayer.querySelector<HTMLElement>(`[data-wallpaper-value="${key}"]`);
    if (label) label.textContent = `${value}${limits.unit}`;
  }
}

function onModalKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement;
  if (target.matches("[data-cat-rename-input]")) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commitCategoryRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      state.editingCategoryId = null;
      state.renameDraft = "";
      refreshActive();
      return;
    }
  }
  if (target.matches("[data-new-category-input]") && event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    addCategory();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeSettings();
    return;
  }
  if (event.key === "Tab") {
    const modal = els.modalLayer.querySelector<HTMLElement>(".modal");
    if (!modal) return;
    const focusable = [
      ...modal.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/* ── context menu ─────────────────────────────────────────────── */

function openContextMenu(app: AppEntry, x: number, y: number): void {
  state.menu = { appId: app.id, x, y, mode: "main" };
  renderMenu();
}

function renderMenu(): void {
  const menu = state.menu;
  if (!menu) {
    els.menuLayer.hidden = true;
    els.menuLayer.innerHTML = "";
    return;
  }
  const app = appMap().get(menu.appId);
  if (!app) {
    closeMenu();
    return;
  }
  const pinned = state.settings.pinned.includes(app.id);
  const canReveal = app.source !== "uwp";
  let contents = "";

  if (menu.mode === "main") {
    contents = `<div class="menu-heading">${escapeHtml(app.name)}</div>
      <button class="menu-item" data-menu-action="launch">${icon("arrow-up-right")}启动应用</button>
      <button class="menu-item" data-menu-action="inspect">${icon("info")}应用详情</button>
      <button class="menu-item" data-menu-action="reveal"${canReveal ? "" : " disabled"}>${icon(
        "folder",
      )}打开文件位置</button>
      <div class="menu-sep"></div>
      <button class="menu-item" data-menu-action="pin">${icon("pin")}${
        pinned ? "取消固定" : "固定到常用"
      }</button>
      <button class="menu-item" data-menu-action="move">${icon("layers")}移动到分类<span class="menu-chevron">${icon(
        "chevron-right",
      )}</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item is-danger" data-menu-action="hide">${icon("eye-off")}隐藏此应用</button>`;
  } else {
    const override = state.settings.overrides[app.id];
    contents = `<div class="menu-heading"><button class="menu-back" data-menu-action="back" aria-label="返回">${icon(
      "chevron-left",
    )}</button>移动到分类</div>
      <button class="menu-item" data-menu-action="auto"${override ? "" : " disabled"}>${icon(
        "sparkle",
      )}恢复自动分类${override ? "" : `<span class="menu-chevron">${icon("check")}</span>`}</button>
      <div class="menu-sep"></div>
      ${state.settings.categories
        .map((item) => {
          const color = categoryColor(item.id, state.settings.categories);
          const selected = effectiveCategory(app) === item.id;
          return `<button class="menu-item" data-menu-cat="${escapeHtml(item.id)}">
            <span class="menu-cat-dot" style="--cat-color:${color}"></span>${escapeHtml(item.name)}
            ${selected ? `<span class="menu-chevron">${icon("check")}</span>` : ""}
          </button>`;
        })
        .join("")}`;
  }

  els.menuLayer.innerHTML = `<div class="context-menu" role="menu">${contents}</div>`;
  els.menuLayer.hidden = false;

  const menuEl = els.menuLayer.querySelector<HTMLElement>(".context-menu");
  if (menuEl) {
    const rect = menuEl.getBoundingClientRect();
    const padding = 10;
    const left = Math.max(padding, Math.min(menu.x, window.innerWidth - rect.width - padding));
    const top = Math.max(padding, Math.min(menu.y, window.innerHeight - rect.height - padding));
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }
}

function closeMenu(): void {
  state.menu = null;
  els.menuLayer.hidden = true;
  els.menuLayer.innerHTML = "";
}

async function onMenuClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;
  if (target === els.menuLayer) {
    closeMenu();
    return;
  }
  const moveEl = target.closest<HTMLElement>("[data-menu-cat]");
  if (moveEl) {
    const categoryId = moveEl.dataset.menuCat;
    const menu = state.menu;
    const app = menu ? appMap().get(menu.appId) : undefined;
    if (categoryId && app) {
      const category = categoryById(categoryId);
      patchSettings({
        overrides: { ...state.settings.overrides, [app.id]: categoryId },
      });
      showToast(`已移动到「${category?.name ?? "分类"}」`, "success");
    }
    closeMenu();
    return;
  }

  const actionEl = target.closest<HTMLElement>("[data-menu-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.menuAction;
  const menu = state.menu;
  const app = menu ? appMap().get(menu.appId) : undefined;
  if (!app) {
    closeMenu();
    return;
  }

  if (action === "back") {
    if (menu) menu.mode = "main";
    renderMenu();
    return;
  }
  if (action === "move") {
    if (menu) menu.mode = "move";
    renderMenu();
    return;
  }
  if (action === "auto") {
    const overrides = { ...state.settings.overrides };
    delete overrides[app.id];
    patchSettings({ overrides });
    showToast("已恢复自动分类", "success");
    closeMenu();
    return;
  }
  if (action === "launch") {
    closeMenu();
    await launchApp(app);
    return;
  }
  if (action === "inspect") {
    closeMenu();
    state.inspectorId = app.id;
    scheduleRender();
    return;
  }
  if (action === "reveal") {
    closeMenu();
    try {
      await api.reveal(app.id);
  } catch (error) {
      showToast(`无法打开文件位置：${String(error)}`, "error");
    }
    return;
  }
  if (action === "pin") {
    closeMenu();
    togglePinned(app);
    return;
  }
  if (action === "hide") {
    closeMenu();
    hideApp(app);
  }
}

/* ── app actions ──────────────────────────────────────────────── */

let lastAppPruneAt = 0;

async function pruneMissingApps(force = false): Promise<void> {
  const now = Date.now();
  if (!force && !(await windowActive())) return;
  if (!force && now - lastAppPruneAt < 15_000) return;
  lastAppPruneAt = now;
  try {
    const apps = await api.pruneApps();
    const currentIds = new Set(apps.map((app) => app.id));
    const removed = state.apps.filter((app) => !currentIds.has(app.id));
    if (removed.length === 0) return;
    const removedIds = new Set(removed.map((app) => app.id));
    removedIds.forEach((id) => {
      iconCache.delete(id);
      iconRequested.delete(id);
    });
    state.apps = apps;
    state.settings.pinned = state.settings.pinned.filter((id) => !removedIds.has(id));
    state.settings.recent = state.settings.recent.filter((entry) => !removedIds.has(entry.id));
    state.settings.hidden = state.settings.hidden.filter((id) => !removedIds.has(id));
    state.resetScroll = true;
    queueSave();
    renderAll();
    showToast(`已从列表移除 ${removed.length} 个不存在的应用`, "info");
  } catch {
    // 清理失败时保留现有列表，不影响使用
  }
}

async function launchApp(app: AppEntry, sourceEl?: HTMLElement): Promise<void> {
  if (!app.launchable) {
    showToast(`「${app.name}」没有可用的启动目标`, "error");
    return;
  }
  sourceEl?.classList.add("is-launching");
  window.setTimeout(() => sourceEl?.classList.remove("is-launching"), 480);
  try {
    const result: LaunchResult = await api.launch(app.id);
    if (!result.ok) {
      showToast(result.error ? `启动失败：${result.error}` : "启动失败", "error");
      void pruneMissingApps(true);
      return;
    }
    const recent = [
      { id: app.id, at: Date.now() },
      ...state.settings.recent.filter((entry) => entry.id !== app.id),
    ].slice(0, 20);
    // 本地同步累加启动次数，让「常用优先」在下次渲染时立刻反映最新排序。
    const usage = { ...(state.settings.usage ?? {}) };
    usage[app.id] = (usage[app.id] ?? 0) + 1;
    patchSettings({ recent, usage });
    showToast(`已启动 ${app.name}`, "success");
  } catch (error) {
    showToast(`启动失败：${String(error)}`, "error");
  }
}

function togglePinned(app: AppEntry): void {
  const pinned = [...state.settings.pinned];
  const index = pinned.indexOf(app.id);
  if (index >= 0) {
    pinned.splice(index, 1);
    patchSettings({ pinned });
    showToast(`已从常用中移除 ${app.name}`, "info");
    return;
  }
  if (pinned.length >= 9) {
    showToast("常用栏最多固定 9 个应用", "error");
    return;
  }
  pinned.push(app.id);
  patchSettings({ pinned });
  showToast(`已固定 ${app.name}，可用 Alt + ${pinned.length} 启动`, "success");
}

function hideApp(app: AppEntry): void {
  if (state.settings.hidden.includes(app.id)) return;
  patchSettings({
    hidden: [...state.settings.hidden, app.id],
    pinned: state.settings.pinned.filter((id) => id !== app.id),
  });
  if (state.inspectorId === app.id) state.inspectorId = null;
  showToast(`已隐藏 ${app.name}，可在「设置 > 扫描」中恢复`, "info");
}

function setCategory(app: AppEntry, categoryId: string): void {
  const category = categoryById(categoryId);
  if (!category) return;
  if (effectiveCategory(app) === categoryId && state.settings.overrides[app.id] === categoryId) return;
  patchSettings({
    overrides: { ...state.settings.overrides, [app.id]: categoryId },
  });
  showToast(`已把 ${app.name} 移动到「${category.name}」`, "success");
}

function setNav(nav: NavKey): void {
  state.workspace = "launcher";
  state.activeNav = nav;
  state.query = "";
  els.search.value = "";
  state.cursorIndex = 0;
  state.resetScroll = true;
  els.searchWrap.classList.remove("has-query");
  els.searchClear.hidden = true;
  renderAll();
}

function clearSearch(focus = true): void {
  state.query = "";
  state.cursorIndex = 0;
  els.search.value = "";
  els.searchWrap.classList.remove("has-query");
  els.searchClear.hidden = true;
  state.resetScroll = true;
  if (focus) els.search.focus({ preventScroll: true });
  scheduleRender("query");
}

function updateSearch(value: string): void {
  state.query = value;
  state.cursorIndex = 0;
  state.resetScroll = true;
  els.searchWrap.classList.toggle("has-query", value.length > 0);
  els.searchClear.hidden = value.length === 0;
  state.lastResults = searchResults();
  resultsQuery = value;
  scheduleRender("query");
}

function moveSearchCursor(delta: number): void {
  const tokens = searchTokens();
  const results = state.lastResults.length > 0 ? state.lastResults : searchResults(tokens);
  if (results.length === 0) return;
  state.cursorIndex = (state.cursorIndex + delta + results.length) % results.length;
  const current = results[state.cursorIndex];
  els.contentBody.querySelectorAll<HTMLElement>("[data-app-id]").forEach((node) => {
    node.classList.toggle("is-cursor", node.dataset.appId === current?.id);
  });
  const target = els.contentBody.querySelector<HTMLElement>(`[data-app-id="${current?.id}"]`);
  target?.scrollIntoView({ block: "nearest" });
}

/* ── toasts ───────────────────────────────────────────────────── */

function showToast(message: string, type: "success" | "error" | "info" = "info"): void {
  while (els.toastStack.childElementCount >= 3) {
    els.toastStack.firstElementChild?.remove();
  }
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " is-error" : ""}`;
  toast.setAttribute("role", "status");
  toast.innerHTML = `<span class="toast-icon">${icon(
    type === "success" ? "check" : "info",
  )}</span><span class="toast-copy">${escapeHtml(message)}</span>`;
  els.toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, 2800);
}

/* ── events ───────────────────────────────────────────────────── */

els.search.addEventListener("input", () => updateSearch(els.search.value));

els.search.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!state.query.trim()) return;
    event.preventDefault();
    moveSearchCursor(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Enter") {
    if (!state.query.trim()) return;
    event.preventDefault();
    const results = state.lastResults.length > 0 ? state.lastResults : searchResults();
    const app = results[state.cursorIndex];
    if (app) void launchApp(app);
    return;
  }
  if (event.key === "Escape" && els.search.value.length > 0) {
    event.preventDefault();
    event.stopPropagation();
    clearSearch();
  }
});

els.searchClear.addEventListener("click", () => clearSearch());

document.getElementById("btn-scan")?.addEventListener("click", () => void runScan(true));

document.getElementById("btn-settings")?.addEventListener("click", () => openSettings());

document.getElementById("btn-add-category")?.addEventListener("click", () => openSettings("categories"));

document.getElementById("btn-theme-quick")?.addEventListener("click", () => {
  const index = THEME_OPTIONS.findIndex((item) => item.id === state.settings.theme);
  const next = THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length] ?? THEME_OPTIONS[0];
  patchSettings({ theme: next.id });
  showToast(`已切换到 ${next.name}`, "info");
});

els.btnSort.addEventListener("click", () => {
  cycleSort();
  saveUiPrefs();
});

const viewScrollPositions: Partial<Record<ViewMode, number>> = {};

els.btnView.addEventListener("click", () => {
  const current = els.content.scrollTop;
  viewScrollPositions[state.view] = current;
  state.view = state.view === "grid" ? "list" : "grid";
  saveUiPrefs();
  state.resetScroll = false;
  const target = viewScrollPositions[state.view] ?? current;
  renderAll();
  window.requestAnimationFrame(() => {
    els.content.scrollTop = target;
  });
});

document.getElementById("btn-min")?.addEventListener("click", () => {
  void minimizeWindow();
});

els.btnMax.addEventListener("click", () => void handleMaximize());

document.getElementById("btn-close")?.addEventListener("click", () => {
  if (isTauri) {
    void closeWithSave();
  } else {
    showToast("预览模式不会关闭窗口；桌面版关闭后会隐藏到系统托盘", "info");
  }
});

async function closeWithSave(): Promise<void> {
  try {
    await queueSaveAndWait();
  } catch {
    // 即使保存失败也允许关闭
  }
  await closeWindow();
}

async function queueSaveAndWait(): Promise<void> {
  queueSave();
  await saveChain;
}

async function handleMaximize(): Promise<void> {
  try {
    const maximized = await toggleMaximizeWindow();
    applyMaximized(maximized);
  } catch {
    showToast("无法切换窗口大小", "error");
  }
}

function applyMaximized(maximized: boolean): void {
  els.app.dataset.maximized = String(maximized);
  const use = els.btnMax.querySelector("use");
  use?.setAttribute("href", maximized ? "#i-restore" : "#i-maximize");
  els.btnMax.title = maximized ? "向下还原" : "最大化";
  els.btnMax.setAttribute("aria-label", maximized ? "向下还原" : "最大化");
}

function renderWindowControlsState(): void {
  const maximized = els.app.dataset.maximized === "true";
  const use = els.btnMax.querySelector("use");
  use?.setAttribute("href", maximized ? "#i-restore" : "#i-maximize");
}

watchMaximize((maximized) => applyMaximized(maximized));

els.app.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (els.modalLayer.contains(target) || els.menuLayer.contains(target)) return;

  const emptyAction = target.closest<HTMLElement>("[data-empty-action]");
  if (emptyAction) {
    const action = emptyAction.dataset.emptyAction as EmptyAction | undefined;
    if (action === "scan") void runScan(true);
    else if (action === "retry-boot") void boot();
    else if (action === "clear-search") clearSearch();
    else if (action === "all") setNav("all");
    else if (action === "settings") openSettings();
    else if (action === "settings-scan") openSettings("apps");
    else if (action === "settings-categories") openSettings("categories");
    return;
  }

  const surface = target.closest<HTMLElement>("[data-surface]");
  if (surface) {
    const id = surface.dataset.surface as WorkspaceTab | undefined;
    if (id) setWorkspace(id);
    return;
  }

  const inspect = target.closest<HTMLElement>("[data-inspect]");
  if (inspect) {
    const id = inspect.dataset.inspect;
    if (id) {
      state.inspectorId = id;
      renderInspector();
    }
    return;
  }

  const quick = target.closest<HTMLElement>("[data-quick-id]");
  if (quick) {
    const app = appMap().get(quick.dataset.quickId ?? "");
    if (app) void launchApp(app, quick);
    return;
  }

  const railItem = target.closest<HTMLElement>("[data-nav]");
  if (railItem) {
    const nav = railItem.dataset.nav;
    if (nav) setNav(nav);
    return;
  }

  const sectionCat = target.closest<HTMLElement>("[data-section-cat]");
  if (sectionCat) {
    const id = sectionCat.dataset.sectionCat;
    if (id) setNav(id);
    return;
  }

  const tile = target.closest<HTMLElement>("[data-app-id]");
  if (tile) {
    const app = appMap().get(tile.dataset.appId ?? "");
    if (app) void launchApp(app, tile);
    return;
  }

  const inspectorAction = target.closest<HTMLElement>("[data-inspector-action]");
  if (inspectorAction) {
    const action = inspectorAction.dataset.inspectorAction;
    const app = state.inspectorId ? appMap().get(state.inspectorId) : undefined;
    if (action === "close") {
      state.inspectorId = null;
      renderInspector();
      return;
    }
    if (!app) return;
    if (action === "launch") void launchApp(app);
    else if (action === "reveal") {
      void api.reveal(app.id).catch((error) => showToast(`无法打开文件位置：${String(error)}`, "error"));
    } else if (action === "pin") {
      togglePinned(app);
    } else if (action === "hide") {
      hideApp(app);
      renderInspector();
    } else if (action === "category") {
      const rect = inspectorAction.getBoundingClientRect();
      openContextMenu(app, rect.left, rect.bottom + 6);
      if (state.menu) state.menu.mode = "move";
      renderMenu();
    }
  }
});

els.app.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, [contenteditable='true'], .is-mono")) {
    return;
  }
  event.preventDefault();
  if (els.modalLayer.contains(target)) return;

  let app: AppEntry | undefined;
  const entity = target.closest<HTMLElement>("[data-app-id]");
  const quick = target.closest<HTMLElement>("[data-quick-id]");
  if (entity) {
    app = appMap().get(entity.dataset.appId ?? "");
  } else if (quick) {
    app = appMap().get(quick.dataset.quickId ?? "");
  } else if (els.inspector.contains(target) && state.inspectorId) {
    app = appMap().get(state.inspectorId);
  }

  if (!app) {
    closeMenu();
    return;
  }
  openContextMenu(app, event.clientX, event.clientY);
});

els.modalLayer.addEventListener("click", (event) => void onModalClick(event));
els.modalLayer.addEventListener("change", (event) => {
  const target = event.target as HTMLElement;
  const fileInput = target.closest<HTMLInputElement>("[data-wallpaper-file]");
  if (fileInput) {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = "";
    if (files.length > 0) void importWallpapers(files);
    return;
  }
  if (target.matches("[data-palette-range]") || target.matches("[data-palette-color]")) {
    queueSave();
    refreshActive();
    return;
  }
  if (target.matches("[data-wallpaper-range]") || target.matches("[data-custom-accent]")) {
    queueSave();
    return;
  }
  const select = target.closest<HTMLSelectElement>("[data-hotkey-app-pick]");
  if (!select) return;
  state.hotkeyAppPick = select.value;
  refreshActive();
});
els.contentBody.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const aiAction = target.closest<HTMLElement>("[data-ai-action]");
  if (aiAction?.dataset.aiAction) {
    event.preventDefault();
    void handleAiAction(aiAction.dataset.aiAction, aiAction);
    return;
  }
  void onModalClick(event);
});
els.contentBody.addEventListener("input", (event) => {
  const aiInput = (event.target as HTMLElement).closest<HTMLTextAreaElement>("[data-ai-input]");
  if (aiInput) {
    state.aiInput = aiInput.value;
    if (aiInput.value.trim()) scheduleAiWarm();
    return;
  }
  const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-app-search]");
  if (!input) return;
  state.cleanupAppQuery = input.value;
  refreshCleanupAppList();
});
els.contentBody.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (!target.matches("[data-ai-input]")) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendAiMessage((target as HTMLTextAreaElement).value);
  }
});
els.contentBody.addEventListener("focusin", (event) => {
  if ((event.target as HTMLElement).matches("[data-ai-input]")) scheduleAiWarm();
});
els.contentBody.addEventListener("change", (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-ai-model]");
  if (select) void switchAiModel(select.value);
});
els.modalLayer.addEventListener("input", onModalInput);
els.modalLayer.addEventListener("keydown", onModalKeydown);
els.menuLayer.addEventListener("click", (event) => void onMenuClick(event));

window.addEventListener("resize", () => closeMenu());
els.content.addEventListener("scroll", () => {
  if (state.menu) closeMenu();
});

window.addEventListener("keydown", (event) => {
  if (state.hotkeyCapture) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      cancelHotkeyCapture();
      return;
    }
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
    const combo = acceleratorFromEvent(event);
    if (!combo) {
      showToast("请按字母、数字或功能键，并至少包含 Ctrl / Alt / Win 之一", "error");
      return;
    }
    void commitHotkey(combo);
    return;
  }
  const target = event.target as HTMLElement;
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.key.toLowerCase() === "k") {
    if (state.settingsOpen || state.workspace !== "launcher") return;
    event.preventDefault();
    els.search.focus();
    els.search.select();
    return;
  }
  if (mod && event.key.toLowerCase() === "f") {
    if (state.settingsOpen || state.workspace !== "launcher") return;
    event.preventDefault();
    els.search.focus();
    els.search.select();
    return;
  }
  if (mod && event.key.toLowerCase() === "r") {
    event.preventDefault();
    if (!state.settingsOpen && state.workspace === "launcher") void runScan(true);
    return;
  }
  if (mod && event.key === ",") {
    event.preventDefault();
    openSettings();
    return;
  }
  if (event.key === "Escape") {
    if (state.menu) {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (state.settingsOpen) {
      event.preventDefault();
      closeSettings();
      return;
    }
    if (state.workspace !== "launcher") {
      event.preventDefault();
      setWorkspace("launcher");
      return;
    }
    if (state.inspectorId) {
      event.preventDefault();
      state.inspectorId = null;
      renderInspector();
      return;
    }
    if (state.query) {
      event.preventDefault();
      clearSearch();
      return;
    }
  }
  if (state.settingsOpen || state.menu) return;

  if (event.altKey && /^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    const app = pinnedApps()[index];
    if (app) {
      event.preventDefault();
      void launchApp(app);
    }
    return;
  }

  const isEditable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable;
  if (
    state.workspace === "launcher" &&
    !isEditable &&
    !mod &&
    !event.altKey &&
    event.key.length === 1 &&
    event.key !== " "
  ) {
    event.preventDefault();
    els.search.focus({ preventScroll: true });
    els.search.value = state.query + event.key;
    updateSearch(els.search.value);
  }
});



/* drag & drop */
els.app.addEventListener("dragstart", (event) => {
  const entity = (event.target as HTMLElement).closest<HTMLElement>("[data-app-id]");
  if (!entity) return;
  const app = appMap().get(entity.dataset.appId ?? "");
  if (!app) return;
  state.dragId = app.id;
  entity.classList.add("is-dragging");
  event.dataTransfer?.setData("text/x-qidian-app", app.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
});

els.app.addEventListener("dragend", () => {
  state.dragId = null;
  els.contentBody.querySelectorAll(".is-dragging").forEach((node) => node.classList.remove("is-dragging"));
  document.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
});

els.app.addEventListener("dragover", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cat-drop]");
  document.querySelectorAll(".is-drop-target").forEach((node) => {
    if (node !== target) node.classList.remove("is-drop-target");
  });
  if (!target) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  target.classList.add("is-drop-target");
});

els.app.addEventListener("dragleave", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cat-drop]");
  if (target && !target.contains(event.relatedTarget as Node)) {
    target.classList.remove("is-drop-target");
  }
});

els.app.addEventListener("drop", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cat-drop]");
  if (!target) return;
  event.preventDefault();
  target.classList.remove("is-drop-target");
  const appId = event.dataTransfer?.getData("text/x-qidian-app") || state.dragId;
  const categoryId = target.dataset.catDrop;
  const app = appId ? appMap().get(appId) : undefined;
  if (app && categoryId) setCategory(app, categoryId);
  state.dragId = null;
});

/* helpers */

interface UiPrefs {
  sort: SortMode;
  view: ViewMode;
}

function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem("qidian.ui.v1");
    if (!raw) return { sort: "name", view: "grid" };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      sort:
        parsed.sort === "recent" || parsed.sort === "frequent"
          ? (parsed.sort as SortMode)
          : "name",
      view: parsed.view === "list" ? "list" : "grid",
    };
  } catch {
    return { sort: "name", view: "grid" };
  }
}

function saveUiPrefs(): void {
  try {
    localStorage.setItem(
      "qidian.ui.v1",
      JSON.stringify({ sort: state.sort, view: state.view }),
    );
  } catch {
    // 忽略存储异常
  }
}

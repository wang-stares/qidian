export type ThemeId = "win11" | "miuix" | "macos" | "mono" | "custom";
export type ThemePresetId =
  | "default"
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
  | "peach";
export type ColorMode = "system" | "light" | "dark";
export type AccentId = "blue" | "violet" | "orange" | "green" | "rose" | "cyan" | "amber" | "slate";
/** 强调色可以是预设，也可以是用户自定义的十六进制颜色。 */
export type AccentChoice = AccentId | "custom";
export type WallpaperId = "none" | "aurora" | "dusk" | "sea" | "nebula" | "dots" | "grid" | "custom";
/** 自定义图片壁纸的铺放方式。 */
export type WallpaperFit = "cover" | "contain" | "tile" | "stretch";
export type CornerStyle = "soft" | "sharp" | "round";
export type BlurLevel = "off" | "standard" | "strong";
export type Density = "cozy" | "compact";
export type SortMode = "name" | "recent" | "frequent";
export type ViewMode = "grid" | "list";
export type AiPhase =
  | "idle"
  | "llama"
  | "whisper"
  | "model"
  | "speech"
  | "extract"
  | "done";

export type AppSource =
  | "startMenu"
  | "desktop"
  | "appPaths"
  | "registry"
  | "uwp"
  | "appsFolder"
  | "installDir";
export type MemoryMode = "auto" | "custom" | "manual";
export type MemoryLevel = "low" | "normal";
export type MemoryTrimScope = "self" | "system";
export type NavKey = "all" | "recent" | "pinned" | string;

export interface Category {
  id: string;
  name: string;
  builtin?: boolean;
}

export interface MockVisual {
  glyph: string;
  tone: string;
}

export interface AppEntry {
  id: string;
  name: string;
  category: string;
  publisher?: string | null;
  version?: string | null;
  source: AppSource;
  installLocation?: string | null;
  shortcutPath?: string | null;
  launchable: boolean;
  visual?: MockVisual;
}

export interface RecentEntry {
  id: string;
  at: number;
}

/** 用户保存的外观方案：一次性还原整套视觉参数。 */
export interface CustomTheme {
  id: string;
  name: string;
  theme: ThemeId;
  preset: ThemePresetId;
  accent: AccentChoice;
  customAccent: string;
  wallpaper: WallpaperId;
  wallpaperImage: string;
  wallpaperAsset: string;
  wallpaperFit: WallpaperFit;
  wallpaperX: number;
  wallpaperY: number;
  wallpaperZoom: number;
  wallpaperOpacity: number;
  wallpaperBlur: number;
  wallpaperDim: number;
  corners: CornerStyle;
  blur: BlurLevel;
  colorMode: ColorMode;
  density: Density;
  palette: CustomPalette;
}

/** 自定义主题的调色板与形状参数。 */
export interface CustomPalette {
  bgLight: string;
  bgDark: string;
  panelLight: string;
  panelDark: string;
  textLight: string;
  textDark: string;
  radius: number;
  panelOpacity: number;
  blur: number;
  iconSize: number;
}

/** 本地壁纸库中的一张图片（像素文件由后端保存在数据目录）。 */
export interface WallpaperAsset {
  id: string;
  name: string;
  addedAt: number;
  bytes: number;
}

export interface Settings {
  schemaVersion: number;
  theme: ThemeId;
  themePreset: ThemePresetId;
  colorMode: ColorMode;
  accent: AccentChoice;
  /** 自定义强调色的十六进制值，仅在 accent === "custom" 时生效。 */
  customAccent: string;
  density: Density;
  /** 圆角档位：跟随主题 / 直角 / 大圆角。 */
  corners: CornerStyle;
  /** 面板模糊档位：关闭 / 标准 / 加强。 */
  blur: BlurLevel;
  wallpaper: WallpaperId;
  /** 自定义壁纸的 data URL（兼容旧配置），仅 wallpaper === "custom" 时生效。 */
  wallpaperImage: string;
  /** 当前使用的壁纸库图片 id；为空时回落到 wallpaperImage。 */
  wallpaperAsset: string;
  wallpaperLibrary: WallpaperAsset[];
  wallpaperFit: WallpaperFit;
  wallpaperX: number;
  wallpaperY: number;
  wallpaperZoom: number;
  wallpaperOpacity: number;
  wallpaperBlur: number;
  wallpaperDim: number;
  customPalette: CustomPalette;
  customThemes: CustomTheme[];
  lowPower: boolean;
  scanUwp: boolean;
  includeSystemApps: boolean;
  scanInstallDirs: boolean;
  autoRefreshHours: number;
  memoryMode: MemoryMode;
  memoryLevel: MemoryLevel;
  memoryLowPercent: number;
  memoryRecoverPercent: number;
  memorySmartThresholds: boolean;
  memoryIntervalSec: number;
  memoryAdaptiveInterval: boolean;
  memoryTrimWorkingSet: boolean;
  memoryTrimScope: MemoryTrimScope;
  memoryIdleTrim: boolean;
  memoryDropIcons: boolean;
  memoryPauseFullscreen: boolean;
  memoryPowerAware: boolean;
  hotkeyToggle: string;
  appHotkeys: Record<string, string>;
  closeToTray: boolean;
  trayQuickApps: boolean;
  cleanupRecycleBin: boolean;
  categories: Category[];
  overrides: Record<string, string>;
  pinned: string[];
  recent: RecentEntry[];
  /** 每个应用的启动次数，用于「常用优先」排序。 */
  usage?: Record<string, number>;
  hidden: string[];
}

export interface Bootstrap {
  settings: Settings;
  apps: AppEntry[];
  scannedAt: number | null;
  aiEnabled: boolean;
  aiInstalled: boolean;
}

export interface AiStatus {
  enabled: boolean;
  installed: boolean;
  running: boolean;
  downloadedBytes: number;
  totalBytes: number;
  modelLabel: string;
  downloading: boolean;
}

export interface AiProgress {
  phase: string;
  done: number;
  total: number;
  percent: number;
}

export interface AiToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface AiChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: AiToolCall[];
  tool_call_id?: string;
}

export interface MemoryLastAction {
  reason: string;
  at: number;
  releasedBytes: number;
  level: MemoryLevel;
}

export interface MemoryStatus {
  mode: MemoryMode;
  level: MemoryLevel;
  monitor: "event" | "timer" | "off";
  trimWorkingSet: boolean;
  trimScope: MemoryTrimScope;
  idleTrim: boolean;
  effectiveIntervalSec: number;
  fullscreenPaused: boolean;
  powerSource: "ac" | "battery" | "unknown";
  batteryPercent: number | null;
  powerAware: boolean;
  effectiveLowPercent: number;
  effectiveRecoverPercent: number;
  smartThresholds: boolean;
  emergencyLow: boolean;
  systemTotalBytes: number;
  systemAvailBytes: number;
  systemUsedPercent: number;
  systemCommitTotalBytes: number;
  systemCommitAvailBytes: number;
  systemCommitUsedPercent: number;
  commitPressure: boolean;
  userIdleSeconds: number;
  selfWorkingSetBytes: number;
  selfPrivateBytes: number;
  lastAction: MemoryLastAction | null;
  history: MemoryLastAction[];
  totalReleasedBytes: number;
  todayReleasedBytes: number;
  adjustCount: number;
}

export interface ScanProgress {
  phase: string;
  found: number;
  percent: number;
}

export interface ScanResult {
  apps: AppEntry[];
  scannedAt: number;
  cached: boolean;
  durationMs?: number;
}

export interface LaunchResult {
  ok: boolean;
  error?: string;
}

export interface IconMap {
  [id: string]: string;
}

export type StartupSource =
  | "registry"
  | "runOnce"
  | "policy"
  | "startupFolder"
  | "scheduledTask"
  | "service";
export type StartupScope = "user" | "machine";

export interface StartupItem {
  id: string;
  name: string;
  command: string;
  source: StartupSource;
  scope: StartupScope;
  enabled: boolean;
  editable: boolean;
  impact: "high" | "medium" | "low";
  recommendation: "keep" | "disable" | "optional";
}

export interface StartupScan {
  items: StartupItem[];
  advancedOk: boolean;
}

export interface CleanupCandidate {
  id: string;
  name: string;
  path: string;
  root: string;
  kind: "install" | "data";
  sizeBytes: number;
  files: number;
  lastModified: number;
  referenced: boolean;
}

export interface CleanupScan {
  candidates: CleanupCandidate[];
  references: number;
  roots: string[];
  scannedDirs: number;
  suspects: number;
  totalBytes: number;
  advancedOk: boolean;
}

export interface CleanupDeleteReport {
  freedBytes: number;
  files: number;
  deleted: string[];
  recycled: boolean;
  /** 已安排下次重启后删除的路径。 */
  pendingReboot: string[];
  errors: string[];
}

export interface CleanupApp {
  id: string;
  name: string;
  publisher?: string | null;
  version?: string | null;
  installLocation?: string | null;
  sizeBytes: number;
  scope: string;
  iconPath?: string | null;
  quiet: boolean;
  uninstallable: boolean;
}

export interface UninstallReport {
  appName: string;
  exitCode: number | null;
  timedOut: boolean;
  removedDirs: string[];
  freedBytes: number;
  files: number;
  registryRemoved: boolean;
  errors: string[];
}

export interface HotkeyBindingStatus {
  appId: string;
  accelerator: string;
  ok: boolean;
}

export interface HotkeyStatus {
  toggle: string;
  toggleOk: boolean;
  bindings: HotkeyBindingStatus[];
  errors: string[];
}

export interface ProcessItem {
  pid: number;
  name: string;
  path?: string | null;
  memoryBytes: number;
  company?: string | null;
  description?: string | null;
  protected: boolean;
}

export interface ProcessTarget {
  pid: number;
  name: string;
}

export interface TerminateFailure {
  pid: number;
  name: string;
  error: string;
}

export interface TerminateReport {
  terminated: number;
  failed: TerminateFailure[];
}

export interface CategoryMeta {
  color: string;
  glyph: string;
}

export type ModuleId =
  | "background"
  | "performance"
  | "optimize"
  | "memory"
  | "cleanup"
  | "boot";

export interface ModuleStatus {
  id: ModuleId;
  name: string;
  version: string;
  description: string;
  features: string[];
  installed: boolean;
  installedAt: number | null;
  sizeBytes: number;
  runtime: string;
}

export interface PerfModuleStatus {
  installed: boolean;
  installedVersion: string | null;
  availableVersion: string;
  installedAt: number | null;
  sizeBytes: number;
  path: string | null;
  updateAvailable: boolean;
}

export interface PerfMemoryInfo {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface PerfDiskInfo {
  drive: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  system: boolean;
}

export interface PerfCpuInfo {
  name: string;
  logical: number;
  usagePercent: number;
}

export interface PerfPhysicalDisk {
  name: string;
  mediaType: string;
  health: string;
  sizeBytes: number;
}

export interface PerfHog {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  protected: boolean;
}

export interface PerfScorePoint {
  at: number;
  score: number;
}

export interface PerfCleanRecord {
  at: number;
  freedBytes: number;
  files: number;
}

export interface PerfPowerInfo {
  guid: string;
  name: string;
  error?: string | null;
}

export interface PerfOsInfo {
  caption: string;
  version: string;
  build: string;
  uptimeSeconds: number;
}

export interface PerfIssue {
  id: "memory" | "disk" | "startup" | "ok" | string;
  title: string;
  detail: string;
  severity: "high" | "medium" | "low" | "ok" | string;
  /** 这一项扣掉的分数；0 表示只是提示。 */
  points: number;
}

export interface PerfSystemInfo {
  memory: PerfMemoryInfo;
  cpu: PerfCpuInfo;
  disk: PerfDiskInfo;
  disks: PerfDiskInfo[];
  physicalDisks: PerfPhysicalDisk[];
  hogs: PerfHog[];
  power: PerfPowerInfo;
  os: PerfOsInfo;
  startupTotal: number;
  startupEnabled: number;
  score: number;
  scoreLabel: string;
  issues: PerfIssue[];
  history: PerfScorePoint[];
  cleanupTotalBytes: number;
  cleanupCount: number;
  lastCleanAt: number | null;
  recentCleans: PerfCleanRecord[];
}

export interface PerfTempCategory {
  id: string;
  name: string;
  path: string;
  bytes: number;
  files: number;
  accessible: boolean;
  errors: number;
  error?: string | null;
}

export interface PerfTempScan {
  categories: PerfTempCategory[];
  totalBytes: number;
  totalFiles: number;
  days: number;
}

export interface DiskUsageEntry {
  path: string;
  name: string;
  bytes: number;
  files: number;
}

export interface DiskUsageScan {
  drive: string;
  totalBytes: number;
  usedBytes: number;
  entries: DiskUsageEntry[];
}

export interface PerfCleanCategory {
  id: string;
  name: string;
  freedBytes: number;
  files: number;
  failed: number;
  /** 已安排下次重启后删除的对象数。 */
  pendingReboot: number;
  error?: string | null;
}

export interface PerfCleanResult {
  freedBytes: number;
  files: number;
  failed: number;
  pendingReboot: number;
  categories: PerfCleanCategory[];
}

export interface OptimizeValueInfo {
  hive: string;
  path: string;
  name: string;
  target: number;
  current: number | null;
  error?: string | null;
}

export type OptimizeState = "applied" | "default" | "custom" | "unknown";

export interface OptimizeItem {
  id: string;
  group: "safe" | "advanced" | string;
  /** 类别：privacy（隐私与通知）/ performance（性能）/ services（服务）/ updates（更新与安装）。 */
  category: "privacy" | "performance" | "services" | "updates" | string;
  name: string;
  description: string;
  risk: "safe" | "caution" | string;
  requiresAdmin: boolean;
  state: OptimizeState | string;
  backedUp: boolean;
  available: boolean;
  unavailableReason?: string | null;
  applies: string;
  values: OptimizeValueInfo[];
}

export interface OptimizeSkip {
  id: string;
  reason: string;
}

export interface OptimizeOutcome {
  changed: string[];
  skipped: OptimizeSkip[];
  message: string;
  elevated: boolean;
  cancelled: boolean;
}

/** 单个网络接口的 DNS 配置。 */
export interface DnsInterfaceInfo {
  index: number;
  alias: string;
  servers: string[];
}

/** 切换公共 DNS 前记录的原始配置。 */
export interface DnsBackup {
  preset?: string | null;
  at?: number;
  interfaces: DnsInterfaceInfo[];
}

export interface DnsStatus {
  interfaces: DnsInterfaceInfo[];
  backup?: DnsBackup | null;
}

export interface DiagProbe {
  target: string;
  label: string;
  ok: boolean;
  ms?: number | null;
}

export interface DiagReport {
  probes: DiagProbe[];
}

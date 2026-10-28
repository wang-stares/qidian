import type {
  AccentId,
  Category,
  CategoryMeta,
  CustomPalette,
  Settings,
  ThemeId,
  ThemePresetId,
  WallpaperFit,
  WallpaperId,
} from "./types";

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "dev", name: "开发工具", builtin: true },
  { id: "office", name: "办公协作", builtin: true },
  { id: "design", name: "设计创作", builtin: true },
  { id: "media", name: "影音娱乐", builtin: true },
  { id: "game", name: "游戏", builtin: true },
  { id: "social", name: "社交通讯", builtin: true },
  { id: "network", name: "网络浏览", builtin: true },
  { id: "security", name: "安全工具", builtin: true },
  { id: "system", name: "系统工具", builtin: true },
  { id: "other", name: "其他", builtin: true },
];

export const CATEGORY_META: Record<string, CategoryMeta> = {
  dev: { color: "#2f6feb", glyph: "terminal" },
  office: { color: "#2b7cd3", glyph: "briefcase" },
  design: { color: "#a259ff", glyph: "palette" },
  media: { color: "#e5533d", glyph: "play" },
  game: { color: "#1f9d55", glyph: "gamepad" },
  social: { color: "#07c160", glyph: "chat" },
  network: { color: "#0ea5a5", glyph: "globe" },
  security: { color: "#d97706", glyph: "shield" },
  system: { color: "#8a8f98", glyph: "wrench" },
  other: { color: "#8a8f98", glyph: "box" },
};

export const CUSTOM_COLORS = [
  "#2f6feb",
  "#a259ff",
  "#e5533d",
  "#1f9d55",
  "#0ea5a5",
  "#d97706",
  "#e0518e",
  "#64748b",
];

export const ACCENTS: { id: AccentId; name: string; color: string }[] = [
  { id: "blue", name: "远山蓝", color: "#1b62d6" },
  { id: "violet", name: "暮光紫", color: "#6e4be0" },
  { id: "orange", name: "落日橙", color: "#d96a1e" },
  { id: "green", name: "松针绿", color: "#0e8a57" },
  { id: "rose", name: "烟粉", color: "#c53a6c" },
  { id: "cyan", name: "青碧", color: "#0e7c9e" },
  { id: "amber", name: "琥珀", color: "#b06b12" },
  { id: "slate", name: "石墨蓝", color: "#55606f" },
];

export const THEME_OPTIONS: { id: ThemeId; name: string; short: string; note: string }[] = [
  { id: "win11", name: "Windows 11", short: "Win11", note: "Fluent · 原生 Mica" },
  { id: "miuix", name: "Miuix 风格", short: "Miuix", note: "HyperOS · 柔和大圆角" },
  { id: "macos", name: "macOS 风格", short: "macOS", note: "SF 字体 · 通透侧栏" },
  { id: "mono", name: "极简 Mono", short: "Mono", note: "直角 · 无模糊" },
  { id: "custom", name: "自定义", short: "自定义", note: "自己调色 · 圆角 · 图标" },
];

export const WALLPAPER_FITS: { id: WallpaperFit; label: string }[] = [
  { id: "cover", label: "填充" },
  { id: "contain", label: "适应" },
  { id: "tile", label: "平铺" },
  { id: "stretch", label: "拉伸" },
];

export const DEFAULT_PALETTE: CustomPalette = {
  bgLight: "#f2f3f5",
  bgDark: "#131315",
  panelLight: "#ffffff",
  panelDark: "#1f1f22",
  textLight: "#17181b",
  textDark: "#f2f2f4",
  radius: 12,
  panelOpacity: 78,
  blur: 26,
  iconSize: 44,
};

export const THEME_PRESETS: {
  id: ThemePresetId;
  name: string;
  note: string;
  accent: AccentId;
}[] = [
  { id: "default", name: "默认", note: "中性留白", accent: "blue" },
  { id: "ocean", name: "深海", note: "冷色蓝调", accent: "blue" },
  { id: "forest", name: "松林", note: "自然绿意", accent: "green" },
  { id: "sunset", name: "落日", note: "暖橙氛围", accent: "orange" },
  { id: "lavender", name: "暮紫", note: "柔和紫调", accent: "violet" },
  { id: "sakura", name: "樱粉", note: "轻盈粉调", accent: "rose" },
  { id: "nebula", name: "星云", note: "深空紫蓝", accent: "violet" },
  { id: "mint", name: "薄荷", note: "清透青绿", accent: "green" },
  { id: "graphite", name: "石墨", note: "中性灰蓝", accent: "slate" },
  { id: "coffee", name: "咖啡", note: "暖棕低饱和", accent: "amber" },
  { id: "aurora", name: "极光", note: "青绿流光", accent: "cyan" },
  { id: "peach", name: "蜜桃", note: "粉橙柔光", accent: "rose" },
];

export const WALLPAPERS: { id: WallpaperId; name: string; note: string }[] = [
  { id: "none", name: "无壁纸", note: "仅主题氛围" },
  { id: "aurora", name: "极光", note: "蓝紫青三色" },
  { id: "dusk", name: "暮色", note: "暖橙余晖" },
  { id: "sea", name: "海雾", note: "青蓝薄雾" },
  { id: "nebula", name: "星云", note: "深空紫蓝" },
  { id: "dots", name: "点阵", note: "细腻纹理" },
  { id: "grid", name: "网格", note: "工程网格" },
  { id: "custom", name: "自定义", note: "本地图片" },
];

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  theme: "win11",
  themePreset: "default",
  colorMode: "system",
  accent: "blue",
  customAccent: "#1b62d6",
  density: "cozy",
  corners: "soft",
  blur: "standard",
  wallpaper: "none",
  wallpaperImage: "",
  wallpaperAsset: "",
  wallpaperLibrary: [],
  wallpaperFit: "cover",
  wallpaperX: 50,
  wallpaperY: 50,
  wallpaperZoom: 100,
  wallpaperOpacity: 60,
  wallpaperBlur: 0,
  wallpaperDim: 0,
  customPalette: { ...DEFAULT_PALETTE },
  customThemes: [],
  lowPower: false,
  scanUwp: true,
  includeSystemApps: false,
  scanInstallDirs: false,
  aiPermissions: {
    appLaunch: true,
    appSearch: true,
    appStart: true,
    appControl: false,
    processList: false,
    processClose: false,
    settingsNav: true,
    settingsOpen: true,
  },
  autoRefreshHours: 12,
  memoryMode: "auto",
  memoryLevel: "normal",
  memoryLowPercent: 85,
  memoryRecoverPercent: 60,
  memorySmartThresholds: true,
  memoryIntervalSec: 60,
  memoryAdaptiveInterval: true,
  memoryTrimWorkingSet: true,
  memoryTrimScope: "self",
  memoryIdleTrim: true,
  memoryDropIcons: true,
  memoryPauseFullscreen: true,
  memoryPowerAware: true,
  hotkeyToggle: "Ctrl+Alt+Q",
  appHotkeys: {},
  closeToTray: true,
  trayQuickApps: true,
  cleanupRecycleBin: true,
  categories: DEFAULT_CATEGORIES,
  overrides: {},
  pinned: [],
  recent: [],
  usage: {},
  hidden: [],
};

export function cloneSettings(settings: Settings): Settings {
  return {
    ...settings,
    categories: settings.categories.map((c) => ({ ...c })),
    overrides: { ...settings.overrides },
    appHotkeys: { ...settings.appHotkeys },
    pinned: [...settings.pinned],
    recent: settings.recent.map((r) => ({ ...r })),
    usage: { ...(settings.usage ?? {}) },
    hidden: [...settings.hidden],
    customPalette: { ...settings.customPalette },
    wallpaperLibrary: (settings.wallpaperLibrary ?? []).map((asset) => ({ ...asset })),
    customThemes: (settings.customThemes ?? []).map((theme) => ({
      ...theme,
      palette: { ...theme.palette },
    })),
  };
}

export function categoryColor(id: string, categories: Category[]): string {
  if (CATEGORY_META[id]) return CATEGORY_META[id].color;
  const index = Math.max(0, categories.findIndex((c) => c.id === id));
  return CUSTOM_COLORS[index % CUSTOM_COLORS.length];
}

export function categoryGlyph(id: string): string {
  return CATEGORY_META[id]?.glyph ?? "box";
}

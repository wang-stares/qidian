import type { AccentId, Category, CategoryMeta, Settings, ThemePresetId } from "./types";

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
];

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
];

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  theme: "win11",
  themePreset: "default",
  colorMode: "system",
  accent: "blue",
  density: "cozy",
  lowPower: false,
  scanUwp: true,
  includeSystemApps: false,
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

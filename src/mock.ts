import type {
  AppEntry,
  AppSource,
  MemoryLastAction,
  MemoryStatus,
  ModuleId,
  ModuleStatus,
  OptimizeItem,
  OptimizeOutcome,
  PerfCleanResult,
  PerfCleanRecord,
  PerfModuleStatus,
  PerfPowerInfo,
  PerfSystemInfo,
  PerfTempCategory,
  PerfTempScan,
  ProcessItem,
  ProcessTarget,
  Settings,
  StartupItem,
  StartupScan,
  CleanupApp,
  CleanupCandidate,
  CleanupDeleteReport,
  CleanupScan,
  DiagReport,
  DiskUsageScan,
  DnsStatus,
  TerminateReport,
  UninstallReport,
} from "./types";
import { cloneSettings, DEFAULT_SETTINGS } from "./defaults";

interface Seed {
  name: string;
  category: string;
  publisher: string;
  version?: string;
  source?: AppSource;
  location?: string;
  glyph: string;
  tone: string;
}

const SEEDS: Seed[] = [
  { name: "Visual Studio Code", category: "dev", publisher: "Microsoft", version: "1.96.2", location: "C:\\Program Files\\Microsoft VS Code", glyph: "code", tone: "#2f6feb" },
  { name: "Cursor", category: "dev", publisher: "Anysphere", version: "0.44.11", location: "C:\\Users\\you\\AppData\\Local\\Programs\\cursor", glyph: "code", tone: "#21252b" },
  { name: "IntelliJ IDEA Ultimate", category: "dev", publisher: "JetBrains", version: "2024.3", location: "C:\\Program Files\\JetBrains\\IntelliJ IDEA 2024.3", glyph: "code", tone: "#e8632c" },
  { name: "Docker Desktop", category: "dev", publisher: "Docker Inc.", version: "4.37.1", location: "C:\\Program Files\\Docker\\Docker", glyph: "box", tone: "#2496ed" },
  { name: "Postman", category: "dev", publisher: "Postman Inc.", version: "11.23.0", location: "C:\\Users\\you\\AppData\\Local\\Postman", glyph: "layers", tone: "#f26b3a" },
  { name: "Windows Terminal", category: "dev", publisher: "Microsoft", version: "1.22", source: "uwp", glyph: "terminal", tone: "#334155" },
  { name: "Git Bash", category: "dev", publisher: "The Git Development Community", version: "2.47.1", location: "C:\\Program Files\\Git", glyph: "terminal", tone: "#c2410c" },
  { name: "PyCharm Professional", category: "dev", publisher: "JetBrains", version: "2024.3", location: "C:\\Program Files\\JetBrains\\PyCharm 2024.3", glyph: "code", tone: "#0e8a57" },
  { name: "Unity Hub", category: "dev", publisher: "Unity Technologies", version: "3.8.0", location: "C:\\Program Files\\Unity Hub", glyph: "layers", tone: "#30343b" },
  { name: "Android Studio", category: "dev", publisher: "Google LLC", version: "2024.2.2", location: "C:\\Program Files\\Android\\Android Studio", glyph: "code", tone: "#0b8457" },

  { name: "Microsoft Word", category: "office", publisher: "Microsoft Corporation", version: "16.0.18324", location: "C:\\Program Files\\Microsoft Office\\root\\Office16", glyph: "doc", tone: "#2b579a" },
  { name: "Microsoft Excel", category: "office", publisher: "Microsoft Corporation", version: "16.0.18324", location: "C:\\Program Files\\Microsoft Office\\root\\Office16", glyph: "table", tone: "#217346" },
  { name: "Microsoft PowerPoint", category: "office", publisher: "Microsoft Corporation", version: "16.0.18324", location: "C:\\Program Files\\Microsoft Office\\root\\Office16", glyph: "monitor", tone: "#c43e1c" },
  { name: "飞书", category: "office", publisher: "字节跳动", version: "7.32.9", location: "C:\\Users\\you\\AppData\\Local\\Feishu", glyph: "chat", tone: "#3370ff" },
  { name: "Notion", category: "office", publisher: "Notion Labs", version: "4.8.2", location: "C:\\Users\\you\\AppData\\Local\\Programs\\Notion", glyph: "doc", tone: "#202124" },
  { name: "WPS Office", category: "office", publisher: "金山办公", version: "12.1.0", location: "C:\\Program Files\\Kingsoft\\WPS Office", glyph: "doc", tone: "#d94a37" },
  { name: "钉钉", category: "office", publisher: "阿里巴巴", version: "7.6.15", location: "C:\\Program Files\\DingTalk", glyph: "chat", tone: "#1677ff" },
  { name: "Adobe Acrobat", category: "office", publisher: "Adobe", version: "24.3", location: "C:\\Program Files\\Adobe\\Acrobat DC", glyph: "doc", tone: "#e23a3a" },

  { name: "Figma", category: "design", publisher: "Figma", version: "124.6.4", location: "C:\\Users\\you\\AppData\\Local\\Figma", glyph: "palette", tone: "#a259ff" },
  { name: "Adobe Photoshop 2024", category: "design", publisher: "Adobe", version: "25.11", location: "C:\\Program Files\\Adobe\\Adobe Photoshop 2024", glyph: "palette", tone: "#2d7ff9" },
  { name: "Adobe Illustrator 2024", category: "design", publisher: "Adobe", version: "28.7", location: "C:\\Program Files\\Adobe\\Adobe Illustrator 2024", glyph: "palette", tone: "#e07b00" },
  { name: "Blender", category: "design", publisher: "Blender Foundation", version: "4.3.0", location: "C:\\Program Files\\Blender Foundation\\Blender 4.3", glyph: "layers", tone: "#e86a17" },

  { name: "PotPlayer", category: "media", publisher: "Kakao", version: "1.7.22347", location: "C:\\Program Files\\DAUM\\PotPlayer", glyph: "play", tone: "#3b4b63" },
  { name: "Spotify", category: "media", publisher: "Spotify AB", version: "1.2.49", location: "C:\\Users\\you\\AppData\\Roaming\\Spotify", glyph: "music", tone: "#17994a" },
  { name: "网易云音乐", category: "media", publisher: "网易", version: "3.1.6", location: "C:\\Program Files\\NetEase\\CloudMusic", glyph: "music", tone: "#cf3232" },
  { name: "OBS Studio", category: "media", publisher: "OBS Project", version: "31.0.0", location: "C:\\Program Files\\obs-studio", glyph: "monitor", tone: "#2b2f36" },
  { name: "剪映专业版", category: "media", publisher: "字节跳动", version: "6.1.1", location: "C:\\Users\\you\\AppData\\Local\\JianyingPro", glyph: "sparkle", tone: "#6d5df6" },

  { name: "Steam", category: "game", publisher: "Valve", version: "2.10.91", location: "C:\\Program Files (x86)\\Steam", glyph: "gamepad", tone: "#1b2838" },
  { name: "Epic Games Launcher", category: "game", publisher: "Epic Games", version: "17.2.2", location: "C:\\Program Files (x86)\\Epic Games\\Launcher", glyph: "gamepad", tone: "#31313a" },
  { name: "WeGame", category: "game", publisher: "腾讯", version: "5.9.3", location: "C:\\Program Files\\WeGame", glyph: "gamepad", tone: "#2c6ed5" },
  { name: "Xbox", category: "game", publisher: "Microsoft", version: "2411", source: "uwp", glyph: "gamepad", tone: "#107c10" },

  { name: "微信", category: "social", publisher: "腾讯", version: "3.9.12", location: "C:\\Program Files\\Tencent\\WeChat", glyph: "chat", tone: "#07a855" },
  { name: "QQ", category: "social", publisher: "腾讯", version: "9.9.15", location: "C:\\Program Files\\Tencent\\QQNT", glyph: "chat", tone: "#0ea5e9" },
  { name: "Discord", category: "social", publisher: "Discord Inc.", version: "1.0.9176", location: "C:\\Users\\you\\AppData\\Local\\Discord", glyph: "chat", tone: "#5865f2" },

  { name: "Google Chrome", category: "network", publisher: "Google LLC", version: "131.0", location: "C:\\Program Files\\Google\\Chrome\\Application", glyph: "globe", tone: "#3b82f6" },
  { name: "Microsoft Edge", category: "network", publisher: "Microsoft Corporation", version: "131.0", location: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application", glyph: "globe", tone: "#0a9ca5" },
  { name: "迅雷", category: "network", publisher: "迅雷网络", version: "24.0.2", location: "C:\\Program Files\\Thunder Network\\Thunder", glyph: "arrow-down", tone: "#1e88e5" },
  { name: "百度网盘", category: "network", publisher: "百度", version: "7.5.0", location: "C:\\Program Files\\Baidu\\BaiduNetdisk", glyph: "hard-drive", tone: "#2468f2" },

  { name: "火绒安全", category: "security", publisher: "火绒", version: "6.0.4", location: "C:\\Program Files\\Huorong\\Sysdiag", glyph: "shield", tone: "#e0632f" },
  { name: "360安全卫士", category: "security", publisher: "奇虎 360", version: "13.0", location: "C:\\Program Files (x86)\\360\\360Safe", glyph: "shield", tone: "#12a150" },

  { name: "7-Zip", category: "system", publisher: "Igor Pavlov", version: "24.08", location: "C:\\Program Files\\7-Zip", glyph: "box", tone: "#596b7d" },
  { name: "Everything", category: "system", publisher: "voidtools", version: "1.4.1", location: "C:\\Program Files\\Everything", glyph: "search", tone: "#9a7b3f" },
  { name: "PowerToys", category: "system", publisher: "Microsoft Corporation", version: "0.86.0", location: "C:\\Program Files\\PowerToys", glyph: "wrench", tone: "#6d4aff" },
  { name: "计算器", category: "system", publisher: "Microsoft", version: "11.2410", source: "uwp", glyph: "grid", tone: "#64748b" },
  { name: "截图工具", category: "system", publisher: "Microsoft", version: "11.2409", source: "uwp", glyph: "monitor", tone: "#64748b" },
  { name: "Geek Uninstaller", category: "system", publisher: "Thomas Koen", version: "1.5.2", location: "C:\\Program Files\\Geek Uninstaller", glyph: "trash", tone: "#3f6b5a" },
];

export const MOCK_APPS: AppEntry[] = SEEDS.map((seed, index) => {
  const source = seed.source ?? (index % 7 === 3 ? "registry" : "startMenu");
  const id = `mock-${String(index + 1).padStart(2, "0")}`;
  return {
    id,
    name: seed.name,
    category: seed.category,
    publisher: seed.publisher,
    version: seed.version ?? null,
    source,
    installLocation: seed.location ?? null,
    shortcutPath:
      source === "uwp"
        ? `shell:AppsFolder\\${seed.publisher}.${seed.name}_mock!App`
        : `${seed.location ?? ""}\\${seed.name}.exe`,
    launchable: true,
    visual: { glyph: seed.glyph, tone: seed.tone },
  };
});

function idsByNames(names: string[]): string[] {
  return names
    .map((name) => MOCK_APPS.find((app) => app.name === name)?.id)
    .filter((id): id is string => Boolean(id));
}

export const MOCK_PINNED_IDS = idsByNames([
  "微信",
  "Google Chrome",
  "Visual Studio Code",
  "Figma",
  "Spotify",
  "Steam",
]);

const now = Date.now();
const recentNames: [string, number][] = [
  ["Visual Studio Code", 8 * 60 * 1000],
  ["微信", 26 * 60 * 1000],
  ["Google Chrome", 55 * 60 * 1000],
  ["Figma", 2.4 * 60 * 60 * 1000],
  ["飞书", 4.1 * 60 * 60 * 1000],
  ["Steam", 20 * 60 * 60 * 1000],
];

export const MOCK_RECENT = recentNames.map(([name, delta]) => ({
  id: idsByNames([name])[0],
  at: now - delta,
}));

export const MOCK_SETTINGS: Settings = (() => {
  const settings = cloneSettings(DEFAULT_SETTINGS);
  settings.pinned = MOCK_PINNED_IDS;
  settings.recent = MOCK_RECENT;
  settings.usage = {
    [idsByNames(["Google Chrome"])[0]]: 38,
    [idsByNames(["微信"])[0]]: 27,
    [idsByNames(["Visual Studio Code"])[0]]: 19,
    [idsByNames(["飞书"])[0]]: 11,
    [idsByNames(["Steam"])[0]]: 4,
  };
  settings.appHotkeys = { [MOCK_APPS[0].id]: "Ctrl+Alt+1" };
  return settings;
})();

export const MOCK_ICON_URLS = Object.fromEntries(
  MOCK_APPS.map((app) => [app.id, ""]),
);

/** 基础字段 + 运行期由评估函数补齐的 impact / recommendation。 */
let mockStartup: Omit<StartupItem, "impact" | "recommendation">[] = [
  {
    id: "demo-startup-onedrive",
    name: "OneDrive",
    command: "C:\\Users\\you\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe /background",
    source: "registry",
    scope: "user",
    enabled: true,
    editable: true,
  },
  {
    id: "demo-startup-wechat",
    name: "WeChat",
    command: "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe",
    source: "registry",
    scope: "user",
    enabled: true,
    editable: true,
  },
  {
    id: "demo-startup-steam",
    name: "Steam",
    command: "C:\\Program Files (x86)\\Steam\\steam.exe -silent",
    source: "registry",
    scope: "user",
    enabled: true,
    editable: true,
  },
  {
    id: "demo-startup-tencent-meeting",
    name: "腾讯会议",
    command: "C:\\Program Files\\Tencent\\WeMeet\\wemeetapp.exe -auto",
    source: "registry",
    scope: "user",
    enabled: true,
    editable: true,
  },
  {
    id: "demo-startup-baidu",
    name: "百度网盘",
    command: "C:\\Program Files\\Baidu\\BaiduNetdisk\\BaiduNetdisk.exe",
    source: "registry",
    scope: "user",
    enabled: false,
    editable: true,
  },
  {
    id: "demo-startup-netease",
    name: "网易云音乐",
    command: "C:\\Users\\you\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\网易云音乐.lnk",
    source: "startupFolder",
    scope: "user",
    enabled: false,
    editable: true,
  },
  {
    id: "demo-startup-thunder",
    name: "迅雷",
    command: "C:\\Users\\you\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Thunder.lnk",
    source: "startupFolder",
    scope: "user",
    enabled: true,
    editable: true,
  },
  {
    id: "demo-startup-huorong",
    name: "火绒安全",
    command: "C:\\Program Files\\Huorong\\Sysdiag\\bin\\HipsTray.exe",
    source: "registry",
    scope: "machine",
    enabled: true,
    editable: false,
  },
  {
    id: "demo-startup-adobe",
    name: "Adobe Updater",
    command: "C:\\Program Files (x86)\\Common Files\\Adobe\\Adobe Desktop Common\\Updater\\AdobeUpdater.exe",
    source: "registry",
    scope: "machine",
    enabled: true,
    editable: false,
  },
  {
    id: "demo-startup-sogou",
    name: "搜狗输入法",
    command: "C:\\Program Files (x86)\\SogouInput\\SogouCloud.exe",
    source: "registry",
    scope: "machine",
    enabled: true,
    editable: false,
  },
  {
    id: "demo-startup-runonce-teams",
    name: "Teams 更新器",
    command: "C:\\Users\\you\\AppData\\Local\\Microsoft\\TeamsUpdate\\TeamsUpdate.exe -update",
    source: "runOnce",
    scope: "user",
    enabled: true,
    editable: false,
  },
  {
    id: "demo-startup-policy-agent",
    name: "公司安全客户端",
    command: "C:\\Program Files\\CorpSec\\agent.exe /autostart",
    source: "policy",
    scope: "machine",
    enabled: true,
    editable: false,
  },
  {
    id: "demo-startup-task-acrobat",
    name: "Adobe Acrobat 更新",
    command: "计划任务：\\Adobe\\Acrobat Update Task",
    source: "scheduledTask",
    scope: "machine",
    enabled: true,
    editable: false,
  },
  {
    id: "demo-startup-task-onedrive",
    name: "OneDrive 登录启动",
    command: "计划任务：\\OneDrive\\OneDrive Startup Task",
    source: "scheduledTask",
    scope: "machine",
    enabled: false,
    editable: false,
  },
  {
    id: "demo-startup-service-adobe",
    name: "Adobe Genuine Service",
    command: "\"C:\\Program Files (x86)\\Common Files\\Adobe\\Adobe Desktop Common\\ADS\\Adobe Genuine Service.exe\"",
    source: "service",
    scope: "machine",
    enabled: true,
    editable: false,
  },
  {
    id: "demo-startup-service-steam",
    name: "Steam Client Service",
    command: "\"C:\\Program Files (x86)\\Common Files\\Steam\\steamservice.exe\" /RunAsService",
    source: "service",
    scope: "machine",
    enabled: true,
    editable: false,
  },
];

let mockProcesses: ProcessItem[] = [
  { pid: 4212, name: "chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", memoryBytes: 436 * 1024 * 1024, company: "Google LLC", description: "Google Chrome", protected: false },
  { pid: 4236, name: "chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", memoryBytes: 218 * 1024 * 1024, company: "Google LLC", description: "Google Chrome", protected: false },
  { pid: 4310, name: "chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", memoryBytes: 154 * 1024 * 1024, company: "Google LLC", description: "Google Chrome", protected: false },
  { pid: 4440, name: "chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", memoryBytes: 92 * 1024 * 1024, company: "Google LLC", description: "Google Chrome", protected: false },
  { pid: 5620, name: "Code", path: "C:\\Users\\you\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe", memoryBytes: 512 * 1024 * 1024, company: "Microsoft Corporation", description: "Visual Studio Code", protected: false },
  { pid: 5712, name: "Code", path: "C:\\Users\\you\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe", memoryBytes: 236 * 1024 * 1024, company: "Microsoft Corporation", description: "Visual Studio Code", protected: false },
  { pid: 5876, name: "Code", path: "C:\\Users\\you\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe", memoryBytes: 121 * 1024 * 1024, company: "Microsoft Corporation", description: "Visual Studio Code", protected: false },
  { pid: 6120, name: "WeChat", path: "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe", memoryBytes: 388 * 1024 * 1024, company: "Tencent", description: "WeChat", protected: false },
  { pid: 6204, name: "WeChat", path: "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe", memoryBytes: 96 * 1024 * 1024, company: "Tencent", description: "WeChat", protected: false },
  { pid: 7180, name: "msedgewebview2", path: "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\131.0.2903.112\\msedgewebview2.exe", memoryBytes: 182 * 1024 * 1024, company: "Microsoft Corporation", description: "Microsoft Edge WebView2", protected: true },
  { pid: 7244, name: "msedgewebview2", path: "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\131.0.2903.112\\msedgewebview2.exe", memoryBytes: 74 * 1024 * 1024, company: "Microsoft Corporation", description: "Microsoft Edge WebView2", protected: true },
  { pid: 8256, name: "qidian", path: "C:\\Users\\you\\AppData\\Local\\Programs\\QiDian\\QiDian.exe", memoryBytes: 42 * 1024 * 1024, company: "QiDian", description: "启点", protected: true },
  { pid: 612, name: "svchost", path: "C:\\Windows\\System32\\svchost.exe", memoryBytes: 38 * 1024 * 1024, company: "Microsoft Corporation", description: "Host Process for Windows Services", protected: true },
  { pid: 788, name: "svchost", path: "C:\\Windows\\System32\\svchost.exe", memoryBytes: 24 * 1024 * 1024, company: "Microsoft Corporation", description: "Host Process for Windows Services", protected: true },
  { pid: 932, name: "svchost", path: "C:\\Windows\\System32\\svchost.exe", memoryBytes: 31 * 1024 * 1024, company: "Microsoft Corporation", description: "Host Process for Windows Services", protected: true },
  { pid: 1108, name: "svchost", path: "C:\\Windows\\System32\\svchost.exe", memoryBytes: 18 * 1024 * 1024, company: "Microsoft Corporation", description: "Host Process for Windows Services", protected: true },
  { pid: 1440, name: "explorer", path: "C:\\Windows\\explorer.exe", memoryBytes: 126 * 1024 * 1024, company: "Microsoft Corporation", description: "Windows Explorer", protected: true },
  { pid: 1332, name: "dwm", path: "C:\\Windows\\System32\\dwm.exe", memoryBytes: 68 * 1024 * 1024, company: "Microsoft Corporation", description: "Desktop Window Manager", protected: true },
  { pid: 3488, name: "SearchIndexer", path: "C:\\Windows\\System32\\SearchIndexer.exe", memoryBytes: 144 * 1024 * 1024, company: "Microsoft Corporation", description: "Microsoft Windows Search Indexer", protected: false },
  { pid: 3044, name: "OneDrive", path: "C:\\Users\\you\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe", memoryBytes: 88 * 1024 * 1024, company: "Microsoft Corporation", description: "Microsoft OneDrive", protected: false },
  { pid: 2512, name: "steam", path: "C:\\Program Files (x86)\\Steam\\steam.exe", memoryBytes: 184 * 1024 * 1024, company: "Valve Corporation", description: "Steam Client Bootstrapper", protected: false },
  { pid: 3720, name: "spotify", path: "C:\\Users\\you\\AppData\\Roaming\\Spotify\\Spotify.exe", memoryBytes: 262 * 1024 * 1024, company: "Spotify AB", description: "Spotify", protected: false },
  { pid: 3792, name: "spotify", path: "C:\\Users\\you\\AppData\\Roaming\\Spotify\\Spotify.exe", memoryBytes: 104 * 1024 * 1024, company: "Spotify AB", description: "Spotify", protected: false },
  { pid: 4892, name: "Adobe Desktop Service", path: "C:\\Program Files (x86)\\Common Files\\Adobe\\Adobe Desktop Common\\ADS\\Adobe Desktop Service.exe", memoryBytes: 72 * 1024 * 1024, company: "Adobe Inc.", description: "Adobe Desktop Service", protected: false },
];

/** 前端 mock 也复用一个轻量评估：按名称关键词给出建议。 */
function mockStartupAssessment(
  name: string,
  source: string,
): { impact: "high" | "medium" | "low"; recommendation: "keep" | "disable" | "optional" } {
  const lower = name.toLowerCase();
  const keepWords = ["onedrive", "wechat", "微信", "输入法", "火绒", "sogou", "安全", "防御", "huorong"];
  const disableWords = ["update", "更新", "updater", "steam", "云音乐", "网盘", "会议", "adobe", "acrobat", "team", "teams"];
  const impact: "high" | "medium" | "low" =
    source === "service" ? "high" : source === "scheduledTask" ? "medium" : source === "registry" ? "medium" : "low";
  const recommendation = disableWords.some((word) => lower.includes(word))
    ? "disable"
    : keepWords.some((word) => lower.includes(word))
      ? "keep"
      : "optional";
  return { impact, recommendation };
}

export function mockStartupItems(): StartupItem[] {
  return mockStartup.map((item) => {
    const { impact, recommendation } = mockStartupAssessment(item.name, item.source);
    return { ...item, impact, recommendation };
  });
}

export function mockStartupScan(): StartupScan {
  return { items: mockStartupItems(), advancedOk: true };
}

export function mockSetStartupEnabled(id: string, enabled: boolean): StartupScan {
  const item = mockStartup.find((entry) => entry.id === id);
  if (!item || !item.editable) throw new Error("该启动项不可修改");
  item.enabled = enabled;
  return mockStartupScan();
}

let mockCleanupAppsList: CleanupApp[] = [
  {
    id: "cleanup-app-chrome",
    name: "Google Chrome",
    publisher: "Google LLC",
    version: "128.0",
    installLocation: "C:\\Program Files\\Google\\Chrome",
    sizeBytes: Math.round(1.1 * 1024 ** 3),
    scope: "所有用户",
    iconPath: null,
    quiet: true,
    uninstallable: true,
  },
  {
    id: "cleanup-app-wechat",
    name: "微信",
    publisher: "Tencent",
    version: "3.9.11",
    installLocation: "C:\\Program Files\\Tencent\\WeChat",
    sizeBytes: Math.round(890 * 1024 ** 2),
    scope: "所有用户",
    iconPath: null,
    quiet: false,
    uninstallable: true,
  },
  {
    id: "cleanup-app-spotify",
    name: "Spotify",
    publisher: "Spotify AB",
    version: "1.2.42",
    installLocation: "C:\\Users\\you\\AppData\\Local\\Programs\\Spotify",
    sizeBytes: Math.round(312 * 1024 ** 2),
    scope: "当前用户",
    iconPath: null,
    quiet: true,
    uninstallable: true,
  },
  {
    id: "cleanup-app-oldgame",
    name: "OldGame",
    publisher: "Old Studio",
    version: "1.0.4",
    installLocation: "C:\\Program Files (x86)\\OldGame",
    sizeBytes: Math.round(1.6 * 1024 ** 3),
    scope: "所有用户",
    iconPath: null,
    quiet: true,
    uninstallable: true,
  },
  {
    id: "cleanup-app-legacytool",
    name: "LegacyTool",
    publisher: "Legacy Inc.",
    version: "2.3.0",
    installLocation: "C:\\ProgramData\\LegacyTool",
    sizeBytes: Math.round(486 * 1024 ** 2),
    scope: "所有用户",
    iconPath: null,
    quiet: false,
    uninstallable: true,
  },
  {
    id: "cleanup-app-oldplayer",
    name: "OldPlayer",
    publisher: "Old Player Team",
    version: "0.9.1",
    installLocation: "C:\\Users\\you\\AppData\\Local\\Programs\\OldPlayer",
    sizeBytes: Math.round(212 * 1024 ** 2),
    scope: "当前用户",
    iconPath: null,
    quiet: true,
    uninstallable: true,
  },
  {
    id: "cleanup-app-portabletool",
    name: "PortableTool",
    publisher: "独立开发者",
    version: "2.1",
    installLocation: "D:\\Tools\\PortableTool",
    sizeBytes: 0,
    scope: "",
    iconPath: null,
    quiet: false,
    uninstallable: false,
  },
];

export function mockCleanupApps(): CleanupApp[] {
  return mockCleanupAppsList.map((item) => ({ ...item }));
}

export function mockCleanupUninstall(id: string, removeLeftovers: boolean): UninstallReport {
  const app = mockCleanupAppsList.find((item) => item.id === id);
  if (!app) throw new Error("应用不存在或已经被卸载");
  mockCleanupAppsList = mockCleanupAppsList.filter((item) => item.id !== id);
  const report: UninstallReport = {
    appName: app.name,
    exitCode: 0,
    timedOut: false,
    removedDirs: [],
    freedBytes: 0,
    files: 0,
    registryRemoved: removeLeftovers,
    errors: [],
  };
  if (!removeLeftovers) return report;
  if (app.installLocation) {
    report.removedDirs.push(app.installLocation);
    report.freedBytes = app.sizeBytes;
    report.files = Math.max(1, Math.round(app.sizeBytes / (3 * 1024 ** 2)));
  }
  return report;
}

let mockCleanupCandidates: CleanupCandidate[] = [
  {
    id: "cleanup-adobe-old",
    name: "Adobe",
    path: "C:\\Program Files\\Adobe",
    root: "Program Files",
    kind: "install",
    sizeBytes: Math.round(2.4 * 1024 ** 3),
    files: 812,
    lastModified: Date.now() - 124 * 86_400_000,
    referenced: false,
  },
  {
    id: "cleanup-chrome-installed",
    name: "Chrome",
    path: "C:\\Program Files\\Google\\Chrome",
    root: "Program Files",
    kind: "install",
    sizeBytes: Math.round(1.1 * 1024 ** 3),
    files: 486,
    lastModified: Date.now() - 2 * 86_400_000,
    referenced: true,
  },
  {
    id: "cleanup-pixelworks",
    name: "PixelWorks",
    path: "C:\\Program Files (x86)\\PixelWorks",
    root: "Program Files (x86)",
    kind: "install",
    sizeBytes: Math.round(1.6 * 1024 ** 3),
    files: 2314,
    lastModified: Date.now() - 301 * 86_400_000,
    referenced: false,
  },
  {
    id: "cleanup-notetaker",
    name: "NoteTaker",
    path: "C:\\ProgramData\\NoteTaker",
    root: "ProgramData",
    kind: "install",
    sizeBytes: Math.round(486 * 1024 ** 2),
    files: 96,
    lastModified: Date.now() - 48 * 86_400_000,
    referenced: false,
  },
  {
    id: "cleanup-retroplayer",
    name: "RetroPlayer",
    path: "C:\\Users\\you\\AppData\\Local\\Programs\\RetroPlayer",
    root: "LocalAppData\\Programs",
    kind: "install",
    sizeBytes: Math.round(212 * 1024 ** 2),
    files: 54,
    lastModified: Date.now() - 17 * 86_400_000,
    referenced: false,
  },
  {
    id: "cleanup-wechat-data",
    name: "WeChat",
    path: "C:\\Users\\you\\AppData\\Roaming\\Tencent\\WeChat",
    root: "AppData\\Roaming",
    kind: "data",
    sizeBytes: Math.round(3.2 * 1024 ** 3),
    files: 12890,
    lastModified: Date.now() - 86_400_000,
    referenced: true,
  },
  {
    id: "cleanup-code-data",
    name: "Code",
    path: "C:\\Users\\you\\AppData\\Roaming\\Code",
    root: "AppData\\Roaming",
    kind: "data",
    sizeBytes: Math.round(640 * 1024 ** 2),
    files: 4321,
    lastModified: Date.now() - 3 * 86_400_000,
    referenced: true,
  },
  {
    id: "cleanup-oldchat-data",
    name: "OldChat",
    path: "C:\\Users\\you\\AppData\\Local\\OldChat",
    root: "LocalAppData",
    kind: "data",
    sizeBytes: Math.round(158 * 1024 ** 2),
    files: 322,
    lastModified: Date.now() - 210 * 86_400_000,
    referenced: false,
  },
];

export function mockCleanupScan(): CleanupScan {
  const candidates = mockCleanupCandidates.map((item) => ({ ...item }));
  return {
    candidates,
    references: 1284,
    roots: [
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      "C:\\ProgramData",
      "C:\\Users\\you\\AppData\\Local\\Programs",
      "C:\\Users\\you\\AppData\\Local",
      "C:\\Users\\you\\AppData\\Roaming",
    ],
    scannedDirs: 128,
    suspects: candidates.filter((item) => !item.referenced).length,
    totalBytes: candidates.reduce((sum, item) => sum + item.sizeBytes, 0),
    advancedOk: true,
  };
}

export function mockCleanupDelete(
  paths: string[],
  recycle: boolean,
): CleanupDeleteReport {
  const report: CleanupDeleteReport = {
    freedBytes: 0,
    files: 0,
    deleted: [],
    recycled: recycle,
    pendingReboot: [],
    errors: [],
  };
  for (const path of paths) {
    const item = mockCleanupCandidates.find((candidate) => candidate.path === path);
    if (!item) {
      report.errors.push(`${path}：文件夹已不存在`);
      continue;
    }
    if (item.referenced) {
      report.errors.push(`${path}：仍被已安装应用、快捷方式或进程引用`);
      continue;
    }
    report.freedBytes += item.sizeBytes;
    report.files += item.files;
    report.deleted.push(path);
  }
  mockCleanupCandidates = mockCleanupCandidates.filter(
    (candidate) => !report.deleted.includes(candidate.path),
  );
  return report;
}

export function mockProcessItems(): ProcessItem[] {
  return mockProcesses.map((item) => ({ ...item }));
}

export function mockTerminate(targets: ProcessTarget[]): TerminateReport {
  const failed: TerminateReport["failed"] = [];
  let terminated = 0;
  for (const target of targets) {
    const item = mockProcesses.find((process) => process.pid === target.pid);
    if (!item) {
      failed.push({ pid: target.pid, name: target.name, error: "进程已退出" });
      continue;
    }
    if (item.protected) {
      failed.push({ pid: target.pid, name: target.name, error: "系统或启点依赖的进程，已受保护" });
      continue;
    }
    mockProcesses = mockProcesses.filter((process) => process.pid !== target.pid);
    terminated += 1;
  }
  return { terminated, failed };
}

const POWER_SAVER = "a1841308-3541-4fab-bc81-f71556f20b4a";
const POWER_BALANCED = "381b4222-f694-41f0-9685-ff5bb260df2e";
const POWER_HIGH = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
const POWER_ULTIMATE = "e9a42b02-d5df-448d-aa00-03f14749eb61";

interface ModuleSeed {
  id: ModuleId;
  name: string;
  version: string;
  description: string;
  features: string[];
  sizeBytes: number;
}

const MODULE_SEEDS: ModuleSeed[] = [
  {
    id: "background",
    name: "后台管理",
    version: "1.1.0",
    description: "管理注册表、启动文件夹、计划任务与自动服务里的自启动，并说明每个进程的用途。",
    features: ["全量自启动扫描", "来源与只读标识", "进程分组与结束", "进程用途说明", "关键进程保护"],
    sizeBytes: 1480,
  },
  {
    id: "performance",
    name: "系统体检",
    version: "1.4.0",
    description: "只做体检不插手优化：系统健康评分、CPU 与多磁盘状态、物理磁盘健康、资源占用排行与评分趋势。",
    features: ["体检评分", "CPU 采样", "多磁盘状态", "磁盘健康", "资源排行", "评分趋势", "清理记录"],
    sizeBytes: 1680,
  },
  {
    id: "optimize",
    name: "系统优化",
    version: "1.1.0",
    description: "集中所有主动优化动作：可撤销的一键优化（13 项）、临时文件与更新缓存清理、电源计划（含卓越性能）、刷新 DNS、深层内存清理。",
    features: ["一键优化", "原值备份", "单项还原", "临时文件清理", "更新缓存清理", "预读取缓存清理", "回收站清理", "电源计划", "卓越性能", "刷新 DNS", "深度内存清理"],
    sizeBytes: 1460,
  },
  {
    id: "memory",
    name: "内存管理",
    version: "1.3.0",
    description: "自动识别物理内存与提交内存，按压力调节 WebView2 档位；支持工作集释放与管理员级的系统缓存、待机列表清理，空闲自动释放，隐藏时挂起并释放工作集。",
    features: ["自动识别内存", "智能阈值", "动态档位", "工作集释放", "系统缓存清理", "待机列表清理", "深度释放", "空闲释放", "提交内存", "提交压力", "趋势采样", "隐藏挂起", "调节记录"],
    sizeBytes: 1024,
  },
  {
    id: "cleanup",
    name: "应用管理",
    version: "1.2.0",
    description: "卸载应用并可完全清除；同时扫描安装目录与应用数据文件夹，标注是否仍被引用，按大小与疑似残留筛选清理。",
    features: ["已安装应用列表", "调用自带卸载程序", "完全清除安装文件夹", "残留注册表清理", "安装目录两级扫描", "应用数据目录扫描", "空间占用排行", "疑似残留标记", "引用保护", "确认后删除"],
    sizeBytes: 1180,
  },
  {
    id: "boot",
    name: "启动与托盘",
    version: "1.1.0",
    description: "自定义显示/隐藏快捷键，为常用应用设置全局启动快捷键；托盘右键可直接启动常用应用，关闭窗口可隐藏或退出。",
    features: ["系统托盘", "自定义全局快捷键", "应用快捷键", "托盘快捷启动", "关闭行为可选", "开机自启动", "单实例"],
    sizeBytes: 760,
  },
];

const MOCK_MODULES_KEY = "qidian.mock.modules";
type MockModuleInstalls = Partial<Record<ModuleId, number>>;

function loadMockModuleInstalls(): MockModuleInstalls {
  try {
    const raw = localStorage.getItem(MOCK_MODULES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const installs: MockModuleInstalls = {};
    for (const seed of MODULE_SEEDS) {
      const at = parsed[seed.id];
      if (typeof at === "number") installs[seed.id] = at;
    }
    return installs;
  } catch {
    return {};
  }
}

const mockModuleInstalls = loadMockModuleInstalls();
let mockPerfInstalled = Boolean(mockModuleInstalls.performance);
let mockPerfInstalledAt: number | null = mockModuleInstalls.performance ?? null;
let mockOptimizeInstalled = Boolean(mockModuleInstalls.optimize);
let mockPowerGuid = POWER_BALANCED;
let mockPerfCleanTotal = Math.round(2.6 * 1024 ** 3);
let mockPerfCleanCount = 7;
let mockPerfCleanAt: number | null = Date.now() - 86_400_000;
let mockPerfCleanRecords: PerfCleanRecord[] = [
  { at: Date.now() - 86_400_000, freedBytes: Math.round(2.1 * 1024 ** 3), files: 3120 },
  { at: Date.now() - 3 * 86_400_000, freedBytes: Math.round(860 * 1024 ** 2), files: 940 },
];

function saveMockModuleInstalls(): void {
  try {
    localStorage.setItem(MOCK_MODULES_KEY, JSON.stringify(mockModuleInstalls));
  } catch {
    // 存储不可用时保持内存态
  }
}

function toModuleStatus(seed: ModuleSeed): ModuleStatus {
  const installedAt = mockModuleInstalls[seed.id] ?? null;
  return {
    id: seed.id,
    name: seed.name,
    version: seed.version,
    description: seed.description,
    features: [...seed.features],
    installed: installedAt !== null,
    installedAt,
    sizeBytes: installedAt !== null ? seed.sizeBytes : 0,
    runtime: "in-app",
  };
}

export function mockModules(): ModuleStatus[] {
  return MODULE_SEEDS.map(toModuleStatus);
}

export function mockInstallModule(id: ModuleId): ModuleStatus[] {
  const seed = MODULE_SEEDS.find((item) => item.id === id);
  if (!seed) throw new Error("未知插件");
  if (!mockModuleInstalls[id]) mockModuleInstalls[id] = Date.now();
  if (id === "performance") {
    mockPerfInstalled = true;
    mockPerfInstalledAt = mockModuleInstalls[id] ?? Date.now();
  }
  if (id === "optimize") mockOptimizeInstalled = true;
  saveMockModuleInstalls();
  return mockModules();
}

export function mockUninstallModule(id: ModuleId): ModuleStatus[] {
  if (!MODULE_SEEDS.some((item) => item.id === id)) throw new Error("未知插件");
  delete mockModuleInstalls[id];
  if (id === "performance") {
    mockPerfInstalled = false;
    mockPerfInstalledAt = null;
  }
  if (id === "optimize") mockOptimizeInstalled = false;
  saveMockModuleInstalls();
  return mockModules();
}

let mockTempCategories: PerfTempCategory[] = [
  {
    id: "userTemp",
    name: "用户临时文件",
    path: "C:\\Users\\you\\AppData\\Local\\Temp",
    bytes: Math.round(1.8 * 1024 ** 3),
    files: 2431,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "windowsTemp",
    name: "Windows 临时文件",
    path: "C:\\Windows\\Temp",
    bytes: Math.round(312 * 1024 ** 2),
    files: 96,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "updateCache",
    name: "Windows 更新下载缓存",
    path: "C:\\Windows\\SoftwareDistribution\\Download",
    bytes: Math.round(1.4 * 1024 ** 3),
    files: 183,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "logs",
    name: "系统日志文件",
    path: "C:\\Windows\\Logs",
    bytes: Math.round(96 * 1024 ** 2),
    files: 214,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "prefetch",
    name: "预读取缓存",
    path: "C:\\Windows\\Prefetch",
    bytes: Math.round(148 * 1024 ** 2),
    files: 42,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "d3dCache",
    name: "DirectX 着色器缓存",
    path: "C:\\Users\\you\\AppData\\Local\\D3DSCache",
    bytes: Math.round(460 * 1024 ** 2),
    files: 128,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "dxCache",
    name: "DXCache 缓存",
    path: "C:\\Users\\you\\AppData\\Local\\DXCache",
    bytes: Math.round(88 * 1024 ** 2),
    files: 26,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "glCache",
    name: "OpenGL 着色器缓存",
    path: "C:\\Users\\you\\AppData\\Local\\GLCache",
    bytes: Math.round(64 * 1024 ** 2),
    files: 19,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "inetCache",
    name: "IE/兼容性网络缓存",
    path: "C:\\Users\\you\\AppData\\Local\\Microsoft\\Windows\\INetCache",
    bytes: Math.round(142 * 1024 ** 2),
    files: 386,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "transferCache",
    name: "更新 P2P 传递缓存",
    path: "C:\\Windows\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache",
    bytes: Math.round(2.4 * 1024 ** 3),
    files: 512,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "wer",
    name: "Windows 错误报告（用户）",
    path: "C:\\Users\\you\\AppData\\Local\\Microsoft\\Windows\\WER",
    bytes: Math.round(42 * 1024 ** 2),
    files: 67,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "werSystem",
    name: "Windows 错误报告（系统）",
    path: "C:\\ProgramData\\Microsoft\\Windows\\WER",
    bytes: Math.round(96 * 1024 ** 2),
    files: 41,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "crashDumps",
    name: "应用崩溃转储",
    path: "C:\\Users\\you\\AppData\\Local\\CrashDumps",
    bytes: Math.round(318 * 1024 ** 2),
    files: 12,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "minidump",
    name: "蓝屏小转储",
    path: "C:\\Windows\\Minidump",
    bytes: Math.round(156 * 1024 ** 2),
    files: 7,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "liveKernel",
    name: "内核实时转储",
    path: "C:\\Windows\\LiveKernelReports",
    bytes: Math.round(210 * 1024 ** 2),
    files: 9,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "eventLogs",
    name: "系统事件日志",
    path: "C:\\Windows\\System32\\winevt\\Logs",
    bytes: Math.round(128 * 1024 ** 2),
    files: 16,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "thumbnailCache",
    name: "缩略图与图标缓存",
    path: "C:\\Users\\you\\AppData\\Local\\Microsoft\\Windows\\Explorer",
    bytes: Math.round(624 * 1024 ** 2),
    files: 38,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "systemTemp32",
    name: "系统临时目录（32 位）",
    path: "C:\\Windows\\SystemTemp",
    bytes: Math.round(54 * 1024 ** 2),
    files: 11,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "chromeCache",
    name: "Chrome 浏览器缓存",
    path: "C:\\Users\\you\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache 等 3 处",
    bytes: Math.round(1.6 * 1024 ** 3),
    files: 4820,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "edgeCache",
    name: "Edge 浏览器缓存",
    path: "C:\\Users\\you\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Cache 等 3 处",
    bytes: Math.round(890 * 1024 ** 2),
    files: 2611,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "braveCache",
    name: "Brave 浏览器缓存",
    path: "C:\\Users\\you\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache",
    bytes: 0,
    files: 0,
    accessible: false,
    errors: 0,
    error: "目录不存在",
  },
  {
    id: "firefoxCache",
    name: "Firefox 浏览器缓存",
    path: "C:\\Users\\you\\AppData\\Local\\Mozilla\\Firefox\\Profiles",
    bytes: Math.round(240 * 1024 ** 2),
    files: 1203,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "teamsCache",
    name: "Teams 应用缓存",
    path: "C:\\Users\\you\\AppData\\Roaming\\Microsoft\\Teams\\Cache 等 4 处",
    bytes: Math.round(1.1 * 1024 ** 3),
    files: 3390,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "discordCache",
    name: "Discord 应用缓存",
    path: "C:\\Users\\you\\AppData\\Roaming\\discord\\Cache 等 4 处",
    bytes: Math.round(620 * 1024 ** 2),
    files: 1874,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "slackCache",
    name: "Slack 应用缓存",
    path: "C:\\Users\\you\\AppData\\Roaming\\Slack\\Cache 等 4 处",
    bytes: Math.round(410 * 1024 ** 2),
    files: 962,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "windowsOld",
    name: "旧系统目录 Windows.old",
    path: "C:\\Windows.old",
    bytes: Math.round(18.4 * 1024 ** 3),
    files: 41209,
    accessible: true,
    errors: 0,
    error: null,
  },
  {
    id: "recycleBin",
    name: "回收站",
    path: "回收站 · 所有磁盘",
    bytes: Math.round(1.12 * 1024 ** 3),
    files: 24,
    accessible: true,
    errors: 0,
    error: null,
  },
];

function mockPerfStatus(): PerfModuleStatus {
  return {
    installed: mockPerfInstalled,
    installedVersion: mockPerfInstalled ? "1.2.0" : null,
    availableVersion: "1.2.0",
    installedAt: mockPerfInstalled ? mockPerfInstalledAt : null,
    sizeBytes: mockPerfInstalled ? 1536 : 0,
    path: mockPerfInstalled
      ? "C:\\Users\\you\\AppData\\Local\\com.qidian.launcher\\modules\\performance"
      : null,
    updateAvailable: false,
  };
}

function mockPowerInfo(): PerfPowerInfo {
  let name =
    mockPowerGuid === POWER_SAVER
      ? "省电"
      : mockPowerGuid === POWER_HIGH
        ? "高性能"
        : mockPowerGuid === POWER_ULTIMATE
          ? "卓越性能"
          : "均衡";
  return { guid: mockPowerGuid, name, error: null };
}

export function mockPerformanceStatus(): PerfModuleStatus {
  return mockPerfStatus();
}

export function mockPerformanceInstall(): PerfModuleStatus {
  if (!mockPerfInstalled) {
    mockPerfInstalled = true;
    mockPerfInstalledAt = Date.now();
  }
  return mockPerfStatus();
}

export function mockPerformanceUninstall(): PerfModuleStatus {
  mockPerfInstalled = false;
  mockPerfInstalledAt = null;
  return mockPerfStatus();
}

export function mockPerformanceSystemInfo(): PerfSystemInfo {
  if (!mockPerfInstalled) throw new Error("性能优化模块尚未安装");
  const total = MOCK_TOTAL_MEMORY;
  const free = MOCK_AVAIL_MEMORY;
  const diskTotal = 1024 * 1024 ** 3;
  const diskFree = Math.round(340 * 1024 ** 3);
  const disks = [
    {
      drive: "C:",
      totalBytes: diskTotal,
      freeBytes: diskFree,
      usedBytes: diskTotal - diskFree,
      system: true,
    },
    {
      drive: "D:",
      totalBytes: Math.round(1.8 * 1024 ** 4),
      freeBytes: Math.round(0.9 * 1024 ** 4),
      usedBytes: Math.round(0.9 * 1024 ** 4),
      system: false,
    },
  ];
  const history = [94, 92, 95, 90, 88, 93, 94].map((score, index, list) => ({
    at: Date.now() - (list.length - 1 - index) * 86_400_000,
    score,
  }));
  return {
    memory: { totalBytes: total, freeBytes: free, usedBytes: total - free },
    cpu: { name: "AMD Ryzen 7 7840HS", logical: 16, usagePercent: 23 },
    disk: disks[0],
    disks,
    physicalDisks: [
      { name: "NVMe SSD 1TB", mediaType: "SSD", health: "Healthy", sizeBytes: Math.round(953 * 1024 ** 3) },
      { name: "SATA SSD 2TB", mediaType: "SSD", health: "Healthy", sizeBytes: Math.round(1.82 * 1024 ** 4) },
    ],
    hogs: [
      { pid: 4820, name: "chrome", cpuPercent: 18, memoryBytes: Math.round(1.6 * 1024 ** 3), protected: false },
      { pid: 9120, name: "trae", cpuPercent: 12, memoryBytes: Math.round(1.1 * 1024 ** 3), protected: false },
      { pid: 1332, name: "dwm", cpuPercent: 6, memoryBytes: Math.round(68 * 1024 ** 2), protected: true },
      { pid: 6120, name: "wechat", cpuPercent: 4, memoryBytes: Math.round(420 * 1024 ** 2), protected: false },
      { pid: 788, name: "svchost", cpuPercent: 2, memoryBytes: Math.round(24 * 1024 ** 2), protected: true },
    ],
    power: mockPowerInfo(),
    os: {
      caption: "Windows 11 专业版",
      version: "23H2",
      build: "22631",
      uptimeSeconds: 3 * 86400 + 4 * 3600 + 17 * 60,
    },
    startupTotal: 10,
    startupEnabled: 8,
    score: 94,
    scoreLabel: "运行良好",
    issues: [
      {
        id: "startup",
        title: "多数启动项已开启",
        detail: "8 / 10 项启用，可按需关闭。",
        severity: "low",
        points: 6,
      },
    ],
    history,
    cleanupTotalBytes: mockPerfCleanTotal,
    cleanupCount: mockPerfCleanCount,
    lastCleanAt: mockPerfCleanAt,
    recentCleans: mockPerfCleanRecords.map((record) => ({ ...record })),
  };
}

function mockOptReady(): boolean {
  return mockPerfInstalled || mockOptimizeInstalled;
}

/** 磁盘占用分析：模拟 C 盘顶层目录占用（“空间去哪了”）。 */
export function mockDiskUsage(): DiskUsageScan {
  const gb = 1024 ** 3;
  return {
    drive: "C:",
    totalBytes: 1024 * gb,
    usedBytes: Math.round(684 * gb),
    entries: [
      { path: "C:\\Users", name: "Users", bytes: Math.round(318 * gb), files: 412_309 },
      { path: "C:\\Windows", name: "Windows", bytes: Math.round(168 * gb), files: 203_118 },
      { path: "C:\\Program Files", name: "Program Files", bytes: Math.round(94 * gb), files: 51_207 },
      { path: "C:\\ProgramData", name: "ProgramData", bytes: Math.round(38 * gb), files: 22_601 },
      { path: "C:\\Program Files (x86)", name: "Program Files (x86)", bytes: Math.round(26 * gb), files: 15_402 },
      { path: "C:\\Windows.old", name: "Windows.old", bytes: Math.round(18.4 * gb), files: 41_209 },
      { path: "C:\\pagefile.sys", name: "pagefile.sys", bytes: Math.round(12 * gb), files: 1 },
      { path: "C:\\hiberfil.sys", name: "hiberfil.sys", bytes: Math.round(9.2 * gb), files: 1 },
      { path: "C:\\swapfile.sys", name: "swapfile.sys", bytes: 0, files: 1 },
    ],
  };
}

export function mockPerformanceScanTemp(): PerfTempScan {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  const totalBytes = mockTempCategories.reduce((sum, item) => sum + item.bytes, 0);
  const totalFiles = mockTempCategories.reduce((sum, item) => sum + item.files, 0);
  return {
    categories: mockTempCategories.map((item) => ({ ...item })),
    totalBytes,
    totalFiles,
    days: 7,
  };
}

export function mockPerformanceClean(categories: string[]): PerfCleanResult {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  const result: PerfCleanResult = {
    freedBytes: 0,
    files: 0,
    failed: 0,
    pendingReboot: 0,
    categories: [],
  };
  for (const id of categories) {
    const item = mockTempCategories.find((category) => category.id === id);
    if (!item) continue;
    if (!item.accessible) {
      result.failed += 1;
      result.categories.push({
        id: item.id,
        name: item.name,
        freedBytes: 0,
        files: 0,
        failed: 1,
        pendingReboot: 0,
        error: item.error ?? "无法访问目录",
      });
      continue;
    }
    // 模拟 Windows 临时目录里少量文件被进程占用：强删后安排重启删除。
    const pending = id === "windowsTemp" ? 3 : 0;
    const bytes = item.bytes;
    const files = item.files;
    result.freedBytes += bytes;
    result.files += files;
    result.pendingReboot += pending;
    result.categories.push({
      id: item.id,
      name: item.name,
      freedBytes: bytes,
      files: files,
      failed: 0,
      pendingReboot: pending,
      error: null,
    });
    item.bytes = 0;
    item.files = 0;
  }
  if (result.freedBytes > 0 || result.files > 0) {
    mockPerfCleanTotal += result.freedBytes;
    mockPerfCleanCount += 1;
    mockPerfCleanAt = Date.now();
    mockPerfCleanRecords.unshift({
      at: mockPerfCleanAt,
      freedBytes: result.freedBytes,
      files: result.files,
    });
    mockPerfCleanRecords = mockPerfCleanRecords.slice(0, 10);
  }
  return result;
}

export function mockPerformanceSetPower(guid: string): PerfPowerInfo {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  if (![POWER_SAVER, POWER_BALANCED, POWER_HIGH, POWER_ULTIMATE].includes(guid)) {
    throw new Error("不支持的电源计划");
  }
  mockPowerGuid = guid;
  return mockPowerInfo();
}

export function mockPerformanceFlushDns(): string {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  return "DNS 缓存已刷新";
}

export function mockOptimizePowerStatus(): PerfPowerInfo {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  return mockPowerInfo();
}

/* ── 网络优化（预览数据） ─────────────────────────────── */
const DNS_KEY = "qidian.mock.dns.v1";
const MOCK_DNS_PRESETS: Record<
  string,
  { name: string; primary: string; secondary: string }
> = {
  ali: { name: "阿里 DNS", primary: "223.5.5.5", secondary: "223.6.6.6" },
  tencent: { name: "腾讯 DNS", primary: "119.29.29.29", secondary: "119.28.28.28" },
  google: { name: "Google DNS", primary: "8.8.8.8", secondary: "8.8.4.4" },
  cloudflare: { name: "Cloudflare", primary: "1.1.1.1", secondary: "1.0.0.1" },
};
/** 模拟从路由器 DHCP 自动获取的原始 DNS。 */
const MOCK_DNS_ORIGINALS = [{ index: 12, alias: "以太网", servers: ["192.168.1.1"] }];

function mockDnsPreset(): string | null {
  try {
    const value = localStorage.getItem(DNS_KEY);
    return value && value in MOCK_DNS_PRESETS ? value : null;
  } catch {
    return null;
  }
}

export function mockDnsStatus(): DnsStatus {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  const preset = mockDnsPreset();
  if (!preset) {
    return {
      interfaces: MOCK_DNS_ORIGINALS.map((entry) => ({ ...entry, servers: [...entry.servers] })),
      backup: null,
    };
  }
  const def = MOCK_DNS_PRESETS[preset];
  const interfaces = [{ index: 12, alias: "以太网", servers: [def.primary, def.secondary] }];
  return {
    interfaces,
    backup: {
      preset,
      at: Date.now(),
      interfaces: MOCK_DNS_ORIGINALS.map((entry) => ({ ...entry, servers: [...entry.servers] })),
    },
  };
}

export function mockDnsSet(preset: string): OptimizeOutcome {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  const def = MOCK_DNS_PRESETS[preset];
  if (!def) {
    return {
      changed: [],
      skipped: [],
      message: `未知的 DNS 预设：${preset}`,
      elevated: true,
      cancelled: true,
    };
  }
  try {
    localStorage.setItem(DNS_KEY, preset);
  } catch {
    // 存储不可用时只在本次会话生效
  }
  return {
    changed: [],
    skipped: [],
    message: `已将网络适配器的 DNS 切换到${def.name}（${def.primary} / ${def.secondary}），原配置已备份，随时可还原`,
    elevated: true,
    cancelled: false,
  };
}

export function mockDnsRestore(): OptimizeOutcome {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  const preset = mockDnsPreset();
  if (!preset) {
    return {
      changed: [],
      skipped: [],
      message: "没有找到可还原的 DNS 备份（尚未切换过公共 DNS）",
      elevated: true,
      cancelled: true,
    };
  }
  try {
    localStorage.removeItem(DNS_KEY);
  } catch {
    // 忽略
  }
  return {
    changed: [],
    skipped: [],
    message: "已把网络适配器的 DNS 写回原配置（自动获取）；备份已清除",
    elevated: true,
    cancelled: false,
  };
}

export function mockNetworkDiag(): DiagReport {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  const ping = (target: string, label: string, base: number) => ({
    target,
    label,
    ok: true,
    ms: base + Math.floor(Math.random() * 14),
  });
  return {
    probes: [
      ping("223.5.5.5", "阿里 DNS", 26),
      ping("119.29.29.29", "腾讯 DNS", 32),
      ping("8.8.8.8", "Google DNS", 128),
      { target: "resolve", label: "域名解析 www.baidu.com", ok: true, ms: null },
    ],
  };
}

/* ── 一键优化（预览数据） ─────────────────────────────── */
interface MockOptimizeRecord {
  applied: boolean;
  backedUp: boolean;
}

interface MockOptimizeDef {
  id: string;
  group: "safe" | "advanced";
  name: string;
  description: string;
  risk: "safe" | "caution";
  hive: string;
  path: string;
  valueName: string;
  target: number;
  requiresAdmin: boolean;
  applies: string;
  minBuild: number;
  /** 模拟“外部程序改过”的初始值 */
  preset?: number;
}

const OPTIMIZE_KEY = "qidian.mock.optimize.v1";
/** 预览环境模拟 Windows 11 23H2，用来展示“当前系统不适用”的项。 */
const MOCK_WINDOWS_BUILD = 22631;

const MOCK_OPTIMIZE_DEFS: MockOptimizeDef[] = [
  { id: "telemetry", group: "safe", name: "限制诊断数据上传", description: "把遥测级别设为当前版本允许的最低值：企业/教育版为「安全」，家庭/专业版系统只接受「必需」。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection", valueName: "AllowTelemetry", target: 0, requiresAdmin: true, applies: "重启后生效", minBuild: 10240, preset: 1 },
  { id: "activity-history", group: "safe", name: "关闭活动历史记录", description: "停止向云端上传时间线活动，同时关闭本机活动历史采集。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\System", valueName: "PublishUserActivities", target: 0, requiresAdmin: true, applies: "重新登录后生效", minBuild: 10240, preset: 1 },
  { id: "consumer-features", group: "safe", name: "阻止推荐应用自动安装", description: "关闭「消费者体验」自动推送与安装推广应用；已安装的应用不受影响。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent", valueName: "DisableWindowsConsumerFeatures", target: 1, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "copilot", group: "safe", name: "关闭任务栏 Copilot", description: "隐藏任务栏 Copilot 入口并关闭其侧边栏；Windows 11 23H2 及以上有效。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot", valueName: "TurnOffWindowsCopilot", target: 1, requiresAdmin: true, applies: "重启资源管理器后生效", minBuild: 22621 },
  { id: "search-suggestions", group: "safe", name: "关闭搜索框网络建议", description: "搜索不再向微软请求联网建议与热门内容，只搜索本机应用和文件。", risk: "safe", hive: "HKCU", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer", valueName: "DisableSearchBoxSuggestions", target: 1, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "advertising-id", group: "safe", name: "关闭广告 ID", description: "禁用用于个性化广告的用户标识，减少跨应用广告追踪。", risk: "safe", hive: "HKCU", path: "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo", valueName: "Enabled", target: 0, requiresAdmin: false, applies: "立即生效", minBuild: 10240 },
  { id: "start-recommendations", group: "safe", name: "关闭开始菜单推荐", description: "隐藏开始菜单「推荐」区域的个性化建议，已固定与最近使用的应用保留。", risk: "safe", hive: "HKCU", path: "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced", valueName: "Start_IrisRecommendations", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 22000 },
  { id: "lock-screen-notifications", group: "safe", name: "关闭锁屏应用通知", description: "锁屏界面不再显示应用的通知与提醒；解锁后的通知中心不受影响。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\System", valueName: "DisableLockScreenAppNotifications", target: 1, requiresAdmin: true, applies: "重新登录后生效", minBuild: 10240 },
  { id: "recent-docs", group: "safe", name: "关闭最近文档与跳转列表", description: "开始菜单与任务栏不再显示最近打开的文档；「快速访问」里的最近文件也会清空。", risk: "safe", hive: "HKCU", path: "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced", valueName: "ShowRecentDocuments", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "wifi-sense", group: "safe", name: "关闭 WiFi 感知共享", description: "不再把 WiFi 密码分享给联系人，也不自动连接公开热点；参考 Winhance 的 WiFi-Sense 项。", risk: "safe", hive: "HKLM", path: "Software\\Microsoft\\PolicyManager\\default\\WiFi\\AllowWiFiHotSpotReporting", valueName: "Value", target: 0, requiresAdmin: true, applies: "重新登录后生效", minBuild: 10240 },
  { id: "error-reporting", group: "safe", name: "关闭 Windows 错误报告", description: "崩溃与错误信息不再自动上报微软；不影响系统正常运行。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Error Reporting", valueName: "Disabled", target: 1, requiresAdmin: true, applies: "立即生效", minBuild: 10240 },
  { id: "remote-assistance", group: "safe", name: "关闭远程协助", description: "禁止他人通过远程协助连接本机提供支持，减少被远程入侵的入口。", risk: "safe", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Control\\Remote Assistance", valueName: "fAllowToGetHelp", target: 0, requiresAdmin: true, applies: "立即生效", minBuild: 10240 },
  { id: "content-delivery", group: "safe", name: "关闭推广内容推送", description: "关闭“内容交付”，Windows 不再推送促销内容与建议安装的应用。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "ContentDeliveryAllowed", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "subscribed-content", group: "safe", name: "关闭订阅推送", description: "关闭微软与合作伙伴的“订阅内容”推送，减少系统内的推广信息。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "SubscribedContentEnabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "soft-landing", group: "safe", name: "关闭使用提示", description: "关闭“软着陆”体验，系统不再在使用过程中弹窗介绍新功能。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "SoftLandingEnabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "oem-preinstalled-apps", group: "safe", name: "关闭 OEM 预装应用", description: "防止厂商（OEM）自动向系统推送预装与捆绑应用。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "OemPreInstalledAppsEnabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "preinstalled-apps", group: "safe", name: "关闭建议应用安装", description: "Windows 不再自动安装“建议应用”；已装应用不受影响。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "PreInstalledAppsEnabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "silent-installed-apps", group: "safe", name: "关闭后台静默安装", description: "应用不能在后台被静默安装，需要安装时都会先经过你确认。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "SilentInstalledAppsEnabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "rotating-lock-screen", group: "safe", name: "关闭锁屏轮播", description: "锁屏不再轮播 Windows 聚焦（Spotlight）图片，使用静态背景。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "RotatingLockScreenEnabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "sound-startup", group: "safe", name: "关闭开机启动音", description: "Windows 开机时不再播放启动提示音；参考 Winhance 的 Sound 优化项。", risk: "safe", hive: "HKLM", path: "Software\\Microsoft\\Windows\\CurrentVersion\\Authentication\\LogonUI\\BootAnimation", valueName: "DisableStartupSound", target: 1, requiresAdmin: true, applies: "下次开机生效", minBuild: 17763 },
  { id: "notif-welcome", group: "safe", name: "关闭更新后欢迎体验", description: "系统更新完成或登录后不再弹出「欢迎体验」介绍页；参考 Winhance 的通知优化项。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "SubscribedContent-310093Enabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "notif-setup-suggestions", group: "safe", name: "关闭完成设置建议", description: "不再提示「完成设备设置」之类的引导建议，减少通知打扰。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\UserProfileEngagement", valueName: "ScoobeSystemSettingEnabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "notif-tips", group: "safe", name: "关闭使用提示", description: "不再推送「获取使用提示和建议」类通知，界面更安静。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "SubscribedContent-338389Enabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "notif-pane-suggestions", group: "safe", name: "关闭通知中心建议", description: "通知中心不再显示系统给出的建议卡片，只保留真实通知。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager", valueName: "SystemPaneSuggestionsEnabled", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "notif-capability-access", group: "safe", name: "关闭权限请求通知", description: "应用申请摄像头、麦克风等系统权限时不再弹系统级通知（权限本身不受影响）。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\Windows.SystemToast.CapabilityAccess", valueName: "Enabled", target: 0, requiresAdmin: false, applies: "立即生效", minBuild: 10240 },
  { id: "notif-startup-app", group: "safe", name: "关闭启动应用通知", description: "有应用被加入开机启动项时不再弹「已启动」通知，减少打扰。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\Windows.SystemToast.StartupApp", valueName: "Enabled", target: 0, requiresAdmin: false, applies: "立即生效", minBuild: 10240 },
  { id: "notif-sound", group: "safe", name: "关闭通知声音", description: "收到通知时不再播放提示音，静音场景更省心；桌面下方横幅仍正常显示。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings", valueName: "NOC_GLOBAL_SETTING_ALLOW_NOTIFICATION_SOUND", target: 0, requiresAdmin: false, applies: "立即生效", minBuild: 10240 },
  { id: "driver-coinstallers", group: "safe", name: "禁用驱动配套软件", description: "插入新设备时不再自动安装厂商捆绑软件（如打印机工具、外设驱动套件），只装标准驱动；参考 Winhance 的 Driver Co-Installers 项。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Device Installer", valueName: "DisableCoInstallers", target: 1, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "update-restart-asap", group: "safe", name: "关闭更新后尽快重启", description: "系统更新安装完成后不再「尽快重启」，避免自动重启打断工作。", risk: "safe", hive: "HKLM", path: "Software\\Microsoft\\WindowsUpdate\\UX\\Settings", valueName: "IsExpedited", target: 0, requiresAdmin: true, applies: "立即生效", minBuild: 10240 },
  { id: "update-autoreboot", group: "safe", name: "登录时禁止自动重启", description: "有用户登录时，Windows 更新不再自动重启电脑，重启前会先等你确认。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU", valueName: "NoAutoRebootWithLoggedOnUsers", target: 1, requiresAdmin: true, applies: "立即生效", minBuild: 10240 },
  { id: "delivery-optimization", group: "safe", name: "关闭更新 P2P 分发", description: "Windows 更新不再通过 P2P 从局域网或互联网其他电脑下载，节省带宽与磁盘写入；仍可正常从微软服务器更新。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization", valueName: "DODownloadMode", target: 99, requiresAdmin: true, applies: "立即生效", minBuild: 10240 },
  { id: "voice-activation", group: "safe", name: "关闭语音唤醒", description: "关闭「嘿 Cortana/语音唤醒」后台监听，应用无法通过语音命令唤醒；麦克风按需使用不受影响。", risk: "safe", hive: "HKLM", path: "Software\\Microsoft\\Windows\\CurrentVersion\\SpeechOneCore\\Settings", valueName: "AgentActivationEnabled", target: 0, requiresAdmin: true, applies: "重新登录后生效", minBuild: 10240 },
  { id: "whole-fs-search", group: "safe", name: "关闭全盘搜索", description: "文件搜索只查已建立索引的位置，不再实时遍历整个磁盘，显著减少磁盘活动；索引外文件仍可手动定位。", risk: "safe", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Search\\Preferences", valueName: "WholeFileSystem", target: 0, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "system-responsiveness", group: "advanced", name: "提高前台响应优先", description: "把系统后台线程可占用的 CPU 时间从 20% 降到 10%，游戏与前台应用响应更跟手；参考 Winhance 的 System Responsiveness 项。", risk: "caution", hive: "HKLM", path: "System\\CurrentControlSet\\Control\\PriorityControl", valueName: "SystemResponsiveness", target: 10, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "power-throttling", group: "advanced", name: "关闭后台电源节流", description: "禁止 Windows 对后台进程进行 CPU 节流，满载运行更稳定；笔记本续航会略有下降。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling", valueName: "PowerThrottlingOff", target: 1, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "visual-effects", group: "advanced", name: "关闭动画特效", description: "把视觉效果切换为「最佳性能」：关闭窗口动画、淡入淡出与菜单动画，界面响应立刻变快；参考 WinUtil / Optimizer 的性能优化项。", risk: "caution", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects", valueName: "VisualFXSetting", target: 2, requiresAdmin: false, applies: "重启资源管理器后生效", minBuild: 10240 },
  { id: "transparency", group: "advanced", name: "关闭透明与毛玻璃效果", description: "关闭任务栏与窗口的透明/毛玻璃（Mica）效果，降低图形渲染负担；Win10/11 通用。", risk: "caution", hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", valueName: "EnableTransparency", target: 0, requiresAdmin: false, applies: "立即生效", minBuild: 10240 },
  { id: "network-throttling", group: "safe", name: "关闭网络带宽节流", description: "禁止系统为后台任务预留 20% 网络带宽，提升下载与视频加载速度；参考 WinUtil 的网络优化项。", risk: "safe", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\Psched", valueName: "NonBestEffortLimit", target: 0, requiresAdmin: true, applies: "立即生效", minBuild: 10240 },
  { id: "svc-diagtrack", group: "advanced", name: "禁用诊断跟踪服务", description: "禁用 DiagTrack（Connected User Experiences and Telemetry）服务，彻底停止遥测后台进程；比策略限制更省资源。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Services\\DiagTrack", valueName: "Start", target: 4, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "svc-pcasvc", group: "advanced", name: "禁用程序兼容性助手", description: "禁用 PcaSvc（Program Compatibility Assistant Service），减少程序启动时被它扫描的开销。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Services\\PcaSvc", valueName: "Start", target: 4, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "svc-dmwappush", group: "advanced", name: "禁用设备管理推送服务", description: "禁用 dmwappushservice（Device Management WAP Push），停止常驻推送通道，减少后台进程与网络活动。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Services\\dmwappushservice", valueName: "Start", target: 4, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "svc-retail-demo", group: "advanced", name: "禁用零售演示服务", description: "禁用 RetailDemo（零售演示）服务，普通家用电脑完全不需要。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Services\\RetailDemo", valueName: "Start", target: 4, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "svc-fax", group: "advanced", name: "禁用传真服务", description: "禁用 Fax（传真）服务，不使用传真功能的机器可安全关闭。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Services\\Fax", valueName: "Start", target: 4, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "svc-wmp-network", group: "advanced", name: "禁用媒体网络共享服务", description: "禁用 WMPNetworkSvc（Windows Media Player 网络共享），不使用家庭媒体共享可安全关闭。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Services\\WMPNetworkSvc", valueName: "Start", target: 4, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "svc-maps-broker", group: "advanced", name: "禁用地图下载服务", description: "禁用 MapsBroker（地图下载）服务，不常用系统地图应用可安全关闭。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Services\\MapsBroker", valueName: "Start", target: 4, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "svc-geolocation", group: "advanced", name: "禁用地理定位服务", description: "禁用 lfsvc（地理定位）服务，不依赖定位功能的应用可安全关闭。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Services\\lfsvc", valueName: "Start", target: 4, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "svc-cdp", group: "advanced", name: "禁用连接设备平台", description: "禁用 CDPSvc（Connected Devices Platform），停止跨设备同步与周边设备发现；部分同步功能会失效。", risk: "caution", hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Services\\CDPSvc", valueName: "Start", target: 4, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
  { id: "widgets", group: "advanced", name: "关闭小组件资讯流", description: "关闭任务栏小组件与新闻推送；需要天气卡片时可随时还原。", risk: "caution", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Dsh", valueName: "AllowNewsAndInterests", target: 0, requiresAdmin: true, applies: "重新登录后生效", minBuild: 19041 },
  { id: "recall", group: "advanced", name: "关闭 Recall 截图索引", description: "禁止 Windows 定期截屏并建立可检索的本地索引，仅影响 Copilot+ PC。", risk: "caution", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI", valueName: "DisableAIDataAnalysis", target: 1, requiresAdmin: true, applies: "重启后生效", minBuild: 26100 },
  { id: "game-dvr", group: "advanced", name: "关闭游戏栏后台录制", description: "关闭 Xbox Game Bar 的后台录制与广播，减少少量 CPU 与磁盘写入；手动录屏仍可使用。", risk: "caution", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR", valueName: "AllowGameDVR", target: 0, requiresAdmin: true, applies: "重启游戏栏后生效", minBuild: 10240 },
  { id: "driver-updates", group: "advanced", name: "禁止更新自动装驱动", description: "Windows 更新不再自动安装新驱动，避免驱动被偷偷覆盖；仍可手动安装厂商驱动。", risk: "caution", hive: "HKLM", path: "SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate", valueName: "ExcludeWUDriversInQualityUpdate", target: 1, requiresAdmin: true, applies: "重启后生效", minBuild: 10240 },
];

function loadOptimizeRecords(): Record<string, MockOptimizeRecord> {
  try {
    const raw = localStorage.getItem(OPTIMIZE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, MockOptimizeRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveOptimizeRecords(records: Record<string, MockOptimizeRecord>): void {
  try {
    localStorage.setItem(OPTIMIZE_KEY, JSON.stringify(records));
  } catch {
    // 存储不可用时只在本次会话生效
  }
}

/** 优化项类别，与 Rust 端 `item_category` 保持一致。 */
function optimizeCategoryFor(id: string): "privacy" | "performance" | "services" | "updates" {
  if (
    [
      "telemetry",
      "activity-history",
      "copilot",
      "search-suggestions",
      "advertising-id",
      "start-recommendations",
      "lock-screen-notifications",
      "recent-docs",
      "wifi-sense",
      "error-reporting",
      "remote-assistance",
      "voice-activation",
      "recall",
      "sound-startup",
    ].includes(id) ||
    id.startsWith("notif-")
  ) {
    return "privacy";
  }
  if (id.startsWith("svc-")) return "services";
  if (
    [
      "system-responsiveness",
      "power-throttling",
      "visual-effects",
      "transparency",
      "network-throttling",
      "widgets",
      "game-dvr",
      "whole-fs-search",
    ].includes(id)
  ) {
    return "performance";
  }
  return "updates";
}

export function mockOptimizeItems(): OptimizeItem[] {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  const records = loadOptimizeRecords();
  return MOCK_OPTIMIZE_DEFS.map((def) => {
    const record = records[def.id];
    const current = record?.applied ? def.target : (def.preset ?? null);
    const state = record?.applied
      ? "applied"
      : current === null
        ? "default"
        : current === def.target
          ? "applied"
          : "custom";
    const available = MOCK_WINDOWS_BUILD >= def.minBuild;
    return {
      id: def.id,
      group: def.group,
      category: optimizeCategoryFor(def.id),
      name: def.name,
      description: def.description,
      risk: def.risk,
      requiresAdmin: def.requiresAdmin,
      state,
      backedUp: record?.backedUp ?? false,
      available,
      unavailableReason: available
        ? null
        : `需要 Windows Build ${def.minBuild} 及以上，当前为 ${MOCK_WINDOWS_BUILD}`,
      applies: def.applies,
      values: [
        {
          hive: def.hive,
          path: def.path,
          name: def.valueName,
          target: def.target,
          current,
          error: null,
        },
      ],
    };
  });
}

export function mockOptimizeApply(ids: string[]): OptimizeOutcome {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  const records = loadOptimizeRecords();
  const items = mockOptimizeItems();
  const changed: string[] = [];
  const skipped: OptimizeOutcome["skipped"] = [];
  for (const id of ids) {
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      skipped.push({ id, reason: "未知优化项" });
      continue;
    }
    if (!item.available) {
      skipped.push({ id, reason: item.unavailableReason ?? "当前系统不适用" });
      continue;
    }
    if (item.state === "applied") {
      skipped.push({ id, reason: "已是目标值，无需改动" });
      continue;
    }
    records[id] = { applied: true, backedUp: true };
    changed.push(id);
  }
  saveOptimizeRecords(records);
  const message =
    changed.length > 0
      ? `已优化 ${changed.length} 项，已回读校验${skipped.length > 0 ? `；${skipped.length} 项未改动` : ""}`
      : `没有项目被改动：${skipped[0]?.reason ?? "没有需要变更的项目"}`;
  return {
    changed,
    skipped,
    message,
    elevated: changed.some((id) => MOCK_OPTIMIZE_DEFS.find((def) => def.id === id)?.requiresAdmin),
    cancelled: false,
  };
}

export function mockOptimizeRestore(ids: string[], all: boolean): OptimizeOutcome {
  if (!mockOptReady()) throw new Error("系统优化模块尚未安装");
  const records = loadOptimizeRecords();
  const targets = all
    ? Object.keys(records).filter((id) => records[id].backedUp)
    : ids.filter((id) => records[id]?.backedUp);
  for (const id of targets) delete records[id];
  saveOptimizeRecords(records);
  return {
    changed: targets,
    skipped: [],
    message: targets.length > 0 ? `已还原 ${targets.length} 项` : "没有可还原的项目",
    elevated: false,
    cancelled: false,
  };
}

/* ── 内存管理（预览数据） ─────────────────────────────── */
const MOCK_TOTAL_MEMORY = (() => {
  const value = Number(new URLSearchParams(location.search).get("mem"));
  const gb = Number.isFinite(value) && value >= 4 && value <= 512 ? value : 32;
  return Math.round(gb * 1024 ** 3);
})();
const MOCK_AVAIL_MEMORY = Math.round(MOCK_TOTAL_MEMORY * 0.42);

function mockSmartThresholds(total: number): [number, number] {
  const gb = total / 1024 ** 3;
  if (gb <= 8.5) return [80, 50];
  if (gb <= 12.5) return [82, 52];
  if (gb <= 16.5) return [85, 55];
  if (gb <= 24.5) return [87, 60];
  if (gb <= 32.5) return [88, 62];
  if (gb <= 64.5) return [90, 65];
  return [90, 70];
}
let mockMemoryLow = false;
let mockWorkingSet = 132 * 1024 ** 2;
let mockMemoryHistory: MemoryLastAction[] = [];
let mockMemoryTotalReleased = 184 * 1024 ** 2;
let mockMemoryTodayReleased = 96 * 1024 ** 2;
let mockMemoryAdjustCount = 7;

function mockMemorySettings(): Settings {
  try {
    const raw = localStorage.getItem("qidian.settings.v1");
    if (!raw) return cloneSettings(DEFAULT_SETTINGS);
    const incoming = JSON.parse(raw) as Partial<Settings>;
    return { ...cloneSettings(DEFAULT_SETTINGS), ...incoming };
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function mockMemoryStatus(): MemoryStatus {
  const settings = mockMemorySettings();
  const usedPercent = Math.round(((MOCK_TOTAL_MEMORY - MOCK_AVAIL_MEMORY) / MOCK_TOTAL_MEMORY) * 100);
  const smart = settings.memorySmartThresholds;
  const [effectiveLow, effectiveRecover] = smart
    ? mockSmartThresholds(MOCK_TOTAL_MEMORY)
    : [settings.memoryLowPercent, settings.memoryRecoverPercent];
  return {
    mode: settings.memoryMode,
    level: settings.memoryMode === "manual" ? settings.memoryLevel : mockMemoryLow ? "low" : "normal",
    monitor:
      settings.memoryMode === "manual" ? "off" : settings.memoryMode === "custom" ? "timer" : "event",
    trimWorkingSet: settings.memoryTrimWorkingSet,
    trimScope: settings.memoryTrimScope,
    idleTrim: settings.memoryIdleTrim,
    effectiveIntervalSec:
      settings.memoryMode === "custom" && settings.memoryAdaptiveInterval
        ? usedPercent >= effectiveLow
          ? 30
          : usedPercent <= effectiveRecover
            ? Math.max(settings.memoryIntervalSec, 120)
            : settings.memoryIntervalSec
        : settings.memoryIntervalSec,
    fullscreenPaused: false,
    powerSource: "ac",
    batteryPercent: null,
    powerAware: settings.memoryPowerAware,
    effectiveLowPercent: effectiveLow,
    effectiveRecoverPercent: effectiveRecover,
    smartThresholds: smart,
    emergencyLow: false,
    systemTotalBytes: MOCK_TOTAL_MEMORY,
    systemAvailBytes: MOCK_AVAIL_MEMORY,
    systemUsedPercent: usedPercent,
    systemCommitTotalBytes: Math.round(MOCK_TOTAL_MEMORY * 1.6),
    systemCommitAvailBytes: Math.round(MOCK_TOTAL_MEMORY * 0.9),
    systemCommitUsedPercent: 44,
    commitPressure: false,
    userIdleSeconds: 42,
    selfWorkingSetBytes: mockWorkingSet,
    selfPrivateBytes: Math.round(mockWorkingSet * 1.32),
    lastAction: mockMemoryHistory[0] ?? null,
    history: mockMemoryHistory,
    totalReleasedBytes: mockMemoryTotalReleased,
    todayReleasedBytes: mockMemoryTodayReleased,
    adjustCount: mockMemoryAdjustCount,
  };
}

function pushMockMemoryAction(reason: string, level: "low" | "normal", released: number): void {
  mockMemoryHistory.unshift({ reason, at: Date.now(), releasedBytes: released, level });
  mockMemoryHistory = mockMemoryHistory.slice(0, 6);
  mockMemoryTotalReleased += released;
  mockMemoryTodayReleased += released;
  mockMemoryAdjustCount += 1;
}

export function mockMemoryApply(): MemoryStatus {
  const settings = mockMemorySettings();
  const used = mockMemoryStatus().systemUsedPercent;
  const [effectiveLow, effectiveRecover] = settings.memorySmartThresholds
    ? mockSmartThresholds(MOCK_TOTAL_MEMORY)
    : [settings.memoryLowPercent, settings.memoryRecoverPercent];
  if (settings.memoryMode === "manual") {
    mockMemoryLow = settings.memoryLevel === "low";
  } else if (used >= effectiveLow) {
    mockMemoryLow = true;
  } else if (used <= effectiveRecover) {
    mockMemoryLow = false;
  }
  mockWorkingSet = mockMemoryLow ? 76 * 1024 ** 2 : 132 * 1024 ** 2;
  pushMockMemoryAction("手动检查", mockMemoryLow ? "low" : "normal", 0);
  return mockMemoryStatus();
}

export function mockMemoryTrim(): MemoryStatus {
  const settings = mockMemorySettings();
  const before = mockWorkingSet;
  const systemScope = settings.memoryTrimScope === "system";
  mockWorkingSet = Math.min(before, systemScope ? 48 * 1024 ** 2 : 72 * 1024 ** 2);
  const extra = systemScope ? 420 * 1024 ** 2 : 0;
  pushMockMemoryAction(
    "手动释放",
    mockMemoryLow ? "low" : "normal",
    Math.max(0, before - mockWorkingSet) + extra,
  );
  return mockMemoryStatus();
}

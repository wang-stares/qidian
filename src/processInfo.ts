import type { ProcessItem } from "./types";

export type ProcessRisk = "safe" | "caution" | "system";

interface Knowledge {
  title: string;
  explain: string;
  level: ProcessRisk;
}

/**
 * 常见进程的“这是什么”说明。没有命中的进程会回退到可执行文件自带的
 * 文件描述与发布者，并默认按“谨慎结束”处理。
 */
const KNOWLEDGE: Record<string, Knowledge> = {
  chrome: {
    title: "Google Chrome",
    explain:
      "Chrome 浏览器的主进程。同组的子进程分别负责标签页、插件和页面渲染；结束整组会关闭浏览器，未提交的表单可能丢失。",
    level: "safe",
  },
  msedge: {
    title: "Microsoft Edge",
    explain:
      "Edge 浏览器的主进程。同组子进程负责标签页、扩展和渲染；结束整组会关闭浏览器。",
    level: "safe",
  },
  msedgewebview2: {
    title: "Edge WebView2",
    explain:
      "应用内嵌网页使用的 Edge 内核，启点界面也依赖它。结束会导致窗口白屏或直接消失，因此已保护。",
    level: "system",
  },
  firefox: {
    title: "Mozilla Firefox",
    explain: "Firefox 浏览器进程。结束会关闭对应窗口；同组子进程负责页面渲染。",
    level: "safe",
  },
  code: {
    title: "Visual Studio Code",
    explain:
      "VS Code 主程序。同组子进程是插件宿主和渲染进程；结束整组会退出编辑器，未保存的文件会丢失。",
    level: "safe",
  },
  cursor: {
    title: "Cursor",
    explain: "Cursor 编辑器进程。结束整组会退出编辑器，未保存的修改可能丢失。",
    level: "safe",
  },
  wechat: {
    title: "微信",
    explain: "微信主程序。同组可能包含托盘、音视频或小程序辅助进程；结束整组会退出微信。",
    level: "safe",
  },
  weixin: {
    title: "微信",
    explain: "微信主程序。结束整组会退出微信，正在传输的文件可能中断。",
    level: "safe",
  },
  qq: {
    title: "QQ",
    explain: "QQ 主程序。结束整组会退出 QQ；同组辅助进程负责消息、音视频等模块。",
    level: "safe",
  },
  telegram: {
    title: "Telegram",
    explain: "Telegram 客户端进程。结束会退出客户端，正在下载的文件会暂停。",
    level: "safe",
  },
  discord: {
    title: "Discord",
    explain: "Discord 客户端进程。结束会退出语音和聊天客户端。",
    level: "safe",
  },
  feishu: {
    title: "飞书",
    explain: "飞书主程序。同组辅助进程负责消息、会议和文档；结束整组会退出飞书。",
    level: "safe",
  },
  lark: {
    title: "飞书",
    explain: "飞书主程序。结束整组会退出飞书，正在进行的会议会断开。",
    level: "safe",
  },
  dingtalk: {
    title: "钉钉",
    explain: "钉钉主程序。结束整组会退出钉钉，考勤或会议可能中断。",
    level: "safe",
  },
  teams: {
    title: "Microsoft Teams",
    explain: "Teams 客户端进程。结束会退出聊天和会议客户端。",
    level: "safe",
  },
  "ms-teams": {
    title: "Microsoft Teams",
    explain: "新版 Teams 客户端进程。结束会退出聊天和会议。",
    level: "safe",
  },
  steam: {
    title: "Steam",
    explain:
      "Steam 客户端主进程。steamwebhelper 是商店、好友和游戏内界面的辅助进程；结束整组会关闭 Steam。",
    level: "safe",
  },
  steamwebhelper: {
    title: "Steam Web Helper",
    explain: "Steam 的商店、好友和游戏内网页界面进程。结束会关闭 Steam 界面，但游戏通常继续运行。",
    level: "safe",
  },
  spotify: {
    title: "Spotify",
    explain: "Spotify 音乐客户端进程。结束会停止播放并退出客户端。",
    level: "safe",
  },
  onedrive: {
    title: "OneDrive",
    explain: "OneDrive 云同步进程。结束会暂停文件上传和下载，下次启动后继续同步。",
    level: "safe",
  },
  baidunetdisk: {
    title: "百度网盘",
    explain: "百度网盘客户端。结束会暂停传输，正在下载的文件可能保留为临时文件。",
    level: "safe",
  },
  thunder: {
    title: "迅雷",
    explain: "迅雷下载客户端。结束会暂停正在下载的任务。",
    level: "safe",
  },
  everything: {
    title: "Everything",
    explain: "Everything 本地文件搜索工具。结束只会让搜索窗口消失，不影响文件。",
    level: "safe",
  },
  powertoys: {
    title: "PowerToys",
    explain: "PowerToys 的快捷键与增强工具宿主。结束会停用窗口吸附、速览等增强功能。",
    level: "safe",
  },
  wps: {
    title: "WPS Office",
    explain: "WPS 文档进程。结束前请保存正在编辑的文档，否则未保存内容会丢失。",
    level: "safe",
  },
  winword: {
    title: "Microsoft Word",
    explain: "Word 文档进程。结束会关闭文档，未保存内容会丢失。",
    level: "safe",
  },
  excel: {
    title: "Microsoft Excel",
    explain: "Excel 表格进程。结束会关闭工作簿，未保存内容会丢失。",
    level: "safe",
  },
  powerpnt: {
    title: "Microsoft PowerPoint",
    explain: "PowerPoint 演示文稿进程。结束会关闭演示文稿，未保存内容会丢失。",
    level: "safe",
  },
  acrobat: {
    title: "Adobe Acrobat",
    explain: "Acrobat PDF 阅读与编辑进程。结束会关闭当前 PDF。",
    level: "safe",
  },
  photoshop: {
    title: "Adobe Photoshop",
    explain: "Photoshop 图像编辑进程。结束会丢失未保存的图层修改。",
    level: "caution",
  },
  illustrator: {
    title: "Adobe Illustrator",
    explain: "Illustrator 矢量编辑进程。结束会丢失未保存的修改。",
    level: "caution",
  },
  figma: {
    title: "Figma",
    explain: "Figma 桌面客户端进程。结束会关闭当前设计文件，云端版本不受影响。",
    level: "safe",
  },
  notion: {
    title: "Notion",
    explain: "Notion 桌面客户端进程。结束会关闭当前页面，云端内容不受影响。",
    level: "safe",
  },
  searchindexer: {
    title: "Windows 搜索索引",
    explain:
      "Windows 文件与开始菜单搜索的索引服务。结束会暂时无法搜索，系统稍后会自动重启它，一般无需手动处理。",
    level: "caution",
  },
  "adobe desktop service": {
    title: "Adobe Desktop Service",
    explain: "Adobe Creative Cloud 的后台更新与许可服务。结束会停止 Creative Cloud 的更新和云文档同步。",
    level: "caution",
  },
  svchost: {
    title: "Windows 服务宿主",
    explain:
      "多个 Windows 系统服务共享的宿主进程。结束可能导致网络、音频、更新或安全功能异常，因此已保护。",
    level: "system",
  },
  explorer: {
    title: "Windows 资源管理器",
    explain:
      "负责桌面、任务栏和文件窗口的系统进程。结束会让桌面和任务栏消失，需要重新启动资源管理器，因此已保护。",
    level: "system",
  },
  dwm: {
    title: "桌面窗口管理器",
    explain: "负责窗口绘制、圆角、阴影和动画。结束会导致黑屏或界面异常，因此已保护。",
    level: "system",
  },
  runtimebroker: {
    title: "Runtime Broker",
    explain: "Windows 检查应用权限的代理进程，Store 应用运行时常见。一般无需关闭，已保护。",
    level: "system",
  },
  taskhostw: {
    title: "Windows 任务宿主",
    explain: "承载后台任务和部分系统服务的宿主进程。结束可能让计划任务或系统功能异常，已保护。",
    level: "system",
  },
  ctfmon: {
    title: "输入法框架",
    explain: "负责中文输入法和语言栏。结束可能导致无法输入中文，已保护。",
    level: "system",
  },
  audiodg: {
    title: "Windows 音频设备",
    explain: "负责音频处理。结束会导致声音中断，系统通常会自动重启它，已保护。",
    level: "system",
  },
  lsass: {
    title: "本地安全认证",
    explain: "负责登录和账户安全策略。结束会导致注销或系统重启，已保护。",
    level: "system",
  },
  csrss: {
    title: "Windows 子系统",
    explain: "Windows 图形与控制台子系统。结束会造成严重系统故障，已保护。",
    level: "system",
  },
  winlogon: {
    title: "Windows 登录",
    explain: "负责登录、锁屏和用户会话。结束会导致会话中断，已保护。",
    level: "system",
  },
  services: {
    title: "服务控制管理器",
    explain: "启动和管理 Windows 服务的核心进程。结束会导致系统服务大面积异常，已保护。",
    level: "system",
  },
  smss: {
    title: "会话管理器",
    explain: "Windows 启动阶段的核心进程。结束会导致系统崩溃，已保护。",
    level: "system",
  },
  registry: {
    title: "注册表",
    explain: "Windows 注册表的内存映射进程。结束会导致系统不稳定，已保护。",
    level: "system",
  },
  system: {
    title: "System",
    explain: "Windows 内核与驱动使用的系统进程。结束会直接导致死机，已保护。",
    level: "system",
  },
  idle: {
    title: "System Idle Process",
    explain: "表示 CPU 空闲时间的系统进程，并不是真正运行的应用，不能也不需要结束。",
    level: "system",
  },
  securityhealthservice: {
    title: "Windows 安全中心",
    explain: "Windows 安全健康服务。结束会让安全状态检测失效，已保护。",
    level: "system",
  },
  msmpeng: {
    title: "Microsoft Defender",
    explain: "Windows Defender 的实时防护进程。结束会降低病毒防护能力，已保护。",
    level: "system",
  },
  sihost: {
    title: "Shell Infrastructure Host",
    explain: "Windows 外壳（开始菜单、任务栏等）依赖的基础设施进程，已保护。",
    level: "system",
  },
  fontdrvhost: {
    title: "字体驱动宿主",
    explain: "Windows 字体渲染驱动宿主。结束可能导致界面文字显示异常，已保护。",
    level: "system",
  },
  qidian: {
    title: "启点",
    explain: "启点自身。结束它会关闭当前窗口并释放内存，应用不会继续驻留后台。",
    level: "system",
  },
};

export interface ProcessGroup {
  key: string;
  name: string;
  title: string;
  explain: string;
  level: ProcessRisk;
  publisher: string;
  memoryBytes: number;
  items: ProcessItem[];
  protectedGroup: boolean;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.exe$/, "");
}

function finishSentence(value: string): string {
  const trimmed = value.trim().replace(/[。.！!；;]+$/, "");
  return trimmed ? `${trimmed}。` : "";
}

export function describeProcess(
  item: ProcessItem,
): { title: string; explain: string; level: ProcessRisk } {
  const knowledge = KNOWLEDGE[normalizeName(item.name)];
  if (item.protected) {
    return {
      title: knowledge?.title ?? item.name,
      explain: knowledge?.explain ?? "Windows 或启点运行所需的进程，结束会影响系统或界面，因此已保护。",
      level: "system",
    };
  }
  if (knowledge) return knowledge;

  const company = item.company?.trim();
  const description = item.description?.trim();
  const title = description || company || item.name;
  const explain = description || company
    ? `${company ? `来自 ${company} 的` : ""}进程${description ? `（${description}）` : ""}。可能是应用主进程、界面进程或后台辅助进程；结束前请保存正在编辑的内容。`
    : `${item.name}.exe 是当前运行的进程。无法确认它的用途时请谨慎结束；系统进程已被启点保护。`;
  return { title, explain: finishSentence(explain), level: "caution" };
}

export function buildProcessGroups(processes: ProcessItem[]): ProcessGroup[] {
  const groups = new Map<string, ProcessGroup>();
  for (const item of processes) {
    const key = normalizeName(item.name) || item.name;
    const knowledge = describeProcess(item);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      existing.memoryBytes += item.memoryBytes;
      existing.protectedGroup ||= item.protected;
      if (knowledge.level === "system") existing.level = "system";
      else if (knowledge.level === "caution" && existing.level === "safe") existing.level = "caution";
      if (!existing.publisher && item.company) existing.publisher = item.company;
      continue;
    }
    groups.set(key, {
      key,
      name: item.name,
      title: knowledge.title,
      explain: knowledge.explain,
      level: knowledge.level,
      publisher: item.company?.trim() || "",
      memoryBytes: item.memoryBytes,
      items: [item],
      protectedGroup: item.protected,
    });
  }

  const rank: Record<ProcessRisk, number> = { safe: 0, caution: 1, system: 2 };
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => b.memoryBytes - a.memoryBytes),
    }))
    .sort(
      (a, b) =>
        rank[a.level] - rank[b.level] ||
        b.memoryBytes - a.memoryBytes ||
        a.title.localeCompare(b.title, "zh-CN"),
    );
}

export function formatMemory(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

export function riskLabel(level: ProcessRisk): string {
  if (level === "system") return "系统关键 · 已保护";
  if (level === "caution") return "谨慎结束";
  return "可安全结束";
}

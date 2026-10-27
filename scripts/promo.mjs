/* 启点宣传图生成器：SVG → PNG（sharp/librsvg）
 * 用法：npm run promo
 * 输出：../qidian-build/promo/v{当前版本}/（版本图 + 重点功能图）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const PNG_ROOT = process.env.PROMO_OUT || path.resolve(ROOT, "../qidian-build/promo");
const PNG = path.join(PNG_ROOT, `v${VERSION}`);
fs.mkdirSync(PNG, { recursive: true });

/* ── 基础 ─────────────────────────────────────────────── */
const BG = "#070a14";
const INK = "#f2f6ff";
const MUTED = "#93a2bd";
const DIM = "#5f6e8a";
const BLUE = "#4f7cff";
const VIOLET = "#7c5cff";
const CYAN = "#38d0ff";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ICONS = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
  star: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.6Z"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="M15.6 15.6l4.3 4.3"/>',
  settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17" r="2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-.6 4.2"/><path d="M20 4.5V11h-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.2"/>',
  "arrow-up-right": '<path d="M7 17L17 7M9 7h8v8"/>',
  folder: '<path d="M3.5 8.5c0-1.1.9-2 2-2h4l2 2.2h7c1.1 0 2 .9 2 2v7.8c0 1.1-.9 2-2 2h-13c-1.1 0-2-.9-2-2V8.5Z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9.5l3 2.5-3 2.5M13 15h4"/>',
  code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
  briefcase: '<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.6 0 2-1 1.5-2s.1-2 1.6-2H18a3 3 0 0 0 3-3c0-5.4-4-10-9-10Z"/><circle cx="8" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="9" r="1" fill="currentColor" stroke="none"/>',
  music: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  gamepad: '<path d="M8 8h8c3 0 5 3.2 4.2 6.3l-.7 2.5c-.4 1.5-2.4 1.9-3.3.7l-1.5-2.1H9.3l-1.5 2.1c-.9 1.2-2.9.8-3.3-.7l-.7-2.5C3 11.2 5 8 8 8Z"/><path d="M8 11v3M6.5 12.5h3M15.5 11.5h.01M17.5 13.5h.01"/>',
  chat: '<path d="M4 5.5h16v10.2H9.5L5 20v-4.3H4V5.5Z"/><path d="M8 9h8M8 12h5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5S14.4 18.1 12 20.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5Z"/>',
  shield: '<path d="M12 3l7 2.8v5.4c0 4.3-2.8 7.6-7 9.8-4.2-2.2-7-5.5-7-9.8V5.8L12 3Z"/><path d="M9 11.8l2 2 4-4"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-2.5 2-2.2Z"/>',
  box: '<path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4v-9Z"/><path d="M3.5 7.5L12 11.5l8.5-4M12 11.5v9"/>',
  layers: '<path d="M12 3.5l8.5 4.3L12 12.2 3.5 7.8 12 3.5Z"/><path d="M4 12.5l8 4 8-4M4 16.5l8 4 8-4"/>',
  doc: '<path d="M6 3.5h7l5 5v12H6v-17Z"/><path d="M13 3.5v5h5M9 13h6M9 16.5h6"/>',
  table: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M9.5 9.5V20M4 15h16"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2.5"/><path d="M9 20h6M12 16.5V20"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.5l5.5 3.5-5.5 3.5v-7Z"/>',
  zap: '<path d="M13.5 2.5L4.8 13h6l-1.3 8.5L20 10.5h-6.5l0-8Z"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 6.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.2"/>',
  more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 3l1.7 4.9L18.5 9.6l-4.8 1.7L12 16l-1.7-4.7L5.5 9.6l4.8-1.7L12 3Z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
  "hard-drive": '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 15h.01M11 15h6"/>',
  power: '<path d="M12 3v8"/><path d="M7.2 6.8a7.5 7.5 0 1 0 9.6 0"/>',
  cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
  trash: '<path d="M4.5 7h15M9 7V4.8h6V7M6.5 7l.8 12.2h9.4L17.5 7M10 10.5v5M14 10.5v5"/>',
  eye: '<path d="M3 12c0-.6 3.5-7 9-7s9 6.4 9 7-3.5 7-9 7-9-6.4-9-7Z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M3 3l18 18"/><path d="M10.6 5.3A9.7 9.7 0 0 1 12 5c5.5 0 9 6.4 9 7 0 .3-.5 1.4-1.6 2.7M6.3 7.5C4.2 9.1 3 11 3 12c0 .6 3.5 7 9 7 1.4 0 2.7-.4 3.9-1"/><path d="M9.9 10.2a3 3 0 0 0 4.1 4.2"/>',
};

const SANS = "Noto Sans CJK SC";

function t(x, y, s, o = {}) {
  const { size = 20, weight = 400, fill = INK, ls = 0, anchor = "start", opacity = 1 } = o;
  return `<text x="${x}" y="${y}" font-family="${SANS}" font-size="${size}" font-weight="${weight}" fill="${fill}" letter-spacing="${ls}" text-anchor="${anchor}" opacity="${opacity}">${esc(s)}</text>`;
}

function lines(x, y, arr, o = {}) {
  const { lh = 1.3, ...rest } = o;
  const size = rest.size || 20;
  return arr.map((s, i) => t(x, y + i * size * lh, s, rest)).join("");
}

function glyph(name, x, y, size, color = INK, sw = 1.8) {
  const inner = ICONS[name].replaceAll("currentColor", color);
  return `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
}

function textWidth(s, size) {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.56;
  return w;
}

function chip(x, y, label, o = {}) {
  const { size = 19, h = 44, fill = "rgba(255,255,255,0.05)", stroke = "rgba(255,255,255,0.12)", color = INK, dot = null, glyphName = null } = o;
  const padX = 20;
  const innerW = textWidth(label, size);
  const iconW = glyphName ? size + 10 : dot ? 16 : 0;
  const w = innerW + iconW + padX * 2;
  let inner = "";
  if (glyphName) inner += glyph(glyphName, x + padX, y + (h - size) / 2, size, dot || BLUE, 1.9);
  if (dot) inner += `<circle cx="${x + padX + 4}" cy="${y + h / 2}" r="4" fill="${dot}"/>`;
  inner += t(x + padX + iconW, y + h / 2 + size * 0.36, label, { size, weight: 500, fill: color });
  return {
    svg: `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}"/>${inner}</g>`,
    width: w,
  };
}

function brand(x, y, size) {
  const s = size / 32;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#brand)"/>
    <path d="M10 21.5L20.5 11M13.5 10.5h7.8v7.8" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
}

function defs() {
  return `<defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3f7bff"/><stop offset="0.55" stop-color="#5b6bff"/><stop offset="1" stop-color="#8a5cff"/>
    </linearGradient>
    <linearGradient id="verText" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#cfe1ff"/><stop offset="0.5" stop-color="#8fb6ff"/><stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
    <linearGradient id="accentLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4f7cff" stop-opacity="0"/><stop offset="0.5" stop-color="#6d8dff"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cap" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b2438"/><stop offset="1" stop-color="#121a2b"/>
    </linearGradient>
    <linearGradient id="taskbar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#101827"/><stop offset="1" stop-color="#0b1220"/>
    </linearGradient>
    <radialGradient id="glowBlue" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#3b82f6" stop-opacity="0.42"/><stop offset="1" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowViolet" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#7c5cff" stop-opacity="0.38"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowCyan" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#22d3ee" stop-opacity="0.22"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="under" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#000000" stop-opacity="0.62"/><stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="shadow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#000000" stop-opacity="0.55"/><stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="72" height="72" patternUnits="userSpaceOnUse">
      <path d="M72 0H0V72" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/>
    </pattern>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="#ffffff" fill-opacity="0.09"/>
    </pattern>
    <filter id="blur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
  </defs>`;
}

function backdrop(w, h) {
  return `<rect width="${w}" height="${h}" fill="${BG}"/>
  <circle cx="${w * 0.18}" cy="${h * 0.12}" r="${w * 0.62}" fill="url(#glowBlue)"/>
  <circle cx="${w * 0.92}" cy="${h * 0.72}" r="${w * 0.6}" fill="url(#glowViolet)"/>
  <circle cx="${w * 0.05}" cy="${h * 0.9}" r="${w * 0.42}" fill="url(#glowCyan)"/>
  <rect width="${w}" height="${h}" fill="url(#grid)"/>`;
}

function header(w, y = 64, rightLabel = `v${VERSION}`) {
  return `<g>
    ${brand(84, y, 56)}
    ${t(158, y + 27, "启点", { size: 28, weight: 800 })}
    ${t(158, y + 48, "QIDIAN · LAUNCH DECK", { size: 11, weight: 500, fill: DIM, ls: 2.6 })}
    <g>
      <rect x="${w - 84 - 116}" y="${y + 12}" width="116" height="34" rx="17" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.12)"/>
      <circle cx="${w - 84 - 96}" cy="${y + 29}" r="3.5" fill="#46d38b"/>
      ${t(w - 84 - 84, y + 34, rightLabel, { size: 13, weight: 600, fill: "#cfdcf6" })}
    </g>
  </g>`;
}

/* ── 应用窗口 UI 模拟 ─────────────────────────────────── */
const TILES = [
  ["Visual Studio Code", "Microsoft", "dev", "#2f6feb", "code"],
  ["Cursor", "Anysphere", "dev", "#21252b", "code"],
  ["IntelliJ IDEA", "JetBrains", "dev", "#e8632c", "code"],
  ["Docker Desktop", "Docker Inc.", "dev", "#2496ed", "box"],
  ["Figma", "Figma", "design", "#a259ff", "palette"],
  ["Photoshop", "Adobe", "design", "#2d7ff9", "palette"],
  ["飞书", "字节跳动", "office", "#3370ff", "chat"],
  ["Microsoft Word", "Microsoft", "office", "#2b579a", "doc"],
  ["微信", "腾讯", "social", "#07a855", "chat"],
  ["Steam", "Valve", "game", "#1b2838", "gamepad"],
  ["Google Chrome", "Google", "network", "#3b82f6", "globe"],
  ["Microsoft Edge", "Microsoft", "network", "#0a9ca5", "globe"],
  ["火绒安全", "火绒", "security", "#e0632f", "shield"],
  ["7-Zip", "Igor Pavlov", "system", "#596b7d", "box"],
  ["Spotify", "Spotify AB", "media", "#17994a", "music"],
  ["Notion", "Notion Labs", "office", "#202124", "doc"],
  ["WPS Office", "金山办公", "office", "#d94a37", "doc"],
  ["钉钉", "阿里巴巴", "office", "#1677ff", "chat"],
  ["Blender", "Blender Foundation", "design", "#e86a17", "layers"],
  ["Illustrator", "Adobe", "design", "#e07b00", "palette"],
  ["PotPlayer", "Kakao", "media", "#3b4b63", "play"],
  ["网易云音乐", "网易", "media", "#cf3232", "music"],
  ["OBS Studio", "OBS Project", "media", "#2b2f36", "monitor"],
  ["剪映专业版", "字节跳动", "media", "#6d5df6", "sparkle"],
  ["Epic Games", "Epic Games", "game", "#31313a", "gamepad"],
  ["QQ", "腾讯", "social", "#0ea5e9", "chat"],
  ["Discord", "Discord Inc.", "social", "#5865f2", "chat"],
  ["百度网盘", "百度", "network", "#2468f2", "hard-drive"],
  ["PowerToys", "Microsoft", "system", "#6d4aff", "wrench"],
  ["Everything", "voidtools", "system", "#9a7b3f", "search"],
];

const CAT_COLORS = ["#2f6feb", "#2b7cd3", "#a259ff", "#e5533d", "#1f9d55", "#07c160", "#0ea5a5", "#d97706", "#8a8f98"];

function appWindow(x, y, w, clipH = null) {
  const h = (w * 780) / 1180;
  const k = w / 1180;
  const id = `win${Math.round(x)}_${Math.round(y)}`;
  const railW = 66 * k;
  const titleH = 46 * k;
  const pad = 18 * k;
  const mainX = x + railW;
  const mainW = w - railW;
  const cardGap = 12 * k;
  const cols = 5;
  const cardW = (mainW - pad * 2 - cardGap * (cols - 1)) / cols;
  const cardH = 86 * k;

  let tiles = "";
  TILES.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const tx = mainX + pad + col * (cardW + cardGap);
    const ty = y + titleH + 92 * k + row * (cardH + cardGap);
    if (row > 5) return;
    const [name, pub, cat, color, ic] = item;
    tiles += `<g>
      <rect x="${tx}" y="${ty}" width="${cardW}" height="${cardH}" rx="${12 * k}" fill="#ffffff" stroke="#e3e9f4"/>
      <rect x="${tx + 12 * k}" y="${ty + 13 * k}" width="${30 * k}" height="${30 * k}" rx="${9 * k}" fill="${color}"/>
      ${glyph(ic, tx + 18 * k, ty + 19 * k, 18 * k, "#ffffff", 1.7)}
      ${t(tx + 12 * k, ty + 58 * k, name, { size: 10.5 * k, weight: 700, fill: "#101828" })}
      ${t(tx + 12 * k, ty + 73 * k, pub, { size: 8.5 * k, weight: 400, fill: "#7b8aa3" })}
      <circle cx="${tx + cardW - 13 * k}" cy="${ty + 20 * k}" r="${3.4 * k}" fill="${CAT_COLORS[["dev","office","design","media","game","social","network","security","system"].indexOf(cat)] || "#8a8f98"}"/>
    </g>`;
  });

  let rail = `<rect x="${x}" y="${y + titleH}" width="${railW}" height="${h - titleH}" fill="#eef2f9"/>`;
  rail += `<rect x="${x + 13 * k}" y="${y + titleH + 14 * k}" width="${40 * k}" height="${30 * k}" rx="${9 * k}" fill="rgba(27,98,214,0.10)" stroke="rgba(27,98,214,0.22)"/>`;
  rail += glyph("grid", x + 23 * k, y + titleH + 21 * k, 20 * k, "#1b62d6", 1.9);
  rail += glyph("clock", x + 23 * k, y + titleH + 66 * k, 20 * k, "#8a97ad", 1.7);
  rail += glyph("star", x + 23 * k, y + titleH + 108 * k, 20 * k, "#8a97ad", 1.7);
  rail += `<line x1="${x + 15 * k}" y1="${y + titleH + 146 * k}" x2="${x + 51 * k}" y2="${y + titleH + 146 * k}" stroke="#dbe3f0"/>`;
  CAT_COLORS.forEach((c, i) => {
    rail += `<g><circle cx="${x + 23 * k}" cy="${y + titleH + 172 * k + i * 27 * k}" r="${4 * k}" fill="${c}"/>${i === 0 ? `<rect x="${x + 13 * k}" y="${y + titleH + 162 * k + i * 27 * k}" width="${40 * k}" height="${20 * k}" rx="${7 * k}" fill="rgba(27,98,214,0.08)" stroke="none"/>` : ""}</g>`;
  });

  const headerInner = `
    ${t(mainX + pad, y + titleH + 46 * k, "全部应用", { size: 21 * k, weight: 800, fill: "#0f172a" })}
    ${t(mainX + pad, y + titleH + 66 * k, "46 个应用 · 9 个分类 · 空闲零轮询", { size: 9 * k, weight: 400, fill: "#7b8aa3" })}
    <rect x="${mainX + mainW - pad - 246 * k}" y="${y + titleH + 26 * k}" width="${246 * k}" height="${32 * k}" rx="${10 * k}" fill="#ffffff" stroke="#dde5f2"/>
    ${glyph("search", mainX + mainW - pad - 234 * k, y + titleH + 35 * k, 14 * k, "#8a97ad", 1.9)}
    ${t(mainX + mainW - pad - 214 * k, y + titleH + 46 * k, "搜索应用、分类或发布者", { size: 8.6 * k, weight: 400, fill: "#98a5ba" })}
    <g>
      <rect x="${mainX + mainW - pad - 54 * k}" y="${y + titleH + 26 * k}" width="${26 * k}" height="${32 * k}" rx="${8 * k}" fill="#ffffff" stroke="#dde5f2"/>
      ${glyph("grid", mainX + mainW - pad - 46 * k, y + titleH + 35 * k, 12 * k, "#4f7cff", 2)}
    </g>`;

  return `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${clipH || h}" rx="${22 * k}"/></clipPath></defs>
  <ellipse cx="${x + w / 2}" cy="${y + h - 20}" rx="${w * 0.55}" ry="${h * 0.22}" fill="url(#shadow)"/>
  <g clip-path="url(#${id})">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${22 * k}" fill="#f6f8fd" stroke="#cfd9ea" stroke-width="1.2"/>
    <rect x="${x}" y="${y}" width="${w}" height="${titleH}" fill="#fbfcff"/>
    <line x1="${x}" y1="${y + titleH}" x2="${x + w}" y2="${y + titleH}" stroke="#e6ecf6"/>
    ${brand(x + 16 * k, y + 12 * k, 20 * k)}
    ${t(x + 44 * k, y + 29 * k, "启点", { size: 11 * k, weight: 700, fill: "#1c2740" })}
    <line x1="${x + 80 * k}" y1="${y + 15 * k}" x2="${x + 80 * k}" y2="${y + 31 * k}" stroke="#dfe6f2"/>
    ${t(x + 92 * k, y + 29 * k, "全部应用", { size: 9.5 * k, weight: 500, fill: "#68748c" })}
    ${glyph("minimize", x + w - 70 * k, y + 18 * k, 11 * k, "#8895aa", 1.8)}
    ${glyph("maximize", x + w - 46 * k, y + 18 * k, 11 * k, "#8895aa", 1.8)}
    ${glyph("close", x + w - 22 * k, y + 18 * k, 11 * k, "#8895aa", 1.8)}
    ${rail}
    ${headerInner}
    ${tiles}
    <line x1="${mainX + pad}" y1="${y + h - 26 * k}" x2="${x + w - pad}" y2="${y + h - 26 * k}" stroke="#e6ecf6"/>
    ${t(mainX + pad, y + h - 10 * k, "本地索引 · 无遥测 · 空闲不轮询", { size: 8 * k, weight: 400, fill: "#98a5ba" })}
  </g>`;
}

/* ── 设置面板片段 ─────────────────────────────────────── */
function panelFrame(x, y, w, h, inner, darkInner = false) {
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.10)"/>
    <rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${h - 24}" rx="12" fill="${darkInner ? "#0b1220" : "#f6f8fd"}" stroke="${darkInner ? "rgba(255,255,255,0.06)" : "#d8e2f1"}"/>
    <g transform="translate(${x + 12} ${y + 12})">${inner}</g>
  </g>`;
}

function settingsHead(w, title, activeTab, sub) {
  const tabs = ["外观", "分类", "扫描", "启动", "插件", "更新", "关于"];
  let tabSvg = "";
  let cx = 18;
  tabs.forEach((tab) => {
    const tw = textWidth(tab, 10.5) + 20;
    const on = tab === activeTab;
    tabSvg += `<g><rect x="${cx}" y="42" width="${tw}" height="22" rx="7" fill="${on ? "rgba(27,98,214,0.10)" : "transparent"}"/>${t(cx + 10, 57, tab, { size: 10.5, weight: on ? 700 : 500, fill: on ? "#1b62d6" : "#7b8aa3" })}</g>`;
    cx += tw + 2;
  });
  return `<rect x="0" y="0" width="${w}" height="76" fill="#fbfcff"/>
    ${t(18, 26, title, { size: 15, weight: 800, fill: "#101828" })}
    ${t(18, 39, sub, { size: 8.5, weight: 400, fill: "#8a97ad" })}
    ${tabSvg}
    <line x1="0" y1="76" x2="${w}" y2="76" stroke="#e6ecf6"/>`;
}

function backgroundMock(w, h) {
  let rows = "";
  const items = [
    ["微信", "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe", true],
    ["Steam", "C:\\Program Files (x86)\\Steam\\steam.exe", false],
    ["火绒安全", "C:\\Program Files\\Huorong\\Sysdiag\\HipsMain.exe", true],
  ];
  items.forEach(([name, cmd, on], i) => {
    const y = 96 + i * 58;
    rows += `<g>
      <rect x="16" y="${y}" width="${w - 32}" height="48" rx="10" fill="#ffffff" stroke="#e3e9f4"/>
      ${t(30, y + 20, name, { size: 11.5, weight: 700, fill: "#1c2740" })}
      ${t(30, y + 36, cmd, { size: 7.6, weight: 400, fill: "#8a97ad" })}
      <rect x="${w - 74}" y="${y + 13}" width="40" height="22" rx="11" fill="${on ? "#1b62d6" : "#dfe6f2"}"/>
      <circle cx="${w - 54 + (on ? 10 : -10)}" cy="${y + 24}" r="8" fill="#ffffff"/>
      ${t(w - 100, y + 20, on ? "已启用" : "已禁用", { size: 8, weight: 500, fill: on ? "#1b62d6" : "#8a97ad", anchor: "end" })}
    </g>`;
  });
  return `<g>${settingsHead(w, "设置", "后台", "外观、分类、扫描、后台、性能、启动与版本更新")}
    ${t(18, 92, "自启动管理", { size: 10, weight: 700, fill: "#4b576e" })}${rows}</g>`;
}

function performanceMock(w, h) {
  const metrics = [
    ["内存占用", "62%", "#4f7cff", "12.4 / 20 GB"],
    ["系统盘", "68%", "#7c5cff", "剩余 96 GB"],
    ["电源计划", "均衡", "#0ea5a5", "当前生效"],
    ["自启动项", "12 / 18", "#d97706", "6 项已关闭"],
  ];
  let cards = "";
  metrics.forEach(([label, value, color, sub], i) => {
    const cw = (w - 44) / 4;
    const cx = 16 + i * (cw + 4);
    cards += `<g><rect x="${cx}" y="88" width="${cw}" height="76" rx="10" fill="#ffffff" stroke="#e3e9f4"/>
      <rect x="${cx + 12}" y="100" width="4" height="14" rx="2" fill="${color}"/>
      ${t(cx + 22, 111, label, { size: 8.4, weight: 500, fill: "#7b8aa3" })}
      ${t(cx + 12, 138, value, { size: 20, weight: 800, fill: "#101828" })}
      ${t(cx + 12, 154, sub, { size: 7.6, weight: 400, fill: "#98a5ba" })}
    </g>`;
  });
  let rows = "";
  const cats = [
    ["用户临时文件", "1.24 GB", "2,184 个文件"],
    ["DirectX 着色器缓存", "486 MB", "913 个文件"],
    ["Windows 错误报告", "72 MB", "38 个文件"],
  ];
  cats.forEach(([name, size, count], i) => {
    const y = 178 + i * 33;
    rows += `<g>
      <rect x="16" y="${y}" width="${w - 32}" height="29" rx="8" fill="#ffffff" stroke="#e3e9f4"/>
      <rect x="26" y="${y + 8.5}" width="12" height="12" rx="4" fill="#1b62d6"/>
      ${glyph("check", 27.5, y + 10, 9, "#ffffff", 2.4)}
      ${t(48, y + 19, name, { size: 9.2, weight: 600, fill: "#1c2740" })}
      ${t(w - 34, y + 19, `${size} · ${count}`, { size: 8.4, weight: 500, fill: "#7b8aa3", anchor: "end" })}
    </g>`;
  });
  return `<g>${settingsHead(w, "设置", "性能", "按需安装 · 只在本机运行 · 可随时卸载")}
    ${cards}${rows}</g>`;
}

function healthMock(w, h) {
  const cx = 60;
  const cy = 62;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - 0.86);
  const issues = [
    ["内存压力偏高", "已用 82%，可以关掉不用的后台应用", "#d97706"],
    ["开机自启动偏多", "8 / 10 项随登录启动，可按需关闭", "#d97706"],
  ];
  let rows = "";
  issues.forEach(([title, detail, color], index) => {
    const y = 80 + index * 44;
    rows += `<g>
      <rect x="112" y="${y}" width="${w - 132}" height="38" rx="8" fill="#f7f9fd" stroke="#e9eef7"/>
      <circle cx="126" cy="${y + 13}" r="3" fill="${color}"/>
      ${t(138, y + 14, title, { size: 9.6, weight: 700, fill: "#1c2740" })}
      ${t(138, y + 28, detail, { size: 7.8, weight: 400, fill: "#8a97ad" })}
    </g>`;
  });
  const trend = [
    [20, 246], [86, 238], [152, 242], [218, 226], [284, 232], [350, 216],
    [416, 222], [482, 206], [548, 212], [614, 196], [680, 202], [746, 188],
    [812, 194], [860, 182],
  ];
  const line = trend.map(([x, y]) => `${x},${y}`).join(" ");
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#e8eef8" stroke-width="7"/>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#1b62d6" stroke-width="7"
      stroke-linecap="round" stroke-dasharray="${circumference.toFixed(1)}"
      stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
    ${t(cx, cy + 9, "86", { size: 27, weight: 800, fill: "#101828", anchor: "middle" })}
    ${t(112, 42, "状态不错", { size: 19, weight: 800, fill: "#101828" })}
    ${t(112, 58, "性能体检 · 按本机即时数据计算", { size: 8.6, weight: 400, fill: "#8a97ad" })}
    ${rows}
    ${t(18, 170, "累计清理 12.4 GB", { size: 10.5, weight: 700, fill: "#1c2740" })}
    ${t(18, 186, "23 次 · 上次清理 2 小时前", { size: 8, weight: 400, fill: "#8a97ad" })}
    <line x1="18" y1="200" x2="${w - 18}" y2="200" stroke="#e9eef7"/>
    <polygon points="20,260 ${line} 860,260" fill="rgba(27,98,214,0.08)"/>
    <polyline points="${line}" fill="none" stroke="#1b62d6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="860" cy="182" r="3.2" fill="#1b62d6"/>
    ${t(18, 274, "内存趋势 · 最近 14 次采样", { size: 8, weight: 400, fill: "#98a5ba" })}
  </g>`;
}

function pluginsMock(w, h) {
  const modules = [
    ["后台管理", "自启动 · 进程 · 用途说明", true],
    ["电脑性能优化", "体检 · 清理 · 电源 · DNS", true],
    ["内存管理", "智能阈值 · 动态档位", false],
    ["启动与托盘", "托盘 · 快捷键 · 自启动", false],
  ];
  let rows = "";
  modules.forEach(([name, desc, on], i) => {
    const y = 104 + i * 58;
    rows += `<g>
      <rect x="16" y="${y}" width="${w - 32}" height="48" rx="10" fill="#ffffff" stroke="#e3e9f4"/>
      <rect x="28" y="${y + 10}" width="28" height="28" rx="9" fill="${on ? "rgba(27,98,214,0.10)" : "#eef2f8"}"/>
      ${glyph("box", 36, y + 18, 12, on ? "#1b62d6" : "#8a97ad")}
      ${t(66, y + 21, name, { size: 11.5, weight: 700, fill: "#1c2740" })}
      ${t(66, y + 38, desc, { size: 8.2, weight: 400, fill: "#8a97ad" })}
      ${t(w - 30, y + 21, on ? "已安装" : "未安装", {
        size: 8.4,
        weight: 600,
        fill: on ? "#1b62d6" : "#8a97ad",
        anchor: "end",
      })}
      ${t(w - 30, y + 37, on ? "可卸载" : "安装后生效", {
        size: 7.6,
        weight: 400,
        fill: "#a3aec2",
        anchor: "end",
      })}
    </g>`;
  });
  return `<g>${settingsHead(w, "设置", "插件", "启动应用内置 · 其余功能按需安装")}
    ${t(18, 95, "已安装 2/4 · 卸载后释放常驻占用", { size: 9, weight: 600, fill: "#4b576e" })}${rows}</g>`;
}

function memoryMock(w, h) {
  const metrics = [
    ["系统内存", "58%", "13.4 GB 可用", "#4f7cff"],
    ["启点工作集", "72 MB", "私有 95 MB", "#7c5cff"],
    ["当前档位", "低占用", "自动 · 系统通知", "#0ea5a5"],
    ["上次调节", "手动释放", "释放 60 MB", "#d97706"],
  ];
  let cards = "";
  metrics.forEach(([label, value, sub, color], i) => {
    const cw = (w - 44) / 4;
    const cx = 16 + i * (cw + 4);
    cards += `<g><rect x="${cx}" y="88" width="${cw}" height="76" rx="10" fill="#ffffff" stroke="#e3e9f4"/>
      <rect x="${cx + 12}" y="100" width="4" height="14" rx="2" fill="${color}"/>
      ${t(cx + 22, 111, label, { size: 8.4, weight: 500, fill: "#7b8aa3" })}
      ${t(cx + 12, 138, value, { size: 20, weight: 800, fill: "#101828" })}
      ${t(cx + 12, 154, sub, { size: 7.6, weight: 400, fill: "#98a5ba" })}
    </g>`;
  });
  const modes = [
    ["自动", true],
    ["自定义", false],
    ["手动", false],
  ];
  let modeSvg = "";
  let mx = 16;
  modes.forEach(([label, active]) => {
    const mw = textWidth(label, 9.4) + 28;
    modeSvg += `<g><rect x="${mx}" y="178" width="${mw}" height="28" rx="9" fill="${active ? "rgba(27,98,214,0.10)" : "#ffffff"}" stroke="${active ? "rgba(27,98,214,0.30)" : "#e3e9f4"}"/>
      ${t(mx + mw / 2, 196, label, { size: 9.4, weight: active ? 700 : 500, fill: active ? "#1b62d6" : "#7b8aa3", anchor: "middle" })}</g>`;
    mx += mw + 8;
  });
  return `<g>${settingsHead(w, "设置", "内存", "自动、自定义、手动三种内存管理方式")}
    ${cards}${modeSvg}
    ${t(16, 230, "降档 85% · 恢复 60% · 至少保留 5% 间隔", { size: 8.6, weight: 400, fill: "#7b8aa3" })}
    ${t(w - 16, 230, "系统通知触发 · 不做定时轮询", { size: 8.6, weight: 500, fill: "#1b62d6", anchor: "end" })}
    <line x1="16" y1="246" x2="${w - 16}" y2="246" stroke="#e6ecf6"/>
    ${t(16, 264, "上次调节：手动释放 · 释放 60 MB 工作集", { size: 8.4, weight: 400, fill: "#98a5ba" })}
  </g>`;
}

function updatesMock(w, h, version, date, list) {
  let items = "";
  list.forEach(([title, desc], i) => {
    const y = 130 + i * 50;
    items += `<g>
      <rect x="16" y="${y}" width="${w - 32}" height="44" rx="10" fill="#ffffff" stroke="#e3e9f4"/>
      <circle cx="34" cy="${y + 22}" r="8.5" fill="rgba(27,98,214,0.10)"/>
      ${glyph("check", 28.5, y + 16.5, 11, "#1b62d6", 2.2)}
      ${t(52, y + 19, title, { size: 10.4, weight: 700, fill: "#1c2740" })}
      ${t(52, y + 34, desc, { size: 8.3, weight: 400, fill: "#8a97ad" })}
    </g>`;
  });
  return `<g>${settingsHead(w, "设置", "更新", "当前版本、构建日期、更新公告与历史版本")}
    <rect x="16" y="88" width="${w - 32}" height="32" rx="9" fill="rgba(27,98,214,0.07)" stroke="rgba(27,98,214,0.18)"/>
    ${t(30, 109, `v${version}`, { size: 14, weight: 800, fill: "#1b62d6" })}
    ${t(104, 108, `当前版本 · ${date} · 构建通过`, { size: 8.4, weight: 400, fill: "#6b7890" })}
    ${items}</g>`;
}

function trayMock(w, h) {
  const cap = (x, label, cw) =>
    `<g><rect x="${x}" y="48" width="${cw}" height="54" rx="13" fill="url(#cap)" stroke="rgba(255,255,255,0.16)"/>
     ${t(x + cw / 2, 82, label, { size: 18, weight: 700, fill: "#dfe9ff", anchor: "middle" })}</g>`;
  const keycaps =
    cap(30, "Ctrl", 98) +
    t(138, 83, "+", { size: 20, weight: 500, fill: DIM, anchor: "middle" }) +
    cap(154, "Alt", 86) +
    t(250, 83, "+", { size: 20, weight: 500, fill: DIM, anchor: "middle" }) +
    cap(266, "Q", 74);
  const apps = [
    ["#2f6feb", "globe"],
    ["#07a855", "chat"],
    ["#d96a1e", "palette"],
    ["#7c5cff", "gamepad"],
  ];
  let appIcons = "";
  apps.forEach(([c, ic], i) => {
    appIcons += `<rect x="${286 + i * 44}" y="${196}" width="28" height="28" rx="8" fill="${c}" opacity="0.9"/>
      ${glyph(ic, 293 + i * 44, 203, 14, "#ffffff", 1.8)}`;
  });
  return `<g>
    ${t(30, 28, "系统托盘常驻 · 一键唤出", { size: 11, weight: 600, fill: "#93a2bd" })}
    ${keycaps}
    ${t(30, 136, "任何程序里按下，都能打开启点", { size: 9.6, weight: 400, fill: DIM })}
    <g>
      <rect x="${w - 300}" y="34" width="270" height="104" rx="14" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.10)"/>
      <rect x="${w - 282}" y="52" width="30" height="30" rx="9" fill="rgba(79,124,255,0.2)" stroke="rgba(111,146,255,0.4)"/>
      ${glyph("eye-off", w - 274, 59, 15, "#9ec5ff", 1.8)}
      ${t(w - 240, 72, "启点已隐藏到托盘", { size: 10.4, weight: 600, fill: "#dbe6fa" })}
      ${t(w - 282, 102, "关窗不退出，点击图标或按快捷键", { size: 8.4, weight: 400, fill: "#8291ab" })}
      ${t(w - 282, 120, "Ctrl + Alt + Q 随时唤回。", { size: 8.4, weight: 400, fill: "#8291ab" })}
    </g>
    <g>
      <rect x="30" y="${164}" width="${w - 60}" height="92" rx="14" fill="url(#taskbar)" stroke="rgba(255,255,255,0.08)"/>
      ${glyph("grid", 48, 196, 22, "#8fa0bd", 1.6)}
      <rect x="88" y="186" width="150" height="44" rx="12" fill="rgba(255,255,255,0.05)"/>
      ${glyph("search", 104, 200, 16, "#7f8fae", 1.8)}
      ${t(128, 214, "搜索", { size: 10, weight: 400, fill: "#7f8fae" })}
      ${appIcons}
      <g>
        <rect x="${w - 112}" y="184" width="46" height="46" rx="12" fill="rgba(79,124,255,0.22)" stroke="rgba(111,146,255,0.55)"/>
        ${brand(w - 106, 190, 34)}
      </g>
      <rect x="${w - 84}" y="198" width="24" height="16" rx="5" fill="rgba(255,255,255,0.07)"/>
    </g>
  </g>`;
}

/* ── 宣传图（9:16） ───────────────────────────────────── */
function appPoster9x16() {
  const W = 1080, H = 1920, m = 84;
  const chips = [
    { label: "原生 Tauri", glyphName: "zap" },
    { label: "3.9 MB", glyphName: "hard-drive" },
    { label: "零后台轮询", glyphName: "cpu" },
    { label: "托盘 + 快捷键", glyphName: "power" },
  ];
  let cx = m;
  let chipSvg = "";
  chips.forEach((c) => {
    const r = chip(cx, 1298, c.label, { ...c, size: 18 });
    chipSvg += r.svg;
    cx += r.width + 12;
  });

  const features = [
    ["layers", "自动整理", ["扫描开始菜单、注册表与", "Store，按分类排好。"]],
    ["arrow-up-right", "一点即开", ["双击或回车启动，", "图标按需提取并缓存。"]],
    ["eye-off", "常驻不打扰", ["关窗进托盘，空闲零轮询，", "不占 CPU。"]],
  ];
  let featureSvg = "";
  features.forEach(([ic, title, desc], i) => {
    const x = m + i * 312;
    featureSvg += `<g>
      <rect x="${x}" y="1392" width="260" height="188" rx="20" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.09)"/>
      <rect x="${x + 22}" y="1416" width="40" height="40" rx="12" fill="rgba(79,124,255,0.16)" stroke="rgba(111,146,255,0.30)"/>
      ${glyph(ic, x + 32, 1426, 20, "#7ea2ff", 1.9)}
      ${t(x + 22, 1492, title, { size: 24, weight: 700 })}
      ${lines(x + 22, 1528, desc, { size: 16, fill: MUTED, lh: 1.55 })}
    </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs()}
    ${backdrop(W, H)}
    ${header(W)}
    <g>
      ${t(m, 214, "WINDOWS 原生应用启动台", { size: 13, weight: 600, fill: "#7ea2ff", ls: 4.2 })}
      ${lines(m, 330, ["把桌面，", "收进一个窗口。"], { size: 92, weight: 900, lh: 1.14 })}
      ${t(m, 476, "自动扫描本机全部软件，按分类排好；双击即开，关窗进托盘。", { size: 25, weight: 400, fill: MUTED })}
      ${t(m, 516, "不驻留服务、不联网、不读文件内容。", { size: 25, weight: 400, fill: MUTED })}
    </g>
    ${appWindow(60, 590, 960)}
    ${chipSvg}
    ${featureSvg}
    <g>
      <line x1="${m}" y1="1660" x2="${W - m}" y2="1660" stroke="url(#accentLine)"/>
      ${t(m, 1712, "Windows 10 / 11 · 无需浏览器内核 · 数据只在本机", { size: 19, weight: 500, fill: "#b9c6dd" })}
      ${t(W - m, 1712, "v0.5.0 · 2026-10-25", { size: 15, weight: 500, fill: DIM, anchor: "end" })}
      ${t(m, 1810, "启点 · QiDian", { size: 30, weight: 800 })}
      ${t(W - m, 1810, "Ctrl + Alt + Q", { size: 18, weight: 600, fill: "#8fb6ff", anchor: "end", ls: 1.2 })}
    </g>
  </svg>`;
}

/* ── 宣传图（3:4） ────────────────────────────────────── */
function appPoster3x4() {
  const W = 1080, H = 1440, m = 84;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs()}
    ${backdrop(W, H)}
    ${header(W)}
    ${t(m, 196, "WINDOWS 原生应用启动台", { size: 13, weight: 600, fill: "#7ea2ff", ls: 4.2 })}
    ${t(m, 300, "把桌面，收进一个窗口。", { size: 76, weight: 900 })}
    ${lines(m, 352, ["自动扫描、自动分类、双击即开；关窗只是收进托盘。", "空闲零轮询，不驻留后台服务。"], { size: 22, fill: MUTED, lh: 1.5 })}
    ${appWindow(60, 444, 960, 762)}
    ${chip(84, 1240, "原生 Tauri", { glyphName: "zap", size: 17 }).svg}
    ${chip(276, 1240, "3.9 MB", { glyphName: "hard-drive", size: 17 }).svg}
    ${chip(438, 1240, "零后台轮询", { glyphName: "cpu", size: 17 }).svg}
    ${t(W - 84, 1270, "v0.5.0", { size: 17, weight: 600, fill: "#8fb6ff", anchor: "end", ls: 1 })}
    <line x1="${m}" y1="1320" x2="${W - m}" y2="1320" stroke="url(#accentLine)"/>
    ${t(m, 1362, "启点 · 轻量应用启动台", { size: 20, weight: 600, fill: "#b9c6dd" })}
    ${t(W - m, 1362, "Windows 10 / 11 · 本地数据 · 无遥测", { size: 14, weight: 400, fill: DIM, anchor: "end" })}
  </svg>`;
}

/* ── 版本公告卡（3:4） ────────────────────────────────── */
const RELEASES = [
  {
    version: "0.1.0",
    index: "01",
    date: "2026-10-24",
    title: "第一个可用版本",
    sub: "扫描、分类、搜索、启动，一次打通。",
    bullets: [
      ["扫描三源", "开始菜单、卸载注册表、Microsoft Store"],
      ["自动分类", "拖拽归类、右键移动，内置九大分类"],
      ["找得快", "搜索、最近使用、常用固定、Alt + 1–9"],
      ["双主题", "Miuix 与 Windows 11 规范，明暗模式可切"],
    ],
    visual: "window",
  },
  {
    version: "0.2.0",
    index: "02",
    date: "2026-10-25",
    title: "从能用到好用",
    sub: "安装、更新、图标，都补成了正式形态。",
    bullets: [
      ["标准安装 / 卸载", "目录选择、开始菜单入口、系统卸载项"],
      ["真实名称与图标", "从 Shell 与注册表读取，不再自己造"],
      ["自动刷新索引", "6 / 12 / 24 小时或 7 天，仅打开时检查"],
      ["低内存 + 公告页", "最小化请求低内存模式，更新记录可回看"],
    ],
    visual: "updates",
  },
  {
    version: "0.3.0",
    index: "03",
    date: "2026-10-25",
    title: "后台，交给你管",
    sub: "哪些能自启动、哪些该结束，一眼看懂。",
    bullets: [
      ["自启动管理", "当前用户的启动项一键启用或禁用"],
      ["进程按应用分组", "显示内存合计，整组或单个结束"],
      ["小白说明", "每个进程写明用途，标注风险等级"],
      ["保护与确认", "关键进程禁止结束，误触要二次确认"],
    ],
    visual: "background",
  },
  {
    version: "0.4.0",
    index: "04",
    date: "2026-10-25",
    title: "按需安装的性能模块",
    sub: "要体检、要清理时才装，不用就卸。",
    bullets: [
      ["系统体检", "内存、系统盘、电源计划、启动项统计"],
      ["临时文件清理", "按 7 / 30 / 90 天保留期精确扫描"],
      ["一键安全清理", "只清临时文件与着色器缓存，并刷新 DNS"],
      ["电源与网络", "省电 / 均衡 / 高性能切换，DNS 一键刷新"],
    ],
    visual: "performance",
  },
  {
    version: "0.5.0",
    index: "05",
    date: "2026-10-25",
    title: "关掉窗口，也找得到",
    sub: "托盘常驻、快捷键唤出、开机静默启动。",
    bullets: [
      ["系统托盘", "关闭窗口只是隐藏，右键可显示或退出"],
      ["全局快捷键", "Ctrl + Alt + Q，任何程序里都能唤出"],
      ["开机自启动", "登录后静默进托盘，不弹主窗口"],
      ["单实例", "重复打开只聚焦已有窗口，不占两份内存"],
    ],
    visual: "tray",
  },
  {
    version: "0.6.0",
    index: "06",
    date: "2026-10-25",
    title: "内存，按你的偏好调",
    sub: "自动、自定义、手动，三种方式管理启点自身占用。",
    bullets: [
      ["三种模式", "系统通知自动调节、自定义阈值、手动固定档位"],
      ["策略与阈值", "轻度 / 均衡 / 激进预设，阈值保留 5% 间隔"],
      ["真实记录", "工作集、累计释放量、调节记录与应用排行"],
      ["只管自己", "不结束其他应用，不强制系统回收内存"],
    ],
    visual: "memory",
  },
  {
    version: "0.7.0",
    index: "07",
    date: "2026-10-25",
    title: "功能按需装，占用随时还",
    sub: "启动应用内置，其余能力拆成可装卸插件。",
    bullets: [
      ["核心保持轻", "启动、扫描与分类始终内置，不依赖插件"],
      ["四个可选插件", "后台管理、性能优化、内存管理、启动与托盘"],
      ["顶部标签直达", "后台、性能、内存装完就上主界面顶部"],
      ["启动留在设置", "托盘、快捷键与开机自启动在设置 › 启动里"],
    ],
    visual: "plugins",
  },
  {
    version: "0.8.0",
    index: "08",
    date: "2026-10-25",
    title: "内存更稳，体检更清楚",
    sub: "自动降档更可靠，残留与启动项一眼看清。",
    bullets: [
      ["自动档位", "低内存通知直接降档，15 秒冷却防抖"],
      ["隐藏即挂起", "窗口隐藏时挂起 WebView2，显示前恢复"],
      ["体检评分", "0–100 分与问题清单，按本机数据计算"],
      ["残留清理", "应用管理找出卸载残留，核对引用后确认删除"],
    ],
    visual: "health",
  },
];

function releaseCard(rel) {
  const W = 1080, H = 1440;
  let bullets = "";
  rel.bullets.forEach(([title, desc], i) => {
    const y = 520 + i * 106;
    bullets += `<g>
      <circle cx="95" cy="${y}" r="11" fill="rgba(79,124,255,0.16)" stroke="rgba(111,146,255,0.35)"/>
      <circle cx="95" cy="${y}" r="3.6" fill="#8fb6ff"/>
      ${t(130, y + 9, title, { size: 26, weight: 700 })}
      ${t(130, y + 38, desc, { size: 18, weight: 400, fill: MUTED })}
      ${i < rel.bullets.length - 1 ? `<line x1="130" y1="${y + 62}" x2="${W - 84}" y2="${y + 62}" stroke="rgba(255,255,255,0.06)"/>` : ""}
    </g>`;
  });

  let visual = "";
  const vx = 80, vy = 1012, vw = 920, vh = 300, innerW = vw - 24, innerH = vh - 24;
  if (rel.visual === "window") {
    visual = panelFrame(vx, vy, vw, vh, `<g clip-path="url(#innerClip)">${appWindow(0, -8, innerW, innerH + 8)}</g>`);
    visual = `<defs><clipPath id="innerClip"><rect x="0" y="0" width="${innerW}" height="${innerH}" rx="12"/></clipPath></defs>` + visual;
  } else if (rel.visual === "updates") {
    visual = panelFrame(
      vx,
      vy,
      vw,
      vh,
      updatesMock(innerW, innerH, rel.version, rel.date, [
        ["标准安装 / 卸载程序", "支持目录选择与系统卸载项"],
        ["真实名称与图标", "从 Shell 与注册表读取"],
        ["自动刷新索引", "6 / 12 / 24 小时或 7 天"],
      ]),
    );
  } else if (rel.visual === "background") {
    visual = panelFrame(vx, vy, vw, vh, backgroundMock(innerW, innerH));
  } else if (rel.visual === "performance") {
    visual = panelFrame(vx, vy, vw, vh, performanceMock(innerW, innerH));
  } else if (rel.visual === "memory") {
    visual = panelFrame(vx, vy, vw, vh, memoryMock(innerW, innerH));
  } else if (rel.visual === "plugins") {
    visual = panelFrame(vx, vy, vw, vh, pluginsMock(innerW, innerH));
  } else if (rel.visual === "health") {
    visual = panelFrame(vx, vy, vw, vh, healthMock(innerW, innerH));
  } else {
    visual = panelFrame(vx, vy, vw, vh, trayMock(innerW, innerH), true);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs()}
    ${backdrop(W, H)}
    ${brand(84, 60, 44)}
    ${t(144, 84, "启点 · 版本更新", { size: 20, weight: 700 })}
    ${t(144, 103, "RELEASE NOTES", { size: 10, weight: 500, fill: DIM, ls: 2.6 })}

    ${t(84, 292, `v${rel.version}`, { size: 118, weight: 900, fill: "url(#verText)", ls: -2 })}
    <line x1="84" y1="322" x2="${W - 84}" y2="322" stroke="url(#accentLine)"/>
    ${t(84, 390, rel.title, { size: 50, weight: 900 })}
    ${t(84, 430, rel.sub, { size: 21, weight: 400, fill: MUTED })}
    ${bullets}
    ${visual}
    <line x1="84" y1="1348" x2="${W - 84}" y2="1348" stroke="rgba(255,255,255,0.08)"/>
    ${t(84, 1388, "完整公告：CHANGELOG.md · 覆盖安装即可升级", { size: 13, weight: 400, fill: DIM })}
    ${t(W - 84, 1388, "QIDIAN · WINDOWS 10 / 11", { size: 11, weight: 500, fill: DIM, anchor: "end", ls: 1.4 })}
  </svg>`;
}

/* ── 重点功能卡（3:4） ────────────────────────────────── */

const HIGHLIGHTS = {
  "0.5.0": [
    {
      tag: "系统托盘",
      title: ["关掉窗口，", "不等于退出。"],
      sub: "关闭只是收起，托盘里继续待命。",
      bullets: [
        ["关闭按钮改为隐藏", "进程与托盘图标保留，不再直接退出"],
        ["左键唤回窗口", "右键菜单可显示、隐藏或彻底退出"],
        ["托盘不可用会降级", "关闭恢复为直接退出，并在启动页标注"],
      ],
      visual: "tray",
    },
    {
      tag: "全局快捷键",
      title: ["任何程序里，", "按一下就回来。"],
      sub: "Ctrl + Alt + Q，系统级注册。",
      bullets: [
        ["前台按下收起", "不用离开当前工作流就能让出屏幕"],
        ["隐藏时唤出并聚焦", "最小化或后台状态同样有效"],
        ["被占用会明确提示", "不静默失败，托盘图标仍可操作"],
      ],
      visual: "hotkey",
    },
    {
      tag: "开机自启动",
      title: ["开机就在，", "但不打扰。"],
      sub: "登录后静默进托盘，不弹主窗口。",
      bullets: [
        ["只写当前用户注册表", "不需要管理员权限，不改系统级配置"],
        ["登录后静默启动", "不抢焦点、不打断开机流程"],
        ["升级自动修正路径", "卸载时清理 Run 项与启用状态"],
      ],
      visual: "boot",
    },
  ],
};

function keycap(x, y, w, h, label) {
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="url(#cap)" stroke="rgba(255,255,255,0.18)"/>
    <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h * 0.32}" rx="12" fill="rgba(255,255,255,0.045)"/>
    ${t(x + w / 2, y + h * 0.66, label, { size: Math.round(h * 0.26), weight: 700, fill: "#e6eeff", anchor: "middle" })}
  </g>`;
}

function featureVisual(kind) {
  if (kind === "tray") {
    const chips = [
      chip(38, 352, "关闭 ≠ 退出", { size: 15, h: 38, glyphName: "eye-off" }),
      chip(196, 352, "左键唤回", { size: 15, h: 38, glyphName: "arrow-up-right" }),
      chip(326, 352, "右键菜单", { size: 15, h: 38, glyphName: "more" }),
    ];
    return `<g>
      ${t(38, 46, "关闭按钮 = 隐藏到托盘", { size: 15, weight: 600, fill: "#93a2bd" })}
      <g transform="translate(38 86)">
        <rect width="320" height="212" rx="16" fill="#f6f8fd" stroke="#c9d4e6"/>
        <rect width="320" height="38" rx="16" fill="#fbfcff"/>
        <rect y="22" width="320" height="16" fill="#fbfcff"/>
        ${brand(14, 9, 20)}
        ${t(42, 25, "启点", { size: 10, weight: 700, fill: "#1c2740" })}
        <circle cx="292" cy="19" r="13" fill="#fff1f2" stroke="#ef9aa4"/>
        ${glyph("close", 286, 13, 11, "#e5484d", 2)}
        ${[[16, 54], [170, 54], [16, 126], [170, 126]]
          .map(([x, y], i) =>
            `<g><rect x="${x}" y="${y}" width="134" height="60" rx="10" fill="#ffffff" stroke="#e3e9f4"/>
             <rect x="${x + 10}" y="${y + 10}" width="24" height="24" rx="7" fill="${["#2f6feb", "#a259ff", "#07a855", "#d96a1e"][i]}"/>
             ${glyph(["code", "palette", "chat", "play"][i], x + 15, y + 15, 14, "#ffffff", 1.8)}
             <rect x="${x + 10}" y="${y + 40}" width="72" height="6" rx="3" fill="#dbe3f0"/>
             <rect x="${x + 10}" y="${y + 50}" width="48" height="5" rx="2.5" fill="#e8edf6"/></g>`,
          )
          .join("")}
      </g>
      <g>
        <line x1="382" y1="192" x2="486" y2="192" stroke="#6d8dff" stroke-width="2.4"/>
        <path d="M476 184l12 8-12 8" fill="none" stroke="#6d8dff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        ${t(434, 172, "关闭", { size: 12, weight: 500, fill: "#93a2bd", anchor: "middle" })}
      </g>
      <g transform="translate(520 86)">
        <rect width="360" height="212" rx="16" fill="#0d1424" stroke="rgba(255,255,255,0.10)"/>
        ${t(18, 28, "系统托盘", { size: 11, weight: 600, fill: "#93a2bd" })}
        ${t(18, 46, "图标仍在运行", { size: 9, weight: 400, fill: "#5f6e8a" })}
        <rect x="196" y="62" width="146" height="28" rx="8" fill="#16203a" stroke="rgba(255,255,255,0.12)"/>
        ${t(210, 81, "启点 · 已隐藏", { size: 9, weight: 500, fill: "#cfdcf6" })}
        <rect x="18" y="126" width="324" height="66" rx="12" fill="url(#taskbar)" stroke="rgba(255,255,255,0.08)"/>
        ${glyph("grid", 32, 148, 16, "#8fa0bd", 1.6)}
        <rect x="58" y="140" width="86" height="38" rx="9" fill="rgba(255,255,255,0.05)"/>
        ${t(72, 164, "搜索", { size: 8, weight: 400, fill: "#7f8fae" })}
        ${["#2f6feb", "#07a855", "#d96a1e"].map((c, i) => `<rect x="${162 + i * 32}" y="148" width="22" height="22" rx="6" fill="${c}" opacity="0.85"/>`).join("")}
        <rect x="282" y="134" width="48" height="48" rx="12" fill="rgba(79,124,255,0.24)" stroke="rgba(111,146,255,0.6)"/>
        ${brand(288, 140, 36)}
        ${t(18, 110, "左键唤回 · 右键菜单", { size: 8.6, weight: 400, fill: "#5f6e8a" })}
      </g>
      ${chips.map((c) => c.svg).join("")}
      ${t(38, 438, "窗口从任务栏消失，进程继续驻留；左键图标或按 Ctrl+Alt+Q 即可回来。", { size: 14, weight: 400, fill: MUTED })}
    </g>`;
  }

  if (kind === "hotkey") {
    const items = ["前台按下收起", "隐藏时唤出", "被占用会提示"];
    const icons = ["minimize", "arrow-up-right", "info"];
    const made = items.map((label, i) => chip(0, 390, label, { size: 15, h: 38, glyphName: icons[i] }));
    const gap = 16;
    const total = made.reduce((sum, c) => sum + c.width, 0) + gap * (made.length - 1);
    let cursor = (920 - total) / 2;
    const chips = items.map((label, i) => {
      const c = chip(cursor, 390, label, { size: 15, h: 38, glyphName: icons[i] });
      cursor += c.width + gap;
      return c;
    });
    return `<g>
      ${t(38, 46, "全局快捷键 · 系统级注册", { size: 15, weight: 600, fill: "#93a2bd" })}
      <g>
        <rect x="734" y="30" width="148" height="30" rx="15" fill="rgba(70,211,139,0.12)" stroke="rgba(70,211,139,0.35)"/>
        <circle cx="754" cy="45" r="4" fill="#46d38b"/>
        ${t(766, 50, "已注册", { size: 11, weight: 600, fill: "#8fe3b6" })}
      </g>
      ${keycap(120, 92, 220, 180, "Ctrl")}
      ${t(348, 196, "+", { size: 28, weight: 500, fill: DIM, anchor: "middle" })}
      ${keycap(374, 92, 190, 180, "Alt")}
      ${t(582, 196, "+", { size: 28, weight: 500, fill: DIM, anchor: "middle" })}
      ${keycap(598, 92, 170, 180, "Q")}
      ${t(460, 326, "任何程序 · 无需切回桌面", { size: 17, weight: 500, fill: "#c6d3e8", anchor: "middle" })}
      ${chips.map((c) => c.svg).join("")}
      ${t(38, 466, "窗口隐藏或最小化时同样生效；组合键被占用时会在启动页明确标注。", { size: 14, weight: 400, fill: MUTED })}
    </g>`;
  }

  const chips = [
    chip(38, 352, "仅写 HKCU", { size: 15, h: 38, glyphName: "shield" }),
    chip(190, 352, "免管理员", { size: 15, h: 38, glyphName: "check" }),
    chip(320, 352, "卸载自动清理", { size: 15, h: 38, glyphName: "trash" }),
  ];
  return `<g>
    ${t(38, 46, "开机自启动 · 当前用户", { size: 15, weight: 600, fill: "#93a2bd" })}
    <g transform="translate(38 86)">
      <rect width="400" height="212" rx="16" fill="#f6f8fd" stroke="#c9d4e6"/>
      ${t(22, 38, "开机自启动", { size: 15, weight: 700, fill: "#101828" })}
      ${t(22, 58, "登录 Windows 后自动运行", { size: 9.6, weight: 400, fill: "#7b8aa3" })}
      <rect x="318" y="24" width="58" height="30" rx="15" fill="#1b62d6"/>
      <circle cx="361" cy="39" r="11" fill="#ffffff"/>
      ${t(22, 88, "状态", { size: 8.6, weight: 400, fill: "#98a5ba" })}
      <rect x="60" y="76" width="76" height="22" rx="11" fill="rgba(27,98,214,0.10)" stroke="rgba(27,98,214,0.24)"/>
      ${t(98, 91, "已开启", { size: 9, weight: 600, fill: "#1b62d6", anchor: "middle" })}
      <line x1="22" y1="118" x2="378" y2="118" stroke="#e3e9f4"/>
      ${glyph("power", 22, 136, 18, "#1b62d6", 1.9)}
      ${t(50, 143, "登录 Windows", { size: 10.4, weight: 600, fill: "#1c2740" })}
      ${t(50, 160, "自动启动，不弹窗口", { size: 8.6, weight: 400, fill: "#7b8aa3" })}
      ${glyph("eye-off", 22, 178, 18, "#1b62d6", 1.9)}
      ${t(50, 185, "静默进入托盘", { size: 10.4, weight: 600, fill: "#1c2740" })}
      ${t(50, 202, "按快捷键随时唤出", { size: 8.6, weight: 400, fill: "#7b8aa3" })}
    </g>
    <g transform="translate(486 86)">
      <rect width="396" height="212" rx="16" fill="#0d1424" stroke="rgba(255,255,255,0.10)"/>
      ${t(20, 30, "从登录到可用", { size: 11, weight: 600, fill: "#93a2bd" })}
      ${[[54, "登录 Windows", "系统启动时读取 Run 项", "power"], [116, "静默进入托盘", "不抢焦点，不弹主窗口", "eye-off"], [178, "随时唤出", "Ctrl + Alt + Q 或点击托盘图标", "zap"]]
        .map(
          ([y, title, desc, ic], i) =>
            `<g>
              <line x1="38" y1="${y + 30}" x2="38" y2="${y + 58}" stroke="rgba(255,255,255,0.12)"/>
              <circle cx="38" cy="${y + 16}" r="16" fill="rgba(79,124,255,0.16)" stroke="rgba(111,146,255,0.4)"/>
              ${glyph(ic, 31, y + 9, 14, "#9ec5ff", 1.9)}
              ${t(68, y + 14, title, { size: 12, weight: 700, fill: "#dbe6fa" })}
              ${t(68, y + 32, desc, { size: 8.8, weight: 400, fill: "#7f8fae" })}
            </g>`,
        )
        .join("")}
    </g>
    ${chips.map((c) => c.svg).join("")}
    ${t(38, 438, "不弹主窗口、不抢焦点；升级后自动修正命令路径，卸载时清理注册表。", { size: 14, weight: 400, fill: MUTED })}
  </g>`;
}

function featureCard(item, index, total) {
  const W = 1080, H = 1440;
  const num = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  let bullets = "";
  item.bullets.forEach(([title, desc], i) => {
    const y = 1034 + i * 94;
    bullets += `<g>
      <circle cx="95" cy="${y}" r="10" fill="rgba(79,124,255,0.16)" stroke="rgba(111,146,255,0.35)"/>
      ${glyph("check", 89, y - 6, 12, "#9ec5ff", 2.2)}
      ${t(130, y + 6, title, { size: 23, weight: 700 })}
      ${t(130, y + 31, desc, { size: 16.5, weight: 400, fill: MUTED })}
    </g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs()}
    ${backdrop(W, H)}
    ${brand(84, 60, 44)}
    ${t(144, 84, "启点 · 重点更新", { size: 20, weight: 700 })}
    ${t(144, 103, "FEATURE HIGHLIGHT", { size: 10, weight: 500, fill: DIM, ls: 2.6 })}
    ${t(W - 84, 78, `v${VERSION}`, { size: 14, weight: 600, fill: "#8fb6ff", anchor: "end" })}
    ${t(84, 206, `${item.tag} · ${num}`, { size: 12, weight: 600, fill: "#7ea2ff", ls: 3.2 })}
    ${lines(84, 300, item.title, { size: 64, weight: 900, lh: 1.22 })}
    ${t(84, 424, item.sub, { size: 21, weight: 400, fill: MUTED })}
    <g>
      <rect x="80" y="452" width="920" height="520" rx="26" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.10)"/>
      <g transform="translate(80 452)">${featureVisual(item.visual)}</g>
    </g>
    ${bullets}
    <line x1="84" y1="1334" x2="${W - 84}" y2="1334" stroke="rgba(255,255,255,0.08)"/>
    ${t(84, 1374, "详细说明见发布公告 · 覆盖安装即可升级", { size: 13, weight: 400, fill: DIM })}
    ${t(W - 84, 1374, "QIDIAN · WINDOWS 10 / 11", { size: 11, weight: 500, fill: DIM, anchor: "end", ls: 1.4 })}
  </svg>`;
}

/* ── 版本时间线（3:4） ────────────────────────────────── */
function timelineCard() {
  const W = 1080, H = 1440;
  const rows = [
    ["0.1.0", "10-24", "第一个可用版本：扫描、分类、搜索、启动"],
    ["0.2.0", "10-25", "标准安装程序、真实图标、自动刷新与公告页"],
    ["0.3.0", "10-25", "自启动管理、进程分组、小白说明与保护"],
    ["0.4.0", "10-25", "可安装的性能模块：体检、清理、电源、DNS"],
    ["0.5.0", "10-25", "系统托盘、Ctrl+Alt+Q、开机自启动、单实例"],
  ];
  let list = "";
  rows.forEach(([v, d, s], i) => {
    const y = 446 + i * 154;
    const current = i === rows.length - 1;
    list += `<g>
      <circle cx="112" cy="${y - 10}" r="${current ? 10 : 7}" fill="${current ? "#4f7cff" : "#0e1526"}" stroke="${current ? "#9ec5ff" : "#3a4a6a"}"/>
      ${current ? `<circle cx="112" cy="${y - 10}" r="18" fill="rgba(79,124,255,0.14)"/>` : ""}
      ${t(158, y, `v${v}`, { size: 34, weight: 800, fill: current ? "#dce9ff" : "#c6d3e8" })}
      ${t(300, y - 2, d, { size: 13, weight: 500, fill: DIM, ls: 1 })}
      ${t(158, y + 32, s, { size: 18, weight: 400, fill: MUTED })}
      ${current ? `<rect x="${W - 84 - 96}" y="${y - 26}" width="96" height="30" rx="15" fill="rgba(79,124,255,0.16)" stroke="rgba(111,146,255,0.4)"/>${t(W - 84 - 48, y - 6, "最新版本", { size: 12, weight: 600, fill: "#a9c6ff", anchor: "middle" })}` : ""}
    </g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs()}
    ${backdrop(W, H)}
    ${header(W)}
    ${t(84, 208, "VERSION TIMELINE", { size: 12, weight: 600, fill: "#7ea2ff", ls: 4 })}
    ${lines(84, 300, ["五个版本，一条主线。", "更轻、更快、更可控。"], { size: 64, weight: 900, lh: 1.22 })}
    <line x1="112" y1="392" x2="112" y2="${446 + 4 * 154 - 10}" stroke="rgba(255,255,255,0.10)" stroke-width="1.6"/>
    ${list}
    <g>
      <rect x="84" y="1118" width="${W - 168}" height="150" rx="24" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.09)"/>
      ${[1, 2, 3].map((i) => `<line x1="${84 + i * 228}" y1="1146" x2="${84 + i * 228}" y2="1240" stroke="rgba(255,255,255,0.07)"/>`).join("")}
      ${t(140, 1180, "5", { size: 32, weight: 800 })}
      ${t(140, 1206, "个版本，从 0.1 到 0.5", { size: 12.5, weight: 400, fill: MUTED })}
      ${t(368, 1180, "3.9 MB", { size: 32, weight: 800 })}
      ${t(368, 1206, "便携版单文件体积", { size: 12.5, weight: 400, fill: MUTED })}
      ${t(596, 1180, "0", { size: 32, weight: 800 })}
      ${t(596, 1206, "常驻后台服务", { size: 12.5, weight: 400, fill: MUTED })}
      ${t(824, 1180, "1", { size: 32, weight: 800 })}
      ${t(824, 1206, "全局快捷键", { size: 12.5, weight: 400, fill: MUTED })}
    </g>
    <line x1="84" y1="1300" x2="${W - 84}" y2="1300" stroke="url(#accentLine)"/>
    ${t(84, 1344, "每个版本的完整改动与已知限制，都写在应用内“更新”页。", { size: 17, weight: 400, fill: MUTED })}
    ${t(84, 1390, "启点 · QiDian", { size: 22, weight: 800 })}
    ${t(W - 84, 1390, "v0.5.0 · 2026-10-25", { size: 14, weight: 500, fill: DIM, anchor: "end" })}
  </svg>`;
}

/* ── 输出 ─────────────────────────────────────────────── */
const current = RELEASES.find((release) => release.version === VERSION);
if (!current) {
  console.error(`RELEASES 中缺少 v${VERSION} 的文案，请先补充 scripts/promo.mjs。`);
  process.exit(1);
}
const highlights = HIGHLIGHTS[VERSION] || [];
const includeHighlights = process.env.PROMO_HIGHLIGHTS === "1";

for (const file of fs.readdirSync(PNG)) {
  if (file.endsWith(".png")) fs.unlinkSync(path.join(PNG, file));
}

const jobs = [[`01-启点-v${VERSION}-版本更新.png`, releaseCard(current)]];

if (includeHighlights) {
  const dir = path.join(PNG, "highlights");
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".png")) fs.unlinkSync(path.join(dir, file));
  }
  highlights.forEach((item, index) => {
    jobs.push([
      path.join("highlights", `0${index + 2}-启点-v${VERSION}-重点-${item.tag}.png`),
      featureCard(item, index, highlights.length),
    ]);
  });
}

(async () => {
  for (const [name, svg] of jobs) {
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(PNG, name));
    console.log("✓", path.relative(process.cwd(), path.join(PNG, name)));
  }
})();

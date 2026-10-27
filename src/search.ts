import { pinyin } from "pinyin-pro";
import type { AppEntry } from "./types";

/**
 * 搜索索引：把应用拆成名称、紧凑名、分词、拼音、路径等多个字段，
 * 每个字段按匹配质量给不同分值，避免「能搜到但排在后面」和短词误命中。
 */
export interface SearchIndex {
  name: string;
  nameCompact: string;
  nameWords: string[];
  nameAbbr: string;
  /** 词首缩写 + 后续单词：Visual Studio Code → visual / vstudio / vscode。 */
  nameVariants: string[];
  namePinyin: string;
  nameInitials: string;
  publisher: string;
  publisherPinyin: string;
  category: string;
  version: string;
  /** 安装目录 / 快捷方式中的有效目录名与文件名（含去空格形式）。 */
  pathSegments: string[];
}

const HAN = /\p{Script=Han}/u;

/** 全角转半角、去除音调符号、统一小写与分隔符。 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** 在 CamelCase / 数字与字母交界处插入空格，让 VSCode 也能按 code 命中。 */
function splitCompound(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([\p{Script=Han}])([A-Za-z0-9])/gu, "$1 $2")
    .replace(/([A-Za-z0-9])([\p{Script=Han}])/gu, "$1 $2");
}

function pinyinForms(raw: string): { full: string; initials: string } {
  if (!HAN.test(raw)) return { full: "", initials: "" };
  const full = pinyin(raw, { toneType: "none", type: "array", nonZh: "removed" }).join("");
  const initials = pinyin(raw, {
    toneType: "none",
    type: "array",
    nonZh: "removed",
    pattern: "first",
  }).join("");
  return { full: normalizeText(full).replace(/ /g, ""), initials: normalizeText(initials).replace(/ /g, "") };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** 这些目录名几乎出现在所有安装路径里，参与匹配会让任意关键词命中全部应用。 */
const GENERIC_PATH_SEGMENTS = new Set([
  "program", "programs", "programfiles", "programfilesx86", "programdata",
  "files", "common", "commonfiles", "windows", "system32", "syswow64", "winsxs",
  "users", "user", "public", "default", "appdata", "local", "locallow", "roaming",
  "temp", "tmp", "cache", "caches", "data", "bin", "lib", "libs", "resources",
  "assets", "x64", "x86", "amd64", "arm64", "desktop", "start", "menu", "startmenu",
  "startup", "microsoft", "windowsapps", "dotnet", "node_modules", "dist", "build",
  "release", "installer", "update", "updater", "original",
]);

function pathSegments(value: string): string[] {
  return unique(
    value
      .split(/[\\/]+/)
      .map((segment) => normalizeText(splitCompound(segment)))
      .filter((segment) => {
        const compact = segment.replace(/ /g, "");
        return compact.length >= 3 && !GENERIC_PATH_SEGMENTS.has(compact);
      })
      .flatMap((segment) => [segment, segment.replace(/ /g, "")]),
  );
}

export function buildSearchIndex(app: AppEntry, categoryName: string): SearchIndex {
  const name = normalizeText(splitCompound(app.name));
  const nameWords = name.split(" ").filter(Boolean);
  const asciiWords = nameWords.filter((word) => /^[a-z0-9]+$/.test(word));
  // 任意连续词段的「前缀首字母 + 末词」缩写：Microsoft Visual Studio Code
  // 可拼出 visual / vstudio / vscode，避免带厂名前缀时缩写失效。
  const nameVariants = unique(
    nameWords.flatMap((_, start) =>
      nameWords
        .slice(start)
        .map(
          (word, offset) =>
            nameWords
              .slice(start, start + offset)
              .map((prefix) => prefix[0] ?? "")
              .join("") + word,
        ),
    ),
  );
  const nameForms = pinyinForms(app.name);

  const publisherRaw = app.publisher ?? "";
  const publisher = normalizeText(splitCompound(publisherRaw));
  const publisherForms = pinyinForms(publisherRaw);

  const segments = unique(
    [app.installLocation ?? "", app.shortcutPath ?? ""].flatMap(pathSegments),
  );

  return {
    name,
    nameCompact: name.replace(/ /g, ""),
    nameWords,
    nameAbbr: asciiWords.map((word) => word[0] ?? "").join(""),
    nameVariants,
    namePinyin: nameForms.full,
    nameInitials: nameForms.initials,
    publisher,
    publisherPinyin: publisherForms.full,
    category: normalizeText(categoryName),
    version: normalizeText(app.version ?? ""),
    pathSegments: segments,
  };
}

function exactPrefixContains(
  haystack: string,
  token: string,
  exact: number,
  prefix: number,
  contains: number,
): number {
  if (!haystack) return 0;
  if (haystack === token) return exact;
  if (haystack.startsWith(token)) return prefix;
  if (haystack.includes(token)) return contains;
  return 0;
}

/**
 * 单个关键词的匹配得分；0 表示不匹配。
 * 拉丁词长度不足 3 时不做裸子串匹配（避免 mi 命中 terminal 这类误找），
 * 但保留前缀 / 词首 / 拼音首字母匹配。
 */
export function tokenScore(index: SearchIndex, token: string): number {
  if (!token) return 0;
  const cjk = HAN.test(token);
  const single = token.length === 1;
  const allowContains = cjk || token.length >= 3;
  let best = 0;
  const take = (score: number) => {
    if (score > best) best = score;
  };

  // 名称：拉丁词只做词首 / 前缀匹配，中文允许包含匹配（「音乐」能命中「QQ音乐」）
  if (index.name === token) take(1000);
  else if (index.name.startsWith(token)) take(900);
  else if (index.nameWords.includes(token)) take(860);
  else if (index.nameWords.some((word) => word.startsWith(token))) take(820);
  else if (cjk && index.name.includes(token)) take(720);

  // 紧凑名（去空格）：visualstudio / qq音乐
  if (allowContains) {
    if (index.nameCompact === token) take(950);
    else if (index.nameCompact.startsWith(token)) take(880);
    else if (cjk && index.nameCompact.includes(token)) take(700);
    if (index.nameAbbr === token) take(640);
    else if (!single && index.nameAbbr.startsWith(token)) take(600);
  }

  // 词首缩写 + 完整单词：vscode / vstudio / 7zip（精确或前缀，误命中风险低）
  if (!cjk && !single) {
    if (index.nameVariants.includes(token)) take(760);
    else if (index.nameVariants.some((variant) => variant.startsWith(token))) take(660);
  }

  // 拼音：输入 xiaomi / xm / weixin 也能命中中文名称
  if (!cjk && !single) {
    if (index.namePinyin === token) take(780);
    else if (index.namePinyin.startsWith(token)) take(720);
    else if (allowContains && index.namePinyin.includes(token)) take(620);
    if (index.nameInitials === token) take(640);
    else if (index.nameInitials.startsWith(token)) take(590);
    take(exactPrefixContains(index.publisherPinyin, token, 540, 500, 460));
  }

  // 发布者
  if (index.publisher === token) take(540);
  else if (index.publisher.startsWith(token)) take(470);
  else if (allowContains) take(exactPrefixContains(index.publisher, token, 0, 0, 400));

  // 分类
  if (index.category === token) take(320);
  else if (allowContains && index.category.includes(token)) take(250);

  // 版本号
  if (index.version === token) take(230);
  else if (!single && index.version.startsWith(token)) take(210);

  // 安装目录 / 快捷方式路径（MiConnect 这类主程序名通常只出现在路径里）；
  // 通用目录名已在建索引时剔除，避免 program / files 这类词命中全部应用。
  if (!cjk) {
    for (const segment of index.pathSegments) {
      if (segment === token) take(430);
      else if (!single && segment.startsWith(token)) take(390);
      else if (allowContains && segment.includes(token)) take(340);
    }
  }

  return best;
}

/**
 * 所有关键词都要命中（AND），返回总分；任一关键词无匹配返回 null。
 * 整串在名称中连续出现时给短语加分，保证「小米互联」排在「小米」系列前面。
 */
export function matchScore(
  index: SearchIndex,
  tokens: string[],
  phrase: string,
): number | null {
  if (tokens.length === 0) return null;
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(index, token);
    if (score <= 0) return null;
    total += score;
  }
  // 中文短词或多关键词整串连续命中才加权，避免 "mi" 这类短拉丁串误给所有含该串的名称加分
  const phraseEligible = HAN.test(phrase) || phrase.includes(" ");
  if (phraseEligible && phrase.length > 1 && index.name.includes(phrase)) total += 180;
  return total;
}

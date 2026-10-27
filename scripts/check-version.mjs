import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(resolve(root, "VERSION"), "utf8").trim();
const problems = [];

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  problems.push("VERSION 不是合法的 x.y.z 版本号");
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
  } catch (error) {
    problems.push(`${relativePath} 无法读取：${error.message}`);
    return null;
  }
}

const pkg = readJson("package.json");
if (pkg && pkg.version !== version) {
  problems.push(`package.json 版本是 ${pkg.version}，应为 ${version}`);
}

const lock = readJson("package-lock.json");
if (lock) {
  if (lock.version !== version) {
    problems.push(`package-lock.json 版本是 ${lock.version}，应为 ${version}`);
  }
  if (lock.packages && lock.packages[""] && lock.packages[""].version !== version) {
    problems.push(
      `package-lock.json root 包版本是 ${lock.packages[""].version}，应为 ${version}`,
    );
  }
}

const tauri = readJson("src-tauri/tauri.conf.json");
if (tauri && tauri.version !== version) {
  problems.push(`tauri.conf.json 版本是 ${tauri.version}，应为 ${version}`);
}

const cargo = readFileSync(resolve(root, "src-tauri", "Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
if (cargoVersion !== version) {
  problems.push(`Cargo.toml 版本是 ${cargoVersion ?? "缺失"}，应为 ${version}`);
}

const installerPath = resolve(root, "installer", "version.nsh");
if (!existsSync(installerPath)) {
  problems.push("缺少 installer/version.nsh，请运行 npm run version:sync");
} else {
  const installerVersion = readFileSync(installerPath, "utf8").match(
    /!define APP_VERSION "([^"]+)"/,
  )?.[1];
  if (installerVersion !== version) {
    problems.push(`installer/version.nsh 版本是 ${installerVersion ?? "缺失"}，应为 ${version}`);
  }
}

const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const escaped = version.replaceAll(".", "\\.");
const heading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m");
if (!heading.test(changelog)) {
  problems.push(
    `CHANGELOG.md 缺少当前版本公告，请添加：## [${version}] - YYYY-MM-DD`,
  );
}

if (problems.length > 0) {
  console.error("版本检查失败：");
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

console.log(`版本检查通过：v${version}`);

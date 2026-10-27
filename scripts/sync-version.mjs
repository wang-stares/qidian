import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionPath = resolve(root, "VERSION");
const version = readFileSync(versionPath, "utf8").trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`VERSION 内容无效：${version}。请使用 x.y.z 格式。`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function updatePackage() {
  const path = resolve(root, "package.json");
  const json = readJson(path);
  json.version = version;
  writeJson(path, json);
}

function updateLockfiles() {
  const pkgLockPath = resolve(root, "package-lock.json");
  if (existsSync(pkgLockPath)) {
    const lock = readJson(pkgLockPath);
    lock.version = version;
    if (lock.packages && lock.packages[""]) {
      lock.packages[""].version = version;
    }
    writeJson(pkgLockPath, lock);
  }

  const cargoLockPath = resolve(root, "src-tauri", "Cargo.lock");
  if (existsSync(cargoLockPath)) {
    const cargoLock = readFileSync(cargoLockPath, "utf8");
    const next = cargoLock.replace(
      /(\[\[package\]\]\nname = "qidian"\nversion = ")[^"]+(")/,
      `$1${version}$2`,
    );
    writeFileSync(cargoLockPath, next);
  }
}

function updateTauriConfig() {
  const path = resolve(root, "src-tauri", "tauri.conf.json");
  const json = readJson(path);
  json.version = version;
  writeJson(path, json);
}

function updateCargoToml() {
  const path = resolve(root, "src-tauri", "Cargo.toml");
  const text = readFileSync(path, "utf8");
  const next = text.replace(/^version = "[^"]+"/m, `version = "${version}"`);
  writeFileSync(path, next);
}

function updateInstallerVersion() {
  const path = resolve(root, "installer", "version.nsh");
  const content = [
    "; 本文件由 scripts/sync-version.mjs 生成，请勿手动修改。",
    `!define APP_VERSION "${version}"`,
    `!define APP_VERSION_4 "${version}.0"`,
    "",
  ].join("\n");
  writeFileSync(path, content);
}

updatePackage();
updateLockfiles();
updateTauriConfig();
updateCargoToml();
updateInstallerVersion();
console.log(`版本已同步：v${version}`);

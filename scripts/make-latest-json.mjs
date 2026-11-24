#!/usr/bin/env node
/**
 * 生成 Tauri 更新清单 latest.json：签名安装包并汇总版本、公告与下载地址。
 * 全程使用本地 tauri CLI 与本地文件，不访问网络。
 *
 * 用法：
 *   node scripts/make-latest-json.mjs --version 3.1.0
 *   node scripts/make-latest-json.mjs --version 3.1.0 \
 *     --installer ../qidian-build/QiDian-Setup-3.1.0-x64.exe \
 *     --url https://github.com/wang-stares/qidian/releases/download/v3.1.0/QiDian-Setup-3.1.0-x64.exe
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = resolve(root, "..", "qidian-build");
const repo = "wang-stares/qidian";
const usage = `用法：node scripts/make-latest-json.mjs [选项]

  --version <x.y.z>    版本号，默认取 VERSION
  --installer <path>   安装包，默认 ${buildDir}/QiDian-Setup-<版本>-x64.exe
  --url <url>          latest.json 中的下载地址，默认 GitHub Release 地址
  --out <path>         输出文件，默认 ${buildDir}/latest.json
  --key <path>         签名私钥，默认 \$TAURI_SIGNING_PRIVATE_KEY_PATH 或 ${buildDir}/updater.key
  --notes <text>       覆盖从 CHANGELOG.md 读取的公告
  -h, --help           显示本说明`;
if (process.argv.includes("-h") || process.argv.includes("--help")) {
  console.log(usage);
  process.exit(0);
}

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`参数 --${key} 缺少值`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function readChangelogNotes(version) {
  const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
  const marker = `## [${version}] - `;
  const start = changelog.indexOf(marker);
  if (start < 0) {
    fail(`CHANGELOG.md 中没有 v${version} 的公告，请先补充，或用 --notes 指定。`);
  }
  const next = changelog.indexOf("\n## [", start + marker.length);
  const block = changelog.slice(start, next < 0 ? undefined : next).trim();
  const bodyStart = block.indexOf("\n");
  return bodyStart < 0 ? "" : block.slice(bodyStart + 1).trim();
}

function signInstaller(installer, keyPath, version) {
  const args = [
    "signer",
    "sign",
    installer,
    "--private-key-path",
    keyPath,
    "--password",
    "",
    // 将版本写入签名注释，启用 requireSignedVersion 时可拦截降级重放。
    "--app-version",
    version,
  ];
  const localCli = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "tauri.cmd" : "tauri");
  const result = existsSync(localCli)
    ? spawnSync(localCli, args, { stdio: "inherit" })
    : spawnSync("npx", ["tauri", ...args], { stdio: "inherit" });
  if (result.error) {
    fail(`无法调用 tauri signer：${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`tauri signer sign 退出码 ${result.status}`);
  }
  const signaturePath = `${installer}.sig`;
  if (!existsSync(signaturePath)) {
    fail(`签名文件不存在：${signaturePath}`);
  }
  return readFileSync(signaturePath, "utf8").trim();
}

const options = parseArgs(process.argv.slice(2));
const version = options.version ?? readFileSync(resolve(root, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`版本号格式无效：${version}`);
}

const installer = resolve(
  options.installer ?? resolve(buildDir, `QiDian-Setup-${version}-x64.exe`),
);
if (!existsSync(installer)) {
  fail(`安装包不存在：${installer}`);
}

const url =
  options.url ??
  `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(basename(installer))}`;
const notes = options.notes ?? readChangelogNotes(version);
const keyPath = resolve(
  options.key ??
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ??
    resolve(buildDir, "updater.key"),
);
if (!existsSync(keyPath)) {
  fail(`签名私钥不存在：${keyPath}`);
}

const signature = signInstaller(installer, keyPath, version);
const payload = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: {
    "windows-x86_64": {
      url,
      signature,
    },
  },
};

const output = resolve(options.out ?? resolve(buildDir, "latest.json"));
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`已生成 ${output}`);
console.log(`  版本：${version}`);
console.log(`  安装包：${installer}`);
console.log(`  下载地址：${url}`);

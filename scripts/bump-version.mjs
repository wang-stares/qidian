import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionPath = resolve(root, "VERSION");
const current = readFileSync(versionPath, "utf8").trim();
const [major, minor, patch] = current.split(".").map(Number);
const argument = process.argv[2];

let next;
if (argument === "major") {
  next = `${major + 1}.0.0`;
} else if (argument === "minor") {
  next = `${major}.${minor + 1}.0`;
} else if (argument === "patch") {
  next = `${major}.${minor}.${patch + 1}`;
} else if (/^\d+\.\d+\.\d+$/.test(argument ?? "")) {
  next = argument;
} else {
  console.error("用法：npm run version:bump -- patch|minor|major|x.y.z");
  process.exit(1);
}

writeFileSync(versionPath, `${next}\n`);
execFileSync(process.execPath, [resolve(root, "scripts", "sync-version.mjs")], {
  stdio: "inherit",
});

console.log(`\n已从 v${current} 升级到 v${next}。`);
console.log("下一步：在 CHANGELOG.md 中添加当前版本公告，然后运行 npm run build。");
console.log("提示：npm run release:notes 可以输出当前版本的公告文本。");

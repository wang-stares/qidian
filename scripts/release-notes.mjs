import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(resolve(root, "VERSION"), "utf8").trim();
const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const marker = `## [${version}] - `;
const start = changelog.indexOf(marker);

if (start < 0) {
  console.error(`CHANGELOG.md 中没有 v${version} 的公告，请先补充。`);
  process.exit(1);
}

const next = changelog.indexOf("\n## [", start + marker.length);
const block = changelog.slice(start, next < 0 ? undefined : next).trim();
const firstLine = block.indexOf("\n");
const heading = firstLine < 0 ? block : block.slice(0, firstLine);
const date = heading.slice(marker.length).trim();
const body = firstLine < 0 ? "" : block.slice(firstLine + 1).trim();

console.log(`# 启点 v${version} 更新公告\n`);
console.log(`发布日期：${date}\n`);
console.log(body);

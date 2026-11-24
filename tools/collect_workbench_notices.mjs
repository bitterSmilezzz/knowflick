import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const goDir = path.join(root, "apps/workbench-go");
const webDir = path.join(root, "apps/workbench");
const noticeName = /^(licen[cs]e|copying|notice|copyright|patents)([._-]|$)/i;

function readNotices(name, directory) {
  const files = readdirSync(directory).filter((file) => noticeName.test(file)).sort();
  if (files.length === 0) throw new Error(`找不到 ${name} 的许可文件：${directory}`);
  return files.map((file) => {
    const text = readFileSync(path.join(directory, file), "utf8");
    return `=== ${name} / ${file} ===\n\n${text.trimEnd()}`;
  });
}

const notices = readNotices("KnowFlick", root);
const goRoot = execFileSync("go", ["env", "GOROOT"], { cwd: goDir, encoding: "utf8" }).trim();
notices.push(...readNotices("Go", goRoot));
// Homebrew 将许可放在 libexec 的上层。
if (!existsSync(path.join(goRoot, "LICENSE"))) {
  notices.push(`=== Go / LICENSE ===\n\n${readFileSync(path.join(goRoot, "..", "LICENSE"), "utf8").trimEnd()}`);
}

const moduleList = execFileSync("go", ["list", "-deps", "-tags", "production", "-f",
  "{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}}|{{.Dir}}{{end}}{{end}}", "."],
{ cwd: goDir, encoding: "utf8" });
for (const entry of [...new Set(moduleList.trim().split(/\r?\n/).filter(Boolean))].sort()) {
  const [name, directory] = entry.split("|");
  notices.push(...readNotices(name, directory));
}

// Windows 的 npm 入口是 cmd shim，用 Node 运行 npm 自带的 CLI。
const npm = process.platform === "win32" ? [process.execPath, [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")]] : ["npm", []];
const npmList = execFileSync(npm[0], [...npm[1], "ls", "--omit=dev", "--all", "--parseable"], {
  cwd: webDir,
  encoding: "utf8",
});
for (const directory of npmList.trim().split(/\r?\n/).slice(1).sort()) {
  const { name, version } = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  notices.push(...readNotices(`${name} ${version}`, directory));
}

process.stdout.write(notices.join("\n\n") + "\n");

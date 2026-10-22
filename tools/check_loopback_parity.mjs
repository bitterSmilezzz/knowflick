#!/usr/bin/env node
/**
 * 跨端回环判定对照：Rust 桌面壳、TypeScript 前端、安卓 Kotlin 必须给出同一答案。
 *
 * 为什么要有这个：回环判定散落在三处（`src-tauri/src/http.rs` 的
 * `is_loopback_host`、`src/domain/ingest.ts` 的 `isLoopbackHost`、
 * `apps/android/.../LoopbackHost.kt`），每处各写一套字符串比较，迟早会漂。
 * ADR-0002 §3 要求「同一份 settings.json 在两端行为相同」——同一份文件里写着
 * `http://[::1]:11434/v1`，两端对「要不要密钥」的判断就必须一致。
 *
 * 做法：同一批地址跑过两端实现，逐条比对结果，不一致就报出来。
 * 安卓那侧由它的镜像用例 `LoopbackHostTest.kt` 保证（同一批地址），
 * 这里是 Rust 与 TypeScript 的直接对照。
 *
 * 用法：node tools/check_loopback_parity.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 三端共用的地址批次。改这里就要同步改三边的测试。 */
const HOSTS = [
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "0:0:0:0:0:0:0:1",
  "[0:0:0:0:0:0:0:1]",
  "::",
  "[::]",
  "::ffff:127.0.0.1",
  "[::ffff:7f00:1]",
  "[2001:db8::1]",
  "192.168.1.10",
  "10.0.0.1",
  "example.com",
  "",
  "not a host",
];

function emit(text) {
  try {
    process.stdout.write(text + "\n");
  } catch {
    process.stdout.write(Buffer.from(text + "\n", "utf8"));
  }
}

/** Rust 侧：跑一个临时探针测试，把每条判定打印出来。 */
async function rustVerdicts() {
  const lib = path.join(ROOT, "apps/workbench/src-tauri/src/http.rs");
  const fs = await import("node:fs/promises");
  const original = await fs.readFile(lib, "utf8");
  const probe = `    #[test]
    fn __parity_probe() {
        for h in ${JSON.stringify(HOSTS)}.iter() {
            println!("PARITY\\t{}\\t{}", h, super::is_loopback_host(h));
        }
    }

`;
  const anchor = "    #[test]\n    fn keeps_ordinary_error_text() {";
  if (!original.includes(anchor)) throw new Error("http.rs 里找不到插入探针的锚点");
  await fs.writeFile(lib, original.replace(anchor, probe + anchor), "utf8");
  try {
    const { stdout } = await exec("cargo", ["test", "--locked", "--lib", "http::tests::__parity_probe", "--", "--nocapture"], {
      cwd: path.join(ROOT, "apps/workbench/src-tauri"),
      timeout: 900_000,
      maxBuffer: 32 * 1024 * 1024,
      // Windows 上 cargo 是 cargo.exe，直接 spawn 即可。
      shell: false,
    });
    const verdicts = new Map();
    for (const line of stdout.split("\n")) {
      const match = line.match(/^PARITY\t(.*)\t(true|false)$/);
      if (match) verdicts.set(match[1], match[2] === "true");
    }
    if (verdicts.size !== HOSTS.length) {
      throw new Error(`Rust 探针只返回 ${verdicts.size} 条，应为 ${HOSTS.length} 条`);
    }
    return verdicts;
  } finally {
    await fs.writeFile(lib, original, "utf8");
  }
}

/**
 * TypeScript 侧：调用**已安装的** vitest 跑一个临时用例，把判定打印出来。
 *
 * 为什么不用 npx：Windows runner 上 npx 是 `npx.cmd`，`spawn npx` 会 ENOENT
 * （实测在 Windows CI 上把门禁打红）。改为直接用 node 执行 vitest 的
 * JS 入口（node_modules/vitest/vitest.mjs），三端都稳。
 */
async function typescriptVerdicts() {
  const fs = await import("node:fs/promises");
  const workbench = path.join(ROOT, "apps/workbench");
  const testFile = path.join(workbench, "src/domain/__parity.test.ts");
  await fs.writeFile(
    testFile,
    `import { it } from "vitest";
import { isLoopbackHost } from "./ingest";
it("parity", () => {
  for (const h of ${JSON.stringify(HOSTS)}) {
    console.log("PARITY\\t" + h + "\\t" + isLoopbackHost(h));
  }
});
`,
    "utf8",
  );
  try {
    // 直接用 node 执行 vitest 的 JS 入口，绕开 Windows 上「npx / .cmd 垫片」
    // 的解析差异（实测 Windows CI 上 spawn npx 直接 ENOENT）。
    const vitestEntry = path.join(workbench, "node_modules", "vitest", "vitest.mjs");
    const fsCheck = await fs.stat(vitestEntry).catch(() => null);
    if (!fsCheck) {
      throw new Error(`找不到 vitest 入口：${vitestEntry}（先在 apps/workbench 跑 npm ci）`);
    }
    const { stdout } = await exec(process.execPath, [vitestEntry, "run", "src/domain/__parity.test.ts"], {
      cwd: workbench,
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const verdicts = new Map();
    for (const line of stdout.split("\n")) {
      const match = line.match(/^PARITY\t(.*)\t(true|false)$/);
      if (match) verdicts.set(match[1], match[2] === "true");
    }
    if (verdicts.size !== HOSTS.length) {
      throw new Error(`TypeScript 侧只返回 ${verdicts.size} 条，应为 ${HOSTS.length} 条`);
    }
    return verdicts;
  } finally {
    await fs.rm(testFile, { force: true });
  }
}

const rust = await rustVerdicts();
const ts = await typescriptVerdicts();

const mismatches = [];
for (const host of HOSTS) {
  const r = rust.get(host);
  const t = ts.get(host);
  if (r !== t) mismatches.push(`  ${JSON.stringify(host)}：Rust=${r} TypeScript=${t}`);
}

if (mismatches.length) {
  emit("回环判定两端不一致：");
  for (const line of mismatches) emit(line);
  emit(`\n（共 ${mismatches.length} 处）`);
  process.exit(1);
}

emit(`回环判定两端一致：${HOSTS.length} 个地址逐条相同`);

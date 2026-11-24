#!/usr/bin/env node
/**
 * 浏览器冒烟的资源闸门（本地与 CI 通用）。
 *
 * 为什么需要：18 套冒烟每套都会拉起一个 Chromium。并行跑、或者上一轮崩了没关干净时，
 * Chrome 进程会堆到十几个、吃掉数 GB 内存。症状不是「报错」，而是 CDP 通道被关：
 * 断言莫名其妙红，排查半天发现是机器资源打满——本仓库多次踩到这个假红。
 *
 * 闸门做三件事：
 * 1. 单飞锁：同一时刻只允许一套浏览器冒烟持有浏览器（mkdir 是原子操作）。
 * 2. 进程预检与回收：Chromium / agent-browser 进程超过上限就先 close --all 再等。
 * 3. 内存预检：可用内存低于下限直接拒绝，并说明原因与办法。
 *
 * 用法：
 *   node tools/browser_resource_guard.mjs acquire   # 取锁并预检（最长等待 KF_BROWSER_LOCK_WAIT 秒）
 *   node tools/browser_resource_guard.mjs release
 *   node tools/browser_resource_guard.mjs status    # 只读：锁与资源现状
 *
 * 环境变量：
 *   KF_BROWSER_MAX_PROCS   浏览器进程上限（默认 6）
 *   KF_BROWSER_MIN_FREE_MB 可用内存下限（默认 1024）
 *   KF_BROWSER_LOCK_WAIT   取锁最长等待秒数（默认 180）
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, freemem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_DIR = join(ROOT, ".scratch", "locks", "browser-smoke.lock");
const MAX_PROCS = Number(process.env.KF_BROWSER_MAX_PROCS ?? 6);
const MIN_FREE_MB = Number(process.env.KF_BROWSER_MIN_FREE_MB ?? 256);
const LOCK_WAIT_MS = Number(process.env.KF_BROWSER_LOCK_WAIT ?? 180) * 1000;
const STALE_MS = 30 * 60 * 1000;

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function browserProcesses() {
  const out = sh("ps", ["-Ao", "pid=,rss=,command="]);
  if (!out) return { count: 0, rssMb: 0 };
  let count = 0;
  let rssKb = 0;
  for (const line of out.split("\n")) {
    if (!/Chromium|agent-browser/i.test(line)) continue;
    if (/browser_resource_guard|run_all_smokes|ps -Ao/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const rss = Number(parts[1]);
    if (!parts[0] || !Number.isFinite(rss)) continue;
    count += 1;
    rssKb += rss;
  }
  return { count, rssMb: Math.round(rssKb / 1024) };
}

const freeMb = () => Math.round(freemem() / 1024 / 1024);

function lockOwner() {
  try {
    return JSON.parse(readFileSync(join(LOCK_DIR, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function lockAge() {
  try {
    return Date.now() - statSync(LOCK_DIR).mtimeMs;
  } catch {
    return 0;
  }
}

function alive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  return sh("ps", ["-p", String(pid), "-o", "pid="]) !== "";
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function acquire() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  mkdirSync(dirname(LOCK_DIR), { recursive: true });
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      writeFileSync(
        join(LOCK_DIR, "owner.json"),
        JSON.stringify({ pid: process.pid, at: new Date().toISOString() }, null, 2)
      );
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = lockOwner();
      const stale = owner ? !alive(owner.pid) || lockAge() > STALE_MS : lockAge() > STALE_MS;
      if (stale) {
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        const who = owner ? "pid " + owner.pid + "（" + owner.at + " 起）" : "未知进程";
        console.error("::error::等不到浏览器锁：" + who + " 正持有它。同一时刻只允许一套浏览器冒烟；等它结束或确认后删掉 " + LOCK_DIR + "。");
        process.exit(1);
      }
      sh("sleep", ["1"]);
    }
  }
  const before = browserProcesses();
  if (before.count > MAX_PROCS) {
    console.log(`回收：${before.count} 个浏览器进程（${before.rssMb} MB）超过上限 ${MAX_PROCS}，先 close --all`);
    sh("agent-browser", ["close", "--all"]);
    // 关闭是异步的：给进程一点时间退出，别刚发完命令就判定「关不掉」。
    let after = browserProcesses();
    for (let attempt = 0; attempt < 20 && after.count > MAX_PROCS; attempt += 1) {
      await wait(500);
      after = browserProcesses();
    }
    if (after.count > MAX_PROCS) {
      rmSync(LOCK_DIR, { recursive: true, force: true });
      console.error(`::error::浏览器进程仍剩 ${after.count} 个（${after.rssMb} MB）：先关掉别的冒烟或浏览器（ps -Ao pid,command | grep Chromium）。`);
      process.exit(1);
    }
  }
  const mb = freeMb();
  if (mb < MIN_FREE_MB * 2) {
    console.log(`提醒：可用内存只剩 ${mb} MB，冒烟期间留意其它占内存的进程（下限 ${MIN_FREE_MB} MB）。`);
  }
  if (mb < MIN_FREE_MB) {
    rmSync(LOCK_DIR, { recursive: true, force: true });
    console.error(`::error::可用内存 ${mb} MB 低于下限 ${MIN_FREE_MB} MB——先关掉浏览器或别的构建。`);
    process.exit(1);
  }
  console.log(
    `浏览器闸门：锁已取得 · 浏览器进程 ${browserProcesses().count} · 可用内存 ${mb} MB · CPU 并发度 ${availableParallelism()}`
  );
}

function release() {
  rmSync(LOCK_DIR, { recursive: true, force: true });
}

function status() {
  const procs = browserProcesses();
  console.log(
    JSON.stringify(
      { lock: lockOwner(), lockAgeMs: lockAge(), processes: procs, freeMb: freeMb(), maxProcs: MAX_PROCS, minFreeMb: MIN_FREE_MB },
      null,
      2
    )
  );
}

const command = process.argv[2] ?? "status";
if (command === "acquire") await acquire();
else if (command === "release") release();
else if (command === "status") status();
else {
  console.error("用法：node tools/browser_resource_guard.mjs acquire|release|status");
  process.exit(2);
}

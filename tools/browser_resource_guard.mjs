#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { freemem, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// A live socket owns the machine-wide slot. The OS releases it on process exit.
const lockPort = 47849;
const mib = 1024 ** 2;
const windows = process.platform === "win32";

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483) {
    throw new Error(name + " 须为 1 至 2147483 之间的整数");
  }
  return value;
}

function availableMiB() {
  if (process.platform !== "linux") return Math.floor(freemem() / mib);
  const bytes = Number(readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024;
  let available = Number.isFinite(bytes) ? bytes : freemem();
  try {
    // A CI container can have much less memory than its host reports.
    const limit = Number(readFileSync("/sys/fs/cgroup/memory.max", "utf8"));
    const usage = Number(readFileSync("/sys/fs/cgroup/memory.current", "utf8"));
    if (Number.isFinite(limit) && Number.isFinite(usage)) available = Math.min(available, Math.max(0, limit - usage));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return Math.floor(available / mib);
}

function processes() {
  const options = { encoding: "utf8", timeout: 5000, maxBuffer: 8 * mib, windowsHide: true };
  if (windows) {
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress';
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], options);
    if (result.status !== 0) throw new Error("无法读取 Windows 进程资源", { cause: result.error });
    return [JSON.parse(result.stdout)].flat().map(row => ({
      pid: Number(row.ProcessId), parent: Number(row.ParentProcessId),
      kib: Number(row.WorkingSetSize) / 1024, command: row.CommandLine ?? "",
    }));
  }
  const result = spawnSync("ps", ["-ww", "-Ao", "pid=,ppid=,rss=,command="], options);
  if (result.status !== 0) throw new Error("无法读取进程资源", { cause: result.error });
  return result.stdout.trim().split("\n").map(line => {
    const [pid, parent, kib] = line.trim().split(/\s+/, 3);
    return { pid: Number(pid), parent: Number(parent), kib: Number(kib), command: line.trim().replace(/^\d+\s+\d+\s+\d+\s+/, "") };
  });
}

async function acquire() {
  const lock = createServer(socket => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      lock.once("error", reject);
      lock.listen({ port: lockPort, host: "127.0.0.1", exclusive: true }, resolve);
    });
  } catch (error) {
    if (error.code === "EADDRINUSE") throw new Error("本机浏览器测试槽已占用，请在当前测试结束后重试");
    throw error;
  }
  return lock;
}

async function run(command, args) {
  const maxProcesses = positiveInteger("KF_BROWSER_MAX_PROCS", 16);
  // 规模冒烟在 4000 条数据下实测峰值约 2.0 GiB；3 GiB 既容得下它，也挡住失控占用。
  const maxMiB = positiveInteger("KF_BROWSER_MAX_RSS_MB", 3072);
  const minFreeMiB = positiveInteger("KF_BROWSER_MIN_FREE_MB", 256);
  const timeout = positiveInteger("KF_SMOKE_TIMEOUT", 300);
  const lock = await acquire();
  let directory;
  let child;
  let problem;
  let watcher;
  let deadline;
  const stop = (message, code) => {
    if (problem) return;
    problem = { message, code };
    killSuite("SIGTERM");
  };
  function killSuite(signal) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (windows) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { timeout: 5000, windowsHide: true, stdio: "ignore" });
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  const interrupt = () => stop("浏览器测试已中断", 130);
  const terminate = () => stop("浏览器测试已终止", 143);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);

  try {
    processes();
    const free = availableMiB();
    if (free < minFreeMiB) throw new Error("可用内存 " + free + " MiB，低于测试所需的 " + minFreeMiB + " MiB");
    // Unix-domain socket paths have a small platform limit. Use a short prefix.
    directory = mkdtempSync(join(windows ? tmpdir() : "/tmp", "kfbr-"));
    const profile = join(directory, "profile");
    const env = {
      ...process.env,
      AGENT_BROWSER_SOCKET_DIR: directory,
      AGENT_BROWSER_PROFILE: profile,
      AGENT_BROWSER_IDLE_TIMEOUT_MS: "30000",
    };
    delete env.AGENT_BROWSER_CDP;
    delete env.AGENT_BROWSER_AUTO_CONNECT;
    delete env.AGENT_BROWSER_SESSION_NAME;
    delete env.AGENT_BROWSER_CONFIG;
    // Preserve the identities of observed children even if their browser parent exits.
    const owned = new Map();
    function browserProcesses() {
      const rows = processes();
      const selected = new Set(rows.filter(row => owned.get(row.pid) === row.command || row.command.includes("--user-data-dir=" + profile) || row.command.includes('--user-data-dir="' + profile + '"')).map(row => row.pid));
      let previousSize;
      do {
        previousSize = selected.size;
        for (const row of rows) if (selected.has(row.parent)) selected.add(row.pid);
      } while (selected.size !== previousSize);
      const matches = rows.filter(row => selected.has(row.pid));
      for (const row of matches) owned.set(row.pid, row.command);
      return matches;
    }

    let highestCount = 0;
    let highestMiB = 0;
    function monitor() {
      const rows = browserProcesses();
      const rss = Math.ceil(rows.reduce((sum, row) => sum + row.kib, 0) / 1024);
      highestCount = Math.max(highestCount, rows.length);
      highestMiB = Math.max(highestMiB, rss);
      if (rows.length > maxProcesses || rss > maxMiB) {
        stop("测试浏览器超出预算（" + rows.length + "/" + maxProcesses + " 个进程，" + rss + "/" + maxMiB + " MiB RSS）", 1);
      }
    }

    let exitCode;
    try {
      child = spawn(command, args, { env, stdio: ["ignore", "inherit", "inherit"], detached: !windows, windowsHide: true });
      const done = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      watcher = setInterval(() => {
        try { monitor(); } catch (error) { stop(error.message, 1); }
        if (problem) killSuite("SIGKILL");
      }, 1000);
      deadline = setTimeout(() => stop("浏览器测试超过 " + timeout + " 秒", 124), timeout * 1000);
      exitCode = await done;
      monitor();
    } finally {
      clearInterval(watcher);
      clearTimeout(deadline);
      // Only the private socket directory is consulted. Never close global sessions.
      for (const file of readdirSync(directory)) {
        if (!file.endsWith(".pid")) continue;
        const session = basename(file, ".pid");
        spawnSync("agent-browser", ["--session", session, "close"], { env, timeout: 4000, stdio: "ignore", windowsHide: true });
      }
      const cleanupUntil = Date.now() + 5000;
      let remaining = browserProcesses();
      while (remaining.length && Date.now() < cleanupUntil) {
        for (const row of remaining) {
          try { process.kill(row.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        }
        await delay(200);
        remaining = browserProcesses();
      }
      if (remaining.length) throw new Error("测试浏览器仍有 " + remaining.length + " 个进程未退出");
      console.error("浏览器预算（采样峰值） " + highestCount + "/" + maxProcesses + " 个进程，" + highestMiB + "/" + maxMiB + " MiB RSS");
    }
    if (problem) {
      console.error(problem.message);
      return problem.code;
    }
    return exitCode ?? 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    lock.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}

try {
  const [mode, command, ...args] = process.argv.slice(2);
  if (mode !== "run" || !command) throw new Error("用法：node tools/browser_resource_guard.mjs run <命令> [参数]");
  process.exitCode = await run(command, args);
} catch (error) {
  console.error("浏览器测试资源检查失败：" + error.message);
  process.exitCode = 1;
}

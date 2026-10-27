import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("回环对照守卫实际取得两端 16 条判定并比较", () => {
  const result = spawnSync(process.execPath, ["tools/check_loopback_parity.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 300_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /回环判定两端一致：16 个地址逐条相同/);
});

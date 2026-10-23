#!/usr/bin/env node
/**
 * 反向验证：MCP 素材检索的断言**真的**能抓住对应的缺陷吗？
 *
 * 为什么要有这个文件：断言「绿」不等于「在守东西」。
 * 前几轮反复踩的坑是——守卫写完了、跑一遍是绿的，就当它生效了；
 * 实际上把它依赖的实现改回缺陷状态，它照样绿。
 *
 * 这里逐个把 `tools/mcp-server.mjs` 改回「有缺陷」的样子，
 * 看 `tools/mcp_server_smoke.mjs` 会不会报红。**报红才算守住了。**
 *
 * 每次跑完都把文件恢复原状。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "mcp-server.mjs");
const smokePath = join(here, "mcp_server_smoke.mjs");

const original = readFileSync(serverPath, "utf8");

function runSmoke() {
  try {
    execFileSync("node", [smokePath], { cwd: join(here, ".."), stdio: "pipe" });
    return { ok: true };
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    return {
      ok: false,
      assertionFailure: error.status === 1 && /AssertionError \[ERR_ASSERTION\]/.test(out)
        && !/SyntaxError|MCP 请求超时/.test(out),
      message: out.slice(-2000),
    };
  }
}

/** 每个用例：把实现改成缺陷状态，断言必须报红。 */
const CASES = [
  {
    name: "搜索只看已进索引的素材（没进索引的会漏）",
    patch: (source) =>
      source.replace(
        "const hits = rows.filter((row) => {",
        "const hits = rows.filter((row) => { if (row.id !== 'mat-indexed') return false;"
      ),
  },
  {
    name: "命中结果不带 resourceUri（读不回原文）",
    patch: (source) =>
      source.replace("resourceUri: `knowflick://materials/${row.id}`,", "resourceUri: '',"),
  },
  {
    name: "add_material 不同步 fts_materials（应用里搜不到）",
    patch: (source) =>
      source.replace(
        '      db.prepare(\n        "INSERT INTO fts_materials (material_id, title, raw_text, source_url) VALUES (?, ?, ?, ?)"\n      ).run(id, title, text, sourceUrl ?? "");',
        "      void id;"
      ),
  },
  {
    name: "软删除的素材也会被检索到",
    patch: (source) =>
      source.replace(
        "FROM materials WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ?",
        "FROM materials ORDER BY created_at DESC LIMIT ?"
      ),
  },
  {
    name: "多词检索退化成「整句 LIKE」（'release status' 找不到 'release rollout status'）",
    patch: (source) =>
      source.replace(
        "return tokens.every((token) => haystack.includes(token.toLowerCase()));",
        "return haystack.includes(trimmed.toLowerCase());"
      ),
  },
  {
    name: "无链接素材写成未登记的来源类型（界面上显示英文 'note'）",
    patch: (source) =>
      source.replace(
        ').run(id, sourceUrl ? "web" : "manual", title, sourceUrl, text, hash, now, now);',
        ').run(id, sourceUrl ? "web" : "note", title, sourceUrl, text, hash, now, now);'
      ),
  },
];

const baseline = runSmoke();
if (!baseline.ok) {
  console.error("FAIL 正常实现必须先通过 MCP 冒烟\n" + baseline.message);
  process.exit(1);
}

let failures = 0;
try {
  for (const testCase of CASES) {
    const patched = testCase.patch(original);
    if (patched === original) {
      console.log(`FAIL ${testCase.name} → 补丁没匹配上，这个用例测不到任何东西`);
      failures++;
      continue;
    }
    writeFileSync(serverPath, patched, "utf8");
    const result = runSmoke();
    if (result.ok) {
      console.log(`FAIL ${testCase.name} → 断言还是绿的（没守住）`);
      failures++;
    } else if (!result.assertionFailure) {
      console.error(`FAIL ${testCase.name} → 子进程失败，但没有可验证的断言失败\n${result.message}`);
      failures++;
    } else {
      console.log(`PASS ${testCase.name} → AssertionError 证实断言拒绝退化`);
    }
  }
} finally {
  // 无论成败都要恢复——这个脚本改的是**仓库里的真实文件**。
  writeFileSync(serverPath, original, "utf8");
}

if (failures) {
  console.log(`\n反向验证有 ${failures} 项没通过`);
  process.exit(1);
}
console.log(`\n反向验证全部通过：${CASES.length} 个用例的断言都真的在守东西`);

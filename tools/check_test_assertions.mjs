#!/usr/bin/env node
/**
 * 找出「空断言」——vitest 的 `expect(actual, message)` 后面不接 matcher 时**什么都不检查**。
 *
 * 为什么用 TypeScript 编译器 API 而不是正则：
 *
 * 1. 正则认不出**嵌套括号**。真正的回归形态是
 *    ```
 *    expect(
 *      /[一-鿿]/.test(label),
 *      `msg ${type}`,
 *    );
 *    ```
 *    里面那对括号让正则的括号配平彻底失准——这条断言就漏过去了。
 * 2. 正则按**行**判断，所以「一行到头、后面什么也没有」的 `expect(x)`（没写分号）
 *    会被当成「后面没东西=没问题」而放过。
 * 3. 正则**认得** `.not` 就算完，于是 `expect(x).not` 这种断在半路的链子能过关。
 *
 * AST 看的是真实结构，跟书写格式（换行、分号、单双引号）无关。
 *
 * 依赖：仓库里已有的 `apps/workbench/node_modules/typescript`——**不新增依赖**。
 *
 * 用法：`node tools/check_test_assertions.mjs <文件或目录> [...]`
 * 输出：JSON `{"scanned": [...], "problems": [...]}`（stdout）
 * 退出码：0 正常（问题在 JSON 里）；2 内部错误（消息写 stderr）
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 测试文件名：`*.test.ts` / `*.test.tsx`（外加 spec 变体）。 */
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|cts)$/;

/**
 * 「修饰词」：它们本身**不是**断言，只是把断言取反或改成异步等待。
 * 链子停在这里 = 断在半路，什么都没检查。
 */
const MODIFIERS = new Set(["not", "resolves", "rejects"]);

/**
 * vitest 的**非对称匹配器**：`expect.any(String)` 这类构造出来的东西，
 * 是拿去当别的断言的**参数**的，它自己不是断言。单独出现也不该报。
 */
const ASYMMETRIC = new Set([
  "any",
  "anything",
  "arrayContaining",
  "objectContaining",
  "stringContaining",
  "stringMatching",
  "closeTo",
]);

/** vitest 的静态辅助：`expect.assertions(1)` / `expect.hasAssertions()`——它们自己就是断言。 */
const HELPERS = new Set(["assertions", "hasAssertions"]);

/** `expect.soft(x)`——soft 版断言，和 `expect(x)` 同样要接 matcher。 */
const SOFT = "soft";

/** 仓库里已有的 typescript；按顺序找，找不到就报错——不能假装查过了。 */
function loadTypeScript() {
  const require = createRequire(import.meta.url);
  const candidates = [
    path.join(ROOT, "apps", "workbench", "node_modules", "typescript"),
    path.join(ROOT, "node_modules", "typescript"),
    "typescript",
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // 试下一个。
    }
  }
  return null;
}

/** 目录 → 目录下的测试文件；文件 → 它自己（但要检查它是不是测试文件）。 */
function expand(target) {
  const stats = statSync(target);
  if (!stats.isDirectory()) {
    return TEST_FILE.test(path.basename(target)) ? [path.resolve(target)] : [];
  }
  const found = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      found.push(...expand(child));
    } else if (TEST_FILE.test(entry.name)) {
      found.push(path.resolve(child));
    }
  }
  return found;
}

/** 跳过括号与非空断言（`(expect(x)).toBe(1)` / `expect(x)!.toBe(1)`）。 */
function skipTransparent(ts, node) {
  let current = node;
  for (;;) {
    const parent = current.parent;
    if (!parent) return current;
    if (ts.isParenthesizedExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }
    if (ts.isNonNullExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }
    return current;
  }
}

/**
 * 这个文件自己声明了一个叫 `expect` 的东西（本地函数、参数、来自别的模块的 import）——
 * 那它就不是 vitest 的 `expect`，规则不适用，整个文件跳过。
 */
function shadowsExpect(ts, sourceFile) {
  // import：只有从 "vitest" 导入的 `expect` 才是 vitest 的 expect。
  // 从别的模块导入同名 expect（或是 default import）= 另一套东西，规则不适用。
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    const fromVitest = ts.isStringLiteral(specifier) && specifier.text === "vitest";
    const clause = statement.importClause;
    if (!clause) continue;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.name.text !== "expect") continue;
        // `import { expect } from "vitest"` 之外的任何一种同名导入都算「不是 vitest 的 expect」。
        if (!fromVitest) return true;
      }
    } else if (clause.name && clause.name.text === "expect") {
      // default import：`import expect from "./my-expect"`。
      return true;
    }
  }

  // 本地声明：函数、变量、参数、解构——都叫 expect 的话就不是 vitest 的 expect。
  let shadowed = false;
  const visit = (node) => {
    if (shadowed) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "expect") {
      shadowed = true;
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === "expect") {
      shadowed = true;
      return;
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === "expect") {
      shadowed = true;
      return;
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.name.text === "expect") {
      shadowed = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return shadowed;
}

/**
 * 从 `expect(...)` 出发，把后面的链子走完。
 *
 * 返回链上每一环：名字 + 「这一环是不是真的被调用了」。
 * `expect(x).not.toBe(1)` → [{not, false}, {toBe, true}]
 * `expect(x).not`         → [{not, false}]
 * `expect(x).toBe`        → [{toBe, false}]   ← matcher 写了但没调用
 */
function readChain(ts, call) {
  const chain = [];
  let opaque = false;
  let current = skipTransparent(ts, call);
  for (;;) {
    const parent = current.parent;
    if (!parent) break;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      const grandparent = parent.parent;
      const called = Boolean(
        grandparent &&
          ts.isCallExpression(grandparent) &&
          grandparent.expression === parent
      );
      chain.push({ name: parent.name.text, called });
      current = parent;
      continue;
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === current) {
      // `expect(x)["toBe"]` —— 认不出这个形状就不报：认不出 ≠ 没有。
      opaque = true;
      current = parent;
      continue;
    }
    break;
  }
  return { chain, end: current, opaque };
}

/**
 * 判断一个 `expect(...)` 调用是不是空断言。
 *
 * 规则只看**链子**：
 * - 一环都没有 → 裸 expect，后面什么也不检查（bare）；
 * - 链子最后一环是 `.not` / `.resolves` / `.rejects` → 断在半路（unfinished）；
 * - 最后一环是属性访问但**没被调用**（`expect(x).toBe`）→ matcher 写了没执行（unfinished）；
 * - 其余（`.toBe(...)`、`.not.toBe(...)`、`.resolves.toBe(...)`、`.toThrow(...)`）
 *   → 有 matcher，放过。
 *
 * 链子里出现**不认识的**属性名时一律放过：那是自定义 matcher 的可能位置，
 * 猜错只会误报——误报会把人训练成忽略这条守卫。
 */
function analyzeExpectCall(ts, call) {
  const { chain, end, opaque } = readChain(ts, call);
  if (opaque) {
    // 链子的形状认不出来 → 不报。误报会把人训练成忽略这条守卫。
    return null;
  }
  if (chain.length === 0) {
    return { kind: "bare", end };
  }
  const last = chain[chain.length - 1];
  if (MODIFIERS.has(last.name)) {
    return { kind: "unfinished", modifier: last.name, end };
  }
  if (!last.called) {
    // `expect(x).toBe` —— matcher 写了但没调用。
    return { kind: "unfinished", modifier: last.name, end };
  }
  return null;
}

/** 找出文件里所有「可能发起断言」的调用。 */
function findExpectCalls(ts, sourceFile) {
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === "expect") {
        calls.push({ node, kind: "plain" });
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "expect"
      ) {
        const name = callee.name.text;
        if (ASYMMETRIC.has(name) || HELPERS.has(name)) {
          // 非对称匹配器与静态辅助：它们不是断言，不查。
        } else if (name === SOFT) {
          calls.push({ node, kind: "soft" });
        } else {
          calls.push({ node, kind: "unknown-static" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function snippet(sourceFile, node) {
  const text = node.getText(sourceFile).replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function analyzeFile(ts, filePath) {
  const text = readFileSync(filePath, "utf8");
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind
  );

  // 语法坏掉的测试文件本身就是问题——不能因为「解析不了」就当它没问题。
  const parseErrors = sourceFile.parseDiagnostics || [];
  if (parseErrors.length > 0) {
    const first = parseErrors[0];
    const { line } = sourceFile.getLineAndCharacterOfPosition(first.start || 0);
    return [
      {
        kind: "parse-error",
        file: filePath,
        line: line + 1,
        text: "这个文件解析不过，守卫看不懂它——先修语法",
      },
    ];
  }

  if (shadowsExpect(ts, sourceFile)) {
    return [];
  }

  const problems = [];
  for (const { node, kind } of findExpectCalls(ts, sourceFile)) {
    if (kind === "unknown-static") {
      // `expect.xxx(...)` 里的 xxx 不认识（自定义静态方法之类）——放过，别猜。
      continue;
    }
    const verdict = analyzeExpectCall(ts, node);
    if (!verdict) continue;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    problems.push({
      kind: verdict.kind,
      modifier: verdict.modifier,
      file: filePath,
      line: line + 1,
      text: snippet(sourceFile, verdict.end),
    });
  }
  return problems;
}

function fsExists(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

function main(argv) {
  const targets = argv.filter((arg) => !arg.startsWith("--"));
  if (targets.length === 0) {
    process.stderr.write("用法：node tools/check_test_assertions.mjs <文件或目录> [...]\n");
    return 2;
  }

  const ts = loadTypeScript();
  if (!ts) {
    process.stderr.write(
      "找不到 typescript（apps/workbench/node_modules/typescript）——先跑 npm ci，别猜。\n"
    );
    return 2;
  }

  const files = [];
  for (const target of targets) {
    const resolved = path.resolve(target);
    if (!fsExists(resolved)) {
      process.stderr.write(`路径不存在：${resolved}\n`);
      return 2;
    }
    files.push(...expand(resolved));
  }
  const unique = [...new Set(files)].sort();

  const problems = [];
  for (const file of unique) {
    problems.push(...analyzeFile(ts, file));
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        scanned: unique,
        problems: problems.sort((a, b) =>
          a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1
        ),
      },
      null,
      2
    )}\n`
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));

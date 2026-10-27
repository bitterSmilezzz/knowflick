#!/usr/bin/env python3
"""回归：空断言守卫要真的抓得住空断言。

`expect(actual, message)` 后面不接 matcher 时，vitest **什么都不检查**，
测试照样绿。这条守卫就是防这个的。

第一版守卫是**正则**写的，抓不住三件事——这三条各自都是真实漏网：

1. **嵌套括号**。真实的回归形态就是多行 + 内嵌括号：
   ```
   expect(
     /[一-鿿]/.test(label),
     `msg ${type}`,
   );
   ```
   正则的括号配平在这里彻底失准。
2. **裸 expect 没有分号**：`expect(x)` 独占一行，正则按行找 `.matcher`，
   「后面什么也没有」被当成「没问题」。
3. **断在半路的链子**：`expect(x).not` / `.resolves` —— 正则认得 `.not` 就算完，
   于是断链能过关。

所以守卫改成走 TypeScript 编译器 API（`tools/check_test_assertions.mjs`），
本文件验的是**改完之后**它真的能抓、且不误报。

**所有用例都在临时目录里造**——不改动仓库里的任何文件。
"""
from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

import check_test_assertions as checker


class GuardTestBase(unittest.TestCase):
    """共用工具：造临时目录、跑守卫、取出它报出的问题。"""

    def _problems_for(self, source: str, filename: str = "fixture.test.ts") -> list[str]:
        """把源码写进临时目录，跑守卫，返回它报出的问题。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / filename).write_text(source, encoding="utf-8")
            return self._problems_for_dir(root)

    def _problems_for_dir(self, directory: Path) -> list[str]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = checker.main(directory)
        text = buf.getvalue()
        problems = [
            line.strip()
            for line in text.splitlines()
            if line.strip().startswith("-")
        ]
        if problems:
            self.assertEqual(code, 1, f"有问题时退出码必须是 1：{text}")
        else:
            self.assertEqual(code, 0, f"没问题时退出码必须是 0：{text}")
        return problems


class EmptyAssertionGuardTest(GuardTestBase):
    """仓库现状：不该有空断言。"""

    def test_repository_has_no_empty_assertions(self):
        problems = self._problems_for_dir(checker.SRC)
        self.assertEqual(problems, [], "有空断言：\n" + "\n".join(problems))

    def test_repository_test_files_are_actually_scanned(self):
        """守卫不能「什么都没扫还说没问题」。"""
        result = checker.run_scanner(checker.SRC)
        self.assertGreater(
            len(result["scanned"]),
            10,
            "扫到的测试文件太少——守卫是不是没真的扫？",
        )


class DetectorTest(GuardTestBase):
    """每种形态造一个临时目录，验守卫抓得住 / 抓不住。"""

    def test_detects_the_original_regression_with_nested_parens(self):
        """真实的回归形态：多行 + 内嵌括号 + 没有 matcher。

        正则版在这条上失准（括号配平），AST 版必须抓住。
        """
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("来源标签是中文", () => {
              expect(
                /[一-鿿]/.test(label),
                `msg ${type}`,
              );
            });
            """
        )
        self.assertTrue(problems, f"没抓出那个嵌套括号形态的空断言：{problems}")

    def test_detects_bare_expect_without_semicolon(self):
        """裸 expect 且没写分号——正则按行判断时会放过。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("裸的", () => {
              expect(value)
            });
            """
        )
        self.assertTrue(problems, f"没抓出没有分号的裸 expect：{problems}")

    def test_detects_unfinished_not_chain(self):
        """`.not` 后面没有 matcher——断在半路，什么都没检查。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("断链", () => {
              expect(value).not
            });
            """
        )
        self.assertTrue(problems, f"没抓出断在 .not 上的链子：{problems}")

    def test_detects_unfinished_resolves_chain(self):
        """`.resolves` 后面没有 matcher——同样是断链。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("断链", async () => {
              expect(promise).resolves
            });
            """
        )
        self.assertTrue(problems, f"没抓出断在 .resolves 上的链子：{problems}")

    def test_detects_matcher_written_but_never_called(self):
        """`expect(x).toBe` —— matcher 写了但没调用，等于没断言。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("没调用", () => {
              expect(value).toBe
            });
            """
        )
        self.assertTrue(problems, f"没抓出写了没调用的 matcher：{problems}")

    def test_ignores_asymmetric_matchers(self):
        """`expect.any(...)` 是拿去当参数的构造器，它自己不是断言。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("非对称匹配器", () => {
              expect(fn).toHaveBeenCalledWith(expect.any(String));
              expect(obj).toEqual(expect.objectContaining({ a: 1 }));
              const ctor = expect.any(Number);
            });
            """
        )
        self.assertEqual(problems, [], f"非对称匹配器不该被报：{problems}")

    def test_ignores_to_throw(self):
        """`expect(...).toThrow(...)` 是真断言。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("抛错", () => {
              expect(() => boom()).toThrow();
              expect(() => boom()).toThrow(/boom/);
              expect(fn).not.toThrow();
            });
            """
        )
        self.assertEqual(problems, [], f"toThrow 不该被报：{problems}")

    def test_ignores_valid_matcher_chains(self):
        """各种合法链子都不该被报。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("合法", () => {
              expect(value).toBe(1);
              expect(value).not.toBe(1);
              expect(promise).resolves.toBe(1);
              expect(promise).rejects.toThrow();
              expect(list).toHaveLength(3);
              expect(text).toContain("a");
            });
            """
        )
        self.assertEqual(problems, [], f"合法链子不该被报：{problems}")

    def test_ignores_static_helpers(self):
        """`expect.assertions(1)` / `expect.hasAssertions()` 是断言本身。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("辅助", () => {
              expect.assertions(1);
              expect.hasAssertions();
            });
            """
        )
        self.assertEqual(problems, [], f"静态辅助不该被报：{problems}")

    def test_ignores_a_file_that_defines_its_own_expect(self):
        """文件自己声明了 expect（本地函数、别的模块导来的）——那不是 vitest 的 expect。"""
        problems = self._problems_for(
            """
            import { expect } from "./my-expect";

            it("自己的 expect", () => {
              expect(1);
            });
            """
        )
        self.assertEqual(problems, [], f"自己的 expect 不该被报：{problems}")

    def test_ignores_custom_matchers(self):
        """自定义 matcher（expect.extend 出来的）不该被当成断链。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            expect.extend({ toBeCustom(received: unknown) { return true; } });

            it("自定义 matcher", () => {
              expect(1).toBeCustom(1);
            });
            """
        )
        self.assertEqual(problems, [], f"自定义 matcher 不该被报：{problems}")

    def test_reports_a_file_it_cannot_parse(self):
        """语法坏掉的文件——守卫看不懂它，就要说看不懂，不能当没问题。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("写坏了", () => {
              expect(1).toBe(1)
            """
        )
        self.assertTrue(problems, f"解析不过的文件该被报出来：{problems}")
        self.assertTrue(
            any("解析" in p for p in problems),
            f"要说清是解析不过：{problems}",
        )

    def test_reports_the_line_number(self):
        """报出来的问题要指准行——不然没法改。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("断链", () => {
              expect(value).not
            });
            """
        )
        self.assertTrue(problems, "应该报出问题")
        # 源码里 `expect(value).not` 是第 5 行（开头那个空行让行号往后挪了一格）。
        self.assertTrue(
            any(":5" in p for p in problems),
            f"问题里要带行号（这里应该是第 5 行）：{problems}",
        )

    def test_reports_the_file_name(self):
        """报出来的问题要指准文件。"""
        problems = self._problems_for(
            """
            import { describe, expect, it } from "vitest";

            it("裸的", () => {
              expect(value)
            });
            """,
            filename="someFixture.test.ts",
        )
        self.assertTrue(problems, "应该报出问题")
        self.assertTrue(
            any("someFixture.test.ts" in p for p in problems),
            f"问题里要带文件名：{problems}",
        )

    def test_scopes_to_the_given_directory_only(self):
        """只扫给它的目录——旁边的文件不该被算进来。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "clean").mkdir()
            (root / "dirty").mkdir()
            (root / "clean" / "clean.test.ts").write_text(
                'import { expect, it } from "vitest";\n'
                'it("ok", () => { expect(1).toBe(1); });\n',
                encoding="utf-8",
            )
            (root / "dirty" / "dirty.test.ts").write_text(
                'import { expect, it } from "vitest";\n'
                'it("bad", () => { expect(1) });\n',
                encoding="utf-8",
            )
            problems = self._problems_for_dir(root / "clean")
            self.assertEqual(problems, [], f"干净目录不该有问题：{problems}")


if __name__ == "__main__":
    unittest.main()

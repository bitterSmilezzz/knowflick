import { describe, expect, it } from "vitest";
import { userError, userErrorWith } from "./userError";

/**
 * 用户看到的第一句错误，**一定是中文**。
 *
 * Rust 侧的错误现在都有中文了，但前端有十几处 `setError(String(err))`
 * ——一点中文都没有，用户看到的是底层库抛的原始字符串（多半是英文）。
 * 这条锁住共享兜底的行为。
 */
describe("userError", () => {
  it("中文错误原样显示", () => {
    expect(userError("邮件服务器拒绝了这次请求：请检查账号密码")).toBe(
      "邮件服务器拒绝了这次请求：请检查账号密码",
    );
  });

  it("Error 对象取 message", () => {
    expect(userError(new Error("保存失败，请重试"))).toBe("保存失败，请重试");
  });

  it("**英文错误不直接透给用户**", () => {
    const shown = userError("Invalid account email");
    expect(shown).not.toBe("Invalid account email");
    expect(/[一-鿿]/.test(shown)).toBe(true);
    // 原始信息保留——它是开发者定位问题用的
    expect(shown).toContain("Invalid account email");
  });

  it("空错误有兜底文案", () => {
    expect(userError("")).toBe("操作未完成，请重试");
    expect(userError(null)).toBe("操作未完成，请重试");
    expect(userError(undefined)).toBe("操作未完成，请重试");
  });

  it("兜底文案可以自定义", () => {
    expect(userError("", "正在读取，请稍候")).toBe("正在读取，请稍候");
  });

  it("userErrorWith 带上中文上下文", () => {
    expect(userErrorWith("导出失败", new Error("磁盘满了"))).toBe("导出失败：磁盘满了");
  });

  it("userErrorWith 在原因缺失时也说得通", () => {
    expect(userErrorWith("导出失败", "")).toBe("导出失败，请重试");
  });
});

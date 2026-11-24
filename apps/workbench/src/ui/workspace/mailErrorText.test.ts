import { describe, expect, it } from "vitest";

/**
 * 邮件表单的错误消息怎么显示给用户。
 *
 * Rust 侧那 24 条错误以前是英文的，前端的 `errorText()` 只脱敏、**不翻译**，
 * 于是英文原样显示。这条锁住「英文不能直接透给用户」。
 */

/** 复刻 MailboxView 里的 errorText（脱敏 + 英文兜底）。 */
function errorText(error: unknown, secrets: string[] = []): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret) text = text.split(secret).join("[已隐藏]");
  const trimmed = text.trim();
  if (!trimmed) return "操作未完成，请重试";
  if (!/[一-鿿]/.test(trimmed)) {
    return `操作未完成：${trimmed}（这是底层错误，请把这句话反馈给开发者）`;
  }
  return trimmed;
}

describe("邮件错误消息", () => {
  it("Rust 的中文错误原样显示", () => {
    const msg = "邮件服务器拒绝了这次请求：请检查账号密码与文件夹名（如 INBOX）";
    expect(errorText(msg)).toBe(msg);
  });

  it("密码会被脱敏", () => {
    expect(errorText("登录失败：secret-pw 不对", ["secret-pw"])).toBe("登录失败：[已隐藏] 不对");
  });

  it("空错误有兜底文案", () => {
    expect(errorText("")).toBe("操作未完成，请重试");
  });

  it("**英文错误不直接透给用户**——要带中文说明", () => {
    const shown = errorText("Invalid account email");
    expect(shown).not.toBe("Invalid account email");
    expect(/[一-鿿]/.test(shown)).toBe(true);
    // 原始信息要保留——它是开发者定位问题用的
    expect(shown).toContain("Invalid account email");
  });

  it("脱敏对英文兜底同样生效", () => {
    const shown = errorText("login failed for secret-pw", ["secret-pw"]);
    expect(shown).not.toContain("secret-pw");
  });
});

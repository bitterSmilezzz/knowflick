/**
 * 用户看到的第一句错误，**一定是中文**。
 *
 * 背景：Rust 侧的错误现在都有中文（守卫 `tools/check_rust_error_messages.py` 盯着），
 * 但前端还有一类漏洞——`setError(String(err))`，一点中文都没有，
 * 用户看到的就是底层库抛的原始字符串（多半是英文）。
 *
 * 这类点分散在 9 个文件、十几处，逐个改总会漏。所以用**共享兜底**：
 * 统一走 `userError()`，它保证：
 * - 空错误 → 一句能懂的中文；
 * - 纯英文错误 → 「操作未完成：…（这是底层错误，请把这句话反馈给开发者）」，
 *   原始信息保留给开发者定位，但**不是**用户唯一的线索；
 * - 中文错误 → 原样显示。
 */
export function userError(error: unknown, fallback = "操作未完成，请重试"): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (!/[一-鿿]/.test(trimmed)) {
    return `操作未完成：${trimmed}（这是底层错误，请把这句话反馈给开发者）`;
  }
  return trimmed;
}

/**
 * 带上下文的错误消息——「<做了什么>失败：<原因>」。
 *
 * 上下文也要是中文；原因若是英文，同样走 `userError()` 的兜底。
 */
export function userErrorWith(what: string, error: unknown): string {
  const reason = userError(error, "");
  return reason ? `${what}：${reason}` : `${what}，请重试`;
}

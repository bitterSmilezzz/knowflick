/**
 * 导入转换报告（R2「导入向导」的持久化部分）。
 *
 * 为什么不能只用提示条：导 50 个文件，失败 3 个——提示条 4 秒消失后，
 * 「哪三个、为什么」就没了。路线图 R2 把「转换报告」与失败清单并列为
 * 导入向导的交付物；这里把每次导入的结果存成可回看的一条记录。
 *
 * 纯函数：桌面与浏览器体验共用同一语义（桌面持久化到 meta 表，
 * 浏览器持久化到 localStorage——由 repository 路由）。
 */

export interface ImportReport {
  /** 完成时刻（epoch ms）。 */
  at: number;
  /** 成功导入的标题。 */
  ok: string[];
  /** 与库内内容相同而跳过的标题。 */
  skipped: string[];
  /** 失败项与原因。 */
  failed: Array<{ name: string; reason: string }>;
}

export const emptyImportReport = (): ImportReport | null => null;

export function buildImportReport(input: { ok: string[]; skipped: string[]; failed: Array<{ name: string; reason: string }> }, now = Date.now()): ImportReport {
  return { at: now, ok: [...input.ok], skipped: [...input.skipped], failed: input.failed.map((f) => ({ ...f })) };
}

/** 汇总一句话（与导入完成提示同一口径，供回执与报告头部共用）。 */
export function summarizeReport(report: ImportReport): string {
  const parts: string[] = [];
  if (report.ok.length) parts.push(`已导入 ${report.ok.length} 条`);
  if (report.skipped.length) parts.push(`${report.skipped.length} 个与库里内容相同已跳过`);
  if (report.failed.length) parts.push(`${report.failed.length} 个失败`);
  return parts.join("；") || "没有需要导入的文件";
}

export function serializeImportReport(report: ImportReport): string {
  return JSON.stringify(report);
}

/** 损坏的报告按无报告处理（不阻塞界面），不能让一条旧记录把导入页弄崩。 */
export function parseImportReport(raw: string | null | undefined): ImportReport | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<ImportReport>;
    if (!Array.isArray(j.ok) || !Array.isArray(j.skipped) || !Array.isArray(j.failed) || typeof j.at !== "number") return null;
    return { at: j.at, ok: j.ok.map(String), skipped: j.skipped.map(String), failed: j.failed.map((f) => ({ name: String(f?.name ?? ""), reason: String(f?.reason ?? "") })) };
  } catch {
    return null;
  }
}

/** 报告在界面上渲染的行（报告主体 + 时间）。 */
export function reportLines(report: ImportReport): Array<{ kind: "ok" | "skipped" | "failed"; text: string }> {
  const lines: Array<{ kind: "ok" | "skipped" | "failed"; text: string }> = [];
  for (const t of report.ok) lines.push({ kind: "ok", text: t });
  for (const t of report.skipped) lines.push({ kind: "skipped", text: t });
  for (const f of report.failed) lines.push({ kind: "failed", text: `${f.name}（${f.reason}）` });
  return lines;
}

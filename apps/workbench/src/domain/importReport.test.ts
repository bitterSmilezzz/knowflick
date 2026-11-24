import { describe, expect, it } from "vitest";
import { buildImportReport, parseImportReport, reportLines, serializeImportReport, summarizeReport } from "./importReport";

describe("导入转换报告（R2 导入向导）", () => {
  const sample = buildImportReport({
    ok: ["网页剪藏.md", "会议记录.md"],
    skipped: ["重复内容.md"],
    failed: [{ name: "weird.xyz", reason: "暂不支持这种格式" }],
  }, 1000);

  it("构建 → 序列化 → 解析无损往返", () => {
    const parsed = parseImportReport(serializeImportReport(sample));
    expect(parsed).toEqual(sample);
  });

  it("损坏或形状不对的报告按无报告处理（不阻塞界面）", () => {
    expect(parseImportReport(null)).toBeNull();
    expect(parseImportReport("不是 JSON")).toBeNull();
    expect(parseImportReport(JSON.stringify({ ok: "不是数组" }))).toBeNull();
    expect(parseImportReport(JSON.stringify({ ok: [], skipped: [], failed: [] }))).toBeNull(); // 缺 at
  });

  it("汇总句与导入完成提示同口径；报告行带类型标签", () => {
    expect(summarizeReport(sample)).toBe("已导入 2 条；1 个与库里内容相同已跳过；1 个失败");
    const lines = reportLines(sample);
    expect(lines.map(l => l.kind)).toEqual(["ok", "ok", "skipped", "failed"]);
    expect(lines[3].text).toBe("weird.xyz（暂不支持这种格式）");
  });

  it("全失败与全跳过的汇总不遗漏", () => {
    expect(summarizeReport(buildImportReport({ ok: [], skipped: [], failed: [{ name: "a", reason: "x" }] }))).toBe("1 个失败");
    expect(summarizeReport(buildImportReport({ ok: [], skipped: [], failed: [] }))).toBe("没有需要导入的文件");
  });
});

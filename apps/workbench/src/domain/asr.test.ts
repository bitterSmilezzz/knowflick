import { describe, expect, it } from "vitest";
import {
  ASR_MODELS,
  DEFAULT_ASR_MODEL,
  findAsrModel,
  formatBytes,
  realtimeFactor,
  titleFromTranscript,
} from "./asr";

describe("本地语音转写的界面侧约定", () => {
  it("模型目录与 Rust 的 MODEL_CATALOG 同名同序", () => {
    expect(ASR_MODELS.map((m) => m.id)).toEqual(["tiny", "base", "small"]);
    for (const model of ASR_MODELS) {
      expect(model.approxBytes).toBeGreaterThan(0);
      expect(model.label).toBeTruthy();
      expect(model.note).toBeTruthy();
    }
    expect(findAsrModel(DEFAULT_ASR_MODEL)).toBeTruthy();
    expect(findAsrModel("gigantic")).toBeUndefined();
  });

  it("体积格式化覆盖 B / KB / MB / GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(77_700_000)).toBe("74 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("标题取第一行有内容的最长 80 字", () => {
    expect(titleFromTranscript("第一行\n第二行")).toBe("第一行");
    expect(titleFromTranscript("\n\n  只有第三行  ")).toBe("只有第三行");
    expect(titleFromTranscript("   ")).toBe("语音记录");
    expect(titleFromTranscript("", "自定义兜底")).toBe("自定义兜底");
    const long = "长".repeat(100);
    expect(titleFromTranscript(long)).toBe(`${"长".repeat(80)}…`);
  });

  it("实时倍率算得出来，缺数据时给破折号", () => {
    expect(realtimeFactor(4000, 2000)).toBe("0.50× 实时");
    expect(realtimeFactor(0, 100)).toBe("—");
    expect(realtimeFactor(100, 0)).toBe("—");
  });
});

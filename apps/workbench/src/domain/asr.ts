/**
 * 本地语音转写的界面侧约定。
 *
 * 引擎在 Rust（`src-tauri/src/asr.rs`，whisper.cpp via whisper-rs）。这里只放
 * 模型目录、可用性判断与把转写结果落成素材时的默认值——刻意不复制任何推理逻辑，
 * 免得两份「支持哪些模型」的清单漂移。
 */

export type AsrModelId = "tiny" | "base" | "small";

export interface AsrModelSpec {
  id: AsrModelId;
  label: string;
  /** 大致体积，用于下载前告知用户要拉多少数据。 */
  approxBytes: number;
  note: string;
}

/** 与 `asr.rs` 的 `MODEL_CATALOG` 对应；改动时两边一起改。 */
export const ASR_MODELS: readonly AsrModelSpec[] = [
  { id: "tiny", label: "tiny（最快）", approxBytes: 77_700_000, note: "75 MB 左右，速度快但准确率一般，适合口述备忘" },
  { id: "base", label: "base", approxBytes: 147_900_000, note: "140 MB 左右，速度与准确率折中" },
  { id: "small", label: "small（推荐）", approxBytes: 487_600_000, note: "470 MB 左右，准确率明显更好，内存占用也更高" },
];

export const DEFAULT_ASR_MODEL: AsrModelId = "small";

export function findAsrModel(id: string): AsrModelSpec | undefined {
  return ASR_MODELS.find((m) => m.id === id);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** 转写文本 → 素材标题：取第一行有内容的，最长 80 字。 */
export function titleFromTranscript(text: string, fallback = "语音记录"): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return fallback;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

/** 转写耗时里「每秒音频用多少秒算完」，用来给用户一个体感预期。 */
export function realtimeFactor(audioMs: number, elapsedMs: number): string {
  if (!audioMs || !elapsedMs) return "—";
  return `${(elapsedMs / audioMs).toFixed(2)}× 实时`;
}

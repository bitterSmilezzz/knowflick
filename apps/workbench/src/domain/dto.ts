/**
 * 跨层共享的数据形状（T11：领域模块不必通过具体 Tauri 模块获得 DTO）。
 *
 * 这些形状原来定义在 `shell/store.ts`（宿主层），于是 domain 里的纯规则
 * 模块（reviewFacts / restoreRules …）不得不从宿主 import 类型——规则与
 * 宿主耦在一起，改宿主类型就会牵动规则。把形状移到 domain，宿主从这边
 * 取并再导出，定义只有一处，依赖方向也对了（domain 不依赖 shell）。
 */

/** 一份原始素材（收件箱/库里的内容条目）。 */
export interface RawMaterial {
  id: string;
  sourceType: string;
  title: string;
  sourceUrl?: string | null;
  rawText: string;
  cleanedMarkdown?: string | null;
  contentHash: string;
  mediaPath?: string | null;
  mediaSizeBytes?: number;
  metadataJson: string;
  inboxStatus: "inbox" | "processed" | "dismissed";
  createdAt: number;
  updatedAt: number;
}

/** 一个目标（R4/D04）：完成条件是判定的唯一依据。 */
export interface Goal {
  id: string;
  title: string;
  doneCriteria: string;
  scope: string | null;
  createdAt: number;
  achievedAt: number | null;
  abandonedAt: number | null;
  reviewNote: string;
  evidenceCount: number;
}

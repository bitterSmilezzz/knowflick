import { inShell } from "../../shell/store";
import { restorableArtifacts, restorableCards, restorableMaterials } from "../../domain/restoreRules";
import { restoreNotesBundle } from "./notesRestore";
import type { Artifact, RawMaterial } from "../../shell/store";
import type { KnowledgeCard } from "../../domain/card";
import type { KnowledgeBase, Note } from "../../domain/note";
import type { RestoredBackup } from "../../domain/systemBackup";

/**
 * 整份备份恢复的一致性与失败报告（T05，收口审计 KF-007）。
 *
 * 旧实现的问题：外层 catch 一律写「本地内容未受影响」，但中途失败时前面
 * 已经写进去的多条**并没有回滚**；附件保存失败还把素材的 mediaPath 改成
 * null 继续报告完成。用户看到错误后无法判断本地被改了多少。
 *
 * 这里把恢复拆成两段：
 * - **预检**：先算出「将新增/覆盖/跳过多少」，附件先落盘暂存；
 * - **执行**：每类条目各自处置，失败逐条记录；
 * 报告区分「完整恢复」与「部分恢复」，并列出失败明细（可导出）。
 *
 * 附件失败的处理：素材**不落库**（而不是把 mediaPath 静默改成 null）——
 * 半条记录比没有这条更糟，它看起来正常、实际附件丢了。
 */

/** 单条失败：kind + 标识 + 原因。 */
export interface RestoreFailure {
  kind: "material" | "card" | "artifact" | "note" | "knowledgeBase" | "membership" | "media" | "settings";
  id: string;
  error: string;
}

export interface RestorePlan {
  materials: number;
  cards: number;
  artifacts: number;
  notes: number;
  knowledgeBases: number;
  media: number;
}

export interface RestoreReport {
  /** 预检算出的范围（将处理多少条）。 */
  plan: RestorePlan;
  /** 实际写成功多少条。 */
  written: RestorePlan;
  /** 按规则跳过多少条（如修订更新的笔记）。 */
  skipped: { notes: number; materials: number; cards: number; artifacts: number };
  /** 逐条失败明细。 */
  failures: RestoreFailure[];
  /** 是否为部分恢复（有失败，或有该写未写）。 */
  partial: boolean;
  /** 是否被用户取消。 */
  cancelled: boolean;
}

/** 取消令牌：执行期间检查，中途可停。 */
export interface RestoreCancel {
  cancelled: boolean;
}

export function emptyRestoreReport(): RestoreReport {
  return {
    plan: { materials: 0, cards: 0, artifacts: 0, notes: 0, knowledgeBases: 0, media: 0 },
    written: { materials: 0, cards: 0, artifacts: 0, notes: 0, knowledgeBases: 0, media: 0 },
    skipped: { notes: 0, materials: 0, cards: 0, artifacts: 0 },
    failures: [],
    partial: false,
    cancelled: false,
  };
}

/** 把失败明细导出成可读的 Markdown（用户可贴给外部工具排查）。 */
export function restoreFailuresToMarkdown(report: RestoreReport): string {
  const lines: string[] = ["# 备份恢复失败明细", ""];
  lines.push(`计划：素材 ${report.plan.materials}、卡片 ${report.plan.cards}、产物 ${report.plan.artifacts}、笔记 ${report.plan.notes}、知识库 ${report.plan.knowledgeBases}、附件 ${report.plan.media}`);
  lines.push(`成功：素材 ${report.written.materials}、卡片 ${report.written.cards}、产物 ${report.written.artifacts}、笔记 ${report.written.notes}、知识库 ${report.written.knowledgeBases}、附件 ${report.written.media}`);
  if (report.cancelled) lines.push("**本次恢复被用户取消——以上为取消前已完成的范围。**");
  lines.push("");
  if (report.failures.length === 0) {
    lines.push("没有失败条目。");
    return lines.join("\n");
  }
  lines.push(`失败 ${report.failures.length} 条：`, "");
  for (const f of report.failures) {
    lines.push(`- **${f.kind}** \`${f.id}\`：${f.error}`);
  }
  return lines.join("\n");
}

/** 附件暂存器：落盘并返回「包内路径 → 本机路径」的映射与失败清单。 */
export type MediaStager = (rel: string, bytes: Uint8Array) => Promise<string>;

/**
 * 执行整份恢复。`stager` 负责把附件字节落到本机并返回可用的库内相对路径。
 */
/** 恢复的写入依赖（由 Workspace 提供——它才有 updateMaterial/updateCard 的实现）。 */
export interface RestoreSink {
  /** 写素材（mediaPath 已在调用方换成本机路径）。 */
  updateMaterial: (material: RawMaterial) => Promise<void>;
  /** 写卡片。 */
  updateCard: (card: KnowledgeCard) => Promise<void>;
  /** 写认知产物（浏览器模式没有这层，实现可留空）。 */
  saveArtifact?: (artifact: Artifact) => Promise<void>;
  /** 写设置。 */
  saveSettings?: (settings: NonNullable<RestoredBackup["settings"]>) => Promise<void>;
}

export async function executeRestore(
  restored: RestoredBackup,
  dir: string,
  stager: MediaStager,
  sink: RestoreSink,
  options: { cancel?: RestoreCancel; onProgress?: (done: number, total: number) => void } = {}
): Promise<RestoreReport> {
  const report = emptyRestoreReport();
  const cancel = options.cancel ?? { cancelled: false };

  // ---------- 预检：算出范围 ----------
  const materials = restorableMaterials(restored.materials);
  const cards = restorableCards(restored.cards);
  const artifacts = restorableArtifacts(restored.artifacts);
  report.plan = {
    materials: materials.length,
    cards: cards.length,
    artifacts: artifacts.length,
    notes: restored.notes.length,
    knowledgeBases: restored.knowledgeBases.length,
    media: restored.media.size,
  };

  const totalSteps =
    report.plan.media + report.plan.materials + report.plan.cards + report.plan.artifacts + report.plan.notes + 1;
  let done = 0;
  const tick = () => {
    done++;
    options.onProgress?.(done, totalSteps);
  };

  // ---------- 附件暂存：先落盘，失败的不进后续 ----------
  const restoredMedia = new Map<string, string>();
  const mediaFailures: RestoreFailure[] = [];
  for (const [rel, bytes] of restored.media) {
    if (cancel.cancelled) {
      report.cancelled = true;
      break;
    }
    try {
      restoredMedia.set(rel, await stager(rel, bytes));
      report.written.media++;
    } catch (err) {
      mediaFailures.push({ kind: "media", id: rel, error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }
  if (report.cancelled) {
    report.failures.push(...mediaFailures);
    report.partial = true;
    return report;
  }

  // ---------- 素材：附件失败的条目**不落库**（不把引用改成 null 蒙混过去） ----------
  for (const m of materials) {
    if (cancel.cancelled) {
      report.cancelled = true;
      break;
    }
    try {
      let mediaPath = m.mediaPath;
      if (m.mediaPath) {
        const saved = restoredMedia.get(m.mediaPath);
        if (!saved) {
          const reason = mediaFailures.find((f) => f.id === m.mediaPath);
          report.failures.push({
            kind: "material",
            id: m.id,
            error: `附件未能恢复（${reason?.error ?? "附件缺失"}），这条素材未落库`,
          });
          report.skipped.materials++;
          tick();
          continue;
        }
        mediaPath = saved;
      }
      await sink.updateMaterial({ ...m, mediaPath, mediaSizeBytes: m.mediaSizeBytes || 0 });
      report.written.materials++;
    } catch (err) {
      report.failures.push({ kind: "material", id: m.id, error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  // ---------- 卡片 ----------
  for (const c of cards) {
    if (cancel.cancelled) {
      report.cancelled = true;
      break;
    }
    try {
      await sink.updateCard(c);
      report.written.cards++;
    } catch (err) {
      report.failures.push({ kind: "card", id: c.id, error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  // ---------- 认知产物（浏览器模式没有这层，跳过而不是假成功） ----------
  for (const art of artifacts) {
    if (cancel.cancelled) {
      report.cancelled = true;
      break;
    }
    if (!inShell() || !sink.saveArtifact) {
      report.skipped.artifacts++;
      tick();
      continue;
    }
    try {
      await sink.saveArtifact(art);
      report.written.artifacts++;
    } catch (err) {
      report.failures.push({ kind: "artifact", id: art.id, error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  // ---------- 笔记与知识库（专用写入，处置五态） ----------
  if (!cancel.cancelled && (restored.notes.length > 0 || restored.knowledgeBases.length > 0)) {
    const noteReport = await restoreNotesBundle(
      restored.notes,
      restored.knowledgeBases,
      restored.kbMembership,
      dir
    );
    report.written.notes = noteReport.notes.created + noteReport.notes.updated;
    report.written.knowledgeBases = noteReport.knowledgeBases.created + noteReport.knowledgeBases.mapped;
    report.skipped.notes =
      noteReport.notes.skippedLocalNewer + noteReport.notes.skippedDivergent + noteReport.notes.current;
    for (const f of noteReport.notes.failed) report.failures.push({ kind: "note", id: f.id, error: f.error });
    for (const f of noteReport.knowledgeBases.failed) {
      report.failures.push({ kind: "knowledgeBase", id: f.id, error: f.error });
    }
    for (const f of noteReport.membership.failed) {
      report.failures.push({ kind: "membership", id: f.key, error: f.error });
    }
    tick();
  }

  // ---------- 设置 ----------
  if (!cancel.cancelled && restored.settings) {
    try {
      if (sink.saveSettings) await sink.saveSettings(restored.settings);
    } catch (err) {
      report.failures.push({ kind: "settings", id: "settings.json", error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  report.failures.push(...mediaFailures);
  report.partial = report.failures.length > 0 || report.cancelled;
  return report;
}

/** 报告的一句话摘要（界面回执用）。 */
export function summarizeRestore(report: RestoreReport): string {
  const parts = [
    `素材 ${report.written.materials}/${report.plan.materials}`,
    `卡片 ${report.written.cards}/${report.plan.cards}`,
    `产物 ${report.written.artifacts}/${report.plan.artifacts}`,
    `笔记 ${report.written.notes}/${report.plan.notes}`,
    `知识库 ${report.written.knowledgeBases}/${report.plan.knowledgeBases}`,
    `附件 ${report.written.media}/${report.plan.media}`,
  ];
  return parts.join("、");
}

export type { Artifact, KnowledgeBase, Note, RawMaterial, KnowledgeCard };

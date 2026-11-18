import { restorableArtifacts, restorableCards, restorableMaterials } from "../../domain/restoreRules";
import { restoreNotesBundle } from "./notesRestore";
import type { Artifact, RawMaterial } from "../../shell/store";
import type { KnowledgeCard } from "../../domain/card";
import type { KnowledgeBase, Note } from "../../domain/note";
import type { DeletedRecordsSnapshot, DeletedRestoreCounts, MailRestoreCounts, RestoredBackup } from "../../domain/systemBackup";
import type { ReviewRestoreCounts } from "../../domain/reviewHistory";
import { noteMediaPaths } from "../../domain/mediaMime";

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
  kind: "material" | "card" | "artifact" | "deletedRecords" | "note" | "knowledgeBase" | "membership" | "media" | "settings" | "r4" | "subscription" | "mail" | "reviewHistory" | "searchHistory";
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
  r4Written?: number;
  subscriptionsWritten?: number;
  mailWritten?: MailRestoreCounts;
  reviewHistoryWritten?: ReviewRestoreCounts;
  searchHistoryWritten?: { added: number; skipped: number; alreadyPresent: number; overLimit: number };
  deletedRecordsWritten?: DeletedRestoreCounts;
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
  if (report.deletedRecordsWritten) {
    const deleted = report.deletedRecordsWritten;
    lines.push(`回收站：新增素材 ${deleted.materials} 条、卡片 ${deleted.cards} 条、产物 ${deleted.artifacts} 条，已存在 ${deleted.alreadyPresent} 条`);
  }
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
  updateMaterial: (material: RawMaterial) => Promise<void | boolean>;
  /** 写卡片。 */
  updateCard: (card: KnowledgeCard) => Promise<void | boolean>;
  /** 写认知产物（浏览器模式没有这层，实现可留空）。 */
  saveArtifact?: (artifact: Artifact) => Promise<void | boolean>;
  /** 写设置。 */
  saveSettings?: (settings: NonNullable<RestoredBackup["settings"]>) => Promise<void>;
  restoreR4?: (snapshot: unknown) => Promise<number>;
  restoreSubscriptions?: (snapshot: NonNullable<RestoredBackup["subscriptions"]>) => Promise<number>;
  restoreMail?: (snapshot: NonNullable<RestoredBackup["mail"]>) => Promise<MailRestoreCounts>;
  restoreReviewHistory?: (snapshot: NonNullable<RestoredBackup["reviewHistory"]>) => Promise<ReviewRestoreCounts>;
  restoreSearchHistory?: (snapshot: NonNullable<RestoredBackup["searchHistory"]>) => Promise<{ added: number; skipped: number; alreadyPresent: number; overLimit: number }>;
  restoreDeletedRecords?: (snapshot: DeletedRecordsSnapshot) => Promise<DeletedRestoreCounts>;
  restoreNote?: typeof import("./repository").restoreNoteFromBackup;
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
  for (const [kind, all, valid] of [
    ["material", restored.materials, materials],
    ["card", restored.cards, cards],
    ["artifact", restored.artifacts, artifacts],
  ] as const) {
    const validItems = new Set<unknown>(valid);
    for (const item of all) {
      if (validItems.has(item)) continue;
      report.skipped[`${kind}s` as "materials" | "cards" | "artifacts"]++;
      report.failures.push({ kind, id: item?.id || "未知标识", error: "备份条目缺少有效标识或必要字段，未写入" });
    }
  }
  report.plan = {
    materials: restored.materials.length,
    cards: restored.cards.length,
    artifacts: restored.artifacts.length,
    notes: restored.notes.length,
    knowledgeBases: restored.knowledgeBases.length,
    media: restored.media.size,
  };

  const totalSteps = report.plan.media + materials.length + cards.length + artifacts.length +
    (restored.notes.length > 0 || restored.knowledgeBases.length > 0 ? 1 : 0) +
    (restored.settings ? 1 : 0) + (restored.r4 === undefined ? 0 : 1) + (restored.mail === undefined ? 0 : 1) + (restored.subscriptions === undefined ? 0 : 1) + (restored.reviewHistory === undefined ? 0 : 1) + (restored.searchHistory === undefined ? 0 : 1) + (restored.deletedRecords === undefined ? 0 : 1);
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
      const written = await sink.updateMaterial({ ...m, mediaPath, mediaSizeBytes: m.mediaSizeBytes || 0 });
      if (written === false) report.skipped.materials++;
      else report.written.materials++;
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
    if (c.materialId && report.failures.some((failure) => failure.kind === "material" && failure.id === c.materialId)) {
      report.skipped.cards++;
      report.failures.push({ kind: "card", id: c.id, error: "来源素材未能恢复，卡片未写入" });
      tick();
      continue;
    }
    try {
      const written = await sink.updateCard(c);
      if (written === false) report.skipped.cards++;
      else report.written.cards++;
    } catch (err) {
      report.failures.push({ kind: "card", id: c.id, error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  // ---------- 笔记与知识库（专用写入，处置五态） ----------
  if (!cancel.cancelled && (restored.notes.length > 0 || restored.knowledgeBases.length > 0)) {
    try {
      const blockedNotes = new Set<string>();
      const historyByNote = new Map<string, string[]>();
      for (const revision of restored.noteRevisions ?? []) {
        const paths = historyByNote.get(revision.noteId) ?? [];
        paths.push(...noteMediaPaths(revision.bodyMd));
        historyByNote.set(revision.noteId, paths);
      }
      const notes = restored.notes.filter((note) => {
        const missing = [...new Set([...noteMediaPaths(note.bodyMd ?? ""), ...(historyByNote.get(note.id) ?? [])])].filter((path) => restoredMedia.get(path) !== path);
        const sourceFailed = note.sourceMaterialId && report.failures.some((failure) => failure.kind === "material" && failure.id === note.sourceMaterialId);
        if (missing.length === 0 && !sourceFailed) return true;
        blockedNotes.add(note.id);
        report.skipped.notes++;
        const reason = missing.length ? `笔记附件未能按原路径恢复（${missing.join("、")}）` : "来源素材未能恢复";
        report.failures.push({ kind: "note", id: note.id, error: `${reason}，这篇笔记未写入` });
        return false;
      });
      const membership = Object.fromEntries(Object.entries(restored.kbMembership).filter(([key]) => {
        const separator = key.indexOf("\n");
        if (separator < 0 || !blockedNotes.has(key.slice(separator + 1))) return true;
        report.failures.push({ kind: "membership", id: key, error: "笔记未能恢复，成员关系未写入" });
        return false;
      }));
      const noteReport = await restoreNotesBundle(
        notes,
        restored.knowledgeBases,
        membership,
        dir,
        sink.restoreNote
      );
      report.written.notes = noteReport.notes.created + noteReport.notes.updated;
      report.written.knowledgeBases = noteReport.knowledgeBases.created + noteReport.knowledgeBases.mapped;
      report.skipped.notes +=
        noteReport.notes.skippedLocalNewer + noteReport.notes.skippedDivergent + noteReport.notes.current;
      // A newer local note is an expected safe skip. Only same-revision divergence
      // is a restore failure that should block dependent data such as mail cursors.
      const conflictedNotes = noteReport.notes.skippedDivergent;
      if (conflictedNotes > 0) {
        report.failures.push({ kind: "note", id: "notes.json", error: `${conflictedNotes} 篇笔记与备份在同一修订号存在内容分歧，保留本地内容` });
      }
      for (const f of noteReport.notes.failed) report.failures.push({ kind: "note", id: f.id, error: f.error });
      for (const f of noteReport.knowledgeBases.failed) {
        report.failures.push({ kind: "knowledgeBase", id: f.id, error: f.error });
      }
      for (const f of noteReport.membership.failed) {
        report.failures.push({ kind: "membership", id: f.key, error: f.error });
      }
    } catch (err) {
      report.failures.push({ kind: "note", id: "notes.json", error: `笔记恢复中断，部分笔记或知识库可能已写入，数量无法确认：${err instanceof Error ? err.message : String(err)}` });
    }
    tick();
  }

  // 原件失败时不把产物错误地关联到同 ID 的本地内容。
  for (const art of artifacts) {
    if (cancel.cancelled) { report.cancelled = true; break; }
    if (!sink.saveArtifact) {
      report.skipped.artifacts++;
      report.failures.push({ kind: "artifact", id: art.id, error: "当前环境不支持恢复认知产物" });
      tick();
      continue;
    }
    const sourceCards = art.sourceCardIds ?? [];
    const sourceNotes = art.sourceNoteIds ?? [];
    if (!Array.isArray(sourceCards) || !Array.isArray(sourceNotes)) {
      report.skipped.artifacts++;
      report.failures.push({ kind: "artifact", id: art.id, error: "产物的来源清单无效，未写入" });
      tick();
      continue;
    }
    const failedCard = report.failures.some((failure) => failure.kind === "card" && sourceCards.includes(failure.id));
    const failedNote = report.failures.some((failure) => failure.kind === "note" &&
      sourceNotes.length > 0 && (failure.id === "notes.json" || sourceNotes.includes(failure.id)));
    if (failedCard || failedNote) {
      report.skipped.artifacts++;
      report.failures.push({ kind: "artifact", id: art.id, error: "关联原件未能恢复，产物未写入" });
      tick();
      continue;
    }
    try {
      const written = await sink.saveArtifact(art);
      if (written === false) report.skipped.artifacts++;
      else report.written.artifacts++;
    } catch (err) {
      report.failures.push({ kind: "artifact", id: art.id, error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  // ---------- 回收站：恢复时仍保持删除态，附件与来源冲突按条目跳过 ----------
  if (!cancel.cancelled && restored.deletedRecords !== undefined) {
    try {
      if (!sink.restoreDeletedRecords) throw new Error("当前环境不支持恢复回收站内容");
      const blockedMaterials = new Set<string>();
      const deletedMaterials = restored.deletedRecords.materials.flatMap((record) => {
        const path = record.material.mediaPath;
        if (!path) return [record];
        const saved = restoredMedia.get(path);
        if (!saved) {
          blockedMaterials.add(record.material.id);
          report.failures.push({ kind: "deletedRecords", id: record.material.id, error: `回收站素材附件未能恢复（${path}），保留为未恢复条目` });
          return [];
        }
        return [{ ...record, material: { ...record.material, mediaPath: saved } }];
      });
      const blockedDeletedCardIds = new Set<string>();
      const deletedCards = restored.deletedRecords.cards.filter((record) => {
        const id = record.card.materialId;
        if (!id) return true;
        const sourceFailed = blockedMaterials.has(id) || report.failures.some((failure) => failure.kind === "material" && failure.id === id);
        if (!sourceFailed) return true;
        blockedDeletedCardIds.add(record.card.id);
        report.failures.push({ kind: "deletedRecords", id: record.card.id, error: "回收站卡片的来源素材未能恢复，保留为未恢复条目" });
        return false;
      });
      const deletedArtifacts = restored.deletedRecords.artifacts.filter((artifact) => {
        const cardFailed = (artifact.sourceCardIds ?? []).some((id) => blockedDeletedCardIds.has(id) ||
          report.failures.some((failure) => failure.kind === "card" && failure.id === id));
        const noteFailed = (artifact.sourceNoteIds ?? []).some((id) => report.failures.some((failure) =>
          failure.kind === "note" && (failure.id === "notes.json" || failure.id === id)));
        if (!cardFailed && !noteFailed) return true;
        report.failures.push({ kind: "deletedRecords", id: artifact.id, error: "回收站产物的关联原件未能恢复，保留为未恢复条目" });
        return false;
      });
      const partialSnapshot: DeletedRecordsSnapshot = { ...restored.deletedRecords, materials: deletedMaterials, cards: deletedCards, artifacts: deletedArtifacts };
      if (partialSnapshot.materials.length + partialSnapshot.cards.length + partialSnapshot.artifacts.length > 0) {
        report.deletedRecordsWritten = await sink.restoreDeletedRecords(partialSnapshot);
      } else {
        report.deletedRecordsWritten = { materials: 0, cards: 0, artifacts: 0, alreadyPresent: 0 };
      }
    } catch (err) {
      report.failures.push({ kind: "deletedRecords", id: "deleted_records.json", error: err instanceof Error ? err.message : String(err) });
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

  if (!cancel.cancelled && restored.r4 !== undefined) {
    try {
      if (!sink.restoreR4) throw new Error("当前环境不支持恢复项目、目标和画像");
      report.r4Written = await sink.restoreR4(restored.r4);
    } catch (err) {
      report.failures.push({ kind: "r4", id: "r4.json", error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  if (!cancel.cancelled && restored.mail !== undefined) {
    try {
      if (report.failures.length > 0 || mediaFailures.length > 0) throw new Error("其他内容未能完整恢复，为避免邮箱游标与素材错位而未恢复邮箱数据");
      if (!sink.restoreMail) throw new Error("当前环境不支持恢复邮箱数据");
      report.mailWritten = await sink.restoreMail(restored.mail);
    } catch (err) {
      report.failures.push({ kind: "mail", id: "mail.json", error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  if (!cancel.cancelled && restored.subscriptions !== undefined) {
    try {
      if (report.failures.length > 0 || mediaFailures.length > 0) throw new Error("其他内容未能完整恢复，为避免自动抓取而未恢复订阅");
      if (!sink.restoreSubscriptions) throw new Error("当前环境不支持恢复订阅");
      report.subscriptionsWritten = await sink.restoreSubscriptions(restored.subscriptions);
    } catch (err) {
      report.failures.push({ kind: "subscription", id: "subscriptions.json", error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  // 逐次历史与当前卡片状态解耦；原子去重合并，不依赖卡片是否还存在。
  if (!cancel.cancelled && restored.reviewHistory !== undefined) {
    try {
      if (!sink.restoreReviewHistory) throw new Error("当前环境不支持恢复逐次复习历史");
      report.reviewHistoryWritten = await sink.restoreReviewHistory(restored.reviewHistory);
    } catch (err) {
      report.failures.push({ kind: "reviewHistory", id: "review_history.json", error: err instanceof Error ? err.message : String(err) });
    }
    tick();
  }

  // 搜索历史按本地顺序合并；超出本地 LRU 容量或已存在的词条由 sink 汇总计数。
  if (!cancel.cancelled && restored.searchHistory !== undefined) {
    try {
      if (!sink.restoreSearchHistory) throw new Error("当前环境不支持恢复搜索历史");
      report.searchHistoryWritten = await sink.restoreSearchHistory(restored.searchHistory);
    } catch (err) {
      report.failures.push({ kind: "searchHistory", id: restored.manifest.profile === "browser" ? "browser_search_history.json" : "search_history.json", error: err instanceof Error ? err.message : String(err) });
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
    `素材 ${report.written.materials}/${report.plan.materials}${report.skipped.materials ? `（跳过 ${report.skipped.materials}）` : ""}`,
    `卡片 ${report.written.cards}/${report.plan.cards}${report.skipped.cards ? `（跳过 ${report.skipped.cards}）` : ""}`,
    `产物 ${report.written.artifacts}/${report.plan.artifacts}${report.skipped.artifacts ? `（跳过 ${report.skipped.artifacts}）` : ""}`,
    `笔记 ${report.written.notes}/${report.plan.notes}${report.skipped.notes ? `（跳过 ${report.skipped.notes}）` : ""}`,
    `知识库 ${report.written.knowledgeBases}/${report.plan.knowledgeBases}`,
    `附件 ${report.written.media}/${report.plan.media}`,
  ];
  if (report.r4Written !== undefined) parts.push(`项目、目标与画像新增 ${report.r4Written} 条`);
  if (report.subscriptionsWritten !== undefined) parts.push(`订阅新增 ${report.subscriptionsWritten} 条`);
  if (report.mailWritten !== undefined) parts.push(`邮箱账号新增 ${report.mailWritten.accounts} 个、邮件去重记录新增 ${report.mailWritten.imports} 条、隔离记录新增 ${report.mailWritten.rejected} 条`);
  if (report.reviewHistoryWritten !== undefined) parts.push(`逐次复习事件新增 ${report.reviewHistoryWritten.inserted} 条、已存在 ${report.reviewHistoryWritten.skipped} 条`);
  if (report.searchHistoryWritten !== undefined) parts.push(`搜索历史新增 ${report.searchHistoryWritten.added} 条、已存在 ${report.searchHistoryWritten.alreadyPresent} 条、超出 8 条上限 ${report.searchHistoryWritten.overLimit} 条`);
  if (report.deletedRecordsWritten !== undefined) parts.push(`回收站素材新增 ${report.deletedRecordsWritten.materials} 条、卡片新增 ${report.deletedRecordsWritten.cards} 条、产物新增 ${report.deletedRecordsWritten.artifacts} 条、已存在 ${report.deletedRecordsWritten.alreadyPresent} 条`);
  return parts.join("、");
}

export type { Artifact, KnowledgeBase, Note, RawMaterial, KnowledgeCard };

import {
  NoteConflictError,
  type Note,
  type NoteSaveOutcome,
} from "../../domain/note";

/**
 * 单篇笔记的保存会话（T01，收口审计 KF-002 / KF-004）。
 *
 * 之前编辑器把「已保存 Note、修订基线、草稿」分散在三处可变状态里：
 * 冲突分支直接前移修订基线（下一个字符就拿到覆盖资格，静默盖掉外部新内容），
 * 元数据写的是列表快照而正文保存展开的是旧引用（自动保存把属性改回旧值）。
 *
 * 这里把一篇笔记的写入收敛到一个拥有者，不变式：
 * - **同一篇写串行**：保存进行中的新输入进下一轮，回执只应用给产生它的提交，
 *   不会把旧回执标到新草稿上；
 * - **冲突不推进基线**：conflict 态冻结自动保存，本地草稿与远端修订都保留，
 *   只有用户明确选择（覆盖 / 另存副本 / 采用远端）才解除；
 * - **正文与元数据同源**：保存时按「服务端快照 + 元数据补丁 + 草稿正文」组装，
 *   属性后写正文不回退属性，正文后写属性也不回退正文。
 *
 * 桌面与浏览器共用本模块（io.save 绑定各自仓储），语义由单测钉住。
 */

export type NoteSessionPhase = "clean" | "dirty" | "saving" | "conflict" | "error";

/** 元数据补丁：相对服务端快照的覆盖项。 */
export interface MetaPatch {
  notebook?: string | null;
  tags?: string[];
  isPinned?: boolean;
  isFavorite?: boolean;
  archivedAt?: number | null;
}

export interface SessionSnapshot {
  noteId: string;
  phase: NoteSessionPhase;
  /** 编辑器应显示的草稿（切回这篇时从这里恢复）。 */
  draft: { title: string; bodyMd: string };
  /** 组合元数据后的完整属性（属性输入框的值来源）。 */
  note: Note;
  /** 冲突时远端当前修订号；非冲突态为 null。 */
  conflictRevision: number | null;
  /** 保存失败的错误信息（error 态）。 */
  errorMessage: string | null;
  /** 是否还有未落库的改动（conflict / error 态下同样为 true）。 */
  dirty: boolean;
}

/** 会话对外的最小 IO：写仓储 + 草稿镜像（崩溃后可找回）。 */
export interface SessionIo {
  save: (note: Note, baseRevision: number) => Promise<NoteSaveOutcome>;
  /** 每次草稿变化时持久化镜像；实现自行容错（配额满等不阻断编辑）。 */
  persistDraft?: (noteId: string, draft: { title: string; bodyMd: string }) => void;
  /** 保存成功后清掉镜像。 */
  clearDraft?: (noteId: string) => void;
}

export const AUTOSAVE_DELAY_MS = 800;

export class NoteSession {
  readonly noteId: string;
  private io: SessionIo;
  /** 服务端最后已知状态（列表快照或最近一次成功保存的内容）。 */
  private serverNote: Note;
  /** 服务端已确认修订号——只随本会话的成功回执或用户显式解冲突推进。 */
  private baseRevision: number;
  /** 元数据补丁（相对 serverNote）；成功落库后清空（serverNote 已含）。 */
  private meta: MetaPatch = {};
  private draft: { title: string; bodyMd: string };
  private dirty = false;
  /** 每次编辑/补丁自增：保存回执只清掉提交时就绪的 dirty，在途新输入留给下一轮。 */
  private editSeq = 0;
  private pumpPromise: Promise<void> | null = null;
  private timer: number | null = null;
  phase: NoteSessionPhase = "clean";
  conflictRevision: number | null = null;
  errorMessage: string | null = null;
  /** 相态变化回调（界面同步状态条用）。 */
  onChange: (() => void) | null = null;

  constructor(seed: Note, io: SessionIo) {
    this.noteId = seed.id;
    this.io = io;
    this.serverNote = seed;
    this.baseRevision = seed.currentRevision;
    this.draft = { title: seed.title, bodyMd: seed.bodyMd };
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** 编辑正文/标题：记录草稿；冲突态只记录不自动提交。 */
  edit(title: string, bodyMd: string): void {
    this.draft = { title, bodyMd };
    this.dirty = true;
    this.editSeq++;
    if (this.phase === "conflict") {
      this.emit();
      return;
    }
    this.io.persistDraft?.(this.noteId, this.draft);
    this.setPhase("dirty");
    this.scheduleAutosave();
  }

  /** 恢复遗留草稿（崩溃 / 意外退出后重开）：进 dirty 态，走正常自动保存。 */
  restoreDraft(title: string, bodyMd: string): void {
    this.edit(title, bodyMd);
  }

  /** 元数据补丁：与正文共用同一保存队列（元数据变化不追加修订是仓储语义）。 */
  patchMeta(patch: MetaPatch): void {
    this.meta = { ...this.meta, ...patch };
    this.dirty = true;
    this.editSeq++;
    if (this.phase === "conflict") {
      this.emit();
      return;
    }
    this.setPhase("dirty");
    this.scheduleAutosave();
  }

  /** 组合后的当前属性（属性输入框显示值）。 */
  effectiveNote(): Note {
    return { ...this.serverNote, ...this.meta, title: this.draft.title, bodyMd: this.draft.bodyMd };
  }

  snapshot(): SessionSnapshot {
    return {
      noteId: this.noteId,
      phase: this.phase,
      draft: { ...this.draft },
      note: this.effectiveNote(),
      conflictRevision: this.conflictRevision,
      errorMessage: this.errorMessage,
      dirty: this.dirty,
    };
  }

  /**
   * 立即冲刷（切换笔记 / 离开页 / 关窗前）。
   * 返回最终快照；conflict 态不会自动提交（那是 KF-002 要防的事）。
   */
  async flush(): Promise<SessionSnapshot> {
    this.cancelAutosave();
    await this.pump();
    return this.snapshot();
  }

  /**
   * 冲突处置·用我的版本覆盖：以远端当前修订为基线重新提交本地草稿。
   * 这是用户显式选择——唯一的「冲突后推进基线」入口。
   */
  resolveOverwrite(): void {
    if (this.phase !== "conflict" || this.conflictRevision === null) return;
    this.baseRevision = this.conflictRevision;
    this.conflictRevision = null;
    this.setPhase(this.dirty ? "dirty" : "clean");
    this.scheduleAutosave();
    void this.pump();
  }

  /**
   * 冲突处置·采用远端：编辑器换成远端内容，本地草稿放弃（另存副本由界面负责先落一条新笔记）。
   */
  adoptRemote(remote: Note): void {
    this.serverNote = remote;
    this.baseRevision = remote.currentRevision;
    this.meta = {};
    this.draft = { title: remote.title, bodyMd: remote.bodyMd };
    this.dirty = false;
    this.conflictRevision = null;
    this.errorMessage = null;
    this.setPhase("clean");
    this.io.clearDraft?.(this.noteId);
  }

  /** 删除笔记时丢弃会话状态（不再有保存意义）。 */
  discard(): void {
    this.cancelAutosave();
    this.io.clearDraft?.(this.noteId);
    this.dirty = false;
  }

  disposeTimer(): void {
    this.cancelAutosave();
  }

  // ---------- 内部 ----------

  private emit(): void {
    this.onChange?.();
  }

  /** 走方法取相态：runPump 的循环里 TS 会对直接比较做过收窄，await 后相态可能已被并发改变。 */
  private inConflict(): boolean {
    return this.phase === "conflict";
  }

  private setPhase(phase: NoteSessionPhase): void {
    if (phase !== "conflict" && phase !== "error") this.errorMessage = null;
    if (phase !== "conflict") this.conflictRevision = null;
    this.phase = phase;
    this.emit();
  }

  private scheduleAutosave(): void {
    this.cancelAutosave();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, AUTOSAVE_DELAY_MS);
  }

  private cancelAutosave(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 串行泵：把 dirty 排空（保存中新输入会在下一轮继续），冲突/失败即停。 */
  private pump(): Promise<void> {
    if (this.pumpPromise) return this.pumpPromise;
    this.pumpPromise = this.runPump().finally(() => {
      this.pumpPromise = null;
    });
    return this.pumpPromise;
  }

  private async runPump(): Promise<void> {
    if (this.inConflict()) return;
    for (;;) {
      if (!this.dirty || this.inConflict()) return;
      const composed = this.effectiveNote();
      const base = this.baseRevision;
      const seqAtSubmit = this.editSeq;
      const metaAtSubmit = this.meta;
      this.setPhase("saving");
      try {
        const outcome = await this.io.save(composed, base);
        // 回执只应用给发起时的提交：串行泵保证不会出现另一笔在途提交；
        // await 期间若有新 edit（editSeq 前进），dirty 留给下一轮排空。
        this.serverNote = { ...composed, currentRevision: outcome.revision };
        this.baseRevision = outcome.revision;
        // 只清「提交时就带着」的补丁；在途新补丁要等下一轮组合落库，不能被旧回执吞掉。
        if (this.meta === metaAtSubmit) this.meta = {};
        this.io.clearDraft?.(this.noteId);
        if (seqAtSubmit === this.editSeq) {
          this.dirty = false;
          this.setPhase("clean");
          return;
        }
        this.setPhase("dirty");
      } catch (err) {
        if (err instanceof NoteConflictError) {
          // 冲突：保留基线与本地草稿，冻结自动保存——不推进、不清 dirty、不重试。
          this.conflictRevision = err.currentRevision;
          this.setPhase("conflict");
          return;
        }
        this.errorMessage = err instanceof Error ? err.message : String(err);
        this.setPhase("error");
        return;
      }
    }
  }
}

// ---------- 草稿镜像（localStorage；意外退出后可找回未保存内容） ----------

const draftMirrorKey = (id: string) => `knowflick.note.draft.${id}`;

export function persistDraftMirror(id: string, draft: { title: string; bodyMd: string }): void {
  try {
    localStorage.setItem(draftMirrorKey(id), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    /* 镜像是尽力而为：配额满不能挡住编辑本身 */
  }
}

export function readDraftMirror(id: string): { title: string; bodyMd: string } | null {
  try {
    const raw = localStorage.getItem(draftMirrorKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { title?: unknown; bodyMd?: unknown };
    if (typeof parsed.bodyMd !== "string") return null;
    return { title: typeof parsed.title === "string" ? parsed.title : "", bodyMd: parsed.bodyMd };
  } catch {
    return null;
  }
}

export function clearDraftMirror(id: string): void {
  try {
    localStorage.removeItem(draftMirrorKey(id));
  } catch {
    /* 同上 */
  }
}

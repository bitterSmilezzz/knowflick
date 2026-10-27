import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyNotesState,
  NoteConflictError,
  upsertNote,
  type Note,
  type NotesState,
} from "../../domain/note";
import {
  AUTOSAVE_DELAY_MS,
  NoteSession,
  type SessionIo,
} from "./noteSession";

/**
 * T01 保存会话语义（审计 KF-002 / KF-004 的反例回归）：
 * io.save 走领域 upsertNote（与浏览器/桌面同一套修订语义），
 * 冲突与失败可注入——旧实现会在这里红的用例必须绿。
 */

interface StoreIo {
  io: SessionIo;
  saves: { note: Note; baseRevision: number }[];
  readonly state: NotesState;
  setState: (next: NotesState) => void;
  failNext: (err: Error) => void;
  conflictNext: (currentRevision: number) => void;
}

function makeStoreIo(seed?: Note): StoreIo {
  let state = emptyNotesState();
  // 修订 > 0 的会话：仓储里要有同一篇（与服务端快照一致）；修订 0 是未落库的新草稿，仓储保持空。
  if (seed && seed.currentRevision > 0) {
    state = upsertNote(state, seed, 0, 100).state;
  }
  const saves: { note: Note; baseRevision: number }[] = [];
  let fail: Error | null = null;
  let conflict: number | null = null;
  return {
    io: {
      async save(note, baseRevision) {
        saves.push({ note: JSON.parse(JSON.stringify(note)) as Note, baseRevision });
        if (conflict !== null) {
          const c = conflict;
          conflict = null;
          throw new NoteConflictError(c);
        }
        if (fail) {
          const f = fail;
          fail = null;
          throw f;
        }
        const { state: next, outcome } = upsertNote(state, note, baseRevision, 1000);
        state = next;
        return outcome;
      },
    },
    saves,
    get state() {
      return state;
    },
    setState(next) {
      state = next;
    },
    failNext(err) {
      fail = err;
    },
    conflictNext(currentRevision) {
      conflict = currentRevision;
    },
  };
}

const seedNote = (over: Partial<Note> = {}): Note => ({
  id: "n1",
  title: "标题",
  bodyMd: "正文一",
  notebook: null,
  tags: [],
  isPinned: false,
  isFavorite: false,
  archivedAt: null,
  sourceMaterialId: null,
  currentRevision: 0,
  createdAt: 100,
  updatedAt: 100,
  isDeleted: false,
  deletedAt: null,
  ...over,
});

async function drain() {
  await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
  // 排空保存中产生的新一轮（保存完成 → 循环继续），多给几拍
  await vi.advanceTimersByTimeAsync(1);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("NoteSession 元数据与正文同源（KF-004）", () => {
  it("设置属性后写正文，属性不被自动保存改回旧值", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    s.patchMeta({ notebook: "项目甲", tags: ["灵感"] });
    await drain();
    expect(store.state.notes[0].notebook).toBe("项目甲");

    s.edit("标题", "正文二");
    await drain();
    expect(store.state.notes[0].notebook).toBe("项目甲");
    expect(store.state.notes[0].tags).toEqual(["灵感"]);
    expect(store.state.notes[0].bodyMd).toBe("正文二");
  });

  it("正文后改属性，正文不被元数据保存回退", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    s.edit("标题", "正文二");
    await drain();
    s.patchMeta({ notebook: "日志" });
    await drain();
    expect(store.state.notes[0].bodyMd).toBe("正文二");
    expect(store.state.notes[0].notebook).toBe("日志");
  });

  it("元数据单独变化不追加修订（契约）", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    s.patchMeta({ notebook: "项目甲" });
    await drain();
    expect(store.state.notes[0].currentRevision).toBe(1);
    expect(s.snapshot().phase).toBe("clean");
  });
});

describe("NoteSession 串行与回执归属", () => {
  it("保存进行中的输入与属性改动被合并到下一轮，最终内容正确且无假冲突", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    s.edit("标题", "第一版");
    // 手动泵（不推进定时器）：保存挂起期间继续输入 + 改属性
    const pumping = s.flush();
    s.edit("标题", "第一版续");
    s.patchMeta({ tags: ["工作"] });
    await pumping;

    // 第二轮把合并后的草稿落库：内容是「第一版续」+ 属性，基线链正确
    expect(s.snapshot().phase).toBe("clean");
    const last = store.saves[store.saves.length - 1];
    expect(last.note.bodyMd).toBe("第一版续");
    expect(last.note.tags).toEqual(["工作"]);
    expect(store.state.notes[0].bodyMd).toBe("第一版续");
    expect(store.state.notes[0].tags).toEqual(["工作"]);
    expect(store.state.notes[0].currentRevision).toBe(3);
  });

  it("旧回执不把新草稿标成已保存：在途期间的新输入仍要等下一轮落库", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    // 可门控的 save：每一笔都挂起，直到测试放行
    const gates: Array<() => void> = [];
    const waitGate = () => new Promise<void>((resolve) => { gates.push(resolve); });
    const gated: SessionIo = {
      save: async (note, base) => {
        await waitGate();
        const { state: next, outcome } = upsertNote(store.state, note, base, 1000);
        store.setState(next);
        return outcome;
      },
    };
    const s = new NoteSession(seed, gated);
    s.edit("标题", "A");
    const pumping = s.flush();
    await vi.advanceTimersByTimeAsync(0); // flush 进入在途
    expect(s.snapshot().phase).toBe("saving");
    s.edit("标题", "AB"); // 在途期间的新输入
    gates[0]!(); // 放行第一笔（A）
    await vi.advanceTimersByTimeAsync(0); // 第一笔回执应用、第二笔（AB）发起并在门内等待
    // 第一笔回执（A → 修订 2）不能把 AB 标成已保存：第二笔还在途
    expect(s.snapshot().phase).toBe("saving");
    gates[1]!(); // 放行第二笔（AB）
    await pumping;
    expect(s.snapshot().phase).toBe("clean");
    expect(store.state.notes[0].bodyMd).toBe("AB");
    expect(store.state.notes[0].currentRevision).toBe(3);
  });

  it("两篇会话互不串修订：A 的在途回执不影响 B 的基线", async () => {
    const seedA = seedNote({ id: "a", currentRevision: 1 });
    const seedB = seedNote({ id: "b", currentRevision: 1 });
    const store = makeStoreIo(seedA);
    store.setState(upsertNote(store.state, seedB, 0, 100).state);
    const a = new NoteSession(seedA, store.io);
    const b = new NoteSession(seedB, store.io);
    a.edit("标题", "A 的编辑");
    b.edit("标题", "B 的编辑");
    await drain();
    expect(store.state.notes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(a.snapshot().phase).toBe("clean");
    expect(b.snapshot().phase).toBe("clean");
  });

  it("flush 在 800ms 到点前调用也能落库（新建后立刻切走不丢草稿）", async () => {
    const seed = seedNote({ currentRevision: 0 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    s.edit("新笔记", "第一段");
    await s.flush();
    expect(store.state.notes).toHaveLength(1);
    expect(store.state.notes[0].bodyMd).toBe("第一段");
  });
});

describe("NoteSession 冲突保护（KF-002）", () => {
  it("冲突后继续输入不自动提交、不推进基线；显式覆盖才用远端基线", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    // 外部已把修订推进到 2（真实落库，另写一份外部内容）
    store.conflictNext(2);
    s.edit("标题", "本地改写");
    await drain();
    expect(s.snapshot().phase).toBe("conflict");
    expect(s.snapshot().conflictRevision).toBe(2);
    expect(s.snapshot().dirty).toBe(true);
    const attemptsBefore = store.saves.length;
    // 外部编辑者随后完成写入：仓储现在真的是修订 2
    store.setState(upsertNote(store.state, seedNote({ currentRevision: 2, bodyMd: "外部新内容" }), 1, 1000).state);

    // 冲突态继续输入：不得再发起保存（旧实现这里直接覆盖外部内容）
    s.edit("标题", "本地改写二");
    s.patchMeta({ tags: ["x"] });
    await drain();
    expect(store.saves.length).toBe(attemptsBefore);
    expect(s.snapshot().phase).toBe("conflict");

    // 用户显式选择覆盖：以远端修订 2 为基线提交本地内容
    s.resolveOverwrite();
    await drain();
    expect(store.saves.length).toBe(attemptsBefore + 1);
    expect(store.saves[store.saves.length - 1].baseRevision).toBe(2);
    expect(store.saves[store.saves.length - 1].note.bodyMd).toBe("本地改写二");
    expect(store.saves[store.saves.length - 1].note.tags).toEqual(["x"]);
    expect(s.snapshot().phase).toBe("clean");
    expect(store.state.notes[0].currentRevision).toBe(3);
  });

  it("flush 在冲突态不提交任何内容", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    store.conflictNext(2);
    s.edit("标题", "本地改写");
    await drain();
    const before = store.saves.length;
    const snap = await s.flush();
    expect(snap.phase).toBe("conflict");
    expect(store.saves.length).toBe(before);
  });

  it("adoptRemote 换成远端内容并重置基线，之后保存不假冲突", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    store.conflictNext(2);
    s.edit("标题", "本地改写");
    await drain();
    store.setState(upsertNote(store.state, seedNote({ currentRevision: 2, bodyMd: "远端新内容" }), 1, 1000).state);
    const remote = seedNote({ currentRevision: 2, bodyMd: "远端新内容" });
    s.adoptRemote(remote);
    expect(s.snapshot().draft.bodyMd).toBe("远端新内容");
    expect(s.snapshot().dirty).toBe(false);
    s.edit("标题", "远端新内容续");
    await drain();
    expect(store.saves[store.saves.length - 1].baseRevision).toBe(2);
    expect(s.snapshot().phase).toBe("clean");
  });
});

describe("NoteSession 失败与重试", () => {
  it("写失败保留 dirty 与内容，重试成功后落库", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    store.failNext(new Error("磁盘已满"));
    s.edit("标题", "重要草稿");
    await drain();
    expect(s.snapshot().phase).toBe("error");
    expect(s.snapshot().dirty).toBe(true);
    // 失败不自动无限重试；显式冲刷（或再次编辑）是重试入口
    const snap = await s.flush();
    expect(snap.phase).toBe("clean");
    expect(store.state.notes[0].bodyMd).toBe("重要草稿");
  });

  it("错误后再编辑会重新尝试保存", async () => {
    const seed = seedNote({ currentRevision: 1 });
    const store = makeStoreIo(seed);
    const s = new NoteSession(seed, store.io);
    store.failNext(new Error("失败"));
    s.edit("标题", "内容");
    await drain();
    expect(s.snapshot().phase).toBe("error");
    s.edit("标题", "内容二");
    await drain();
    expect(store.state.notes[0].bodyMd).toBe("内容二");
  });
});

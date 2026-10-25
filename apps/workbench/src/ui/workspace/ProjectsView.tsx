import { useCallback, useEffect, useMemo, useState } from "react";
import {
  projectAddNote,
  projectArchive,
  projectCreate,
  projectExportMarkdown,
  projectList,
  projectMemberList,
  projectRemoveNote,
  type Project,
  type ProjectMemberShell,
} from "../../shell/store";
import { inShell } from "../../shell/store";
import { Icon } from "./Icon";

/**
 * 项目记忆视图（R4/D06 的 UI 入口）。
 *
 * 项目是**背景、决策、约束与未决问题**的容器——成员引用现有笔记，
 * 不复制正文。封存的项目不导出（旧上下文不继续污染其它项目）。
 *
 * 关键口径：项目之间的上下文是隔离的——这里只列**当前选中项目**的成员，
 * 导出也只走当前项目（R4 退出门槛「项目 A 无权读取项目 B」）。
 */

interface Props {
  dir: string;
  /** 现有笔记（用于把笔记加入项目）。 */
  notes: Array<{ id: string; title: string }>;
}

export function ProjectsView({ dir, notes }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<ProjectMemberShell[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [noteToAdd, setNoteToAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = await projectList(showArchived, dir);
      setProjects(list);
      setSelectedId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0]?.id ?? null));
    } catch (e) {
      setError(`读取项目列表失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [dir, showArchived]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 选中项目 → 只读这个项目的成员（不读别的项目）
  useEffect(() => {
    if (!selectedId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    void projectMemberList(selectedId, dir)
      .then((rows) => { if (!cancelled) setMembers(rows); })
      .catch((e) => { if (!cancelled) setError(`读取项目成员失败：${e instanceof Error ? e.message : String(e)}`); });
    return () => { cancelled = true; };
  }, [selectedId, dir]);

  const selected = useMemo(() => projects.find((p) => p.id === selectedId) ?? null, [projects, selectedId]);
  const memberIds = useMemo(() => new Set(members.map((m) => m.noteId)), [members]);
  const addable = useMemo(
    () => notes.filter((n) => !memberIds.has(n.id)).slice(0, 50),
    [notes, memberIds]
  );

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(ok);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doCreate = () =>
    run(async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("项目名不能为空");
      await projectCreate(crypto.randomUUID(), trimmed, description.trim(), dir);
      setName("");
      setDescription("");
    }, "项目已创建");

  const doArchive = () => {
    if (!selected) return;
    void run(async () => {
      await projectArchive(selected.id, dir);
      setSelectedId(null);
    }, "项目已封存——封存的项目不再导出，也不进默认列表");
  };

  const doExport = () => {
    if (!selected) return;
    void run(async () => {
      const md = await projectExportMarkdown(selected.id, dir);
      // 导出即下载：项目记忆包要给外部工具用
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selected.name.replace(/[\\/:*?"<>|]/g, "_")}-项目记忆.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "项目记忆包已导出（Markdown）");
  };

  if (!inShell()) {
    return (
      <div className="ws-empty-guide" data-page="projects">
        <p style={{ fontWeight: 500 }}>项目记忆需要桌面客户端</p>
        <span style={{ fontSize: 12 }}>浏览器体验模式没有本机数据库，项目与成员关系存在那里。</span>
      </div>
    );
  }

  return (
    <div className="ws-projects" data-page="projects">
      <header className="ws-projects-head">
        <div>
          <h1>项目记忆</h1>
          <p className="ws-hint">
            项目是背景、决策与约束的容器。成员引用现有笔记，不复制正文；
            封存的项目不再导出，旧上下文不会继续污染其它项目。
          </p>
        </div>
        <label className="ws-projects-archived">
          <input
            type="checkbox"
            aria-label="显示已封存项目"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          显示已封存
        </label>
      </header>

      <div className="ws-projects-body">
        <section className="ws-projects-list" aria-label="项目列表">
          <div className="ws-projects-new">
            <input
              aria-label="新项目名称"
              placeholder="新项目名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void doCreate(); }}
            />
            <input
              aria-label="新项目说明"
              placeholder="说明（可选）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void doCreate(); }}
            />
            <button type="button" className="ws-primary" disabled={busy || !name.trim()} onClick={() => void doCreate()}>
              <Icon name="plus" size={14} /> 新建项目
            </button>
          </div>

          {projects.length === 0 ? (
            <p className="ws-hint">还没有项目。新建一个，把相关的笔记加进去。</p>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`ws-projects-item${p.id === selectedId ? " is-active" : ""}`}
                aria-pressed={p.id === selectedId}
                onClick={() => setSelectedId(p.id)}
              >
                <strong>{p.name}</strong>
                {p.archivedAt ? <span className="ws-projects-badge">已封存</span> : null}
                {p.description ? <span className="ws-hint">{p.description}</span> : null}
              </button>
            ))
          )}
        </section>

        <section className="ws-projects-detail" aria-label="项目详情">
          {!selected ? (
            <p className="ws-hint">选一个项目看它的成员笔记。</p>
          ) : (
            <>
              <div className="ws-projects-detail-head">
                <h2>{selected.name}</h2>
                <div className="ws-projects-actions">
                  <button type="button" className="ws-bordered" disabled={busy} onClick={() => void doExport()}>
                    导出项目记忆包
                  </button>
                  {selected.archivedAt ? null : (
                    <button type="button" className="ws-bordered" disabled={busy} onClick={() => void doArchive()}>
                      封存项目
                    </button>
                  )}
                </div>
              </div>
              {selected.description ? <p className="ws-hint">{selected.description}</p> : null}
              {selected.archivedAt ? (
                <p className="nv-ref-issue" role="status">
                  这个项目已封存——不再导出，也不出现在默认列表里。
                </p>
              ) : null}

              <div className="ws-projects-add">
                <select
                  aria-label="选择要加入项目的笔记"
                  value={noteToAdd}
                  onChange={(e) => setNoteToAdd(e.target.value)}
                >
                  <option value="">选择笔记…</option>
                  {addable.map((n) => (
                    <option key={n.id} value={n.id}>{n.title || "无标题笔记"}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ws-bordered"
                  disabled={busy || !noteToAdd}
                  onClick={() => {
                    const noteId = noteToAdd;
                    if (!noteId) return;
                    setNoteToAdd("");
                    void run(async () => {
                      await projectAddNote(selected.id, noteId, dir);
                    }, "笔记已加入项目");
                  }}
                >
                  加入项目
                </button>
              </div>

              <div className="ws-projects-members">
                <h3>成员笔记（{members.length}）</h3>
                {members.length === 0 ? (
                  <p className="ws-hint">这个项目还没有成员笔记。</p>
                ) : (
                  members.map((m) => (
                    <div key={m.noteId} className="ws-projects-member">
                      <div className="ws-projects-member-main">
                        <strong>{m.title || "无标题笔记"}</strong>
                        {m.isDeleted ? <span className="ws-projects-badge">已删除</span> : null}
                        <span className="ws-hint">{m.excerpt}</span>
                      </div>
                      <button
                        type="button"
                        className="ws-bordered"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await projectRemoveNote(selected.id, m.noteId, dir);
                          }, "已移出项目")
                        }
                      >
                        移出
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {message ? <p className="ws-projects-message" role="status">{message}</p> : null}
      {error ? <p className="ws-error" role="alert">{error}</p> : null}
    </div>
  );
}

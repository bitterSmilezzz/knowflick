import { useEffect, useState } from "react";
import { AddProjectNote, ArchiveProject, CreateProject, ExportProjectMarkdown, ListNotes, ListProjectMembers, ListProjects, RemoveProjectNote } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { Project } from "./bindings/knowflick.local/workbench-go/internal/projects/models";
import type { Member } from "./bindings/knowflick.local/workbench-go/internal/projects/models";
import type { Note } from "./bindings/knowflick.local/workbench-go/internal/library/models";

type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
};

export function ProjectLibrary({ generation, writable, busy, onBusy }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedID, setSelectedID] = useState("");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = projects?.find((project) => project.id === selectedID) ?? null;
  const memberIDs = new Set((members ?? []).map((member) => member.noteId));

  async function reload(include: boolean, selectID = selectedID) {
    const rows = await ListProjects(generation, include);
    setProjects(rows ?? []);
    if (selectID && !rows?.some((project: Project) => project.id === selectID)) {
      setSelectedID("");
      setMembers(null);
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await ListProjects(generation, false);
        if (active) setProjects(rows ?? []);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    })();
    return () => { active = false; };
  }, [generation]);

  async function run(action: () => Promise<void>) {
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      onBusy(false);
    }
  }

  async function select(project: Project) {
    if (busy) return;
    setSelectedID(project.id);
    setMarkdown("");
    setConfirmArchive(false);
    await run(async () => {
      setMembers(await ListProjectMembers(generation, project.id));
    });
  }

  async function create() {
    if (!name.trim() || busy) return;
    await run(async () => {
      await CreateProject(generation, name, description);
      setCreating(false);
      setName("");
      setDescription("");
      setNotice("已创建项目");
      await reload(includeArchived);
    });
  }

  async function archive() {
    if (!selected || busy || !confirmArchive) return;
    await run(async () => {
      await ArchiveProject(generation, selected.id);
      setConfirmArchive(false);
      setNotice("项目已封存；成员笔记保留，导出与检索不再包含它");
      setMembers(null);
      setSelectedID("");
      await reload(includeArchived);
    });
  }

  async function exportMarkdown() {
    if (!selected || busy) return;
    await run(async () => {
      setMarkdown(await ExportProjectMarkdown(generation, selected.id));
    });
  }

  async function openNotePicker() {
    if (busy) return;
    await run(async () => {
      const rows = await ListNotes(generation, 0);
      setNotes(rows?.notes ?? []);
      setNotePickerOpen(true);
    });
  }

  async function addNote(noteID: string) {
    if (!selected || busy) return;
    await run(async () => {
      await AddProjectNote(generation, selected.id, noteID);
      setNotice("已加入项目");
      setMembers(await ListProjectMembers(generation, selected.id));
    });
  }

  async function removeNote(noteID: string) {
    if (!selected || busy) return;
    await run(async () => {
      await RemoveProjectNote(generation, selected.id, noteID);
      setNotice("已移出项目");
      setMembers(await ListProjectMembers(generation, selected.id));
    });
  }

  return (
    <div className="preview-workspace" aria-label="项目库">
      <section className="preview-list" aria-label="项目列表">
        {writable && <button type="button" disabled={busy || creating} onClick={() => setCreating(true)}>新建项目</button>}
        {creating && <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label>名称<input required value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
          <label>说明<input value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="preview-actions">
            <button type="submit" disabled={busy || !name.trim()}>创建</button>
            <button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button>
          </div>
        </form>}
        <label className="preview-meta">
          <input type="checkbox" checked={includeArchived} disabled={busy}
            onChange={(event) => { const on = event.target.checked; setIncludeArchived(on); void run(() => reload(on)); }} />
          包含已封存
        </label>
        {!projects && !error && <p role="status">正在读取项目…</p>}
        {projects && projects.length === 0 && <p className="preview-meta">还没有项目。</p>}
        <ul>
          {projects?.map((project) => (
            <li key={project.id}>
              <button type="button" disabled={busy} aria-current={selected?.id === project.id ? "true" : undefined}
                onClick={() => void select(project)}>
                <strong>{project.name}</strong>
                <small>{project.archivedAt ? "已封存" : (project.description || "未填写说明")}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="preview-note preview-editor" aria-label="项目详情">
        {error && <p className="preview-error" role="alert">{error}</p>}
        {notice && <p className="preview-notice" role="status">{notice}</p>}
        {!selected && <p className="preview-meta">选择一个项目查看它的笔记范围。</p>}
        {selected && <>
          <h2>{selected.name}</h2>
          <p className="preview-meta">{selected.archivedAt ? "已封存" : "进行中"}{selected.description ? " · " + selected.description : ""}</p>
          <h3>成员笔记 {(members ?? []).length} 篇</h3>
          {!members && <p role="status">正在读取成员…</p>}
          {members && members.length === 0 && <p className="preview-meta">这个项目还没有成员笔记。</p>}
          <ul>
            {members?.map((member) => (
              <li key={member.noteId}>
                <strong>{member.title || "无标题笔记"}</strong>
                {member.isDeleted && <span className="preview-meta">（已删除）</span>}
                <span className="preview-meta">{member.excerpt}</span>
                {writable && !selected.archivedAt && <button type="button" disabled={busy} onClick={() => void removeNote(member.noteId)}>移出</button>}
              </li>
            ))}
          </ul>
          {writable && !selected.archivedAt && !notePickerOpen && <button type="button" disabled={busy} onClick={() => void openNotePicker()}>加入笔记</button>}
          {notePickerOpen && <div className="preview-confirm">
            <p>选择要加入「{selected.name}」的笔记：</p>
            {!notes && <p role="status">正在读取笔记…</p>}
            <ul>
              {notes?.map((note) => (
                <li key={note.id}>
                  {note.title || "无标题笔记"}
                  {memberIDs.has(note.id)
                    ? <span className="preview-meta">已在项目中</span>
                    : <button type="button" disabled={busy} onClick={() => void addNote(note.id)}>加入</button>}
                </li>
              ))}
            </ul>
            <button type="button" disabled={busy} onClick={() => setNotePickerOpen(false)}>收起</button>
          </div>}
          <div className="preview-actions">
            {!selected.archivedAt && <button type="button" disabled={busy} onClick={() => void exportMarkdown()}>导出 Markdown</button>}
            {!selected.archivedAt && (confirmArchive ? <>
              <button type="button" disabled={busy} onClick={() => void archive()}>确认封存</button>
              <button type="button" disabled={busy} onClick={() => setConfirmArchive(false)}>取消</button>
            </> : <button type="button" disabled={busy || !writable} onClick={() => setConfirmArchive(true)}>封存项目</button>)}
          </div>
          {markdown && <pre className="preview-material-body">{markdown}</pre>}
        </>}
      </section>
    </div>
  );
}

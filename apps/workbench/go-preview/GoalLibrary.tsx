import { useEffect, useState } from "react";
import { AchieveGoal, AbandonGoal, CreateGoal, GoalReview, LinkGoalEvidence, ListGoals, ListMaterials, ListNotes, ListProjects, SetGoalScope } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { Goal, Snapshot } from "./bindings/knowflick.local/workbench-go/internal/goals/models";
import type { Project } from "./bindings/knowflick.local/workbench-go/internal/projects/models";
import type { Note } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import type { Material } from "./bindings/knowflick.local/workbench-go/internal/materials/models";

type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
};

export function GoalLibrary({ generation, writable, busy, onBusy }: Props) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedID, setSelectedID] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [scope, setScope] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [confirmAction, setConfirmAction] = useState<"achieve" | "abandon" | null>(null);
  const [evidenceTab, setEvidenceTab] = useState<"note" | "material" | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [review, setReview] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = goals?.find((goal) => goal.id === selectedID) ?? null;

  async function reload(selectID = selectedID) {
    setGoals(await ListGoals(generation) ?? []);
    if (selectID && !goals?.some((goal) => goal.id === selectID)) setSelectedID("");
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, scopeRows] = await Promise.all([ListGoals(generation), ListProjects(generation, false)]);
        if (active) { setGoals(rows ?? []); setProjects(scopeRows ?? []); }
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

  async function create() {
    if (!title.trim() || !criteria.trim() || busy) return;
    await run(async () => {
      const id = await CreateGoal(generation, title, criteria, scope);
      setCreating(false);
      setTitle("");
      setCriteria("");
      setNotice("已新建目标");
      setSelectedID(id);
      await reload(id);
    });
  }

  async function finish(action: "achieve" | "abandon") {
    if (!selected || busy) return;
    await run(async () => {
      const changed = action === "achieve"
        ? await AchieveGoal(generation, selected.id, reviewNote)
        : await AbandonGoal(generation, selected.id, reviewNote);
      setConfirmAction(null);
      setReviewNote("");
      setNotice(changed ? (action === "achieve" ? "已确认达成" : "已放弃目标") : "目标已结束，请刷新后重试");
      setSelectedID("");
      await reload("");
    });
  }

  async function openEvidence(tab: "note" | "material") {
    if (busy) return;
    await run(async () => {
      if (tab === "note") {
        const page = await ListNotes(generation, 0);
        setNotes(page?.notes ?? []);
      } else {
        setMaterials(await ListMaterials(generation, false, 100, 0) ?? []);
      }
      setEvidenceTab(tab);
    });
  }

  async function changeScope(projectID: string) {
    if (!selected || busy) return;
    onBusy(true); setError(""); setNotice("");
    try {
      await SetGoalScope(generation, selected.id, projectID);
      setNotice(projectID ? "目标已归属到所选项目" : "目标已改为全局");
      const rows = await ListGoals(generation);
      setGoals(rows ?? []);
    } catch (cause) {
      setError(String(cause));
    } finally {
      onBusy(false);
    }
  }

  async function link(id: string, kind: "note" | "material") {
    if (!selected || busy) return;
    await run(async () => {
      await LinkGoalEvidence(generation, selected.id, id, kind);
      setNotice("已关联证据；证据数量不改变达成判定");
      await reload(selected.id);
    });
  }

  async function loadReview() {
    if (busy) return;
    await run(async () => {
      const now = Date.now();
      setReview(await GoalReview(generation, now - 30 * 86400000, now + 60000));
    });
  }

  return (
    <div className="preview-workspace" aria-label="目标库">
      <section className="preview-list" aria-label="活跃目标">
        {writable && <button type="button" disabled={busy || creating} onClick={() => setCreating(true)}>新建目标</button>}
        {creating && <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label>标题<input required value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>完成条件（必填，判定只认它）<textarea required value={criteria} disabled={busy} onChange={(event) => setCriteria(event.target.value)} /></label>
          <label>归属项目<select value={scope} disabled={busy} onChange={(event) => setScope(event.target.value)}>
            <option value="">全局（不限定项目）</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>
          <div className="preview-actions">
            <button type="submit" disabled={busy || !title.trim() || !criteria.trim()}>创建</button>
            <button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button>
          </div>
        </form>}
        {!goals && !error && <p role="status">正在读取目标…</p>}
        {goals && goals.length === 0 && <p className="preview-meta">没有活跃目标。</p>}
        <ul>
          {goals?.map((goal) => (
            <li key={goal.id}>
              <button type="button" disabled={busy} aria-current={selected?.id === goal.id ? "true" : undefined}
                onClick={() => { setSelectedID(goal.id); setConfirmAction(null); setReview(null); }}>
                <strong>{goal.title}</strong>
                <small>{goal.doneCriteria} · 证据 {goal.evidenceCount} 条（不参与判定）</small>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" disabled={busy} onClick={() => void loadReview()}>查看近 30 天复盘</button>
      </section>
      <section className="preview-note preview-editor" aria-label="目标详情">
        {error && <p className="preview-error" role="alert">{error}</p>}
        {notice && <p className="preview-notice" role="status">{notice}</p>}
        {!selected && <p className="preview-meta">选择一个目标查看完成条件与证据。</p>}
        {selected && <>
          <h2>{selected.title}</h2>
          <p className="preview-meta">完成条件：{selected.doneCriteria}</p>
          <p className="preview-meta">归属：{selected.scope ? (projects.find((project) => project.id === selected.scope)?.name ?? selected.scope) : "全局"} · 证据 {selected.evidenceCount} 条（缺证据不判失败）</p>
          {writable && <div className="preview-actions">
            <button type="button" disabled={busy} onClick={() => void openEvidence("note")}>关联笔记</button>
            <button type="button" disabled={busy} onClick={() => void openEvidence("material")}>关联素材</button>
            <select value={selected.scope ?? ""} disabled={busy} aria-label="调整归属项目"
              onChange={(event) => void changeScope(event.target.value)}>
              <option value="">全局</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>}
          {evidenceTab && <div className="preview-confirm">
            <p>选择要关联到「{selected.title}」的{evidenceTab === "note" ? "笔记" : "素材"}：</p>
            {evidenceTab === "note" && (!notes ? <p role="status">正在读取笔记…</p> : notes.length === 0 ? <p className="preview-meta">还没有笔记。</p> : <ul>
              {notes.map((note) => <li key={note.id}>{note.title || "无标题笔记"}<button type="button" disabled={busy} onClick={() => void link(note.id, "note")}>关联</button></li>)}
            </ul>)}
            {evidenceTab === "material" && (!materials ? <p role="status">正在读取素材…</p> : materials.length === 0 ? <p className="preview-meta">还没有素材。</p> : <ul>
              {materials.map((material) => <li key={material.id}>{material.title || "无标题素材"}<button type="button" disabled={busy} onClick={() => void link(material.id, "material")}>关联</button></li>)}
            </ul>)}
            <button type="button" disabled={busy} onClick={() => setEvidenceTab(null)}>收起</button>
          </div>}
          {writable && <div className="preview-actions">
            {confirmAction ? <>
              <label>复盘说明<textarea value={reviewNote} disabled={busy} onChange={(event) => setReviewNote(event.target.value)} /></label>
              <button type="button" disabled={busy} onClick={() => void finish(confirmAction)}>{confirmAction === "achieve" ? "确认达成" : "确认放弃"}</button>
              <button type="button" disabled={busy} onClick={() => setConfirmAction(null)}>取消</button>
            </> : <>
              <button type="button" disabled={busy} onClick={() => setConfirmAction("achieve")}>确认达成</button>
              <button type="button" disabled={busy} onClick={() => setConfirmAction("abandon")}>放弃目标</button>
            </>}
          </div>}
        </>}
        {review && <div className="preview-confirm">
          <h3>近 30 天复盘</h3>
          <p className="preview-meta">目标 {review.goals?.length ?? 0} 个 · 证据 {review.evidence?.length ?? 0} 条</p>
          <ul>
            {(review.goals ?? []).map((goal) => <li key={goal.id}><strong>{goal.title}</strong><span className="preview-meta">完成条件：{goal.doneCriteria} · 周期内证据 {goal.evidenceCount} 条</span></li>)}
          </ul>
          <p className="preview-meta">证据最多显示 20 条（按关联时间倒序）：</p>
          <ul>
            {(review.evidence ?? []).slice(0, 20).map((item) => <li key={item.goalId + item.evidenceId}>{item.title ?? "原件已删除"} · {item.kind === "note" ? "笔记" : "素材"}</li>)}
          </ul>
        </div>}
      </section>
    </div>
  );
}

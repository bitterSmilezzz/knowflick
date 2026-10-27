import { useCallback, useEffect, useState } from "react";
import type { Note } from "../../domain/note";
import type { RawMaterial } from "../../shell/store";
import {
  goalAbandon,
  goalAchieve,
  goalCreate,
  goalLinkEvidence,
  goalListActive,
  type Goal,
} from "../../shell/store";

/** 目标视图（R4/D04）：用户明确设定的目标、完成条件与证据关联。
 *
 * 判定语义在模型层守住：**达成只来自显式确认**，证据数只是计数——
 * 没有证据的目标照常在列且无「落后/失败」状态；放弃也是显式动作。
 * 页首口径与 D05 一致：这里治理用户自己设的目标，不评价人。
 */
export function GoalsView({ dir, materials, notes, onGoalsChange }: {
  dir: string;
  materials: RawMaterial[];
  notes: Note[];
  onGoalsChange: (goals: Goal[]) => void;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [creating, setCreating] = useState(false);
  // 每个目标独立的「证据选择」打开态。
  const [linkingFor, setLinkingFor] = useState<string | null>(null);
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const [reviewText, setReviewText] = useState("");

  const refresh = useCallback(async () => {
    try {
      const current = await goalListActive(dir);
      setGoals(current);
      onGoalsChange(current);
      setError("");
    } catch (e) {
      setError(`读取目标失败：${String(e)}`);
    } finally {
      setLoaded(true);
    }
  }, [dir, onGoalsChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    try {
      await goalCreate({
        id: crypto.randomUUID(),
        title: title.trim(),
        doneCriteria: criteria.trim(),
        scope: null,
      }, dir);
      setTitle("");
      setCriteria("");
      setCreating(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const achieve = async (id: string) => {
    try {
      await goalAchieve(id, reviewText, dir);
      setReviewFor(null);
      setReviewText("");
      await refresh();
    } catch (e) {
      setError(`确认达成失败：${String(e)}`);
    }
  };

  const abandon = async (id: string) => {
    try {
      await goalAbandon(id, reviewText || "优先级变化", dir);
      setReviewFor(null);
      setReviewText("");
      await refresh();
    } catch (e) {
      setError(`放弃目标失败：${String(e)}`);
    }
  };

  const link = async (goalId: string, evidenceId: string, kind: "note" | "material") => {
    try {
      await goalLinkEvidence(goalId, evidenceId, kind, dir);
      await refresh();
    } catch (e) {
      setError(`关联证据失败：${String(e)}`);
    }
  };

  return (
    <div className="gl-root" aria-label="目标">
      <div className="gl-head">
        <h1>目标</h1>
        <button className="ws-primary" type="button" onClick={() => setCreating(!creating)} disabled={!loaded}>
          <span aria-hidden="true">＋</span> 新建目标
        </button>
      </div>
      <p className="ws-hint" style={{ margin: 0 }}>
        目标与完成条件由你设定；达成由你确认，系统不凭记录多少做任何判定——
        没有关联证据只是「还没有关联」，不是落后。
      </p>

      {error ? <p className="nv-error" role="alert">{error}</p> : null}

      {creating ? (
        <div className="gl-form" role="form" aria-label="新建目标">
          <input
            aria-label="目标标题"
            placeholder="目标（如：读完这本书）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            aria-label="完成条件"
            placeholder="完成条件——达成时你对照的就是这条（必填）"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ws-primary" type="button" disabled={!title.trim() || !criteria.trim()} onClick={() => void create()}>
              创建
            </button>
            <button className="ws-bordered" type="button" onClick={() => setCreating(false)}>取消</button>
          </div>
        </div>
      ) : null}

      {!loaded ? (
        <p className="ws-hint">正在读取目标…</p>
      ) : goals.length === 0 ? (
        <div className="ws-list-empty">
          <h2>还没有目标</h2>
          <p>目标与完成条件由你设定；进展靠证据关联，缺少记录不会被判定为失败。</p>
        </div>
      ) : (
        <ul className="gl-list">
          {goals.map((g) => (
            <li key={g.id} className="gl-item" data-goal={g.id}>
              <div className="gl-item-main">
                <strong>{g.title}</strong>
                <span className="gl-criteria">完成条件：{g.doneCriteria}</span>
                <span className="gl-meta">关联证据 {g.evidenceCount} 条 · 建立于 {new Date(g.createdAt).toLocaleDateString("zh-CN")}</span>
              </div>
              <div className="gl-item-actions">
                <button type="button" className="ws-bordered" onClick={() => { setLinkingFor(linkingFor === g.id ? null : g.id); }}>
                  关联证据
                </button>
                <button type="button" className="ws-bordered" onClick={() => { setReviewFor(reviewFor === g.id ? null : g.id); setReviewText(""); }}>
                  确认达成…
                </button>
                <button
                  type="button"
                  className="ws-bordered gl-abandon"
                  onClick={() => { if (window.confirm(`放弃目标「${g.title}」？放弃会记录你写的一句话回顾。`)) void abandon(g.id); }}
                >
                  放弃
                </button>
              </div>
              {linkingFor === g.id ? (
                <GoalsEvidencePicker goalTitle={g.title} notes={notes} materials={materials}
                  onSelect={(id, kind) => void link(g.id, id, kind)} />
              ) : null}
              {reviewFor === g.id ? (
                <div className="gl-review" role="group" aria-label="达成或放弃">
                  <textarea
                    aria-label="回顾"
                    placeholder="一句话回顾（可选）"
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="ws-primary" type="button" onClick={() => void achieve(g.id)}>确认达成</button>
                    <button className="ws-bordered" type="button" onClick={() => void abandon(g.id)}>放弃目标</button>
                    <button className="ws-bordered" type="button" onClick={() => setReviewFor(null)}>取消</button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 笔记和素材分别选择，避免把一个来源的 id 当成另一种类型提交。 */
export function GoalsEvidencePicker({ goalTitle, notes, materials, onSelect }: {
  goalTitle: string;
  notes: Pick<Note, "id" | "title" | "isDeleted">[];
  materials: Pick<RawMaterial, "id" | "title">[];
  onSelect: (id: string, kind: "note" | "material") => void;
}) {
  return (
    <div className="gl-link" role="group" aria-label="关联证据">
      <select aria-label={`给「${goalTitle}」选择笔记证据`} value=""
        onChange={(e) => { if (e.target.value) onSelect(e.target.value, "note"); }}>
        <option value="">选择笔记作为证据…</option>
        {notes.filter((n) => !n.isDeleted).map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
      </select>
      <select aria-label={`给「${goalTitle}」选择素材证据`} value=""
        onChange={(e) => { if (e.target.value) onSelect(e.target.value, "material"); }}>
        <option value="">选择素材作为证据…</option>
        {materials.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select>
      <span className="ws-hint">可关联笔记或素材作为证据。</span>
    </div>
  );
}

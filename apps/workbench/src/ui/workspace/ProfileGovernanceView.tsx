import { useCallback, useEffect, useMemo, useState } from "react";
import {
  profileClaimAdd,
  profileClaimConfirm,
  profileClaimDeny,
  profileClaimDelete,
  profileClaimPause,
  profileClaimResume,
  profileClaimsAll,
  projectList,
  projectMemberIndex,
  inShell,
  type ProfileClaim,
  type Project,
} from "../../shell/store";
import type { Note } from "../../domain/note";
import type { AiSettings } from "../../domain/settings";
import { generateProfileLearningProposals, profileNotesInScope, type ProfileInferenceProposal, type ProfileLearningNote } from "../../domain/profileLearning";
import { requiresKey } from "../../domain/ingest";
import { indexNoteProjects } from "../../domain/reviewReminder";
import { readNotes } from "./repository";
import { useDeleteConfirm } from "./useDeleteConfirm";

const KIND_LABEL: Record<ProfileClaim["kind"], string> = {
  fact: "已确认事实",
  statistic: "行为统计",
  inference: "AI 推测",
};

type ProjectIndexStatus = "loading" | "ready" | "error" | "unavailable";
type NotesStatus = "loading" | "ready" | "error";
type LearningDraft = ProfileInferenceProposal & { id: string };

export function ProfileGovernanceView({
  dir,
  notes,
  notesStatus,
  projects,
  noteProjectIndex,
  projectIndexStatus,
  settings,
  apiKey,
  onOpenNote,
}: {
  dir: string;
  notes: Note[];
  notesStatus: NotesStatus;
  projects: Project[];
  noteProjectIndex: Map<string, string[]>;
  projectIndexStatus: ProjectIndexStatus;
  settings: AiSettings;
  apiKey: string;
  onOpenNote?: (id: string) => void;
}) {
  const [claims, setClaims] = useState<ProfileClaim[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"active" | "paused" | "denied" | "inactive">("active");
  const [error, setError] = useState("");
  const [scope, setScope] = useState("global");
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<LearningDraft[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [draftScope, setDraftScope] = useState("");
  const [draftNotes, setDraftNotes] = useState<ProfileLearningNote[]>([]);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      setClaims(await profileClaimsAll(dir));
      setError("");
    } catch (e) {
      setError(`读取画像失败：${String(e)}`);
    } finally {
      setLoaded(true);
    }
  }, [dir]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    setScope("global");
    setSelectedNoteIds(new Set());
    setConsented(false);
    setDrafts([]);
    setSelectedDraftIds(new Set());
    setDraftNotes([]);
    setDraftScope("");
    setNotice("");
  }, [dir]);

  const act = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refresh]);

  const del = useDeleteConfirm(async (target: string) => {
    try { await profileClaimDelete(target, dir); await refresh(); }
    catch (e) { setError(`删除失败：${String(e)}`); }
  });

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const scopeReady = projectIndexStatus === "ready" && notesStatus === "ready";
  const availableNotes = useMemo(
    () => profileNotesInScope(notes, scope, noteProjectIndex, scopeReady),
    [notes, noteProjectIndex, scope, scopeReady],
  );
  const selectedNotes = useMemo(
    () => availableNotes.filter((note) => selectedNoteIds.has(note.id)),
    [availableNotes, selectedNoteIds],
  );

  const clearDraft = useCallback(() => {
    setDrafts([]);
    setSelectedDraftIds(new Set());
    setDraftNotes([]);
    setDraftScope("");
    setNotice("");
  }, []);

  useEffect(() => {
    const eligibleIds = new Set(availableNotes.map(({ id }) => id));
    setSelectedNoteIds((current) => {
      const retained = new Set([...current].filter((id) => eligibleIds.has(id)));
      return retained.size === current.size ? current : retained;
    });
    setConsented(false);
    clearDraft();
  }, [availableNotes, clearDraft]);

  const destination = useMemo(() => {
    try {
      const url = new URL(settings.baseURL);
      return url.hostname || "当前配置的模型服务";
    } catch {
      return "当前配置的模型服务";
    }
  }, [settings.baseURL]);
  const modelReady = useMemo(() => {
    if (!settings.enableAI || !settings.model.trim()) return false;
    try { return !requiresKey(settings.baseURL) || Boolean(apiKey.trim()); }
    catch { return false; }
  }, [apiKey, settings.baseURL, settings.enableAI, settings.model]);

  const changeScope = (next: string) => {
    setScope(next);
    setSelectedNoteIds(new Set());
    setConsented(false);
    clearDraft();
  };

  const toggleNote = (id: string) => {
    setSelectedNoteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (selectedNotes.length < 12) next.add(id);
      return next;
    });
    setConsented(false);
    clearDraft();
  };

  const readFreshSelectedNotes = useCallback(async (
    sourceNotes: readonly ProfileLearningNote[],
    targetScope: string,
  ): Promise<ProfileLearningNote[]> => {
    if (!inShell()) throw new Error("个人记忆生成目前需要桌面客户端");
    const [freshState, memberPairs, activeProjects] = await Promise.all([
      readNotes(dir),
      projectMemberIndex(dir),
      projectList(false, dir),
    ]);
    const freshIndex = indexNoteProjects(memberPairs);
    if (targetScope !== "global" && !activeProjects.some((project) => project.id === targetScope)) {
      throw new Error("所选项目已封存或不可用，请重新选择范围");
    }
    const freshById = new Map(freshState.notes.map((note) => [note.id, note]));
    const current = sourceNotes.map((source) => {
      const latest = freshById.get(source.id);
      if (!latest || latest.isDeleted) throw new Error("所选笔记已删除或不可用，请重新选择");
      if (latest.currentRevision !== source.currentRevision || latest.updatedAt !== source.updatedAt || latest.bodyMd !== source.bodyMd) {
        throw new Error("所选笔记在载入后有更新，请重新选择并重新生成");
      }
      return latest;
    });
    const inScope = profileNotesInScope(current, targetScope, freshIndex, true);
    if (inScope.length !== current.length) throw new Error("笔记的项目归属已变化，本次建议未发送或保存");
    return inScope;
  }, [dir]);

  const generate = async () => {
    if (!consented || !modelReady || selectedNotes.length === 0 || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    clearDraft();
    try {
      const current = await readFreshSelectedNotes(selectedNotes, scope);
      const proposals = await generateProfileLearningProposals(current, settings, apiKey);
      const generated = proposals.map((proposal) => ({ ...proposal, id: crypto.randomUUID() }));
      setDrafts(generated);
      setSelectedDraftIds(new Set(generated.map(({ id }) => id)));
      setDraftNotes(current);
      setDraftScope(scope);
      if (generated.length === 0) setNotice("没有找到证据充分的建议；笔记没有写入画像。");
    } catch (e) {
      setError(`生成建议失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveDrafts = async () => {
    const selected = drafts.filter((draft) => selectedDraftIds.has(draft.id));
    if (!selected.length || busy || draftScope !== scope) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const current = await readFreshSelectedNotes(draftNotes, draftScope);
      const currentIds = new Set(current.map(({ id }) => id));
      const toSave = selected.filter((draft) => draft.evidenceIds.every((id) => currentIds.has(id)));
      if (toSave.length !== selected.length) throw new Error("建议引用的笔记已变化，请重新生成");
      const failures: string[] = [];
      const savedDraftIds = new Set<string>();
      for (const draft of toSave) {
        try {
          await profileClaimAdd({
            id: crypto.randomUUID(),
            kind: "inference",
            content: draft.content,
            evidenceJson: JSON.stringify(draft.evidenceIds),
            scope: draftScope,
          }, dir);
          savedDraftIds.add(draft.id);
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (savedDraftIds.size > 0) await refresh();
      setDrafts((currentDrafts) => currentDrafts.filter(({ id }) => !savedDraftIds.has(id)));
      setSelectedDraftIds((currentIds) => new Set([...currentIds].filter((id) => !savedDraftIds.has(id))));
      setNotice(savedDraftIds.size > 0 ? `已保存 ${savedDraftIds.size} 条待确认建议；它们不会进入回答，直到你逐条确认。` : "没有建议保存。");
      if (failures.length > 0) setError(`有 ${failures.length} 条建议未保存。${failures[0]}`);
    } catch (e) {
      setError(`保存建议失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const isInactive = (c: ProfileClaim) =>
    c.deniedAt == null && (c.supersededBy != null || (c.expiresAt != null && c.expiresAt <= now));
  const visible = claims.filter((c) =>
    view === "active" ? c.status === "active" && c.deniedAt == null && !isInactive(c)
      : view === "paused" ? c.status === "paused" && c.deniedAt == null && !isInactive(c)
      : view === "denied" ? c.deniedAt != null
      : isInactive(c),
  );
  const deniedCount = claims.filter((c) => c.deniedAt != null).length;
  const pausedCount = claims.filter((c) => c.status === "paused" && c.deniedAt == null && !isInactive(c)).length;
  const inactiveCount = claims.filter(isInactive).length;

  const evidenceIds = (claim: ProfileClaim): string[] => {
    try {
      const parsed: unknown = JSON.parse(claim.evidenceJson);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch { return []; }
  };
  const scopeLabel = (claimScope: string) => claimScope === "global"
    ? "全局"
    : projectNames.get(claimScope) ?? `项目 ${claimScope}`;

  return (
    <div className="pg-root" aria-label="画像治理">
      <div className="pg-head">
        <h1>我的记忆</h1>
        <p className="ws-hint" style={{ margin: 0 }}>
          记忆从空白开始。你可以从本次选中的笔记生成建议；每条建议保存后仍需你逐条确认，才会进入后续回答。
        </p>
      </div>

      <section className="pg-learning" aria-label="从笔记生成记忆建议">
        <div className="pg-learning-head">
          <div>
            <h2>从笔记生成建议</h2>
            <p className="ws-hint">只发送你勾选的笔记。已排除个人画像的笔记不会出现在这里。范围、笔记版本或项目归属改变时，本次操作会停止。</p>
          </div>
          <label className="pg-scope">
            <span>记忆范围</span>
            <select value={scope} onChange={(event) => changeScope(event.currentTarget.value)}>
              <option value="global">全局</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </div>

        {!inShell() ? <p className="ws-hint">个人记忆治理需要桌面客户端；浏览器体验模式不读取或写入画像。</p> : null}
        {notesStatus === "loading" || projectIndexStatus === "loading" ? <p className="ws-hint">正在读取笔记范围…</p> : null}
        {notesStatus === "error" || projectIndexStatus === "error" || projectIndexStatus === "unavailable" ? (
          <p className="nv-error" role="alert">笔记或项目归属读取失败，暂时不能生成建议。</p>
        ) : null}
        {scopeReady ? (
          <div className="pg-note-picker" role="group" aria-label="选择用于本次建议的笔记">
            {availableNotes.length === 0 ? <p className="ws-hint">这个范围里没有可用笔记。</p> : null}
            {availableNotes.map((note) => (
              <div key={note.id} className="pg-note-option">
                <label className="pg-note-choice">
                  <input
                    type="checkbox"
                    checked={selectedNoteIds.has(note.id)}
                    disabled={!selectedNoteIds.has(note.id) && selectedNotes.length >= 12}
                    onChange={() => toggleNote(note.id)}
                  />
                  <span>
                    <strong>{note.title.trim() || "无标题笔记"}</strong>
                    <small>{note.bodyMd.replace(/\s+/g, " ").slice(0, 180)}</small>
                  </span>
                </label>
                <details className="pg-note-preview">
                  <summary>查看将发送的全文</summary>
                  <pre>{note.bodyMd}</pre>
                </details>
              </div>
            ))}
          </div>
        ) : null}

        <p className="pg-selection-count">已选择 {selectedNotes.length} 篇笔记（最多 12 篇）</p>
        {!settings.enableAI ? <p className="ws-hint">AI 功能已关闭，请先到设置中开启。</p> : null}
        {settings.enableAI && !modelReady ? <p className="ws-hint">请先在设置中检查模型地址、名称和 API 密钥。</p> : null}
        <label className="pg-consent">
          <input type="checkbox" checked={consented} disabled={!scopeReady || selectedNotes.length === 0} onChange={(event) => setConsented(event.currentTarget.checked)} />
          <span>我已核对所选笔记，并同意本次将这些正文发送到 {destination} 的「{settings.model || "未配置模型"}」生成建议。模型只返回草稿，不会自动写入或确认记忆。</span>
        </label>
        <button type="button" className="ws-primary" disabled={!scopeReady || !inShell() || !consented || !modelReady || selectedNotes.length === 0 || busy} onClick={() => void generate()}>
          {busy ? "处理中…" : "生成建议"}
        </button>

        {drafts.length > 0 ? (
          <div className="pg-drafts" aria-label="待审核的生成建议">
            <h3>模型草稿：选择要保存的建议</h3>
            <p className="ws-hint">草稿尚未保存。保存后会进入“待确认”，确认前不会用于问答。</p>
            {drafts.map((draft) => (
              <label className="pg-draft" key={draft.id}>
                <input
                  type="checkbox"
                  checked={selectedDraftIds.has(draft.id)}
                  onChange={() => setSelectedDraftIds((current) => {
                    const next = new Set(current);
                    if (next.has(draft.id)) next.delete(draft.id); else next.add(draft.id);
                    return next;
                  })}
                />
                <span>
                  <strong>{draft.content}</strong>
                  <small>依据：{draft.evidenceIds.map((id) => draftNotes.find((note) => note.id === id)?.title || id).join("、")}</small>
                </span>
              </label>
            ))}
            <button type="button" className="ws-bordered" disabled={busy || selectedDraftIds.size === 0} onClick={() => void saveDrafts()}>
              保存所选为待确认建议
            </button>
          </div>
        ) : null}
      </section>

      {notice ? <p className="ws-hint" role="status">{notice}</p> : null}
      {error ? <p className="nv-error" role="alert">{error}</p> : null}

      <div className="pg-tabs" role="group" aria-label="记忆视图">
        {([["active", `生效中（${claims.filter((c) => c.deniedAt == null && c.status === "active" && !isInactive(c)).length}）`],
          ["paused", `已暂停（${pausedCount}）`],
          ["denied", `已否认（${deniedCount}）`],
          ["inactive", `已过期/已替代（${inactiveCount}）`]] as const).map(([v, label]) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>
        ))}
      </div>

      {!loaded ? (
        <p className="ws-hint">正在读取…</p>
      ) : visible.length === 0 ? (
        <div className="ws-list-empty">
          <h2>{view === "denied" ? "没有已否认的记忆" : view === "paused" ? "没有已暂停的记忆" : view === "inactive" ? "没有已过期或已替代的记忆" : "还没有记忆"}</h2>
          <p>新建议需要你保存并逐条确认；拒绝保存的模型草稿不会留下记录。</p>
        </div>
      ) : (
        <ul className="pg-list">
          {visible.map((c) => {
            const evidence = evidenceIds(c);
            return (
              <li key={c.id} className="pg-item" data-kind={c.kind} data-status={c.status}>
                <div className="pg-item-main">
                  <span className="pg-kind-badge">{KIND_LABEL[c.kind] ?? c.kind}</span>
                  <span className="pg-content">{c.content}</span>
                  <span className="pg-meta">
                    范围：{scopeLabel(c.scope)} · 建立于 {new Date(c.createdAt).toLocaleDateString("zh-CN")}
                    {c.confirmedAt != null ? " · 已确认" : c.kind === "inference" ? " · 待确认" : ""}
                    {c.expiresAt != null ? ` · 有效期至 ${new Date(c.expiresAt).toLocaleDateString("zh-CN")}` : ""}
                  </span>
                  <details className="pg-evidence">
                    <summary>查看证据（{evidence.length}）</summary>
                    {evidence.length ? <ul>{evidence.map((id) => {
                      const note = noteById.get(id);
                      const updatedAfterClaim = note != null && note.updatedAt > c.createdAt;
                      return <li key={id}>
                        {note && onOpenNote ? <button type="button" className="ws-bordered pg-evidence-link" onClick={() => onOpenNote(id)}>{note.title.trim() || "无标题笔记"}</button> : <span>{note?.title || id}</span>}
                        {updatedAfterClaim ? <span className="pg-stale-evidence"> · 笔记建立后已修改，建议复核</span> : null}
                      </li>;
                    })}</ul> : <p className="ws-hint">没有可读取的证据标识。</p>}
                  </details>
                </div>
                <div className="pg-item-actions">
                  {view === "active" && c.confirmedAt == null && c.kind === "inference" ? (
                    <button type="button" className="ws-bordered" onClick={() => void act(() => profileClaimConfirm(c.id, dir))}>确认</button>
                  ) : null}
                  {view === "active" ? (
                    <>
                      <button type="button" className="ws-bordered" onClick={() => void act(() => profileClaimPause(c.id, dir))}>暂停</button>
                      <button type="button" className="ws-bordered" onClick={() => void act(() => profileClaimDeny(c.id, dir))}>否认</button>
                    </>
                  ) : null}
                  {view === "paused" ? (
                    <button type="button" className="ws-bordered" onClick={() => void act(() => profileClaimResume(c.id, dir))}>恢复使用</button>
                  ) : null}
                  {view === "denied" ? (
                    <button type="button" className="ws-bordered" onClick={() => void act(async () => {
                      const { profileDenialClearByEvidence } = await import("../../shell/store");
                      await profileDenialClearByEvidence(c.evidenceJson, dir);
                    })}>允许重新学习</button>
                  ) : null}
                  {view !== "denied" ? (
                    <button type="button" className={`ws-bordered${del.isArmed(c.id) ? " pg-confirm" : ""}`} onClick={() => del.request(c.id)}>
                      {del.isArmed(c.id) ? "再点一次删除（不自动重建）" : "删除"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

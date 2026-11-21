import { useEffect, useState } from "react";
import { AddClaim, ClearClaimDenial, ConfirmClaim, DeleteClaim, DenyClaim, ListClaims, ListClaimDenials, PauseClaim, ResumeClaim, ListProjects } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { Claim, Denial } from "./bindings/knowflick.local/workbench-go/internal/profile/models";
import type { Project } from "./bindings/knowflick.local/workbench-go/internal/projects/models";

type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
};

type Mode = "active" | "all" | "global";

export function ClaimLibrary({ generation, writable, busy, onBusy }: Props) {
  const [mode, setMode] = useState<Mode>("active");
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [denials, setDenials] = useState<Denial[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedID, setSelectedID] = useState("");
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState("");
  const [content, setContent] = useState("");
  const [evidence, setEvidence] = useState("");
  const [scope, setScope] = useState("global");
  const [confirmAction, setConfirmAction] = useState<"deny" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = claims?.find((claim) => claim.id === selectedID) ?? null;

  async function reload(next: Mode = mode) {
    const rows = await ListClaims(generation, next, Date.now());
    setClaims(rows ?? []);
    setDenials(await ListClaimDenials(generation) ?? []);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, denialRows, projectRows] = await Promise.all([
          ListClaims(generation, "active", Date.now()),
          ListClaimDenials(generation),
          ListProjects(generation, false),
        ]);
        if (active) { setClaims(rows ?? []); setDenials(denialRows ?? []); setProjects(projectRows ?? []); }
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
    if (!content.trim() || busy) return;
    await run(async () => {
      const ids = [...new Set(evidence.split(/[,，\s]+/u).map((id) => id.trim()).filter(Boolean))];
      const id = await AddClaim(generation, kind.trim() || "inference", content, ids, scope);
      setCreating(false);
      setKind("");
      setContent("");
      setEvidence("");
      setScope("global");
      setNotice("已新增画像断言");
      setSelectedID(id);
      await reload();
    });
  }

  async function act(action: "confirm" | "pause" | "resume" | "deny" | "delete" | "clear") {
    if (!selected || busy) return;
    await run(async () => {
      if (action === "confirm") await ConfirmClaim(generation, selected.id);
      if (action === "pause") await PauseClaim(generation, selected.id);
      if (action === "resume") await ResumeClaim(generation, selected.id);
      if (action === "deny") { await DenyClaim(generation, selected.id); setNotice("已否认；同源证据不会自动重建"); }
      if (action === "delete") { await DeleteClaim(generation, selected.id); setNotice("已删除；同源证据不会自动重建"); setSelectedID(""); }
      if (action === "clear") {
        const ids = JSON.parse(selected.evidenceJson) as string[];
        await ClearClaimDenial(generation, ids);
        setNotice("已清除否认，同源证据可以重新学习");
      }
      setConfirmAction(null);
      await reload();
    });
  }

  const statusLabels: Record<string, string> = { active: "生效中", paused: "已暂停" };

  return (
    <div className="preview-workspace" aria-label="画像声明">
      <section className="preview-list" aria-label="声明列表">
        <div className="preview-actions">
          <button type="button" aria-pressed={mode === "active"} disabled={busy} onClick={() => { setMode("active"); void run(() => reload("active")); }}>有效声明</button>
          <button type="button" aria-pressed={mode === "all"} disabled={busy} onClick={() => { setMode("all"); void run(() => reload("all")); }}>全部</button>
          <button type="button" aria-pressed={mode === "global"} disabled={busy} onClick={() => { setMode("global"); void run(() => reload("global")); }}>全局问答记忆</button>
        </div>
        {writable && <button type="button" disabled={busy || creating} onClick={() => setCreating(true)}>新增断言</button>}
        {creating && <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label>类型<input value={kind} disabled={busy} onChange={(event) => setKind(event.target.value)} placeholder="如：偏好 / fact" /></label>
          <label>内容<input required value={content} disabled={busy} onChange={(event) => setContent(event.target.value)} /></label>
          <label>证据笔记/素材 ID（逗号分隔）<input value={evidence} disabled={busy} onChange={(event) => setEvidence(event.target.value)} /></label>
          <label>范围<select value={scope} disabled={busy} onChange={(event) => setScope(event.target.value)}>
            <option value="global">全局</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>
          <div className="preview-actions">
            <button type="submit" disabled={busy || !content.trim()}>保存断言</button>
            <button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button>
          </div>
        </form>}
        {!claims && !error && <p role="status">正在读取断言…</p>}
        {claims && claims.length === 0 && <p className="preview-meta">没有断言。</p>}
        <ul>
          {claims?.map((claim) => (
            <li key={claim.id}>
              <button type="button" disabled={busy} aria-current={selected?.id === claim.id ? "true" : undefined}
                onClick={() => { setSelectedID(claim.id); setConfirmAction(null); }}>
                <strong>{claim.content}</strong>
                <small>{claim.kind} · {claim.scope || "未指定范围"} · {statusLabels[claim.status] ?? claim.status}
                  {claim.confirmedAt ? " · 已确认" : " · 未确认"}
                  {claim.deniedAt ? " · 已否认" : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
        {denials.length > 0 && <p className="preview-meta">已否认的证据源 {denials.length} 条（防同源重建）</p>}
      </section>
      <section className="preview-note preview-editor" aria-label="断言详情">
        {error && <p className="preview-error" role="alert">{error}</p>}
        {notice && <p className="preview-notice" role="status">{notice}</p>}
        {!selected && <p className="preview-meta">选择一条断言查看与治理。</p>}
        {selected && <>
          <h2>{selected.content}</h2>
          <p className="preview-meta">类型 {selected.kind} · 范围 {selected.scope || "未指定"} · {statusLabels[selected.status] ?? selected.status}
            {selected.confirmedAt ? " · 已确认" : " · 未确认"}
            {selected.expiresAt ? " · 到期 " + new Date(selected.expiresAt).toLocaleString("zh-CN") : ""}
          </p>
          <p className="preview-meta">证据：{selected.evidenceJson}</p>
          {writable && <div className="preview-actions">
            {!selected.confirmedAt && !selected.deniedAt && <button type="button" disabled={busy} onClick={() => void act("confirm")}>确认事实</button>}
            {selected.status === "active" && <button type="button" disabled={busy} onClick={() => void act("pause")}>暂停</button>}
            {selected.status === "paused" && <button type="button" disabled={busy} onClick={() => void act("resume")}>恢复</button>}
            {!selected.deniedAt && (confirmAction ? <>
              <button type="button" disabled={busy} onClick={() => void act(confirmAction)}>{confirmAction === "deny" ? "确认否认" : "确认删除"}</button>
              <button type="button" disabled={busy} onClick={() => setConfirmAction(null)}>取消</button>
            </> : <>
              <button type="button" disabled={busy} onClick={() => setConfirmAction("deny")}>否认</button>
              <button type="button" disabled={busy} onClick={() => setConfirmAction("delete")}>删除</button>
            </>)}
            {selected.deniedAt && <button type="button" disabled={busy} onClick={() => void act("clear")}>清除否认（允许重新学习）</button>}
          </div>}
        </>}
      </section>
    </div>
  );
}

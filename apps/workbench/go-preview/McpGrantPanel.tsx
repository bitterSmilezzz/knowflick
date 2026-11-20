import { useEffect, useState } from "react";
import { CreateMcpGrant, ListMcpGrants, ListProjects, McpServerPaths, RevokeMcpGrant } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { CreatedGrant, Grant, Request } from "./bindings/knowflick.local/workbench-go/internal/mcpgrants/models";
import type { McpServerPaths as ServerPaths } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import type { Project } from "./bindings/knowflick.local/workbench-go/internal/projects/models";

type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
};

export function McpGrantPanel({ generation, writable, busy, onBusy }: Props) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [paths, setPaths] = useState<ServerPaths | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [clientLabel, setClientLabel] = useState("");
  const [scope, setScope] = useState("project");
  const [projectID, setProjectID] = useState("");
  const [libraryRead, setLibraryRead] = useState(true);
  const [cardWrite, setCardWrite] = useState(false);
  const [materialWrite, setMaterialWrite] = useState(false);
  const [token, setToken] = useState("");
  const [revokeID, setRevokeID] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, pathInfo, projectRows] = await Promise.all([
          ListMcpGrants(generation), McpServerPaths(generation), ListProjects(generation, false),
        ]);
        if (active) { setGrants(rows ?? []); setPaths(pathInfo); setProjects(projectRows ?? []); }
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
    if (!clientLabel.trim() || busy) return;
    await run(async () => {
      const request: Request = {
        clientLabel,
        scope,
        projectId: scope === "project" ? (projectID || null) : null,
        libraryRead: scope === "library" ? libraryRead : false,
        cardWrite: scope === "library" ? cardWrite : false,
        materialWrite: scope === "library" ? materialWrite : false,
      };
      const created: CreatedGrant = await CreateMcpGrant(generation, request);
      setCreating(false);
      setClientLabel("");
      setToken(created.token);
      setNotice("授权已创建：令牌只显示这一次，请立即复制给客户端");
      setGrants(await ListMcpGrants(generation) ?? []);
    });
  }

  async function revoke(id: string) {
    if (busy) return;
    await run(async () => {
      await RevokeMcpGrant(generation, id);
      setRevokeID("");
      setNotice("授权已撤销");
      setGrants(await ListMcpGrants(generation) ?? []);
    });
  }

  return (
    <section className="preview-mail" aria-label="外部授权">
      <div className="preview-mail-head">
        <strong>外部连接授权</strong>
        <span>{grants.length} 条</span>
        <button type="button" disabled={busy || !writable || creating} onClick={() => setCreating(true)}>新建授权</button>
      </div>
      {error && <p className="preview-error" role="alert">{error}</p>}
      {notice && <p className="preview-notice" role="status">{notice}</p>}
      {token && <div className="preview-confirm">
        <p>令牌只显示这一次，库里只存摘要：</p>
        <code>{token}</code>
        <button type="button" onClick={() => setToken("")}>我已保存</button>
      </div>}
      {creating && <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label>连接名称<input required value={clientLabel} disabled={busy} onChange={(event) => setClientLabel(event.target.value)} placeholder="如：Claude Desktop" /></label>
        <label>范围<select value={scope} disabled={busy} onChange={(event) => setScope(event.target.value)}>
          <option value="project">项目笔记只读</option>
          <option value="library">全库能力</option>
        </select></label>
        {scope === "project" && <label>项目<select required value={projectID} disabled={busy} onChange={(event) => setProjectID(event.target.value)}>
          <option value="">选择项目…</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>}
        {scope === "library" && <div className="preview-actions">
          <label><input type="checkbox" checked={libraryRead} disabled={busy} onChange={(event) => setLibraryRead(event.target.checked)} /> 读资料库</label>
          <label><input type="checkbox" checked={cardWrite} disabled={busy} onChange={(event) => setCardWrite(event.target.checked)} /> 写卡片</label>
          <label><input type="checkbox" checked={materialWrite} disabled={busy} onChange={(event) => setMaterialWrite(event.target.checked)} /> 写素材</label>
        </div>}
        <div className="preview-actions">
          <button type="submit" disabled={busy || !clientLabel.trim() || (scope === "project" && !projectID)}>创建授权</button>
          <button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button>
        </div>
      </form>}
      {grants.length === 0 && <p className="preview-count">还没有外部授权</p>}
      <ul className="preview-mail-list">
        {grants.map((grant) => (
          <li key={grant.id}>
            <span>{grant.clientLabel} · {grant.scope === "project" ? "项目笔记只读" : "全库"}
              {grant.libraryRead ? " · 读" : ""}{grant.cardWrite ? " · 写卡片" : ""}{grant.materialWrite ? " · 写素材" : ""}
            </span>
            <small>{grant.revokedAt ? "已撤销" : "生效中"} · 策略 v{grant.policyVersion} · {new Date(grant.createdAt).toLocaleString("zh-CN")}</small>
            {writable && !grant.revokedAt && (revokeID === grant.id
              ? <span className="preview-confirm">撤销后客户端立即失效。<button type="button" disabled={busy} onClick={() => void revoke(grant.id)}>确认撤销</button><button type="button" disabled={busy} onClick={() => setRevokeID("")}>取消</button></span>
              : <button type="button" disabled={busy} onClick={() => setRevokeID(grant.id)}>撤销</button>)}
          </li>
        ))}
      </ul>
      {paths && <p className="preview-meta">
        服务端脚本：{paths.scriptPath}（{paths.scriptExists ? "入口齐全" : "入口缺失，请确认 mcp-access.mjs 与脚本同目录"}）
      </p>}
    </section>
  );
}

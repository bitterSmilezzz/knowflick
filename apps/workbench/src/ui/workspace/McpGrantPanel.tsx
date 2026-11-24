import { useCallback, useEffect, useState } from "react";
import { inShell, mcpGrantCreate, mcpGrantList, mcpGrantRevoke, mcpServerPaths, projectList, type McpGrant, type Project } from "../../shell/store";
import { userError } from "./userError";
import { generateMcpConfigSnippet } from "../../domain/mcpServer";

/** 封存项目不能继续使用；保留撤销入口以清理该连接。 */
export function grantStatus(grant: McpGrant, projects: Project[]): string {
  if (grant.revokedAt !== null) return "已撤销";
  if (grant.scope === "project" && !projects.some(project => project.id === grant.projectId)) return "项目已封存或不存在，当前不可用";
  return "已授权";
}

/** 每个连接单独授权；令牌仅在创建后显示，离开页面后不能再次读取。 */
export function McpGrantPanel({ dir, enabled }: { dir: string; enabled: boolean }) {
  const [grants, setGrants] = useState<McpGrant[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [paths, setPaths] = useState<{ scriptPath: string; libraryDir: string; scriptExists: boolean } | null>(null);
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"project" | "library">("project");
  const [projectId, setProjectId] = useState("");
  const [read, setRead] = useState(false);
  const [card, setCard] = useState(false);
  const [material, setMaterial] = useState(false);
  const [issued, setIssued] = useState<{ grantId: string; snippet: string } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [nextGrants, nextProjects, nextPaths] = await Promise.all([mcpGrantList(dir), projectList(false, dir), mcpServerPaths(dir)]);
    setGrants(nextGrants); setProjects(nextProjects); setPaths(nextPaths);
  }, [dir]);
  useEffect(() => {
    setIssued(null); setProjectId(""); setError(""); setMessage(""); setLoading(true);
    if (!inShell()) { setLoading(false); return; }
    let active = true;
    void Promise.all([mcpGrantList(dir), projectList(false, dir), mcpServerPaths(dir)])
      .then(([g, p, path]) => { if (active) { setGrants(g); setProjects(p); setPaths(path); } })
      .catch(e => { if (active) setError(userError(e, "读取授权失败")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dir]);

  async function create() {
    if (!paths?.scriptExists || !label.trim() || (scope === "project" ? !projectId : !(read || card || material))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await mcpGrantCreate({ clientLabel: label.trim(), scope, projectId: scope === "project" ? projectId : null,
        libraryRead: scope === "library" && read, cardWrite: scope === "library" && card, materialWrite: scope === "library" && material }, dir);
      setIssued({ grantId: result.grant.id, snippet: generateMcpConfigSnippet(paths.scriptPath, paths.libraryDir, result.token) });
      setLabel("");
      try { await refresh(); } catch (e) { setError(userError(e, "授权已创建，但列表刷新失败")); }
    } catch (e) { setError(userError(e, "创建授权失败")); }
    finally { setBusy(false); }
  }
  async function revoke(grant: McpGrant) {
    if (!window.confirm(`撤销「${grant.clientLabel}」的访问？已复制到外部的内容无法收回。`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const found = await mcpGrantRevoke(grant.id, dir);
      if (!found) throw new Error("授权不存在，请刷新列表。");
      setIssued(current => current?.grantId === grant.id ? null : current);
      setMessage("授权已撤销；该连接的下一次请求会被拒绝。");
      try { await refresh(); } catch { setError("授权已撤销，但列表刷新失败；请重新打开设置查看。"); }
    } catch (e) { setError(userError(e, "撤销授权失败")); }
    finally { setBusy(false); }
  }
  if (!inShell()) return <p className="ws-hint">外部连接授权需要桌面端；浏览器模式无法签发授权。</p>;
  return <div className="ws-mcp-grants">
    <p className="ws-hint">每个客户端单独授权。项目授权只能读取所选项目的笔记；全库权限需逐项选择。旧配置需重新创建授权并替换。首次使用请先保存设置，再启动外部连接。</p>
    {error ? <p role="alert" className="nv-error">{error}</p> : null}
    {message ? <p role="status" className="ws-hint">{message}</p> : null}
    {loading ? <p role="status">正在读取授权…</p> : <>
      {!paths?.scriptExists ? <p className="ws-hint">找不到随应用安装的 MCP 服务脚本，请检查安装包。</p> : null}
      <div className="ws-mcp-fields">
        <label>连接名称<input aria-label="连接名称" value={label} maxLength={100} onChange={e => setLabel(e.target.value)} /></label>
        <label>授权范围<select aria-label="授权范围" value={scope} onChange={e => setScope(e.target.value as "project" | "library")}><option value="project">单个项目（只读）</option><option value="library">全库（逐项授权）</option></select></label>
        {scope === "project" ? <label>项目<select aria-label="授权项目" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">选择项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> :
          <fieldset><legend>全库权限</legend><label><input type="checkbox" checked={read} onChange={e => setRead(e.target.checked)} />读取全库素材与卡片</label><label><input type="checkbox" checked={card} onChange={e => setCard(e.target.checked)} />创建知识卡</label><label><input type="checkbox" checked={material} onChange={e => setMaterial(e.target.checked)} />添加收件箱素材</label></fieldset>}
        <button className="ws-bordered" type="button" onClick={() => void create()} disabled={busy || !enabled || !!issued || !paths?.scriptExists || !label.trim() || (scope === "project" ? !projectId : !(read || card || material))}>创建连接授权</button>
      </div>
      {issued ? <div aria-label="一次性连接配置"><p className="ws-hint">令牌只显示这一次。配置文件与剪贴板可能保存令牌，请妥善保管；已交给客户端的内容无法撤回。</p><pre className="ws-mcp-snippet">{issued.snippet}</pre><button type="button" className="ws-bordered" onClick={() => void navigator.clipboard.writeText(issued.snippet).then(() => setMessage("配置已复制。")).catch(() => setError("复制失败，请手动复制配置。"))}>复制连接配置</button> <button type="button" className="ws-bordered" onClick={() => setIssued(null)}>完成并关闭配置</button></div> : null}
      <h3>连接授权</h3>
      {grants.length === 0 ? <p className="ws-hint">尚无授权。</p> : <ul className="ws-mcp-grant-list">{grants.map(g => <li key={g.id}><span><strong>{g.clientLabel}</strong> · {g.scope === "project" ? `项目：${projects.find(p => p.id === g.projectId)?.name ?? "已封存或不存在"}（只读）` : `全库：${[g.libraryRead && "读取", g.cardWrite && "建卡", g.materialWrite && "添加素材"].filter(Boolean).join("、")}`} · {grantStatus(g, projects)}</span>{g.revokedAt === null ? <button type="button" className="ws-bordered" disabled={busy} onClick={() => void revoke(g)}>撤销</button> : null}</li>)}</ul>}
      <p className="ws-hint">旧卡片 MCP 也需此处的全库授权，可按其说明使用同一令牌配置；命令行直接访问文件及有系统文件权限的程序不受此授权控制。审计不保存正文、查询或令牌，最多保留一万条。</p>
    </>}
  </div>;
}

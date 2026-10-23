import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { dbListArtifacts, inShell, type Artifact } from "../../shell/store";
import { userError } from "./userError";

/**
 * 产物库：认知简报等「生成物」的存放处。
 *
 * 之前简报能「存入产物库」，但产物只在简报页内部读一次就丢掉，
 * 界面上没有入口——存进去的东西只有导出备份才看得见。现在它是应用阶段
 * 的一等页面，能列出、查看、复制、删除。
 */
export function ArtifactsView({ dir, cards, onOpenCard, onBack }: {
  dir: string;
  /** 当前卡片库：用来把 sourceCardIds 解析成可点的标题。 */
  cards: Array<{ id: string; headline: string }>;
  onOpenCard: (cardId: string) => void;
  onBack: () => void;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const list = inShell()
        ? await dbListArtifacts(200, dir)
        : JSON.parse(localStorage.getItem("knowflick.workspace.artifacts") || "[]") as Artifact[];
      setArtifacts(list.filter((item) => !item.isDeleted));
    } catch (err) {
      setError(userError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [dir]);

  const remove = async (artifact: Artifact) => {
    // 产物是可再生的（简报随时能重新分析），但删除不可撤销，所以要确认。
    if (!window.confirm(`删除产物「${artifact.title}」？`)) return;
    try {
      if (inShell()) {
        const { dbDeleteArtifact } = await import("../../shell/store");
        await dbDeleteArtifact(artifact.id, dir);
      } else {
        const raw = JSON.parse(localStorage.getItem("knowflick.workspace.artifacts") || "[]") as Artifact[];
        localStorage.setItem(
          "knowflick.workspace.artifacts",
          JSON.stringify(raw.filter((item) => item.id !== artifact.id))
        );
      }
      setArtifacts((current) => current.filter((item) => item.id !== artifact.id));
      if (openId === artifact.id) setOpenId(null);
    } catch (err) {
      setError(userError(err));
    }
  };

  const copy = async (artifact: Artifact) => {
    try {
      await navigator.clipboard.writeText(artifact.contentMarkdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败：剪贴板不可用");
    }
  };

  return <div className="ws-artifacts" data-page="artifacts">
    <header className="ws-artifacts-head">
      <div>
        <h1>产物库</h1>
        <p className="ws-hint">认知简报等生成物都存放在这里，随时可以回看或复制。</p>
      </div>
      <div className="ws-editor-actions" style={{ flexWrap: "nowrap" }}>
        <button type="button" className="ws-bordered" onClick={() => void load()}>
          <Icon name="brief" size={14} /> 刷新
        </button>
        <button type="button" className="ws-bordered" onClick={onBack}>
          返回简报
        </button>
      </div>
    </header>

    {error ? <div className="ws-feedback" role="alert"><span>{error}</span></div> : null}

    {loading ? (
      <p className="ws-hint" role="status">正在读取产物…</p>
    ) : artifacts.length === 0 ? (
      <div className="ws-empty">
        <Icon name="brief" size={26} />
        <h2>还没有产物</h2>
        <p>在「认知简报」里点「存入产物库」，简报就会留在这里。</p>
        <button type="button" className="ws-bordered" onClick={onBack}>去生成简报</button>
      </div>
    ) : (
      <ul className="ws-artifacts-list">
        {artifacts.map((artifact) => (
          <li key={artifact.id} data-artifact={artifact.id} className="ws-artifact">
            <div className="ws-artifact-head">
              <div>
                <strong>{artifact.title}</strong>
                <span className="ws-hint">
                  {new Date(artifact.createdAt).toLocaleDateString("zh-CN")}
                  {artifact.sourceCardIds.length ? ` · 依据 ${artifact.sourceCardIds.length} 张卡片` : ""}
                </span>
              </div>
              <div className="ws-artifact-actions">
                <button
                  type="button"
                  className="ws-bordered"
                  aria-label={openId === artifact.id ? "收起产物内容" : "展开产物内容"}
                  onClick={() => setOpenId(openId === artifact.id ? null : artifact.id)}
                >
                  {openId === artifact.id ? "收起" : "查看"}
                </button>
                <button
                  type="button"
                  className="ws-bordered"
                  aria-label="复制产物 Markdown"
                  onClick={() => void copy(artifact)}
                >
                  {copied ? "已复制" : "复制 Markdown"}
                </button>
                <button
                  type="button"
                  className="ws-icon-button ws-danger"
                  aria-label="删除产物"
                  title="删除"
                  onClick={() => void remove(artifact)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
            {artifact.sourceCardIds.length ? (
              <div className="ws-artifact-sources">
                <span className="ws-hint">依据卡片：</span>
                {artifact.sourceCardIds.map((id) => {
                  // 卡片可能已被删除：标出来且不可点，避免点进去静默跳到别的卡。
                  const alive = cards.find((card) => card.id === id);
                  if (!alive) {
                    return <span key={id} className="ws-cite-chip ws-cite-gone" aria-disabled="true">（已删除的卡片）</span>;
                  }
                  return (
                    <button
                      key={id}
                      type="button"
                      className="ws-cite-chip"
                      onClick={() => onOpenCard(id)}
                    >
                      {alive.headline}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {openId === artifact.id ? (
              <pre className="ws-artifact-body">{artifact.contentMarkdown}</pre>
            ) : null}
          </li>
        ))}
      </ul>
    )}
  </div>;
}

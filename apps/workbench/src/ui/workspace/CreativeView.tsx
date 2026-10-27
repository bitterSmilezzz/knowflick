import { useCallback, useMemo, useState } from "react";
import { dbSaveArtifact, inShell } from "../../shell/store";
import { Icon } from "./Icon";
import type { KnowledgeCard } from "../../domain/card";
import type { Note } from "../../domain/note";

/**
 * 创作工作台（R4/D07）。
 *
 * 路线图口径：素材检索 → 选取证据 → 大纲/文稿 → 人工修改 → 导出；
 * 「外部发布和代发分别授权实现」——本视图**只到导出**，
 * 不向任何外部平台发送内容。
 *
 * R4 退出门槛是「创作草稿可以检查、修改与导出」——所以初稿生成不依赖模型：
 * 证据本身就能拼出可检查的大纲（每条证据一个小节 + 摘录），
 * 模型只是可选的润色手段，没有模型也能完成整条链路。
 */

interface Props {
  dir: string;
  cards: KnowledgeCard[];
  notes: Note[];
}

interface Evidence {
  kind: "card" | "note";
  id: string;
  title: string;
  excerpt: string;
}

const MAX_EXCERPT = 160;

const CREATIVE_TEMPLATES = {
  outline: { label: "通用大纲", sections: [] },
  development: { label: "开发方案", sections: ["问题与目标", "方案与取舍", "实施与验证"] },
  marketing: { label: "营销素材", sections: ["受众与需求", "价值主张", "素材与行动提示"] },
  social: { label: "自媒体内容", sections: ["主题与读者", "观点与叙事", "结尾与互动"] },
  research: { label: "研究整理", sections: ["研究问题", "证据与分析", "局限与待验证"] },
} as const;
type CreativeTemplate = keyof typeof CREATIVE_TEMPLATES;

function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_EXCERPT ? flat : `${flat.slice(0, MAX_EXCERPT)}…`;
}

/**
 * 按证据拼出大纲草稿（不依赖模型）。
 * 每条证据一个小节，标题 + 摘录——用户在这份草稿上手改，而不是从空白开始。
 */
export function buildOutlineFromEvidence(evidence: Evidence[], template: CreativeTemplate = "outline"): string {
  if (evidence.length === 0) return "";
  const config = CREATIVE_TEMPLATES[template];
  const lines: string[] = ["# 草稿大纲", ""];
  if (config.sections.length > 0) {
    for (const section of config.sections) {
      lines.push(`## ${section}`, "", "（在此填写；请核对相关证据。）", "");
    }
    lines.push("## 选取的证据", "");
  }
  evidence.forEach((e, idx) => {
    const heading = config.sections.length > 0 ? "###" : "##";
    lines.push(`${heading} ${idx + 1}. ${e.title || (e.kind === "note" ? "无标题笔记" : "无标题卡片")}`);
    lines.push("");
    lines.push(e.excerpt || "（这条证据没有正文摘录）");
    lines.push("");
  });
  lines.push("---");
  lines.push("");
  lines.push("（在证据之外补充你的论点：每写一条主张，用「> 引用《标题》：…」标出它来自哪条证据。）");
  return lines.join("\n");
}

/** 导出的文稿：正文 + 证据清单（带可回原件的引用行）。 */
export function buildExportMarkdown(title: string, body: string, evidence: Evidence[]): string {
  const lines: string[] = [`# ${title.trim() || "未命名草稿"}`, "", body.trim(), ""];
  if (evidence.length > 0) {
    lines.push("---", "", "## 证据清单", "");
    for (const e of evidence) {
      const uri = e.kind === "note" ? `knowflick://note/${e.id}` : `knowflick://card/${e.id}`;
      lines.push(`- 《${e.title || "无标题"}》：${e.excerpt || "（无摘录）"} — \`${uri}\``);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function CreativeView({ dir, cards, notes }: Props) {
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [template, setTemplate] = useState<CreativeTemplate>("outline");
  const [savedHint, setSavedHint] = useState("");
  const [error, setError] = useState("");

  // 证据候选：笔记 + 卡片，按查询过滤
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fromNotes: Evidence[] = notes
      .filter((n) => !n.isDeleted)
      .map((n) => ({ kind: "note" as const, id: n.id, title: n.title, excerpt: excerptOf(n.bodyMd) }));
    const fromCards: Evidence[] = cards.map((c) => ({
      kind: "card" as const,
      id: c.id,
      title: c.headline,
      excerpt: excerptOf(`${c.summary}\n${c.details}`),
    }));
    const all = [...fromNotes, ...fromCards];
    if (!q) return all.slice(0, 40);
    return all
      .filter((e) => `${e.title}\n${e.excerpt}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [notes, cards, query]);

  const hasEvidence = evidence.length > 0;

  const addEvidence = useCallback((item: Evidence) => {
    setEvidence((prev) => (prev.some((e) => e.kind === item.kind && e.id === item.id) ? prev : [...prev, item]));
  }, []);

  const removeEvidence = (kind: Evidence["kind"], id: string) => {
    setEvidence((prev) => prev.filter((e) => !(e.kind === kind && e.id === id)));
  };

  const doOutline = () => {
    if (!hasEvidence) {
      setError("先选至少一条证据——大纲是从证据长出来的，不是凭空生成。");
      return;
    }
    if (body.trim() && !window.confirm("生成大纲会替换当前草稿正文。确定替换吗？")) return;
    setError("");
    setBody(buildOutlineFromEvidence(evidence, template));
    setSavedHint("已按证据生成大纲，可以直接改。");
  };

  const doExport = () => {
    const md = buildExportMarkdown(title, body, evidence);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title.trim() || "创作草稿").replace(/[\\/:*?"<>|]/g, "_")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setSavedHint("草稿已导出为 Markdown——本应用不代发到任何平台。");
  };

  const doSaveArtifact = () => {
    if (!inShell()) {
      setError("保存为产物需要桌面客户端（浏览器体验模式没有本机产物库）。");
      return;
    }
    if (!body.trim()) {
      setError("草稿还是空的——先写点东西或按证据生成大纲。");
      return;
    }
    void (async () => {
      try {
        await dbSaveArtifact(
          {
            id: crypto.randomUUID(),
            artifactType: "创作草稿",
            title: title.trim() || "未命名草稿",
            contentMarkdown: body,
            sourceCardIds: evidence.filter((e) => e.kind === "card").map((e) => e.id),
            sourceNoteIds: evidence.filter((e) => e.kind === "note").map((e) => e.id),
            dateScopeStart: null,
            dateScopeEnd: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isDeleted: false,
          },
          dir
        );
        setError("");
        setSavedHint("已保存为产物——在「产物库」里可以随时回看和再编辑。");
      } catch (e) {
        setError(`保存产物失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  return (
    <div className="ws-creative" data-page="creative">
      <header className="ws-creative-head">
        <div>
          <h1>创作台</h1>
          <p className="ws-hint">
            检索 → 选取证据 → 大纲/文稿 → 人工修改 → 导出。
            本应用只帮你把稿子做出来，不代发到任何平台。
          </p>
        </div>
      </header>

      <div className="ws-creative-body">
        <section className="ws-creative-evidence" aria-label="证据">
          <label className="ws-search">
            <Icon name="search" />
            <input
              aria-label="搜索证据"
              placeholder="搜索笔记与卡片…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <div className="ws-creative-picked">
            <h3>已选证据（{evidence.length}）</h3>
            {evidence.length === 0 ? (
              <p className="ws-hint">还没有证据。先从下面挑几条——大纲是证据的骨架。</p>
            ) : (
              evidence.map((e) => (
                <div key={`${e.kind}-${e.id}`} className="ws-creative-picked-item">
                  <span className="ws-hint">{e.kind === "note" ? "笔记" : "卡片"}</span>
                  <strong>{e.title || "无标题"}</strong>
                  <button
                    type="button"
                    className="ws-bordered"
                    onClick={() => removeEvidence(e.kind, e.id)}
                    aria-label={`移除证据 ${e.title}`}
                  >
                    移除
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="ws-creative-candidates">
            <h3>候选</h3>
            {candidates.length === 0 ? (
              <p className="ws-hint">没有匹配的内容。</p>
            ) : (
              candidates.map((c) => (
                <button
                  key={`${c.kind}-${c.id}`}
                  type="button"
                  className="ws-creative-candidate"
                  onClick={() => addEvidence(c)}
                >
                  <span className="ws-hint">{c.kind === "note" ? "笔记" : "卡片"}</span>
                  <strong>{c.title || "无标题"}</strong>
                  <span className="ws-hint">{c.excerpt}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="ws-creative-draft" aria-label="草稿">
          <label className="ws-creative-template">
            写作模板
            <select value={template} onChange={(e) => setTemplate(e.target.value as CreativeTemplate)}>
              {Object.entries(CREATIVE_TEMPLATES).map(([id, option]) => (
                <option key={id} value={id}>{option.label}</option>
              ))}
            </select>
            <span className="ws-hint">选择模板不会改变已有正文；生成大纲时才应用。</span>
          </label>
          <div className="ws-creative-draft-head">
            <input
              className="ws-creative-title"
              aria-label="草稿标题"
              placeholder="草稿标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button type="button" className="ws-bordered" disabled={!hasEvidence} onClick={doOutline}>
              按证据生成大纲
            </button>
            <button type="button" className="ws-bordered" onClick={doExport}>
              导出 Markdown
            </button>
            <button type="button" className="ws-bordered" onClick={doSaveArtifact}>
              保存为产物
            </button>
          </div>
          <textarea
            className="ws-creative-body-editor"
            aria-label="草稿正文"
            placeholder="在这里写你的文稿。也可以先点「按证据生成大纲」拿到骨架再改。"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {savedHint ? <p className="ws-creative-hint" role="status">{savedHint}</p> : null}
          {error ? <p className="ws-error" role="alert">{error}</p> : null}
        </section>
      </div>
    </div>
  );
}

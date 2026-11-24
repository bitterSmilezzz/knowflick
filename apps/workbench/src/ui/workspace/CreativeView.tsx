import { useCallback, useMemo, useState } from "react";
import { inShell } from "../../shell/store";
import type { Artifact, Project } from "../../shell/store";
import { storeArtifact } from "./repository";
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
  projects?: Project[];
  projectsStatus?: "loading" | "ready" | "error" | "unavailable";
  projectKnowledgeScopes?: Record<string, CreativeProjectKnowledgeScope>;
  projectKnowledgeScopesStatus?: "loading" | "ready" | "error" | "unavailable";
  onArtifactSaved?: (artifact: Artifact) => void;
}

export interface CreativeEvidence {
  kind: "card" | "note";
  id: string;
  title: string;
  excerpt: string;
}

export interface CreativeProjectKnowledgeScope {
  cardIds: readonly string[];
  noteIds: readonly string[];
}

type Evidence = CreativeEvidence;

const MAX_EXCERPT = 160;

const CREATIVE_TEMPLATES = {
  outline: { label: "通用大纲", sections: [] },
  development: { label: "开发方案", sections: ["问题与目标", "方案与取舍", "实施与验证"] },
  marketing: { label: "营销素材", sections: ["受众与需求", "价值主张", "素材与行动提示"] },
  social: { label: "自媒体内容", sections: ["主题与读者", "观点与叙事", "结尾与互动"] },
  research: { label: "研究整理", sections: ["研究问题", "证据与分析", "局限与待验证"] },
  meeting: { label: "会议纪要", sections: ["会议背景与参与者", "议题与讨论", "达成的决策", "行动项（负责人与期限）", "待确认问题"] },
  reading: { label: "阅读总结", sections: ["作品与阅读目的", "核心观点", "原文证据", "个人理解与疑问", "可应用结论"] },
  weekly: { label: "周报", sections: ["本周进展", "成果与证据", "阻塞与风险", "下周优先事项", "需要协作"] },
  learning: { label: "学习计划", sections: ["学习目标与验收", "当前基础", "学习材料与路径", "练习与检验", "复盘与调整"] },
  comparison: { label: "方案对比", sections: ["比较对象与范围", "评价标准", "证据对照", "权衡与风险", "结论与条件"] },
  marketingPack: { label: "营销素材包", sections: ["目标受众与场景", "需求与主要阻力", "核心价值主张", "内容方向与证据", "渠道素材清单", "行动提示与合规核对"] },
} as const;
type CreativeTemplate = keyof typeof CREATIVE_TEMPLATES;

const CREATIVE_TEMPLATE_GROUPS = [
  { label: "创作结构", templates: ["outline", "development", "marketing", "social", "research"] },
  { label: "应用模板", templates: ["meeting", "reading", "weekly", "learning", "comparison", "marketingPack"] },
] as const satisfies ReadonlyArray<{ label: string; templates: readonly CreativeTemplate[] }>;

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

/**
 * 创作台候选资料与问答共享项目成员规则。索引尚未就绪或项目失效时，
 * 项目范围返回空集；不会短暂展示全库候选。
 */
export function creativeEvidenceInScope(
  cards: Array<Pick<KnowledgeCard, "id" | "headline" | "summary" | "details">>,
  notes: Array<Pick<Note, "id" | "title" | "bodyMd" | "isDeleted">>,
  projectId: string,
  projectKnowledgeScopes: Record<string, CreativeProjectKnowledgeScope> | undefined,
  projectKnowledgeScopesReady: boolean
): CreativeEvidence[] {
  const scope = projectId
    ? projectKnowledgeScopesReady ? projectKnowledgeScopes?.[projectId] ?? null : null
    : null;
  if (projectId && !scope) return [];

  const allowedCardIds = scope ? new Set(scope.cardIds) : null;
  const allowedNoteIds = scope ? new Set(scope.noteIds) : null;
  const fromNotes: CreativeEvidence[] = notes
    .filter((note) => !note.isDeleted && (!allowedNoteIds || allowedNoteIds.has(note.id)))
    .map((note) => ({ kind: "note", id: note.id, title: note.title, excerpt: excerptOf(note.bodyMd) }));
  const fromCards: CreativeEvidence[] = cards
    .filter((card) => !allowedCardIds || allowedCardIds.has(card.id))
    .map((card) => ({ kind: "card", id: card.id, title: card.headline, excerpt: excerptOf(`${card.summary}\n${card.details}`) }));
  return [...fromNotes, ...fromCards];
}

/** 导出的文稿：正文 + 证据清单（带可回原件的引用行）。 */
export function buildExportMarkdown(title: string, body: string, evidence: Evidence[], scopeLabel?: string): string {
  const lines: string[] = [`# ${title.trim() || "未命名草稿"}`, "", body.trim(), ""];
  if (scopeLabel) {
    const flatScopeLabel = scopeLabel.replace(/\s+/g, " ").trim();
    if (flatScopeLabel) lines.splice(2, 0, `> 知识范围：${flatScopeLabel}`, "");
  }
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

export function CreativeView({
  dir,
  cards,
  notes,
  projects = [],
  projectsStatus = "unavailable",
  projectKnowledgeScopes,
  projectKnowledgeScopesStatus = "unavailable",
  onArtifactSaved,
}: Props) {
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [template, setTemplate] = useState<CreativeTemplate>("outline");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [savedHint, setSavedHint] = useState("");
  const [error, setError] = useState("");

  const selectedProject = projects.find((project) => project.id === selectedProjectId && project.archivedAt === null) ?? null;
  const selectedScopeReady = !selectedProjectId || (
    projectsStatus === "ready" &&
    projectKnowledgeScopesStatus === "ready" &&
    selectedProject !== null &&
    projectKnowledgeScopes?.[selectedProjectId] !== undefined
  );
  // 先套项目成员范围，再做搜索和候选上限；读取失败按空集处理。
  const inScopeEvidence = useMemo(() => creativeEvidenceInScope(
    cards,
    notes,
    selectedProjectId,
    projectKnowledgeScopes,
    projectsStatus === "ready" && projectKnowledgeScopesStatus === "ready" && selectedProject !== null
  ), [cards, notes, selectedProjectId, projectKnowledgeScopes, projectsStatus, projectKnowledgeScopesStatus, selectedProject]);
  const currentSources = useMemo(() => new Map(inScopeEvidence.map((item) => [`${item.kind}:${item.id}`, item])), [inScopeEvidence]);
  const inScopePickedEvidence = useMemo(
    () => evidence.flatMap((item) => {
      const current = currentSources.get(`${item.kind}:${item.id}`);
      return current ? [current] : [];
    }),
    [evidence, currentSources]
  );
  const hasOutOfScopeEvidence = inScopePickedEvidence.length !== evidence.length;

  // 证据候选：笔记 + 卡片，先按当前知识范围过滤，再按查询过滤。
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inScopeEvidence.slice(0, 40);
    return inScopeEvidence
      .filter((e) => `${e.title}\n${e.excerpt}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [inScopeEvidence, query]);

  const hasEvidence = inScopePickedEvidence.length > 0;

  const addEvidence = useCallback((item: Evidence) => {
    setEvidence((prev) => (prev.some((e) => e.kind === item.kind && e.id === item.id) ? prev : [...prev, item]));
  }, []);

  const removeEvidence = (kind: Evidence["kind"], id: string) => {
    setEvidence((prev) => prev.filter((e) => !(e.kind === kind && e.id === id)));
  };

  const doOutline = () => {
    if (!selectedScopeReady) {
      setError("项目范围暂不可用；已停止使用该范围的证据，请等归属读取完成或切换范围。");
      return;
    }
    if (!hasEvidence) {
      setError("先选至少一条证据——大纲是从证据长出来的，不是凭空生成。");
      return;
    }
    if (body.trim() && !window.confirm("生成大纲会替换当前草稿正文。确定替换吗？")) return;
    setError("");
    setBody(buildOutlineFromEvidence(inScopePickedEvidence, template));
    setSavedHint("已按证据生成大纲，可以直接改。");
  };

  const doExport = () => {
    if (!selectedScopeReady) {
      setError("所选项目范围暂不可用，暂时不能导出；请等归属读取完成或切换范围。");
      return;
    }
    if (hasOutOfScopeEvidence) {
      setError("项目成员范围已变化，当前草稿可能包含已移出的证据；请先清理草稿再导出。");
      return;
    }
    const md = buildExportMarkdown(title, body, inScopePickedEvidence, selectedProject ? `项目《${selectedProject.name}》` : "全部知识");
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
    if (!body.trim()) {
      setError("草稿还是空的——先写点东西或按证据生成大纲。");
      return;
    }
    if (!selectedScopeReady) {
      setError("所选项目范围暂不可用，暂时不能保存；请等归属读取完成或切换范围。");
      return;
    }
    if (hasOutOfScopeEvidence) {
      setError("项目成员范围已变化，当前草稿可能包含已移出的证据；请先清理草稿再保存。");
      return;
    }
    void (async () => {
      try {
        const now = Date.now();
        const artifact: Artifact = {
          id: crypto.randomUUID(),
          artifactType: "创作草稿",
          title: title.trim() || "未命名草稿",
          contentMarkdown: body,
          sourceCardIds: inScopePickedEvidence.filter((e) => e.kind === "card").map((e) => e.id),
          sourceNoteIds: inScopePickedEvidence.filter((e) => e.kind === "note").map((e) => e.id),
          dateScopeStart: null,
          dateScopeEnd: null,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
        };
        await storeArtifact(artifact, dir);
        onArtifactSaved?.(artifact);
        setError("");
        setSavedHint("已保存为产物——在「产物库」里可以随时回看和再编辑。");
      } catch (e) {
        setError(`保存产物失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  const switchScope = (nextProjectId: string) => {
    if (nextProjectId === selectedProjectId) return;
    if ((title.trim() || body.trim() || evidence.length > 0) && !window.confirm("切换创作范围会清空当前草稿和已选证据，避免把旧范围内容带入新范围。继续吗？")) return;
    setSelectedProjectId(nextProjectId);
    setEvidence([]);
    setTitle("");
    setBody("");
    setError("");
    setSavedHint(nextProjectId ? "已切换项目范围，候选仅包含该项目的成员笔记与来源卡片。" : "已切换为全部知识范围。");
  };

  const clearDraft = () => {
    if (!window.confirm("清空当前草稿标题、正文和已选证据？")) return;
    setEvidence([]);
    setTitle("");
    setBody("");
    setError("");
    setSavedHint("已清空草稿与已选证据。");
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
          {inShell() ? (
            <label className="ws-creative-scope">
              本次创作范围
              <select
                aria-label="本次创作范围"
                value={selectedProjectId}
                onChange={(event) => switchScope(event.target.value)}
              >
                <option value="">全部知识</option>
                {selectedProjectId && !selectedProject ? <option value={selectedProjectId} disabled>所选项目暂不可用</option> : null}
                {projectsStatus === "ready" ? projects.filter((project) => project.archivedAt === null).map((project) => (
                  <option
                    key={project.id}
                    value={project.id}
                    disabled={projectKnowledgeScopesStatus !== "ready" || !projectKnowledgeScopes?.[project.id]}
                  >
                    项目：{project.name}
                  </option>
                )) : null}
              </select>
              <span className="ws-hint">项目范围只提供成员笔记及其明确来源卡片；切换范围会清空当前草稿。</span>
            </label>
          ) : null}
          {inShell() && !selectedScopeReady ? (
            <p className="ws-hint" role="status">
              {projectsStatus === "loading" || projectKnowledgeScopesStatus === "loading"
                ? "正在读取项目归属；所选项目范围暂不可用。"
                : "项目或成员归属读取失败；所选项目范围已暂停使用。可切换为全部知识。"}
            </p>
          ) : null}
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
            <h3>已选证据（{inScopePickedEvidence.length}）</h3>
            {hasOutOfScopeEvidence ? (
              <p className="ws-hint" role="alert">
                项目成员范围已变化，草稿中有证据已不在当前范围；暂不能导出或保存。
                <button type="button" className="ws-bordered" onClick={clearDraft}>清空草稿与证据</button>
              </p>
            ) : null}
            {inScopePickedEvidence.length === 0 ? (
              <p className="ws-hint">还没有证据。先从下面挑几条——大纲是证据的骨架。</p>
            ) : (
              inScopePickedEvidence.map((e) => (
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
              <p className="ws-hint">{selectedProjectId && !selectedScopeReady ? "项目范围准备好后会显示候选。" : "没有匹配的内容。"}</p>
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
              {CREATIVE_TEMPLATE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.templates.map((id) => (
                    <option key={id} value={id}>{CREATIVE_TEMPLATES[id].label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="ws-hint">应用模板只提供可编辑结构；选择模板不会改变正文，生成时会保留当前范围内的全部证据。</span>
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

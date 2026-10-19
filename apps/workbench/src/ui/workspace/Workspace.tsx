import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeCard } from "../../domain/card";
import { cardFromJson } from "../../domain/card";
import { normalizePaperTheme, parseSettings, type SettingsFile } from "../../domain/settings";
import { askModel } from "../../domain/aiChat";
import { requiresKey } from "../../domain/ingest";
import { digest } from "../../domain/clipEngine";
import { fetchClip, inShell, type RawMaterial } from "../../shell/store";
import {
  entriesFor,
  filterEntries,
  makeMaterial,
  materialToCard,
  collectionNames,
  type Collection,
  type Entry,
} from "./model";
import {
  downloadWorkspace,
  readWorkspace,
  storeCard,
  storeCardList,
  storeMaterial,
  storePreferences,
} from "./repository";
import { Icon, sourceLabel, useSystemAppearance } from "./Icon";
import { EntryInspector } from "./EntryInspector";
import { CaptureDialog } from "./CaptureDialog";
import { WorkspaceSettings } from "./WorkspaceSettings";
import "./workspace.css";

const Briefing = lazy(() => import("../BrainViews").then((m) => ({ default: m.BriefingView })));
const Assistant = lazy(() => import("../BrainViews").then((m) => ({ default: m.BrainAssistantDrawer })));
const Quiz = lazy(() => import("../StudyViews").then((m) => ({ default: m.QuizView })));

type Page = Collection | "settings" | "briefing" | "brain" | "review";

const PAGE_TITLES: Record<string, string> = {
  settings: "设置",
  briefing: "认知简报",
  brain: "知识问答",
  review: "温故复习",
};

const PAGE_HINTS: Record<Collection, string> = {
  inbox: "先收集，再慢慢整理",
  library: "最近更新的内容",
  favorites: "留着的，值得再看",
  archive: "处理过的原始素材",
};

export function Workspace() {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [file, setFile] = useState<SettingsFile>(() => parseSettings(null));
  const [apiKey, setApiKey] = useState("");
  const [dir, setDir] = useState("");
  const [page, setPage] = useState<Page>("inbox");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [source, setSource] = useState("all");
  const [capture, setCapture] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<KnowledgeCard[]>([]);
  const [previewSource, setPreviewSource] = useState<RawMaterial | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);

  const searchRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDialogElement>(null);
  const revision = useRef(0);
  const systemAppearance = useSystemAppearance();

  const load = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true);
    setError("");
    try {
      const data = await readWorkspace();
      if (current !== revision.current) return;
      setMaterials(data.materials);
      setCards(data.cards);
      setFile(data.file);
      setApiKey(data.apiKey);
      setDir(data.dir);
    } catch (e) {
      if (current === revision.current) setError(`读取知识库失败：${String(e)}`);
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [load]);

  useEffect(() => {
    if (preview.length && previewRef.current && !previewRef.current.open) {
      previewRef.current.showModal();
    }
  }, [preview]);

  // Native menu events arrive as DOM CustomEvents (see src-tauri/src/lib.rs).
  useEffect(() => {
    const onMenu = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id === "capture") {
        if (!loading && !busy) setCapture(true);
      } else if (id === "find") {
        if (!["inbox", "library", "favorites", "archive"].includes(page)) setPage("library");
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (id === "toggle-nav") {
        setNavOpen((open) => !open);
      } else if (id === "import") {
        importRef.current?.click();
      } else if (id === "settings") {
        navigate("settings");
      } else if (["inbox", "library", "favorites", "archive"].includes(id)) {
        navigate(id as Page);
      }
    };
    window.addEventListener("knowflick:menu", onMenu);
    return () => window.removeEventListener("knowflick:menu", onMenu);
  }, [page, loading, busy]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!["inbox", "library", "favorites", "archive"].includes(page)) setPage("library");
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (!loading && !busy) setCapture(true);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setNavOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [page, loading, busy]);

  const collection: Collection = ["inbox", "library", "favorites", "archive"].includes(page)
    ? (page as Collection)
    : "library";
  const isCollection = ["inbox", "library", "favorites", "archive"].includes(page);

  const entries = useMemo(() => entriesFor(materials, cards, collection), [materials, cards, collection]);
  const filtered = useMemo(() => filterEntries(entries, query, tag, source), [entries, query, tag, source]);

  useEffect(() => setVisibleCount(60), [page, query, tag, source]);

  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0];
  const tags = [...new Set(cards.flatMap((c) => [c.category, ...(c.tags ?? [])]).filter(Boolean))].sort();
  const reviewEnabled = file.raw.reviewPluginEnabled === true;

  let aiReady = false;
  try {
    aiReady = !requiresKey(file.settings.baseURL) || !!apiKey.trim();
  } catch {
    aiReady = false;
  }

  const counts: Record<Collection, number> = {
    inbox: materials.filter((m) => m.inboxStatus === "inbox").length,
    library: materials.length + cards.length,
    favorites: cards.filter((c) => c.isFavorite).length,
    archive: materials.filter((m) => m.inboxStatus !== "inbox").length,
  };

  const updateMaterial = async (m: RawMaterial) => {
    await storeMaterial(m, dir);
    setMaterials((old) => [m, ...old.filter((x) => x.id !== m.id)]);
  };
  const updateCard = async (c: KnowledgeCard) => {
    await storeCard(c, dir);
    setCards((old) => [c, ...old.filter((x) => x.id !== c.id)]);
  };
  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const navigate = (next: Page) => {
    setPage(next);
    setTag("");
    setQuery("");
    setSelectedId("");
    setSource("all");
    setNavOpen(false);
  };
  const closeCapture = () => {
    setCapture(false);
    addRef.current?.focus();
  };

  const saveEntry = async (entry: Entry, title: string, text: string, category: string, entryTags: string[]) =>
    act(async () => {
      if (!title.trim() || !text.trim()) throw new Error("标题和正文不能为空");
      if (entry.kind === "material") {
        await updateMaterial({
          ...(entry.original as RawMaterial),
          title: title.trim(),
          rawText: text,
          updatedAt: Date.now(),
        });
      } else {
        await updateCard({
          ...(entry.original as KnowledgeCard),
          headline: title.trim(),
          details: text,
          summary: text.slice(0, 160),
          category,
          tags: entryTags,
          editedAt: Date.now(),
        });
      }
      setNotice("修改已保存");
    });

  const convert = async (entry: Entry) =>
    act(async () => {
      const m = entry.original as RawMaterial;
      let card = cards.find((c) => c.materialId === m.id);
      if (!card) {
        card = materialToCard(m);
        await updateCard(card);
      }
      await updateMaterial({ ...m, inboxStatus: "processed", updatedAt: Date.now() });
      navigate("library");
      setSelectedId(card.id);
      setSource("card");
      setNotice("已保存为知识卡，原始素材仍可回溯");
    });

  const aiTransform = async (entry: Entry) =>
    act(async () => {
      if (!inShell()) throw new Error("浏览器体验支持本地整理；AI 提炼请在桌面客户端使用");
      const m = entry.original as RawMaterial;
      const result = await askModel(m.rawText, file.settings, apiKey);
      if (!result.length) throw new Error("没有生成有效卡片，素材未改动，请稍后重试");
      setPreview(
        result.map((c) => ({
          ...c,
          materialId: m.id,
          links: m.sourceUrl
            ? [{ title: "原始素材", url: m.sourceUrl }, ...c.links]
            : c.links,
        }))
      );
      setPreviewSource(m);
    });

  const fetchPage = async (entry: Entry) =>
    act(async () => {
      if (!inShell()) throw new Error("浏览器无法跨站抓取。请在桌面客户端抓取，或将正文粘贴到编辑器保存");
      const response = await fetchClip(entry.url);
      const page = digest(response.text, response.finalUrl);
      if (!page) throw new Error("未抽取到正文，素材已保留。可以点击编辑粘贴正文");
      await updateMaterial({ ...(entry.original as RawMaterial), rawText: page.aiNote, updatedAt: Date.now() });
      setNotice("网页正文已抓取并保存，可编辑后再提炼");
    });

  const importFiles = async (files: FileList | File[]) => {
    try {
      await act(async () => {
        let total = 0;
        for (const f of Array.from(files)) {
          if (f.size > 32 * 1024 * 1024) throw new Error(`${f.name} 超过 32 MB`);
          if (!/\.(md|markdown|txt|json)$/i.test(f.name)) {
            throw new Error(`当前界面支持 Markdown、TXT、JSON；${f.name} 尚不能解析`);
          }
          const text = await f.text();
          if (/\.json$/i.test(f.name)) {
            const data = JSON.parse(text) as unknown;
            const root = data as { format?: string; materials?: RawMaterial[]; cards?: unknown[] };
            if (root.format === "knowflick-workspace" && Array.isArray(root.materials)) {
              for (const m of root.materials) {
                if (!m.id || typeof m.rawText !== "string" || !m.title) {
                  throw new Error("备份素材格式无效");
                }
                await updateMaterial({ ...m, mediaSizeBytes: m.mediaSizeBytes || 0 });
                total++;
              }
            }
            const imported = Array.isArray(data) ? data : root.cards;
            if (!Array.isArray(imported)) throw new Error("JSON 文件须包含卡片数组");
            for (const item of imported) {
              const c = cardFromJson(item);
              if (!c.headline || !c.details) throw new Error("卡片缺少标题或正文");
              await updateCard(c);
              total++;
            }
          } else {
            const m = {
              ...makeMaterial({ title: f.name.replace(/\.(md|markdown|txt)$/i, ""), text, url: "" }),
              sourceType: "document",
            };
            await updateMaterial(m);
            total++;
          }
        }
        navigate("library");
        setNotice(`已导入 ${total} 条内容`);
      });
    } catch (e) {
      setError(`导入未全部完成，已保存内容保留：${String(e)}`);
    }
  };

  const openCard = (id: string) => {
    navigate("library");
    setSelectedId(id);
    setSource("card");
  };

  const theme = normalizePaperTheme(file.settings.paperTheme);
  const appearance = theme === "SYSTEM" ? systemAppearance : theme === "DARK" ? "dark" : "light";
  const navMode = navOpen ? "expanded" : "auto";
  const pageTitle = isCollection ? collectionNames[collection] : PAGE_TITLES[page];

  return (
    <div
      className="ws"
      data-appearance={appearance}
      data-nav={navMode}
      data-view={isCollection ? "collection" : "page"}
      data-workspace-root=""
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length && !busy && !loading) void importFiles(e.dataTransfer.files);
      }}
    >
      <header className="ws-header" data-tauri-drag-region="">
        <div className="ws-header-side">
          {/* The desktop shell draws real macOS traffic lights over the overlay
              title bar; these stand-ins only keep the browser preview honest. */}
          {inShell() ? null : (
            <div className="ws-traffic" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          )}
          <span className="ws-app-name">KnowFlick</span>
        </div>
        <div className="ws-header-list">
          <button
            className="ws-icon-button"
            aria-label={navOpen ? "收起导航栏" : "展开导航栏"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Icon name="panel" />
          </button>
          <strong>我的知识库</strong>
        </div>
        <div className="ws-header-reader">
          <span className="ws-crumb">
            {pageTitle}
            {selected && isCollection ? ` / ${selected.category}` : ""}
          </span>
          <div className="ws-toolbar-actions">
            <button
              className="ws-icon-button"
              aria-label="导入文件"
              title="导入文件"
              disabled={loading || busy}
              onClick={() => importRef.current?.click()}
            >
              <Icon name="upload" />
            </button>
            <button
              className="ws-icon-button"
              aria-label="导出备份"
              title="导出备份"
              disabled={loading || busy}
              onClick={() => {
                downloadWorkspace(materials, cards, file);
                setNotice("已导出 JSON，包含素材、卡片与设置，不含 API 密钥");
              }}
            >
              <Icon name="download" />
            </button>
          </div>
        </div>
      </header>

      <aside className="ws-nav" data-workspace-pane="sidebar" aria-label="知识库导航">
        <button
          ref={addRef}
          className="ws-capture"
          disabled={loading || busy}
          onClick={() => setCapture(true)}
        >
          <Icon name="plus" />
          记录
          <kbd>⌘N</kbd>
        </button>
        <div className="ws-nav-scroll">
          <nav className="ws-nav-group" aria-label="知识库栏目">
            {(["inbox", "library", "favorites", "archive"] as Collection[]).map((id, i) => (
              <button
                key={id}
                className="ws-nav-row"
                aria-current={page === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <Icon name={["inbox", "library", "star", "archive"][i]} />
                <span>{collectionNames[id]}</span>
                <span className="ws-count">{counts[id]}</span>
              </button>
            ))}
          </nav>

          <p className="ws-group-label">分类</p>
          <nav className="ws-nav-group" aria-label="分类">
            {tags.slice(0, 8).map((t) => (
              <button
                key={t}
                className="ws-nav-row"
                aria-current={tag === t ? "page" : undefined}
                onClick={() => {
                  setPage("library");
                  setTag(tag === t ? "" : t);
                  setQuery("");
                  setNavOpen(false);
                }}
              >
                <Icon name="folder" size={14} />
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {t}
                </span>
              </button>
            ))}
            {tags.length === 0 ? (
              <p className="ws-group-label" style={{ margin: "0 9px", lineHeight: 1.8 }}>
                知识卡的分类会出现在这里
              </p>
            ) : null}
          </nav>

          <p className="ws-group-label">回顾</p>
          <nav className="ws-nav-group" aria-label="回顾">
            <button
              className="ws-nav-row"
              aria-current={page === "brain" ? "page" : undefined}
              onClick={() => navigate("brain")}
            >
              <Icon name="ask" />
              <span>知识问答</span>
            </button>
            <button
              className="ws-nav-row"
              aria-current={page === "briefing" ? "page" : undefined}
              onClick={() => navigate("briefing")}
            >
              <Icon name="brief" />
              <span>认知简报</span>
            </button>
            {reviewEnabled ? (
              <button
                className="ws-nav-row"
                aria-current={page === "review" ? "page" : undefined}
                onClick={() => navigate("review")}
              >
                <Icon name="layers" />
                <span>温故复习</span>
              </button>
            ) : null}
          </nav>
        </div>

        <div className="ws-nav-bottom">
          <button
            className="ws-nav-row"
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            <Icon name="settings" />
            <span>设置</span>
          </button>
          <p className="ws-storage">
            <i />
            {inShell() ? "本地知识库" : "浏览器体验"}
          </p>
        </div>
      </aside>

      {navOpen ? (
        <button
          className="ws-nav-backdrop"
          aria-label="关闭导航栏"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <div className="ws-feedback-host">
        {error ? (
          <div className="ws-feedback" role="alert">
            <span>{error}</span>
            <button onClick={() => void load()} disabled={busy}>
              重新读取
            </button>
            <button aria-label="关闭提示" onClick={() => setError("")}>
              <Icon name="close" />
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="ws-feedback" role="status">
            <Icon name="check" />
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              <Icon name="close" />
            </button>
          </div>
        ) : null}
      </div>
      {isCollection ? (
        <>
          <section className="ws-list" data-workspace-pane="stream" aria-label="内容列表">
            <div className="ws-list-head">
              <div className="ws-list-title">
                <h1>{tag || collectionNames[collection]}</h1>
                <span>{filtered.length} 条</span>
              </div>
              <p className="ws-list-sub">{PAGE_HINTS[collection]}</p>
              <label className="ws-search">
                <Icon name="search" />
                <input
                  ref={searchRef}
                  aria-label="搜索知识库"
                  placeholder="搜索标题、正文或标签"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query ? (
                  <button aria-label="清除搜索" onClick={() => setQuery("")}>
                    <Icon name="close" size={14} />
                  </button>
                ) : (
                  <kbd>⌘K</kbd>
                )}
              </label>
            </div>
            <div className="ws-list-controls">
              <div className="ws-filter-tabs">
                {[
                  ["all", "全部"],
                  ["material", "素材"],
                  ["card", "知识卡"],
                ].map(([id, label]) => (
                  <button key={id} aria-pressed={source === id} onClick={() => setSource(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <span>最近更新</span>
            </div>

            <div className="ws-entries" role="listbox" aria-label="内容列表">
              {loading ? (
                <div className="ws-list-empty" role="status">
                  正在读取知识库…
                </div>
              ) : filtered.length === 0 ? (
                <div className="ws-list-empty">
                  <Icon name={query ? "search" : "inbox"} size={26} />
                  <h2>
                    {query || tag || source !== "all"
                      ? "没有找到匹配内容"
                      : collection === "inbox"
                        ? "还没有待整理的内容"
                        : "这里还没有内容"}
                  </h2>
                  <p>{query ? "试试更短的关键词，或清除筛选。" : "记一段想法，或导入一份笔记。"}</p>
                  <button
                    className="ws-primary"
                    onClick={() =>
                      query || tag || source !== "all"
                        ? (setQuery(""), setTag(""), setSource("all"))
                        : setCapture(true)
                    }
                  >
                    {query || tag || source !== "all" ? "清除筛选" : "记录第一条"}
                  </button>
                </div>
              ) : (
                <>
                  {filtered.slice(0, visibleCount).map((e) => {
                    const meta = sourceLabel(
                      e.kind === "card" ? "card" : (e.original as RawMaterial).sourceType,
                      e.url
                    );
                    const isSelected = selected?.id === e.id;
                    return (
                      <button
                        key={e.id}
                        role="option"
                        aria-selected={isSelected}
                        className="ws-entry"
                        onClick={() => setSelectedId(e.id)}
                      >
                        <span className="ws-entry-top">
                          <span className="ws-entry-title">{e.title}</span>
                          <time>
                            {new Date(e.date).toLocaleDateString("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                            })}
                          </time>
                        </span>
                        <span className="ws-entry-bottom">
                          <Icon name={meta.icon} size={12} />
                          <span className="ws-entry-source">{meta.label}</span>
                          <span className="ws-entry-summary">
                            {e.text.replace(/\s+/g, " ").trim()}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {visibleCount < filtered.length ? (
                    <button
                      className="ws-nav-row"
                      onClick={() => setVisibleCount((n) => n + 60)}
                    >
                      加载更多（还有 {filtered.length - visibleCount} 条）
                    </button>
                  ) : null}
                </>
              )}
            </div>

            <footer className="ws-list-foot">
              <span>
                {cards.length} 张知识卡 · {materials.length} 份素材
              </span>
            </footer>
          </section>

          {selected && !loading ? (
            <EntryInspector
              key={`${selected.kind}:${selected.id}`}
              entry={selected}
              busy={busy}
              aiReady={aiReady}
              onSettings={() => navigate("settings")}
              onSave={(title, text, category, entryTags) =>
                saveEntry(selected, title, text, category, entryTags)
              }
              onConvert={() => convert(selected)}
              onAi={() => aiTransform(selected)}
              onFetch={() => fetchPage(selected)}
              onArchive={() =>
                act(async () => {
                  const m = selected.original as RawMaterial;
                  await updateMaterial({
                    ...m,
                    inboxStatus: m.inboxStatus === "inbox" ? "dismissed" : "inbox",
                    updatedAt: Date.now(),
                  });
                  setNotice(
                    m.inboxStatus === "inbox" ? "素材已归档，可在已归档中找回" : "已移回收件箱"
                  );
                })
              }
              onFavorite={() =>
                act(async () => {
                  const c = selected.original as KnowledgeCard;
                  await updateCard({
                    ...c,
                    isFavorite: !c.isFavorite,
                    favoritedAt: c.isFavorite ? null : Date.now(),
                  });
                })
              }
            />
          ) : (
            <article className="ws-reader" data-workspace-pane="inspector" aria-label="阅读区">
              <div className="ws-empty">
                <div>
                  <p>选择一条内容，开始阅读</p>
                  <div className="ws-empty-actions">
                    <button
                      className="ws-primary"
                      disabled={loading || busy}
                      onClick={() => setCapture(true)}
                    >
                      <Icon name="plus" />记录
                    </button>
                    <button className="ws-bordered" onClick={() => importRef.current?.click()}>
                      <Icon name="upload" />导入
                    </button>
                  </div>
                </div>
              </div>
            </article>
          )}
        </>
      ) : (
        <>
          <main className="ws-reader ws-page" aria-label={pageTitle}>
            <Suspense fallback={<p className="ws-reader-scroll">正在加载…</p>}>
              {page === "settings" ? (
                <WorkspaceSettings
                  file={file}
                  apiKey={apiKey}
                  reviewEnabled={reviewEnabled}
                  onBack={() => navigate("inbox")}
                  onSave={async (next, key, enabled) => {
                    const updated = {
                      ...next,
                      raw: { ...next.raw, reviewPluginEnabled: enabled },
                    };
                    await storePreferences(updated, key, dir);
                    setFile(updated);
                    setApiKey(key);
                  }}
                />
              ) : null}
              {page === "briefing" ? <Briefing cards={cards} onOpenCard={openCard} /> : null}
              {page === "brain" ? (
                inShell() ? (
                  <Assistant
                    cards={cards}
                    settings={file.settings}
                    apiKey={apiKey}
                    onOpenCard={openCard}
                  />
                ) : (
                  <div className="ws-empty">
                    <div>
                      <p>请在桌面客户端配置模型连接后使用知识问答</p>
                      <button className="ws-bordered" onClick={() => navigate("library")}>
                        去搜索知识库
                      </button>
                    </div>
                  </div>
                )
              ) : null}
              {page === "review" && reviewEnabled ? (
                <Quiz
                  cards={cards}
                  algorithm="fsrs"
                  onChange={async (next) => {
                    await storeCardList(next, dir);
                    setCards(next);
                  }}
                />
              ) : null}
            </Suspense>
          </main>
        </>
      )}

      <footer className="ws-status">
        <span>
          <Icon name="check" size={13} />
          {loading ? "正在读取…" : inShell() ? "已保存到本机" : "浏览器体验 · 内容存在本机"}
        </span>
        <span>
          {selected && isCollection ? "已选中 1 条" : "未选中内容"}　{cards.length + materials.length} 条
        </span>
      </footer>

      <input
        hidden
        ref={importRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,.json"
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {capture ? (
        <CaptureDialog
          onClose={closeCapture}
          onSave={async (input) => {
            const m = makeMaterial(input);
            await updateMaterial(m);
            navigate("inbox");
            setSelectedId(m.id);
            setNotice("已存入收件箱");
          }}
        />
      ) : null}

      {preview.length > 0 ? (
        <dialog
          ref={previewRef}
          className="ws-dialog"
          aria-label="检查 AI 提炼结果"
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setPreview([]);
          }}
        >
          <h2>检查 AI 提炼结果</h2>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>确认后写入知识卡；原始素材会保留。</p>
          <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
            {preview.map((c) => (
              <article key={c.id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 0" }}>
                <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>{c.headline}</h3>
                <p style={{ fontSize: 13, margin: 0 }}>{c.details}</p>
              </article>
            ))}
          </div>
          <div className="ws-actions" style={{ marginTop: 12 }}>
            <button disabled={busy} onClick={() => setPreview([])}>
              取消
            </button>
            <button
              className="ws-primary"
              disabled={busy}
              onClick={() => {
                void act(async () => {
                  for (const c of preview) await updateCard(c);
                  if (previewSource) {
                    await updateMaterial({
                      ...previewSource,
                      inboxStatus: "processed",
                      updatedAt: Date.now(),
                    });
                  }
                  setPreview([]);
                  navigate("library");
                  setSource("card");
                  setNotice("提炼结果已保存");
                }).catch((e) => setError(String(e)));
              }}
            >
              确认保存 {preview.length} 张
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeCard } from "../../domain/card";
import { cardFromJson } from "../../domain/card";
import { normalizePaperTheme, parseSettings, type SettingsFile } from "../../domain/settings";
import { askModel } from "../../domain/aiChat";
import { requiresKey } from "../../domain/ingest";
import { digest } from "../../domain/clipEngine";
import {
  dbBackfillMaterialFts,
  dbListArtifacts,
  dbListSubscriptions,
  dbDeleteSubscription,
  dbMarkSubscriptionPolled,
  dbSaveArtifact,
  dbSaveSubscription,
  dbSearchMaterialsFts,
  fetchClip,
  inShell,
  type RawMaterial,
  type SubscriptionRow,
} from "../../shell/store";
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
  readWorkspace,
  storeCard,
  storeCardList,
  storeMaterial,
  storePreferences,
} from "./repository";
import { downloadMarkdownVault } from "../../domain/markdownExport";
import { downloadKfBackup, restoreKfBackup } from "../../domain/systemBackup";
import { highlightText, extractSnippet } from "./HighlightText";
import { Icon, sourceLabel, useSystemAppearance } from "./Icon";
import { EntryInspector } from "./EntryInspector";
import { CaptureDialog } from "./CaptureDialog";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { usePaneLayout } from "./usePaneLayout";
import { SubscriptionsView } from "./SubscriptionsView";
import {
  itemsToMaterials,
  parseSubscriptionPayload,
  requestUrlFor,
  type Subscription,
} from "../../domain/subscription";
import {
  identifyPlatform,
  parseGitHubRepo,
  parseBilibiliBvid,
  formatGitHubPayload,
  formatBilibiliPayload,
} from "../../domain/sniffer";
import { parseDocumentFile } from "../../domain/documentParser";
import { EmbeddingEngine, syncCardEmbeddings } from "../../domain/embeddingEngine";
import "./workspace.css";

const Briefing = lazy(() => import("../BrainViews").then((m) => ({ default: m.BriefingView })));
const Assistant = lazy(() => import("../BrainViews").then((m) => ({ default: m.BrainAssistantDrawer })));
const Quiz = lazy(() => import("../StudyViews").then((m) => ({ default: m.QuizView })));
const ReviewOverviewPanel = lazy(() => import("../StudyViews").then((m) => ({ default: m.ReviewOverviewPanel })));

type Page = Collection | "settings" | "briefing" | "brain" | "review" | "subscriptions";

const PAGE_TITLES: Record<string, string> = {
  settings: "设置",
  briefing: "认知简报",
  brain: "知识问答",
  review: "温故复习",
  subscriptions: "订阅源",
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
  const [previewSelectedIds, setPreviewSelectedIds] = useState<Set<string>>(new Set());
  const [previewSource, setPreviewSource] = useState<RawMaterial | null>(null);
  const [visibleCount, setVisibleCount] = useState(60);
  const [indexedMaterialIds, setIndexedMaterialIds] = useState<ReadonlySet<string>>(new Set());
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const layout = usePaneLayout();
  const readerRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDialogElement>(null);
  const revision = useRef(0);
  const systemAppearance = useSystemAppearance();

  const load = useCallback(async (quiet = false) => {
    const current = ++revision.current;
    if (!quiet) { setLoading(true); setError(""); }
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
    const changed = () => { void load(true); };
    const storageChanged = (e: StorageEvent) => { if (e.key === "knowflick.workspace.v1") changed(); };
    window.addEventListener("knowflick:library-changed", changed);
    window.addEventListener("storage", storageChanged);
    return () => {
      window.removeEventListener("knowflick:library-changed", changed);
      window.removeEventListener("storage", storageChanged);
    };
  }, [load]);

  useEffect(() => {
    if (preview.length && previewRef.current && !previewRef.current.open) {
      previewRef.current.showModal();
    }
  }, [preview]);

  // 后台静默同步未生成向量的卡片至 SQLite 向量表 (不阻塞界面)
  useEffect(() => {
    if (!cards.length) return;
    const engine = new EmbeddingEngine({
      providerId: file.settings.providerId,
      baseURL: file.settings.baseURL,
      apiKey,
    });
    void syncCardEmbeddings(cards, engine, { dir }).catch((err) => {
      console.warn("卡片向量同步非阻塞跳过:", err);
    });
  }, [cards, file.settings.providerId, file.settings.baseURL, apiKey, dir]);

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
        layout.toggleNav();
      } else if (id === "import") {
        importRef.current?.click();
      } else if (id === "export") {
        downloadMarkdownVault(materials, cards);
      } else if (id === "settings") {
        navigate("settings");
      } else if (["inbox", "library", "favorites", "archive"].includes(id)) {
        navigate(id as Page);
      }
    };
    window.addEventListener("knowflick:menu", onMenu);
    return () => window.removeEventListener("knowflick:menu", onMenu);
  }, [page, loading, busy]);

  const collection: Collection = ["inbox", "library", "favorites", "archive"].includes(page)
    ? (page as Collection)
    : "library";
  const isCollection = ["inbox", "library", "favorites", "archive"].includes(page);

  // 老库升级后 fts_materials 可能是空的：启动时补一次索引（幂等，已同步过的不会再插）。
  // 放在这里而不是每次检索里，避免输入延迟随库规模变化。
  useEffect(() => {
    if (!inShell()) return;
    void dbBackfillMaterialFts(dir).catch((err) => {
      console.warn("素材全文索引补齐跳过:", err);
    });
  }, [dir]);

  // 桌面端：查询非空时去 SQLite 的 fts_materials 拿一次命中集合（持久化跨素材全文索引）。
  // 浏览器体验模式没有这层索引，效果退化为内存子串匹配。
  useEffect(() => {
    const trimmed = query.trim();
    if (!inShell() || !trimmed) {
      setIndexedMaterialIds(new Set());
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void dbSearchMaterialsFts(trimmed, 500, dir)
        .then((hits) => {
          if (!cancelled) setIndexedMaterialIds(new Set(hits.map((m) => m.id)));
        })
        .catch(() => {
          if (!cancelled) setIndexedMaterialIds(new Set());
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, dir]);

  const entries = useMemo(() => entriesFor(materials, cards, collection), [materials, cards, collection]);
  const filtered = useMemo(
    () => filterEntries(entries, query, tag, source, indexedMaterialIds),
    [entries, query, tag, source, indexedMaterialIds]
  );

  useEffect(() => setVisibleCount(60), [page, query, tag, source]);

  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0];

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!target?.closest("input, textarea, select, [contenteditable=true]");
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape" && layout.navMode === "overlay") {
        e.preventDefault(); layout.closeNavOverlay(); return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!isCollection) setPage("library");
        requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (!loading && !busy) setCapture(true);
        return;
      }
      if ((e.metaKey && e.ctrlKey && e.key.toLowerCase() === "s") ||
          (mod && e.shiftKey && e.key.toLowerCase() === "s")) {
        e.preventDefault(); layout.toggleNav(); return;
      }
      if (mod && e.key.toLowerCase() === "e" && selected && isCollection && !typing && !busy) {
        e.preventDefault(); window.dispatchEvent(new CustomEvent("knowflick:edit-entry")); return;
      }
      if (typing || mod || e.altKey || !isCollection) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      const inReader = !!target?.closest('[data-workspace-pane="inspector"]');
      if (e.key === "Enter" && selected && !inReader &&
          (!target?.closest("button, a, [role=separator]") || target.closest(".ws-entry"))) {
        e.preventDefault(); readerRef.current?.focus(); return;
      }
      if (inReader || target?.closest("[role=separator]")) return;
      if (["ArrowDown", "ArrowUp", "j", "k"].includes(e.key) && filtered.length) {
        e.preventDefault();
        const current = filtered.findIndex(it => it.id === selected?.id);
        const down = e.key === "ArrowDown" || e.key === "j";
        const index = Math.max(0, Math.min(filtered.length - 1, (current < 0 ? 0 : current) + (down ? 1 : -1)));
        setVisibleCount(n => Math.max(n, index + 1));
        setSelectedId(filtered[index].id);
        requestAnimationFrame(() => {
          const row = workspaceRef.current?.querySelector<HTMLElement>(`.ws-entry[data-entry-id="${CSS.escape(filtered[index].id)}"]`);
          row?.focus({ preventScroll: true });
          row?.scrollIntoView({ block: "nearest" });
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [page, loading, busy, isCollection, filtered, selected, layout]);
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
    setNotice("");
    setPage(next);
    setTag("");
    setQuery("");
    setSelectedId("");
    setSource("all");
    layout.closeNavOverlay();
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
      const mapped = result.map((c) => ({
        ...c,
        materialId: m.id,
        links: m.sourceUrl
          ? [{ title: "原始素材", url: m.sourceUrl }, ...c.links]
          : c.links,
      }));
      setPreview(mapped);
      setPreviewSelectedIds(new Set(mapped.map((c) => c.id)));
      setPreviewSource(m);
    });

  const fetchPage = async (entry: Entry) =>
    act(async () => {
      if (!inShell()) throw new Error("浏览器无法跨站抓取。请在桌面客户端抓取，或将正文粘贴到编辑器保存");
      const platform = identifyPlatform(entry.url);
      if (platform === "github") {
        const repo = parseGitHubRepo(entry.url);
        if (repo) {
          try {
            const apiRes = await fetchClip(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
            const apiJson = JSON.parse(apiRes.text);
            let readme = "";
            try {
              const readmeRes = await fetchClip(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/README.md`);
              readme = readmeRes.text;
            } catch {
              // try master
              try {
                const readmeRes = await fetchClip(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/master/README.md`);
                readme = readmeRes.text;
              } catch { /* empty */ }
            }
            const sniffed = formatGitHubPayload(entry.url, apiJson, readme);
            await updateMaterial({
              ...(entry.original as RawMaterial),
              title: sniffed.title,
              rawText: sniffed.content,
              updatedAt: Date.now(),
            });
            setNotice("GitHub 仓库信息与 README 已嗅探解析，可转化为知识卡");
            return;
          } catch {
            // fallback to general html clip below
          }
        }
      } else if (platform === "bilibili") {
        const bvid = parseBilibiliBvid(entry.url);
        if (bvid) {
          try {
            const apiRes = await fetchClip(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
            const apiJson = JSON.parse(apiRes.text);
            if (apiJson.data) {
              const sniffed = formatBilibiliPayload(entry.url, apiJson.data);
              await updateMaterial({
                ...(entry.original as RawMaterial),
                title: sniffed.title,
                rawText: sniffed.content,
                updatedAt: Date.now(),
              });
              setNotice("B站视频信息已成功解析并提取简介，可转化为知识卡");
              return;
            }
          } catch {
            // fallback
          }
        }
      }

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
          if (!/\.(md|markdown|txt|json|docx|pdf)$/i.test(f.name)) {
            throw new Error(`当前支持 Markdown、TXT、JSON、Word (.docx)、PDF；${f.name} 尚不能解析`);
          }
          if (/\.json$/i.test(f.name)) {
            const text = await f.text();
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
            const buffer = await f.arrayBuffer();
            const doc = await parseDocumentFile(f.name, buffer);
            const m = {
              ...makeMaterial({ title: doc.title, text: doc.markdown, url: "" }),
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

  // 订阅源只在桌面端的 SQLite 里有；浏览器体验模式没有这层表，页面显示空列表。
  useEffect(() => {
    if (!inShell()) return;
    void dbListSubscriptions(dir)
      .then((rows: SubscriptionRow[]) => {
        setSubscriptions(
          rows.map((r) => ({
            id: r.id,
            type: r.type as Subscription["type"],
            title: r.title,
            targetUrl: r.targetUrl,
            intervalMinutes: r.intervalMinutes,
            lastPolledAt: r.lastPolledAt,
            isActive: r.isActive,
            createdAt: r.createdAt,
          }))
        );
      })
      .catch((err) => console.warn("读取订阅源失败:", err));
  }, [dir]);

  const addSubscription = async (sub: Subscription) => {
    if (!inShell()) throw new Error("订阅源保存在桌面端的 SQLite 里，请在桌面客户端添加");
    await dbSaveSubscription(sub, dir);
    setSubscriptions((prev) => [sub, ...prev]);
    setNotice(`已添加订阅：${sub.title}`);
  };

  const toggleSubscription = async (sub: Subscription, active: boolean) => {
    const next = { ...sub, isActive: active };
    if (inShell()) await dbSaveSubscription(next, dir);
    setSubscriptions((prev) => prev.map((s) => (s.id === sub.id ? next : s)));
  };

  const removeSubscription = async (sub: Subscription) => {
    if (inShell()) await dbDeleteSubscription(sub.id, dir);
    setSubscriptions((prev) => prev.filter((s) => s.id !== sub.id));
    setNotice(`已删除订阅：${sub.title}`);
  };

  /**
   * 抓一次订阅。新条目按 sourceUrl 去重后进收件箱素材层（Layer 1），
   * 不直接生成卡片——提炼仍然由用户/模型决定。
   */
  const pollSubscription = async (sub: Subscription) => {
    await act(async () => {
      if (!inShell()) throw new Error("浏览器无法跨站抓取，订阅抓取请在桌面客户端进行");
      const url = requestUrlFor(sub);
      const response = await fetchClip(url);
      const items = parseSubscriptionPayload(sub, response.text);
      if (items.length === 0) throw new Error("这次没有解析出条目，检查订阅地址是否为有效的 feed / GitHub 仓库");

      const { materials: incoming, skipped } = itemsToMaterials(
        items,
        materials.map((m) => m.sourceUrl || ""),
        sub
      );
      for (const entry of incoming) {
        await updateMaterial({
          ...makeMaterial({ title: entry.title, text: entry.text, url: entry.url }),
          metadataJson: entry.metadataJson,
        });
      }
      const added = incoming.length;

      const polledAt = Date.now();
      await dbMarkSubscriptionPolled(sub.id, polledAt, dir);
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, lastPolledAt: polledAt } : s))
      );
      setNotice(
        `「${sub.title}」抓取完成：新增 ${added} 条素材` +
          (skipped > 0 ? `，${skipped} 条已存在或无链接` : "")
      );
    });
  };

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /**
   * 从 `.kfbackup` 完整备份包恢复。走的是「合并还原」而不是覆盖：
   * 备份里的条目按 id 写入，本机已有同 id 的会被覆盖，其余保持不动；
   * 设置只在备份里带了 settings.json 时替换。这样误点恢复不会清空本地库。
   */
  const restoreFromBackup = async (picked: FileList | null) => {
    const chosen = picked?.[0];
    if (!chosen) return;
    try {
      await act(async () => {
        const buffer = new Uint8Array(await chosen.arrayBuffer());
        const isZip = /\.kfbackup$/i.test(chosen.name) || (buffer[0] === 0x50 && buffer[1] === 0x4b);
        const restored = restoreKfBackup(isZip ? buffer : new TextDecoder().decode(buffer));
        let total = 0;
        for (const m of restored.materials) {
          if (!m.id || typeof m.rawText !== "string" || !m.title) continue;
          await updateMaterial({ ...m, mediaSizeBytes: m.mediaSizeBytes || 0 });
          total++;
        }
        for (const c of restored.cards) {
          if (!c.headline || !c.details) continue;
          await updateCard(c);
          total++;
        }
        // 认知产物是 Layer 3，只在桌面端有 SQLite 表；浏览器体验模式没有这层，跳过。
        for (const art of restored.artifacts) {
          if (!art.id || !art.title) continue;
          if (inShell()) await dbSaveArtifact(art, dir);
          total++;
        }
        if (restored.settings) {
          await storePreferences(restored.settings, apiKey, dir);
          setFile(restored.settings);
        }
        setNotice(
          `备份恢复完成：${restored.cards.length} 张卡片、${restored.materials.length} 份素材` +
            `、${restored.artifacts.length} 条认知产物` +
            (restored.settings ? "、设置已还原" : "") +
            `（共 ${total} 条）`
        );
      });
    } catch (e) {
      setError(`备份恢复失败，本地内容未受影响：${String(e)}`);
    }
  };

  const openCard = (id: string) => {
    navigate("library");
    setSelectedId(id);
    setSource("card");
  };

  const theme = normalizePaperTheme(file.settings.paperTheme);
  const appearance = theme === "SYSTEM" ? systemAppearance : theme === "DARK" ? "dark" : "light";
  const navMode = layout.navMode;
  const pageTitle = isCollection ? collectionNames[collection] : PAGE_TITLES[page];

  return (
    <div
      className="ws"
      ref={workspaceRef}
      data-appearance={appearance}
      data-nav={navMode}
      data-view={isCollection ? "collection" : "page"}
      data-workspace-root=""
      style={{
        ["--nav-w" as string]: `${layout.widths.nav}px`,
        ["--list-w" as string]: `${layout.widths.list}px`,
      }}
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
            aria-label={layout.navShown ? "收起导航栏" : "展开导航栏"}
            aria-expanded={layout.navShown}
            onClick={layout.toggleNav}
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
              title="导出完整备份包 (.kfbackup)"
              disabled={loading || busy}
              onClick={() => {
                if (!inShell()) {
                  downloadKfBackup(materials, cards, file);
                  setNotice("已导出完整备份包 (.kfbackup)，包含素材、卡片与设置，不含 API 密钥");
                  return;
                }
                void dbListArtifacts(1000, dir)
                  .then((arts) => {
                    downloadKfBackup(materials, cards, file, arts);
                    setNotice(
                      `已导出完整备份包 (.kfbackup)：${cards.length} 张卡片、${materials.length} 份素材、${arts.length} 条认知产物，不含 API 密钥`
                    );
                  })
                  .catch(() => {
                    downloadKfBackup(materials, cards, file);
                    setNotice("已导出完整备份包 (.kfbackup)，包含素材、卡片与设置，不含 API 密钥");
                  });
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
                  layout.closeNavOverlay();
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
              aria-current={page === "subscriptions" ? "page" : undefined}
              onClick={() => navigate("subscriptions")}
            >
              <Icon name="inbox" />
              <span>订阅源</span>
              <span className="ws-count">{subscriptions.length}</span>
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
        <div
          className="ws-resizer ws-resizer-nav"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuemin={160}
          aria-valuemax={360}
          aria-valuenow={layout.widths.nav}
          onPointerDown={e => layout.startResize("nav", e)}
          onDoubleClick={() => layout.resetWidth("nav")}
          onKeyDown={e => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault(); e.stopPropagation();
              layout.nudgeWidth("nav", e.key === "ArrowRight" ? 10 : -10);
            }
          }}
          title="双击恢复默认宽度"
          aria-label="拖拽调整侧栏宽度"
        />
      </aside>

      {layout.navMode === "overlay" ? (
        <button
          className="ws-nav-backdrop"
          aria-label="关闭导航栏"
          onClick={layout.closeNavOverlay}
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
                        data-entry-id={e.id}
                        tabIndex={isSelected ? 0 : -1}
                        role="option"
                        aria-selected={isSelected}
                        className="ws-entry"
                        onClick={() => setSelectedId(e.id)}
                      >
                        <span className="ws-entry-top">
                          <span className="ws-entry-title">
                            {highlightText(e.title, query)}
                          </span>
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
                            {highlightText(extractSnippet(e.text, query, 80), query)}
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
            <div
              className="ws-resizer ws-resizer-list"
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-valuemin={240}
              aria-valuemax={480}
              aria-valuenow={layout.widths.list}
              onPointerDown={e => layout.startResize("list", e)}
              onDoubleClick={() => layout.resetWidth("list")}
              onKeyDown={e => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault(); e.stopPropagation();
                  layout.nudgeWidth("list", e.key === "ArrowRight" ? 10 : -10);
                }
              }}
              title="双击恢复默认宽度"
              aria-label="拖拽调整列表宽度"
            />
          </section>

          {selected && !loading ? (
            <EntryInspector
              key={`${selected.kind}:${selected.id}`}
              entry={selected}
              readerRef={readerRef}
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
                {filtered.length === 0 ? (
                  <div className="ws-empty-calm" aria-hidden="true" />
                ) : (
                  <div className="ws-empty-guide">
                    <Icon name="library" size={28} style={{ opacity: 0.35, marginBottom: 8 }} />
                    <p style={{ fontWeight: 500, color: "var(--ink)" }}>选择一条内容，开始阅读</p>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>点击左侧条目查看正文，或使用快捷键浏览</span>
                  </div>
                )}
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
                  onExportMarkdown={() => downloadMarkdownVault(materials, cards)}
                  onExportKfBackup={() => {
                    // 认知产物（Layer 3）只在桌面端的 SQLite 里有；浏览器体验模式跳过。
                    if (!inShell()) {
                      downloadKfBackup(materials, cards, file);
                      return;
                    }
                    void dbListArtifacts(1000, dir)
                      .then((arts) => downloadKfBackup(materials, cards, file, arts))
                      .catch(() => downloadKfBackup(materials, cards, file));
                  }}
                  onRestoreKfBackup={() => restoreRef.current?.click()}
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
              {page === "subscriptions" ? (
                <SubscriptionsView
                  subscriptions={subscriptions}
                  busy={busy}
                  available={inShell()}
                  onAdd={addSubscription}
                  onToggle={toggleSubscription}
                  onDelete={removeSubscription}
                  onPoll={pollSubscription}
                />
              ) : null}
              {page === "briefing" ? <Briefing cards={cards} onOpenCard={openCard} /> : null}
              {page === "brain" ? (
                <Assistant
                  cards={cards}
                  settings={file.settings}
                  apiKey={apiKey}
                  onOpenCard={openCard}
                  onNavigateSettings={() => navigate("settings")}
                />
              ) : null}
              {page === "review" && reviewEnabled ? (
                <>
                  <ReviewOverviewPanel cards={cards} />
                  <Quiz
                    cards={cards}
                    algorithm="fsrs"
                    onChange={async (next) => {
                      await storeCardList(next, dir);
                      setCards(next);
                    }}
                  />
                </>
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
        accept=".md,.markdown,.txt,.json,.docx,.pdf"
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <input
        hidden
        ref={restoreRef}
        type="file"
        accept=".kfbackup,.zip,.json"
        aria-label="选择完整备份包"
        onChange={(e) => {
          if (e.target.files) void restoreFromBackup(e.target.files);
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
          style={{ maxWidth: 640 }}
          aria-label="检查 AI 提炼结果"
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setPreview([]);
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>检查 AI 提炼卡片</h2>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              已勾选 {previewSelectedIds.size} / {preview.length} 张
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 12px" }}>
            勾选需要保留的原子知识卡，确认后写入知识库；原始素材会完整保留。
          </p>
          <div style={{ maxHeight: "55vh", overflowY: "auto", display: "grid", gap: 10 }}>
            {preview.map((c) => {
              const isChecked = previewSelectedIds.has(c.id);
              return (
                <label
                  key={c.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    padding: 12,
                    border: `1px solid ${isChecked ? "var(--accent)" : "var(--line)"}`,
                    borderRadius: 6,
                    background: isChecked ? "var(--sunken)" : "var(--surface)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      setPreviewSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      });
                    }}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span className="ws-tag-chip" style={{ fontSize: "var(--text-meta)", padding: "1px 6px" }}>
                        {c.category}
                      </span>
                      <strong style={{ fontSize: 14 }}>{c.headline}</strong>
                    </div>
                    <p style={{ fontSize: "var(--text-meta)", color: "var(--muted)", margin: "0 0 4px" }}>
                      {c.summary}
                    </p>
                    <p style={{ fontSize: "var(--text-meta)", margin: 0, opacity: 0.85, whiteSpace: "pre-wrap" }}>
                      {c.details}
                    </p>
                    {c.tags && c.tags.length > 0 ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        {c.tags.map((t) => (
                          <span key={t} style={{ fontSize: "var(--text-meta)", color: "var(--muted)" }}>
                            #{t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
          <div className="ws-actions" style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
            <button
              type="button"
              className="ws-bordered"
              onClick={() => {
                if (previewSelectedIds.size === preview.length) setPreviewSelectedIds(new Set());
                else setPreviewSelectedIds(new Set(preview.map((c) => c.id)));
              }}
            >
              {previewSelectedIds.size === preview.length ? "取消全选" : "全选"}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={busy} onClick={() => setPreview([])}>
                取消
              </button>
              <button
                className="ws-primary"
                disabled={busy || previewSelectedIds.size === 0}
                onClick={() => {
                  void act(async () => {
                    const toSave = preview.filter((c) => previewSelectedIds.has(c.id));
                    for (const c of toSave) await updateCard(c);
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
                    setNotice(`已存入 ${toSave.length} 张原子知识卡`);
                  }).catch((e) => setError(String(e)));
                }}
              >
                确认保存 ({previewSelectedIds.size} 张)
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}

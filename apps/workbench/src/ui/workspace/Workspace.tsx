import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeCard } from "../../domain/card";
import { cardFromJson } from "../../domain/card";
import { normalizePaperTheme, parseSettings, personalizationEnabled, type SettingsFile } from "../../domain/settings";
import { askModel } from "../../domain/aiChat";
import { requiresKey } from "../../domain/ingest";
import { digest } from "../../domain/clipEngine";
import {
  dbBackfillMaterialFts,
  dbGetStats,
  dbListArtifacts,
  exportCardsJson,
  dbListSubscriptions,
  dbDeleteSubscription,
  dbMarkSubscriptionPolled,
  dbSaveArtifact,
  dbSaveSubscription,
  dbSearchMaterialsFts,
  fetchClip,
  asrModelStatus,
  asrTranscribe,
  inShell,
  readMedia,
  saveMedia,
  pickAudioFile,
  pickExportPath,
  type Artifact,
  type DbStats,
  type RawMaterial,
  type SubscriptionRow,
} from "../../shell/store";
import {
  entriesFor,
  filterEntries,
  makeMaterial,
  materialToCard,
  collectionNames,
  subscriptionIdOf,
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
import { downloadAnkiTsv, downloadMarkdownVault } from "../../domain/markdownExport";
import { downloadKfBackup, restoreKfBackup } from "../../domain/systemBackup";
import { highlightText, extractSnippet } from "./HighlightText";
import { Icon, sourceLabel, useSystemAppearance } from "./Icon";
import { EntryInspector } from "./EntryInspector";
import { CaptureDialog } from "./CaptureDialog";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { usePaneLayout } from "./usePaneLayout";
import { SubscriptionsView } from "./SubscriptionsView";
import { NotesView } from "./NotesView";
import type { NotesState } from "../../domain/note";
import { restoreNotesBundle } from "./notesRestore";
import { MailboxView } from "./MailboxView";
import { ArtifactsView } from "./ArtifactsView";
import { StatsView } from "./StatsView";
import { setSoundEffectsEnabled } from "../../shell/sounds";
import { parseNotesFile } from "../../domain/notes";
import { restorableArtifacts, restorableCards, restorableMaterials } from "../../domain/restoreRules";
import { parseEml } from "./emlParser";
import { imageMimeOf, mediaMimeOfExtension } from "../../domain/mediaMime";
import { InkPad, VoiceRecorder } from "./NotePads";
import { formatDuration, inkTitle, type InkDocument } from "../../domain/ink";
import { existingKeys } from "../../domain/contentHash";
import { emailBodyForAi, makeMailDigestMetadata, type MailDigestSource } from "../../domain/mail";
import { sourceInsights } from "../../domain/insights";
import { mailSyncDueAccounts } from "../../shell/mail";
import { DEFAULT_ASR_MODEL, realtimeFactor, titleFromTranscript } from "../../domain/asr";
import { pluginEnabledIn } from "../../domain/pluginSettings";
import {
  isDue,
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
import { useModalFocus } from "./useModalFocus";
import { dbLibrarySignature } from "../../shell/store";
import { EXTERNAL_REFRESH_INTERVAL_MS, externalChangeDetected } from "./externalRefresh";
import { DisabledEntry } from "./DisabledEntry";
import "./workspace.css";
import { userError } from "./userError";

const Briefing = lazy(() => import("../BrainViews").then((m) => ({ default: m.BriefingView })));
const Assistant = lazy(() => import("../BrainViews").then((m) => ({ default: m.BrainAssistantDrawer })));
const Quiz = lazy(() => import("../StudyViews").then((m) => ({ default: m.QuizView })));
const ReviewOverviewPanel = lazy(() => import("../StudyViews").then((m) => ({ default: m.ReviewOverviewPanel })));

type Page = Collection | "settings" | "notes" | "briefing" | "brain" | "review" | "quiz" | "subscriptions" | "mail" | "artifacts" | "stats";

const PAGE_TITLES: Record<string, string> = {
  settings: "设置",
  notes: "笔记",
  briefing: "认知简报",
  brain: "知识问答",
  review: "温故复习",
  subscriptions: "订阅源",
  mail: "邮箱",
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
  const [notePad, setNotePad] = useState<"ink" | "voice" | null>(null);
  const [notesState, setNotesState] = useState<NotesState>({ notes: [], knowledgeBases: [], membership: {} });
  // 手写/语音面板是手写的 div（不是原生 <dialog>），没有浏览器自带的焦点陷阱
  // 与 Escape 处理——实测 Tab 进不去、Escape 无效。用这个钩子补上。
  const notePadRef = useRef<HTMLDivElement | null>(null);
  const closeNotePad = useCallback(() => setNotePad(null), []);
  useModalFocus(notePad !== null, closeNotePad, notePadRef);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 长操作（AI 归纳、转写、导入）要让用户看见「在做什么」，而不只是按钮变灰。
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setErrorText] = useState("");
  // 错误提示条上的「重新读取」只对**读取失败**有意义。导入/转换/导出/恢复失败时
  // 挂那个按钮会误导：用户点了只会重载库，与他的问题无关，还打断当前操作。
  const [errorIsReloadable, setErrorIsReloadable] = useState(false);
  // 报错统一走这里：默认**不提供**「重新读取」——那个按钮只对读取失败有意义。
  const setError = useCallback((message: string) => {
    setErrorText(message);
    setErrorIsReloadable(false);
  }, []);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<KnowledgeCard[]>([]);
  const [previewSelectedIds, setPreviewSelectedIds] = useState<Set<string>>(new Set());
  const [previewSource, setPreviewSource] = useState<RawMaterial | null>(null);
  const [visibleCount, setVisibleCount] = useState(60);
  const [indexedMaterialIds, setIndexedMaterialIds] = useState<ReadonlySet<string>>(new Set());
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  // The mail summary lives here so jumping to an original mail (which leaves the
  // mailbox page) does not throw away an unsaved result.
  const [mailDigest, setMailDigest] = useState<{ text: string; sources: MailDigestSource[]; saved: boolean } | null>(null);
  const [mailDigestTitle, setMailDigestTitle] = useState("邮件整理摘要");
  const [personalizationOn, setPersonalizationOn] = useState(() => personalizationEnabled(file.raw));
  // 批量选择：⌘/Ctrl 点击追加或取消，普通点击仍是单选。
  // 用 Set 而不是数组，是为了让「是否已选」判断不随选中项数量变慢。
  const [batchIds, setBatchIds] = useState<ReadonlySet<string>>(() => new Set());
  // 产物在多个页面都要用（产物库、问答作为回答依据），状态提到这里统一加载。
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  // 统计：桌面端走 SQLite 的 db_get_stats；浏览器体验没有这层表，用内存数据算同样的指标。
  const [stats, setStats] = useState<DbStats | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (inShell()) {
          const result = await dbGetStats(dir);
          if (active) setStats(result);
        } else {
          const now = Date.now();
          const cardList = cards;
          const materialList = materials;
          const due = cardList.filter((card) => {
            if (card.lastReviewedAt === null) return card.seenAt !== null;
            const days = card.intervalDays > 1 ? card.intervalDays : card.masteryLevel >= 2 ? 7 : card.masteryLevel === 1 ? 3 : 1;
            return now - card.lastReviewedAt >= days * 86400000;
          }).length;
          if (active) {
            setStats({
              totalCards: cardList.length,
              totalMaterials: materialList.length,
              inboxMaterials: materialList.filter((m) => m.inboxStatus === "inbox").length,
              favoriteCards: cardList.filter((c) => c.isFavorite).length,
              seenCards: cardList.filter((c) => c.seenAt !== null).length,
              dueCards: due,
            });
          }
        }
      } catch {
        if (active) setStats(null);
      }
    })();
    return () => { active = false; };
  }, [dir, cards, materials]);
  // 音效开关是跨端共享设置；工作台此前只解析不使用，等于开关失效。
  useEffect(() => {
    setSoundEffectsEnabled(file.settings.soundEffectsEnabled !== false);
  }, [file.settings.soundEffectsEnabled]);
  // 设分类用界面内输入，不用 window.prompt：原生弹窗样式与整套界面割裂，
  // 还会挡住下面的列表。
  const [batchCategory, setBatchCategory] = useState<string | null>(null);
  const layout = usePaneLayout();
  const readerRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  // 「笔记转知识卡」与「导入文件」是两种意图：前者把攒下的笔记变成可复习的卡，
  // 后者把文件收进收件箱。分开入口，用户不必猜。
  const notesRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDialogElement>(null);
  const revision = useRef(0);
  const systemAppearance = useSystemAppearance();

  /**
   * 导出与安卓端同格式的 cards.json。
   *
   * ADR-0002 §3 承诺「两套共享同一份 cards.json，拷过去就能打开」。
   * 命令与导出逻辑都早就有了，但界面上没有入口——用户根本拿不到这份文件。
   */
  const exportCardsJsonForAndroid = async (libraryDir: string) => {
    try {
      const dest = await pickExportPath("cards.json");
      if (!dest) return;
      await exportCardsJson(libraryDir, dest);
      setNotice(`已导出 cards.json：${dest}。把它放到安卓端的数据目录即可打开。`);
    } catch (err) {
      setError(`导出 cards.json 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** 产物供产物库与问答共用；读取失败不阻塞主界面。 */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = inShell()
          ? await dbListArtifacts(200, dir)
          : JSON.parse(localStorage.getItem("knowflick.workspace.artifacts") || "[]") as Artifact[];
        if (active) setArtifacts(list.filter((item) => !item.isDeleted));
      } catch {
        if (active) setArtifacts([]);
      }
    })();
    return () => { active = false; };
  }, [dir]);

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
      if (current === revision.current) {
        setErrorText(`读取知识库失败：${String(e)}`);
        setErrorIsReloadable(true);
      }
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

  // 页面切换时把当前导航行滚进可视区。「应用」段在滚动区里，小窗口下会被
  // 藏住——此前靠「点击的按钮获焦点后浏览器自动滚动」兜着，程序化导航
  // （快捷键、深链接）兜不住；CI 的 Linux 字体行高更大时点击路径也红过
  // （workspace_ui_smoke「小窗口下知识测验仍可见」）。这里把保证做实。
  useEffect(() => {
    const row = workspaceRef.current?.querySelector<HTMLElement>('.ws-nav-row[aria-current="page"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [page]);

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

  // 发现**外部进程**写进来的改动。
  //
  // 上面那两个信号都只覆盖「本应用自己写的」：DOM 事件由 Tauri 命令派发，
  // storage 事件来自浏览器 localStorage。而 MCP server 是独立进程、直接写
  // SQLite——它两个信号都发不出去，界面就停在旧状态（外部 Agent 写完卡，
  // 用户这边什么也看不到，得重启或切页）。
  //
  // 这里轮询库文件的修改签名；一变就派发**已有的** knowflick:library-changed，
  // 复用现成的刷新路径，不另开一套。
  useEffect(() => {
    if (!inShell() || !dir) return;
    let cancelled = false;
    let last = "";
    const check = async () => {
      // **不要因为窗口失焦就跳过。**
      // `document.hidden` 在窗口**失焦**时就是 true（不只是最小化时）——
      // 于是「用户切到别的窗口看看别的东西」期间，界面就一直停在旧状态，
      // 切回来也不刷新（除非正好赶上一次轮询）。这跟「外部改了库要看得见」矛盾。
      // 这里的检查只是一次 stat，很便宜；刷新本身由 load() 去合并。
      if (cancelled) return;
      try {
        const signature = await dbLibrarySignature(dir);
        if (cancelled) return;
        if (externalChangeDetected(last, signature)) {
          last = signature;
          window.dispatchEvent(new CustomEvent("knowflick:library-changed"));
        } else {
          last = signature;
        }
      } catch {
        // 库还没建出来（首次启动）——下次再试，不打扰用户。
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), EXTERNAL_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [dir]);

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

  // Background mail polling while the app runs. The interval is decided in Rust
  // (persisted last attempt + backoff), so this only wakes up occasionally and
  // never performs network work for accounts that opted out.
  useEffect(() => {
    if (!inShell() || !dir) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        const outcomes = await mailSyncDueAccounts(dir);
        if (!cancelled && outcomes.length) {
          window.dispatchEvent(new CustomEvent("knowflick:library-changed"));
        }
      } catch (err) {
        console.warn("邮件定时同步跳过:", err);
      }
    };
    const timer = window.setInterval(() => void tick(), 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [dir]);

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

  const insights = useMemo(
    () => (personalizationOn ? sourceInsights({ materials, cards }).ranked : []),
    [materials, cards, personalizationOn]
  );

  const entries = useMemo(() => entriesFor(materials, cards, collection), [materials, cards, collection]);
  const filtered = useMemo(
    () => filterEntries(entries, query, tag, source, indexedMaterialIds),
    [entries, query, tag, source, indexedMaterialIds]
  );

  useEffect(() => setVisibleCount(60), [page, query, tag, source]);
  // 换筛选后旧选择多半已经不可见，直接清掉，避免误操作看不见的条目。
  useEffect(() => { setBatchIds(new Set()); }, [page, query, tag, source]);

  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0];
  /** 批量栏只对知识卡开放：素材归到收件箱的归档语义里，不在这里批量处理。 */
  const batchCards = cards.filter((card) => batchIds.has(card.id));
  const batchMaterials = materials.filter((material) => batchIds.has(material.id));

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
        // Shift+方向键 = 范围多选。没有这条，键盘用户完全无法进入批量模式
        // ——多选只能靠 ⌘/Ctrl 鼠标点击。
        if (e.shiftKey) {
          setBatchIds(previous => {
            const anchorId = [...(previous.size ? previous : [])][0] ?? selected?.id;
            const anchor = Math.max(0, filtered.findIndex(it => it.id === anchorId));
            const from = Math.min(anchor, index);
            const to = Math.max(anchor, index);
            return new Set(filtered.slice(from, to + 1).map(it => it.id));
          });
        } else {
          setBatchIds(new Set());
        }
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
  // 分类按「用得多的在前」排，同量再按名称；纯字母序对使用频率没有信息量。
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) {
      for (const tag of [card.category, ...(card.tags ?? [])]) {
        if (!tag) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return counts;
  }, [cards]);
  const tags = useMemo(
    () =>
      [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
        .map(([tag]) => tag),
    [tagCounts]
  );
  const reviewEnabled = file.raw.reviewPluginEnabled === true;
  const asrEnabled = pluginEnabledIn(file.raw, "official-speech-asr");

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
  const act = async (action: () => Promise<void>, label = "正在处理…") => {
    if (busy) return;
    setBusy(true);
    setBusyLabel(label);
    setError("");
    setNotice("");
    try {
      await action();
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };
  /**
   * 对多选的知识卡执行一次操作。
   *
   * 只作用于卡片：素材是原始记录，归档走收件箱语义，不能在这里批量抹掉。
   * 素材被选中时批量栏不出现，避免给一个「删素材」的假入口。
   */
  const runOnSelectedCards = async (label: string, apply: (card: KnowledgeCard) => KnowledgeCard) => {
    const ids = new Set(batchIds);
    if (ids.size === 0) return;
    await act(async () => {
      const next = cards.map((card) => (ids.has(card.id) ? apply(card) : card));
      await storeCardList(next, dir);
      setCards(next);
      setBatchIds(new Set());
      setBatchCategory(null);
      setNotice(`${label}：已处理 ${ids.size} 张卡片`);
    });
  };

  /**
   * 对多选的素材批量归档。
   *
   * 素材是原始记录，不提供硬删除——归档（processed）已经是"处理过了"的语义，
   * 删掉原始记录等于把知识卡的回溯链断掉。
   */
  const archiveSelectedMaterials = async () => {
    const ids = new Set(batchIds);
    if (ids.size === 0) return;
    await act(async () => {
      const now = Date.now();
      for (const material of materials) {
        if (!ids.has(material.id)) continue;
        if (material.inboxStatus !== "inbox") continue;
        await updateMaterial({ ...material, inboxStatus: "processed", updatedAt: now });
      }
      setBatchIds(new Set());
      setNotice(`已归档 ${ids.size} 条素材`);
    });
  };

  const navigate = (next: Page) => {
    setNotice("");
    setBatchIds(new Set());
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
      const m = entry.original as RawMaterial;
      const result = await askModel(m.sourceType === "email" ? emailBodyForAi(m) : m.rawText, file.settings, apiKey);
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
      if (!inShell()) throw new Error("浏览器无法跨站抓取。请在桌面客户端抓取，或将正文粘贴到编辑器保存（桌面客户端下载见设置页）");
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

  /**
   * 批量导入：逐个文件处理，一个失败不影响其余。
   *
   * 之前任何一处 `throw` 都会中止整批——选十个文件、其中一个是 .png，
   * 前面已经导入的留下、后面的全不处理，用户只看到一句错误。现在改成
   * 收集每个文件的结果，最后给一条「成功 / 跳过 / 失败」的汇总，
   * 失败项逐条说明原因。
   */
  /**
   * 把笔记文件（Markdown / JSON）转成知识卡。
   *
   * 与「导入文件」的区别：导入文件把内容收进收件箱当素材；这里直接把
   * 攒下的笔记拆成可复习的原子卡——笔记软件最该有的能力。
   */
  const importNotesToCards = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const ok: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];
    try {
      await act(async () => {
        for (const [index, f] of list.entries()) {
          setNotice(`正在转换 ${index + 1}/${list.length}：${f.name}`);
          try {
            const text = await f.text();
            const cards = parseNotesFile(text, f.name);
            if (cards.length === 0) throw new Error("这个文件里没有能转成知识卡的内容");
            for (const card of cards) await updateCard(card);
            ok.push(`${f.name}（${cards.length} 张）`);
          } catch (err) {
            failed.push({ name: f.name, reason: err instanceof Error ? err.message : String(err) });
          }
        }
        if (ok.length) {
          navigate("library");
          setSource("card");
        }
        if (!ok.length && failed.length) {
          setError(`没有转成知识卡：${failed.map(f => `${f.name}（${f.reason}）`).join("；")}`);
        } else if (failed.length) {
          setNotice(`已转换 ${ok.length} 个文件；${failed.length} 个失败：${failed.map(f => f.name).join("、")}`);
          setError(`以下文件没有转换：${failed.map(f => `${f.name}（${f.reason}）`).join("；")}`);
        } else {
          setNotice(`已转换 ${ok.length} 个文件：${ok.join("、")}`);
        }
      });
    } catch (e) {
      setError(`转换中断，已完成的保留：${String(e)}`);
    }
  };

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const ok: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];
    // 库里已有的指纹：同一个文件导入两次不该变成两份。
    // 图片按「文件名 + 字节数」判重（见 existingKeys），否则第二次拖同一个
    // 文件会因为库里只留了 contentHash 而再进来一份。
    const seen = existingKeys(materials);
    try {
      await act(async () => {
        for (const [index, f] of list.entries()) {
          setNotice(`正在导入 ${index + 1}/${list.length}：${f.name}`);
          try {
            await importOneFile(f, ok, skipped, seen);
          } catch (err) {
            failed.push({ name: f.name, reason: err instanceof Error ? err.message : String(err) });
          }
        }
        if (ok.length) navigate("library");
        const parts: string[] = [];
        if (ok.length) parts.push(`已导入 ${ok.length} 条`);
        if (skipped.length) parts.push(`${skipped.length} 个与库里内容相同已跳过`);
        if (failed.length) parts.push(`${failed.length} 个失败`);
        if (!ok.length && !skipped.length && failed.length) {
          setError(`没有文件导入成功：${failed.map(f => `${f.name}（${f.reason}）`).join("；")}`);
        } else {
          setNotice(parts.join("；") || "没有需要导入的文件");
          if (failed.length) {
            setError(`以下文件没有导入：${failed.map(f => `${f.name}（${f.reason}）`).join("；")}`);
          }
        }
      });
    } catch (e) {
      setError(`导入中断，已保存内容保留：${String(e)}`);
    }
  };

  /** 处理单个文件；成功时往 `ok` 里追加标题。失败由调用方收集。 */
  const importOneFile = async (f: File, ok: string[], skipped: string[], seen: Set<string>) => {
    const IMAGE = /\.(png|jpe?g|webp|gif|heic)$/i;
    if (f.size > 32 * 1024 * 1024) throw new Error("超过 32 MB");
    if (IMAGE.test(f.name)) {
      // 后端 media 的图片上限是 16 MB，先在这里用中文说清楚，
      // 免得用户等到写入阶段才收到一句英文报错。
      if (f.size > 16 * 1024 * 1024) throw new Error("图片超过 16 MB 上限");
      // 浏览器体验把图片内嵌成 data URL，而整库只有一个 localStorage key（约 6 MB）。
      // 一张大图会把配额吃满，之后连编辑都存不进去；这里按预算先拦，
      // 与其写坏整个库，不如说明原因。
      if (!inShell() && f.size > 1024 * 1024) {
        throw new Error("浏览器体验只存得住 1 MB 以内的图片；请改用桌面客户端，那边存原图");
      }
      // f.type 不是总有的：浏览器对某些扩展名给不出 MIME（HEIC 尤其常见），
      // 给空时一律当成 PNG 会把 JPEG / HEIC 存成 .png 文件——内容与扩展名不符，
      // 有些查看器直接打不开。所以先按扩展名推断，再退回 f.type。
      const mime = imageMimeOf(f.name, f.type);
      const bytes = new Uint8Array(await f.arrayBuffer());
      // 浏览器没有可写的库目录，但图片不大：用 data URL 内嵌，随素材一起进
      // localStorage，重开还能看。桌面端才落到 media/ 文件，避免把大文件塞进库行。
      let mediaPath: string | null = null;
      let dataUrl: string | null = null;
      if (inShell()) {
        mediaPath = await saveMedia("image", mime, bytes, dir);
      } else {
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        dataUrl = `data:${mime};base64,${btoa(binary)}`;
      }
      const m = {
        ...makeMaterial({ title: f.name.replace(/\.[^/.]+$/, ""), text: `（图片素材：${f.name}）`, url: "" }),
        sourceType: "image",
        mediaPath,
        mediaSizeBytes: bytes.byteLength,
        metadataJson: JSON.stringify({ mime, fileName: f.name, ...(dataUrl ? { dataUrl } : {}) }),
      };
      // 图片按「同名 + 同大小」判重：只比文本指纹会把不同的截图当成同一张。
      const imageKey = `image:${f.name}:${bytes.byteLength}`;
      if (seen.has(imageKey)) { skipped.push(f.name); return; }
      seen.add(imageKey);
      await updateMaterial(m);
      ok.push(f.name);
      return;
    }
    if (/\.eml$/i.test(f.name)) {
      // 邮件文件：导回知识库是「数据完全归你所有」的自然一环。
      // 产出 sourceType="email" 的素材，才能进邮箱视图、参与来源洞察。
      const raw = new TextDecoder("utf-8").decode(new Uint8Array(await f.arrayBuffer()));
      const mail = parseEml(raw);
      if (!mail.text.trim()) throw new Error("这封邮件里没有可读正文");
      const metadata = {
        accountId: "eml-import",
        from: mail.from,
        to: mail.to,
        date: mail.date,
        messageId: mail.messageId,
        attachments: mail.attachments,
        fileName: f.name,
      };
      const m = {
        ...makeMaterial({ title: mail.subject, text: mail.text, url: "" }),
        sourceType: "email" as const,
        metadataJson: JSON.stringify(metadata),
      };
      const key = `eml:${mail.messageId || f.name}:${mail.text.length}`;
      if (seen.has(key)) { skipped.push(f.name); return; }
      seen.add(key);
      await updateMaterial(m);
      ok.push(f.name);
      return;
    }
    if (!/\.(md|markdown|txt|json|docx|pptx|pdf|eml)$/i.test(f.name)) {
      throw new Error("暂不支持这种格式（支持 Markdown、TXT、JSON、Word、PPT、PDF、EML、图片）");
    }
    if (/\.json$/i.test(f.name)) {
      const text = await f.text();
      const data = JSON.parse(text) as unknown;
      const root = data as { format?: string; materials?: RawMaterial[]; cards?: unknown[] };
      // 走一遍窄化判断，否则下面 for 里的 root.materials TS 视为可能 undefined。
      const workspaceMaterials = root.format === "knowflick-workspace" && Array.isArray(root.materials)
        ? root.materials
        : null;
      if (workspaceMaterials) {
        for (const m of workspaceMaterials) {
          if (!m.id || typeof m.rawText !== "string" || !m.title) throw new Error("备份素材格式无效");
          await updateMaterial({ ...m, mediaSizeBytes: m.mediaSizeBytes || 0 });
          ok.push(m.title);
        }
      }
      const imported = Array.isArray(data) ? data : root.cards;
      // 已经把素材落库的备份可以只有素材没有卡片；此时再抛「须包含卡片数组」，
      // 会让同一份文件既报成功又报失败，而素材其实已经进去了。
      if (!Array.isArray(imported)) {
        if (workspaceMaterials) return;
        throw new Error("JSON 文件须包含卡片数组");
      }
      for (const item of imported) {
        const c = cardFromJson(item);
        if (!c.headline || !c.details) throw new Error("卡片缺少标题或正文");
        await updateCard(c);
        ok.push(c.headline);
      }
      return;
    }
    const buffer = await f.arrayBuffer();
    const doc = await parseDocumentFile(f.name, buffer);
    const m = {
      ...makeMaterial({ title: doc.title, text: doc.markdown, url: "" }),
      sourceType: "document",
    };
    if (m.contentHash && seen.has(m.contentHash)) { skipped.push(f.name); return; }
    if (m.contentHash) seen.add(m.contentHash);
    await updateMaterial(m);
    ok.push(doc.title);
  };

  /**
   * 订阅源自动轮询。
   *
   * 只在桌面端、且没有其它批量操作在跑时触发；一次只抓一个到期的订阅，
   * 抓完再排下一个——并发抓取会把 ext 的请求与 SQLite 写放大到没必要。
   * 失败只记一条提示，不打断用户正在做的事。
   */
  const autoPollLock = useRef(false);
  useEffect(() => {
    if (!inShell()) return;
    let disposed = false;

    const tick = async () => {
      if (disposed || autoPollLock.current || busy) return;
      const due = subscriptions.filter((s) => isDue(s));
      if (due.length === 0) return;

      autoPollLock.current = true;
      const sub = due[0];
      try {
        await pollSubscription(sub);
      } catch (err) {
        setNotice(`「${sub.title}」自动抓取失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        autoPollLock.current = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [subscriptions, busy, dir]);

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
    // 删除订阅是不可撤销的（`db_delete_subscription` 是硬删除，没有回收站）。
    // 二次确认由订阅页的删除按钮负责（`requestDelete` → `confirm.request`），
    // 这里是被确认之后才走到的一步。
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
      setBusyLabel(`正在抓取「${sub.title}」…`);
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

  /**
   * 语音导入：选一个音频文件 → 本地 Whisper 转写 → 落成收件箱素材。
   *
   * 转写文本同时作为正文与标题来源；不在这里顺手调用大模型出卡——
   * 转写只是入口，要不要提炼由用户在素材页决定。
   */
  /**
   * 读出本机附件字节，供打包带走。
   *
   * 只在桌面端有读取能力；单条失败（文件被移动、权限）只跳过那一条，
   * 不能让整份备份导不出来。
   */
  const collectBackupMedia = async (items: RawMaterial[]): Promise<Map<string, Uint8Array>> => {
    const media = new Map<string, Uint8Array>();
    if (!inShell()) return media;
    for (const m of items) {
      if (!m.mediaPath) continue;
      if (media.has(m.mediaPath)) continue;
      try { media.set(m.mediaPath, await readMedia(m.mediaPath, dir)); } catch { /* 跳过缺失附件 */ }
    }
    return media;
  };

  /** 手写笔记：笔迹存成素材附件（JSON），标题自动生成，进收件箱等整理。 */
  const saveInkNote = async (doc: InkDocument) => {
    const json = JSON.stringify(doc);
    const bytes = new TextEncoder().encode(json);
    let mediaPath: string | null = null;
    if (inShell()) {
      try { mediaPath = await saveMedia("ink", "application/json", bytes, dir); }
      catch (err) { throw new Error(`笔迹没能存到本机：${err instanceof Error ? err.message : String(err)}`); }
    }
    const title = inkTitle(doc);
    const material = {
      ...makeMaterial({ title, text: `${title}\n\n（手写笔记，${doc.strokes.length} 笔；笔迹以附件保存，可在阅读区重看。）`, url: "" }),
      sourceType: "ink",
      mediaPath,
      mediaSizeBytes: bytes.byteLength,
      metadataJson: JSON.stringify({ ink: doc, savedInline: !inShell() }),
    };
    await updateMaterial(material);
    setNotePad(null);
    navigate("inbox");
    setNotice(`手写笔记已存入收件箱：${doc.strokes.length} 笔${inShell() ? "，笔迹保存在本机" : "（浏览器体验仅保存在本页存储）"}`);
  };

  /** 语音笔记：先存音频，再尝试本地转写；转写失败不影响笔记本身。 */
  const saveVoiceNote = async (blob: Blob, durationMs: number) => {
    if (!inShell()) {
      // 浏览器体验没有可写库目录：音频字节只在内存里，落不了盘。
      // 这里直接失败，不产出一条「已保存」的空壳笔记。
      throw new Error("浏览器体验不保存录音，请在桌面客户端使用语音笔记");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let mediaPath: string | null = null;
    try { mediaPath = await saveMedia("audio", blob.type || "audio/webm", bytes, dir); }
    catch (err) { throw new Error(`录音没能存到本机：${err instanceof Error ? err.message : String(err)}`); }
    let transcript = "";
    let transcriptNote = "";
    if (inShell() && asrEnabled && mediaPath) {
      try {
        const model = (file.raw.plugins as Record<string, { preferences?: Record<string, unknown> }> | undefined)?.[
          "official-speech-asr"
        ]?.preferences?.model as string | undefined ?? DEFAULT_ASR_MODEL;
        const status = await asrModelStatus(model);
        if (!status.installed) {
          transcriptNote = "语音模型尚未下载，录音已保存；到设置里下载模型后可再转写。";
        } else {
          const absolute = mediaPath.startsWith("/") ? mediaPath : `${dir}/${mediaPath}`;
          const result = await asrTranscribe(absolute, model);
          transcript = result.text.trim();
          transcriptNote = transcript ? "已用本地 Whisper 转写，音频没有上传。" : "没有识别出文字，录音已保留。";
        }
      } catch (err) {
        transcriptNote = `录音已保存，但转写失败：${err instanceof Error ? err.message : String(err)}`;
      }
    } else if (!asrEnabled) {
      transcriptNote = "语音转写插件未启用，录音已保存。";
    }
    const stamp = new Date();
    const title = transcript ? titleFromTranscript(transcript) : `语音笔记 · ${stamp.getMonth() + 1}月${stamp.getDate()}日`;
    const body = transcript || `（语音笔记，${formatDuration(durationMs)}；音频以附件保存。）`;
    const material = {
      ...makeMaterial({ title, text: body, url: "" }),
      sourceType: "audio",
      mediaPath,
      mediaSizeBytes: bytes.byteLength,
      metadataJson: JSON.stringify({
        durationMs,
        mime: blob.type || "audio/webm",
        transcript,
        transcribed: !!transcript,
      }),
    };
    await updateMaterial(material);
    setNotePad(null);
    navigate("inbox");
    setNotice(`语音笔记已存入收件箱：${formatDuration(durationMs)}。${transcriptNote}`);
  };

  const transcribeAudio = async () => {
    await act(async () => {
      if (!inShell()) throw new Error("语音转写只在桌面客户端可用");
      setBusyLabel("正在转写语音…");
      if (!asrEnabled) throw new Error("语音转写插件未启用：在设置 →「功能模块与官方插件」里开启");
      const path = await pickAudioFile();
      if (!path) return;

      const model =
        (file.raw.plugins as Record<string, { preferences?: Record<string, unknown> }> | undefined)?.[
          "official-speech-asr"
        ]?.preferences?.model as string | undefined ?? DEFAULT_ASR_MODEL;

      const status = await asrModelStatus(model);
      if (!status.installed) {
        throw new Error(`语音模型 ${model} 尚未下载：去设置 →「功能模块与官方插件」里下载`);
      }

      const result = await asrTranscribe(path, model);
      const text = result.text.trim();
      if (!text) throw new Error("没有识别出文字。可以换更清晰的录音，或在设置里换更大的模型");

      const material = {
        ...makeMaterial({ title: titleFromTranscript(text), text, url: "" }),
        sourceType: "audio",
      };
      await updateMaterial(material);
      navigate("inbox");
      setNotice(
        `语音已转写并存入收件箱：${text.length} 字，音频 ${(result.audioMs / 1000).toFixed(1)} 秒，` +
          `耗时 ${(result.elapsedMs / 1000).toFixed(1)} 秒（${realtimeFactor(result.audioMs, result.elapsedMs)}）`
      );
    });
  };

  // 简报/问答/复习是 lazy chunk，首次点开要等下载。空闲时先取回，
  // 把「正在加载…」从用户路径上挪走（失败无所谓，真打开时还会再请求）。
  useEffect(() => {
    const prefetch = () => {
      void import("../BrainViews").catch(() => {});
      void import("../StudyViews").catch(() => {});
    };
    const idle = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(cb, 1200));
    const handle = idle(prefetch);
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(handle as number);
      else window.clearTimeout(handle as number);
    };
  }, []);

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
  const restoreFromBackup = async (picked: FileList | File[] | null) => {
    const chosen = picked?.[0];
    if (!chosen) return;
    try {
      await act(async () => {
        setBusyLabel("正在恢复备份…");
        const buffer = new Uint8Array(await chosen.arrayBuffer());
        const isZip = /\.kfbackup$/i.test(chosen.name) || (buffer[0] === 0x50 && buffer[1] === 0x4b);
        const restored = restoreKfBackup(isZip ? buffer : new TextDecoder().decode(buffer));
        // 附件先写回本机再落素材行：素材里的 mediaPath 是库内相对路径，
        // 换一台机器后必须重新落盘，否则就是一批指向空处的引用。
        const restoredMedia = new Map<string, string>();
        for (const [rel, bytes] of restored.media) {
          try {
            // media 只接受白名单 MIME，必须按扩展名还原，否则每一条都会被判失败。
            const ext = rel.split(".").pop()?.toLowerCase() ?? "";
            const mime = mediaMimeOfExtension(ext);
            const kind = rel.startsWith("media/image/") ? "image" : rel.startsWith("media/ink/") ? "ink" : "audio";
            if (!mime) return;
            const saved = await saveMedia(kind as "audio" | "ink" | "image", mime, bytes, dir);
            restoredMedia.set(rel, saved);
          } catch { /* 单个附件失败不阻断整份备份恢复 */ }
        }
        let total = 0;
        // 「哪些条目该被放回去」的判定在 domain/restoreRules.ts ——
        // 那里有单测钉着（曾经是静默丢数据的地方，不能只有浏览器层的证据）。
        for (const m of restorableMaterials(restored.materials)) {
          const mediaPath = m.mediaPath ? restoredMedia.get(m.mediaPath) ?? null : m.mediaPath;
          await updateMaterial({ ...m, mediaPath, mediaSizeBytes: m.mediaSizeBytes || 0 });
          total++;
        }
        for (const c of restorableCards(restored.cards)) {
          await updateCard(c);
          total++;
        }
        // 认知产物是 Layer 3，只在桌面端有 SQLite 表；浏览器体验模式没有这层，跳过。
        for (const art of restorableArtifacts(restored.artifacts)) {
          if (inShell()) await dbSaveArtifact(art, dir);
          total++;
        }
        // 笔记与知识库（v2 包）：同 id 已存在 → 以备份覆盖（与素材/卡片的恢复语义一致）；
        // 不存在 → 新建。恢复条数计入回执。
        const restoredNotes = await restoreNotesBundle(restored.notes, restored.knowledgeBases, restored.kbMembership, dir);
        total += restoredNotes;
        if (restored.settings) {
          await storePreferences(restored.settings, apiKey, dir);
          setFile(restored.settings);
        }
        setNotice(
          `备份恢复完成：${restored.cards.length} 张卡片、${restored.materials.length} 份素材` +
            `、${restored.artifacts.length} 条认知产物、${restored.notes.length} 篇笔记、${restored.knowledgeBases.length} 个知识库` +
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
        if (!e.dataTransfer.files.length || busy || loading) return;
        const backups = Array.from(e.dataTransfer.files).filter(f => /\.kfbackup$/i.test(f.name));
        if (backups.length) {
          // 拖放的备份包走恢复而不是导入：同一份文件两个入口只会让人
          // 猜哪个对——恢复的失败提示也明确说「本地内容未受影响」。
          void restoreFromBackup(backups);
          return;
        }
        void importFiles(e.dataTransfer.files);
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
          {/* 顶栏只留「导出备份」一个全局动作。语音转写与侧栏「记录方式」里的
              「转写」是同一个动作（transcribeAudio）——四段收敛清理顶栏时侧栏
              还没有「转写」，后来笔记软件本体把三个记法收进侧栏，这里就成了
              重复入口（插件关闭时甚至是两个灰按钮各解释一遍）。
              见 docs/UI_CONSOLIDATION.md「顶栏」一节。 */}
          <div className="ws-toolbar-actions">
            <button
              className="ws-icon-button"
              aria-label="导出备份"
              title="导出完整备份包 (.kfbackup)"
              disabled={loading || busy}
              onClick={() => {
                // 附件字节必须随包带走，所以导出是异步的；取附件失败只丢附件，
                // 不能让整份备份导不出来。
                void (async () => {
                  const media = await collectBackupMedia(materials);
                  if (!inShell()) {
                    downloadKfBackup(materials, cards, file, [], media, notesState.notes, notesState.knowledgeBases, notesState.membership);
                    setNotice("已导出完整备份包 (.kfbackup)，包含素材、卡片、设置与附件，不含 API 密钥");
                    return;
                  }
                  try {
                    const arts = await dbListArtifacts(1000, dir);
                    downloadKfBackup(materials, cards, file, arts, media, notesState.notes, notesState.knowledgeBases, notesState.membership);
                    setNotice(
                      `已导出完整备份包 (.kfbackup)：${cards.length} 张卡片、${materials.length} 份素材、` +
                        `${arts.length} 条认知产物、${media.size} 个附件，不含 API 密钥`
                    );
                  } catch {
                    downloadKfBackup(materials, cards, file, [], media, notesState.notes, notesState.knowledgeBases, notesState.membership);
                    setNotice("已导出完整备份包 (.kfbackup)，包含素材、卡片、设置与附件，不含 API 密钥");
                  }
                })();
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
        {/* 笔记软件的三种记法并列：打字、手写、说话。都在同一层，随手就能选。 */}
        <div className="ws-capture-modes" role="group" aria-label="记录方式">
          <button type="button" className="ws-capture-mode" aria-label="手写笔记" disabled={loading || busy} onClick={() => setNotePad("ink")}>
            <Icon name="edit" size={14} /><span>手写</span>
          </button>
          <button type="button" className="ws-capture-mode" aria-label="语音笔记" disabled={loading || busy} onClick={() => setNotePad("voice")}>
            <Icon name="mic" size={14} /><span>语音</span>
          </button>
          {/* 插件没开时**不能**用 disabled：禁用按钮不可聚焦、不派发事件，
              键盘用户 Tab 不到、鼠标点了也没反应，连 title 都看不到——
              界面上就多出一个没人知道为什么灰掉的入口。
              改成 aria-disabled：照常可聚焦，点了说明原因与下一步。 */}
          {asrEnabled ? (
            <button type="button" className="ws-capture-mode" aria-label="导入音频转写" disabled={loading || busy} title="导入已有音频并转写" onClick={() => void transcribeAudio()}>
              <Icon name="upload" size={14} /><span>转写</span>
            </button>
          ) : (
            <DisabledEntry
              className="ws-capture-mode"
              label="导入音频转写"
              reason="语音转写插件未启用"
              hint="到设置 →「功能模块与官方插件」里开启"
              onExplain={(message) => setNotice(message)}
            >
              <Icon name="upload" size={14} /><span>转写</span>
            </DisabledEntry>
          )}
          <button type="button" className="ws-capture-mode" aria-label="笔记转知识卡" disabled={loading || busy} title="把 Markdown 笔记拆成可复习的知识卡" onClick={() => notesRef.current?.click()}>
            <Icon name="card" size={14} /><span>笔记</span>
          </button>
        </div>
        <div className="ws-nav-scroll">
          {/* 侧栏只回答一个问题：我在流水线的哪一段。
              「来源 → 收件箱 → 知识库 → 应用」是产品主线；收藏/归档/分类是
              库的筛选条件，折叠在知识库下面，不再和主线抢同一层。 */}
          {/* 三入口导航（R1，UI_SPEC「桌面主导航」+ ADR-0004）：一级目的地只有
              笔记 / 知识库 / 应用。原「来源」与「收件箱」并入笔记——邮箱、订阅、
              导入是笔记的采集手段，收件箱是笔记的处理状态，都不是与笔记并列的
              产品层（旧四段结构的迁移对照见 docs/UI_CONSOLIDATION.md）。 */}
          <nav className="ws-nav-group" aria-label="笔记">
            <p className="ws-group-label">笔记</p>
            <button
              className="ws-nav-row"
              aria-current={page === "notes" ? "page" : undefined}
              onClick={() => navigate("notes")}
            >
              <Icon name="edit" /><span>全部笔记</span>
              <span className="ws-count">{notesState.notes.filter(n => !n.isDeleted).length}</span>
            </button>
            <button
              className="ws-nav-row"
              aria-current={page === "inbox" ? "page" : undefined}
              onClick={() => navigate("inbox")}
            >
              <Icon name="inbox" /><span>收件箱</span>
              <span className="ws-count">{counts.inbox}</span>
            </button>
            <button className="ws-nav-row" aria-current={page === "mail" ? "page" : undefined} onClick={() => navigate("mail")}>
              <Icon name="mail" /><span>邮箱</span>
              <span className="ws-count">{materials.filter(m => m.sourceType === "email" && m.inboxStatus === "inbox").length}</span>
            </button>
            <button className="ws-nav-row" aria-current={page === "subscriptions" ? "page" : undefined} onClick={() => navigate("subscriptions")}>
              <Icon name="inbox" /><span>订阅源</span>
              <span className="ws-count">{subscriptions.length}</span>
            </button>
            {/* 导入是动作不是目的地；样式区别于导航行。 */}
            <button className="ws-nav-action" onClick={() => importRef.current?.click()} disabled={loading || busy}>
              <Icon name="upload" /><span>导入文件</span>
            </button>
          </nav>

          <nav className="ws-nav-group" aria-label="知识库">
            <p className="ws-group-label">知识库</p>
            <button
              className="ws-nav-row"
              aria-current={page === "library" ? "page" : undefined}
              onClick={() => navigate("library")}
            >
              <Icon name="library" /><span>全部知识</span>
              <span className="ws-count">{counts.library}</span>
            </button>
            {/* 收藏与归档是「库」的筛选，不是并列的一级目的地。 */}
            <details className="ws-nav-details" open={page === "favorites" || page === "archive"}>
              <summary className="ws-nav-summary">
                筛选
                <span className="ws-count">{counts.favorites + counts.archive}</span>
              </summary>
              <button
                className="ws-nav-row"
                aria-current={page === "favorites" ? "page" : undefined}
                onClick={() => navigate("favorites")}
              >
                <Icon name="star" /><span>收藏</span>
                <span className="ws-count">{counts.favorites}</span>
              </button>
              <button
                className="ws-nav-row"
                aria-current={page === "archive" ? "page" : undefined}
                onClick={() => navigate("archive")}
              >
                <Icon name="archive" /><span>已归档</span>
                <span className="ws-count">{counts.archive}</span>
              </button>
            </details>
            {tags.length ? (
              <details className="ws-nav-details">
                <summary className="ws-nav-summary">分类<span className="ws-count">{tags.length}</span></summary>
                {tags.slice(0, 8).map((t) => (
                  <button
                    key={t}
                    className="ws-nav-row"
                    aria-current={tag === t ? "page" : undefined}
                    onClick={() => {
                      // 走 navigate 而不是只改 page/tag：否则从「收藏」等集合点进来时
                      // selectedId 留着上一屏的条目，右栏面包屑会显示成「收藏 / 计算机」。
                      navigate("library");
                      setTag(tag === t ? "" : t);
                    }}
                  >
                    <Icon name="folder" size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</span>
                    <span className="ws-count">{tagCounts.get(t) ?? 0}</span>
                  </button>
                ))}
              </details>
            ) : null}
          </nav>

        {/* 「应用」是产品主线（对知识做应用），不能被滚动藏起来：
            侧栏空间不够时，多出来的那一行会正好把「知识测验」挤出可视区，
            用户根本看不到这个功能。放在滚动区之外，来源/收件箱/知识库
            那些流入管道仍然可以滚动。 */}
<nav className="ws-nav-group" aria-label="应用">
            {/* 「应用」段收进可折叠区：一级入口（各组里直接可见的行）要控制在六个
                以内（见 17834ea 的四段收敛），我新增「统计」「知识测验」后一度到 9。
                但**当前就在应用页时自动展开**——折叠着的「知识问答」会让用户
                以为自己没在那一段。
                summary 带 ws-group-label 类：它同时就是这一段的组标签。 */}
            <details
              className="ws-nav-details"
              open={["brain", "briefing", "artifacts", "stats", "quiz"].includes(page)}
            >
            <summary className="ws-nav-summary ws-group-label">应用</summary>
            <button
              className="ws-nav-row"
              aria-current={page === "brain" ? "page" : undefined}
              onClick={() => navigate("brain")}
            >
              <Icon name="ask" /><span>知识问答</span>
            </button>
            <button
              className="ws-nav-row"
              aria-current={page === "briefing" ? "page" : undefined}
              onClick={() => navigate("briefing")}
            >
              <Icon name="brief" /><span>认知简报</span>
            </button>
            <button
              className="ws-nav-row"
              aria-current={page === "artifacts" ? "page" : undefined}
              onClick={() => navigate("artifacts")}
            >
              <Icon name="layers" /><span>产物库</span>
            </button>
            <button
              className="ws-nav-row"
              aria-current={page === "stats" ? "page" : undefined}
              onClick={() => navigate("stats")}
            >
              <Icon name="brief" /><span>统计</span>
            </button>
            <button
              className="ws-nav-row"
              aria-current={page === "quiz" ? "page" : undefined}
              onClick={() => navigate("quiz")}
            >
              <Icon name="ask" /><span>知识测验</span>
            </button>
            </details>
            {/* 温故复习是**高频入口**（每天都要用），不跟着「应用」一起折叠——
                折叠起来用户就找不到每天要点开的那个按钮了。 */}
            {reviewEnabled ? (
              <button
                className="ws-nav-row"
                aria-current={page === "review" ? "page" : undefined}
                onClick={() => navigate("review")}
              >
                <Icon name="layers" /><span>温故复习</span>
              </button>
            ) : null}
          </nav>

          
          {/* 内容超过可视高度时，底部渐隐提示「还能往下滚」——
              否则最后一行被硬切一半，看起来像布局坏了。 */}
          <div className="ws-nav-fade" aria-hidden="true" />
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

      {/*
        提示区做成**常驻**的 live region。

        为什么：屏幕阅读器只会播报「已经存在的 live region 里的内容变化」。
        原来提示条是条件渲染的（`notice ? <div role="status">… : null`），
        元素在出现的那一刻才插进 DOM——很多读屏软件这时还没挂上监听，
        提示就**静默地**出现了：视觉用户看得见，屏幕阅读器用户听不到。

        现在：容器一直在，消息节点也一直在（无消息时 `hidden`），
        文本变化会被 `aria-live="polite"` 捕获。
        `aria-atomic="true"` 让整条消息一起播报，而不是逐字读。
      */}
      <div className="ws-feedback-host" aria-live="polite" aria-atomic="true">
        <div className="ws-feedback" role="status" hidden={!notice}>
          <Icon name="check" />
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <Icon name="close" />
          </button>
        </div>
        {error ? (
          <div className="ws-feedback" role="alert">
            <span>{error}</span>
            {errorIsReloadable ? (
              <button onClick={() => void load()} disabled={busy}>
                重新读取
              </button>
            ) : null}
            <button aria-label="关闭提示" onClick={() => setError("")}>
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
                  placeholder="搜索标题、正文、发件人、附件或标签"
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
                  // 订阅是「来源」维度，不是内容类型；单独一项便于清理自动收进来的内容。
                  ["subscription", "订阅"],
                ].map(([id, label]) => (
                  <button key={id} aria-pressed={source === id} onClick={() => setSource(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <span>最近更新</span>
            </div>

            {batchCards.length > 0 || batchMaterials.length > 0 ? (
              <div className="ws-batch-bar" role="group" aria-label="批量操作">
                <span className="ws-batch-count" data-batch-count>
                  {batchCards.length > 0
                    ? `已选 ${batchCards.length} 张卡片`
                    : `已选 ${batchMaterials.length} 条素材`}
                </span>
                <div className="ws-batch-actions">
                  {batchMaterials.length > 0 && batchCards.length === 0 ? (
                    <button
                      className="ws-bordered"
                      aria-label="批量归档素材"
                      disabled={loading || busy}
                      onClick={() => void archiveSelectedMaterials()}
                    >
                          归档
                    </button>
                  ) : null}
                  <button
                    className="ws-bordered"
                    aria-label="导出选中内容"
                    disabled={loading || busy}
                    onClick={() => {
                      // 复用整库导出的同一套生成逻辑，只是把范围收窄到选中项，
                      // 避免出现第二套导出格式。
                      downloadMarkdownVault(batchMaterials, batchCards);
                      setNotice(`已导出 ${batchMaterials.length + batchCards.length} 条选中内容（Markdown）`);
                    }}
                  >
                    导出选中
                  </button>
                  <button
                    className="ws-bordered"
                    aria-label="标记为已复习"
                    disabled={loading || busy}
                    onClick={() => void runOnSelectedCards("标记为已复习", (card) => ({
                      ...card, seenAt: card.seenAt ?? Date.now(),
                    }))}
                  >
                    标记已复习
                  </button>
                  <button
                    className="ws-bordered"
                    aria-label="收藏选中卡片"
                    disabled={loading || busy}
                    onClick={() => void runOnSelectedCards("收藏", (card) => ({
                      ...card, isFavorite: true, favoritedAt: card.favoritedAt ?? Date.now(),
                    }))}
                  >
                    收藏
                  </button>
                  {batchCards.length === 0 ? null : batchCategory === null ? (
                    <button
                      className="ws-bordered"
                      aria-label="设置统一分类"
                      disabled={loading || busy}
                      onClick={() => setBatchCategory(batchCards[0]?.category || "")}
                    >
                      设分类
                    </button>
                  ) : (
                    <span className="ws-batch-input">
                      <input
                        autoFocus
                        aria-label="统一分类名称"
                        placeholder="分类名称"
                        value={batchCategory}
                        onChange={(event) => setBatchCategory(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const category = batchCategory.trim();
                            if (category) void runOnSelectedCards(`归类到「${category}」`, (card) => ({ ...card, category }));
                            else setBatchCategory(null);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setBatchCategory(null);
                          }
                        }}
                      />
                      <button
                        className="ws-primary"
                        aria-label="确认设置分类"
                        disabled={loading || busy || !batchCategory.trim()}
                        onClick={() => {
                          const category = batchCategory.trim();
                          if (category) void runOnSelectedCards(`归类到「${category}」`, (card) => ({ ...card, category }));
                          else setBatchCategory(null);
                        }}
                      >
                        应用
                      </button>
                      <button className="ws-icon-button" aria-label="取消设置分类" disabled={loading || busy} onClick={() => setBatchCategory(null)}>
                        <Icon name="close" size={14} />
                      </button>
                    </span>
                  )}
                  <button
                    className="ws-icon-button"
                    aria-label="退出批量选择"
                    title="退出批量选择"
                    disabled={loading || busy}
                    onClick={() => { setBatchIds(new Set()); setBatchCategory(null); }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </div>
            ) : null}

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
                  <p>
                    {query
                      ? "试试更短的关键词，或清除筛选。"
                      : "记一段想法，或导入一份笔记。侧栏的「记录」随时可以写一条。"}
                  </p>
                  {/* 有筛选时给「清除筛选」；没有筛选时**不放**「记录第一条」——
                      侧栏的「记录 ⌘N」常驻可见，再放一个做同一件事的按钮只会
                      让用户以为是两个不同的入口。 */}
                  {query || tag || source !== "all" ? (
                    <button
                      className="ws-primary"
                      onClick={() => (setQuery(""), setTag(""), setSource("all"))}
                    >
                      清除筛选
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  {filtered.slice(0, visibleCount).map((e) => {
                    const meta = sourceLabel(
                      e.kind === "card" ? "card" : (e.original as RawMaterial).sourceType,
                      e.url,
                      e.kind === "material" ? subscriptionIdOf(e.original as RawMaterial) : null
                    );
                    const isSelected = selected?.id === e.id;
                    return (
                      <button
                        key={e.id}
                        data-entry-id={e.id}
                        tabIndex={isSelected ? 0 : -1}
                        role="option"
                        aria-selected={isSelected}
                        className={batchIds.has(e.id) ? "ws-entry ws-entry-picked" : "ws-entry"}
                        data-picked={batchIds.has(e.id) ? "true" : undefined}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey) {
                            const next = new Set(batchIds);
                            if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                            setBatchIds(next);
                            setSelectedId(e.id);
                            return;
                          }
                          setBatchIds(new Set());
                          setSelectedId(e.id);
                        }}
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
              dir={dir}
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
                  // 归档是「处理完了」，状态写 processed。
                  // 原先写的是 dismissed——而 dismissed 是用户**明确忽略**的语义，
                  // 来源洞察会据此给这个来源降权：用户只是归档了一份材料，
                  // 并不表示讨厌它的来源。而且提示写「已归档」、状态却是
                  // 「已忽略」，两处自相矛盾。
                  await updateMaterial({
                    ...m,
                    inboxStatus: m.inboxStatus === "inbox" ? "processed" : "inbox",
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
              onDelete={() =>
                act(async () => {
                  // 卡片删除是硬删除：素材保留，从素材转出的关系由 materialId 记录，
                  // 所以删卡不会丢原始记录。
                  const card = selected.original as KnowledgeCard;
                  const next = cards.filter((item) => item.id !== card.id);
                  await storeCardList(next, dir);
                  setCards(next);
                  setSelectedId("");
                  setNotice(`已删除知识卡「${card.headline}」。素材与归档内容不受影响。`);
                })
              }
            />
          ) : (
            <article className="ws-reader" data-workspace-pane="inspector" aria-label="阅读区">
              <div className="ws-empty">
                {filtered.length > 0 ? (
                  <div className="ws-empty-guide">
                    <Icon name="library" size={28} style={{ opacity: 0.35, marginBottom: 8 }} />
                    <p style={{ fontWeight: 500, color: "var(--ink)" }}>选择一条内容，开始阅读</p>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>点击左侧条目查看正文，或使用快捷键浏览</span>
                  </div>
                ) : (
                  /* 空列表时右栏不能是一片空白：首次打开应用的用户会不知道下一步做什么。
                     这里给的是可执行的三条入口，而不是一句「暂无内容」。 */
                  <div className="ws-empty-guide" data-empty-onboarding="">
                    <Icon name="inbox" size={26} style={{ opacity: 0.35, marginBottom: 8 }} />
                    <p style={{ fontWeight: 500, color: "var(--ink)" }}>
                      {query.trim() || tag ? "这个条件下没有内容" : "从一个想法开始"}
                    </p>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {query.trim() || tag
                        ? "换个关键词，或清空筛选看看全部内容"
                        : "按 ⌘N 记一条闪念，拖入文件，粘贴链接自动抓取，或用订阅源定期收集"}
                    </span>
                    {/* 不再放「记录」按钮：侧栏的「记录 ⌘N」常驻可见，
                        同一动作同一屏出现两次是重复 CTA。这里补的是用户还没看到的入口。 */}
                    {query.trim() || tag ? (
                      // 文案里写着「清空筛选看看全部内容」，那就得有个能点的入口——
                      // 否则用户要自己回到搜索框手动删词，还得记得把标签也点掉。
                      <div className="ws-empty-actions">
                        <button
                          className="ws-bordered"
                          type="button"
                          data-action="clear-search"
                          onClick={() => { setQuery(""); setTag(""); }}
                        >
                          清空搜索与标签
                        </button>
                      </div>
                    ) : (
                      <div className="ws-empty-actions">
                        <button className="ws-bordered" type="button" onClick={() => navigate("mail")}>
                          连接邮箱
                        </button>
                        <button className="ws-bordered" type="button" onClick={() => navigate("subscriptions")}>
                          添加订阅
                        </button>
                      </div>
                    )}
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
                  materials={materials}
                  cards={cards}
                  onBack={() => navigate("inbox")}
                  onExportMarkdown={() => downloadMarkdownVault(materials, cards)}
                  onExportKfBackup={() => {
                    // 认知产物（Layer 3）只在桌面端的 SQLite 里有；浏览器体验模式跳过。
                    void (async () => {
                      const media = await collectBackupMedia(materials);
                      if (!inShell()) {
                        downloadKfBackup(materials, cards, file, [], media, notesState.notes, notesState.knowledgeBases, notesState.membership);
                        return;
                      }
                      try {
                        const arts = await dbListArtifacts(1000, dir);
                        downloadKfBackup(materials, cards, file, arts, media, notesState.notes, notesState.knowledgeBases, notesState.membership);
                      } catch {
                        downloadKfBackup(materials, cards, file, [], media, notesState.notes, notesState.knowledgeBases, notesState.membership);
                      }
                    })();
                  }}
                  onRestoreKfBackup={() => restoreRef.current?.click()}
                  onExportCardsJson={inShell() ? () => void exportCardsJsonForAndroid(dir) : undefined}
                  onExportAnkiTsv={() => {
                    // Anki 词表是纯文本，浏览器里也能直接下载。
                    downloadAnkiTsv(cards);
                    setNotice(`已导出 ${cards.length} 张卡片的 Anki 词表 (.tsv)`);
                  }}
                  onSave={async (next, key, enabled) => {
                    const updated = {
                      ...next,
                      raw: { ...next.raw, reviewPluginEnabled: enabled },
                    };
                    await storePreferences(updated, key, dir);
                    setFile(updated);
                    setApiKey(key);
                    setPersonalizationOn(personalizationEnabled(updated.raw));
                  }}
                />
              ) : null}
              {page === "stats" ? (
                <StatsView stats={stats} onBack={() => navigate("library")} />
              ) : null}
              {page === "artifacts" ? (
                <ArtifactsView
                  dir={dir}
                  cards={cards}
                  onOpenCard={(cardId) => { navigate("library"); setSelectedId(cardId); setSource("card"); }}
                  onBack={() => navigate("briefing")}
                />
              ) : null}
              {page === "notes" ? (
                <NotesView dir={dir} onStateChange={setNotesState} />
              ) : null}
              {page === "mail" ? (
                <MailboxView
                  dir={dir} materials={materials} settings={file.settings} apiKey={apiKey}
                  onRefresh={() => load(true)}
                  onSettings={() => navigate("settings")}
                  onOpenMaterial={(id) => { navigate("library"); setSelectedId(id); }}
                  digest={mailDigest}
                  onDigestChange={setMailDigest}
                  digestTitle={mailDigestTitle}
                  onDigestTitleChange={setMailDigestTitle}
                  insights={insights}
                  personalizationOn={personalizationOn}
                  onSaveDigest={async (title, markdown, sources) => {
                    const material = makeMaterial({ title, text: markdown, url: "" });
                    material.sourceType = "email-digest";
                    // The source map is captured at request time, so a saved digest
                    // still points at the right originals after the selection changes.
                    material.metadataJson = makeMailDigestMetadata(sources);
                    await storeMaterial(material, dir);
                    setMailDigest(current => current ? { ...current, saved: true } : null);
                    await load(true);
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
                  artifacts={artifacts}
                  settings={file.settings}
                  apiKey={apiKey}
                  onOpenCard={openCard}
                  onNavigateSettings={() => navigate("settings")}
                />
              ) : null}
              {page === "quiz" ? (
                <div className="ws-review-page-scroll" data-page="quiz">
                  <div className="ws-quiz-head">
                    <h1>知识测验</h1>
                    <p className="ws-hint">
                      从全库随机抽十张卡来答——这是「练手」，不影响温故复习的到期安排。
                    </p>
                  </div>
                  <Quiz
                    cards={cards}
                    algorithm="fsrs"
                    onChange={async (next) => {
                      await storeCardList(next, dir);
                      setCards(next);
                    }}
                  />
                </div>
              ) : null}
              {page === "review" && reviewEnabled ? (
                <div className="ws-review-page-scroll">
                  <ReviewOverviewPanel cards={cards} />
                  <Quiz
                    cards={cards}
                    algorithm="fsrs"
                    dueOnly
                    onChange={async (next) => {
                      await storeCardList(next, dir);
                      setCards(next);
                    }}
                  />
                </div>
              ) : null}
            </Suspense>
          </main>
        </>
      )}

      <footer className="ws-status">
        <span>
          <Icon name="check" size={13} />
          {loading ? "正在读取…" : busy ? busyLabel : inShell() ? "已保存到本机" : "浏览器体验 · 内容存在本机"}
        </span>
        <span>
          {selected && isCollection ? "已选中 1 条" : "未选中内容"}　{cards.length + materials.length} 条
        </span>
      </footer>

      <input
        hidden
        ref={notesRef}
        type="file"
        multiple
        data-role="notes-to-cards"
        accept=".md,.markdown,.txt,.json"
        onChange={(e) => {
          if (e.target.files) void importNotesToCards(e.target.files);
          e.target.value = "";
        }}
      />

      <input
        hidden
        ref={importRef}
        type="file"
        multiple
        data-role="import-files"
        accept=".md,.markdown,.txt,.json,.docx,.pptx,.pdf,.eml,.png,.jpg,.jpeg,.webp,.gif,.heic"
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

      {notePad ? (
        <div
          className="ws-note-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={notePad === "ink" ? "手写笔记" : "语音笔记"}
          ref={notePadRef}
        >
          <div className="ws-note-panel">
            <header className="ws-note-head">
              <strong>{notePad === "ink" ? "手写笔记" : "语音笔记"}</strong>
              <button type="button" className="ws-icon-button" aria-label="关闭" onClick={() => setNotePad(null)}>
                <Icon name="close" size={14} />
              </button>
            </header>
            {notePad === "ink"
              ? <InkPad onCancel={() => setNotePad(null)} onSave={saveInkNote} />
              : <VoiceRecorder onCancel={() => setNotePad(null)} onSave={saveVoiceNote} />}
          </div>
        </div>
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
                  }).catch((e) => setError(userError(e)));
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

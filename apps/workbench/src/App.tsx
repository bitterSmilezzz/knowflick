import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  clearHistory,
  encodeCardList,
  loadCardList,
  swipeCard,
  swipeDirectionLabel,
  undoSwipe,
  type KnowledgeCard,
  type SwipeDirection,
} from "./domain/card";
import { encodeSettings, parseSettings, type AiSettings, type SettingsFile } from "./domain/settings";
import { reviewDay, type SpacedAlgorithm } from "./domain/review";
import { applyArchiveRestore, buildArchivePreview, decodeListSalvaging, type ArchivePreview, type RestoreStrategy } from "./domain/archive";
import { encodeSearchHistory, parseSearchHistory, pushSearchHistory, removeSearchHistory } from "./domain/searchHistory";
import { exportArchive, exportCardsJson, inShell, loadStore, openExternalUrl, pickExportPath, pickImportArchive, pickLibraryDir, readApiKey, readArchive, saveCards, saveSearchHistory, saveSettings, writeApiKey } from "./shell/store";
import {
  buildDeckIds,
  deckFilterSignature,
  deckFromIds,
  eligibleDeck,
  promoteDeckIds,
  refreshDeckIds,
} from "./domain/deckSession";
import { probeConnection } from "./domain/aiChat";
import { pruneThemeCache, themeKeyForCard } from "./domain/cardTheme";
import { CardSheet } from "./ui/CardSheet";
import { HelpSheet } from "./ui/HelpSheet";
import { ImportRestoreSheet } from "./ui/ImportRestoreSheet";
import { SearchSheet } from "./ui/SearchSheet";
import { playPaperSlide, playSwipeTone } from "./shell/sounds";
import { stampColor } from "./ui/stampColor";
import { ClipView, GenerateView, NotesView, QuizView, StatsView } from "./ui/StudyViews";

type View = "deck" | "library" | "detail" | "settings" | "quiz" | "stats" | "notes" | "clip" | "generate";

export function App() {
  const [dir, setDir] = useState("");
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [settingsFile, setSettingsFile] = useState<SettingsFile>(() => parseSettings(null));
  const [apiKey, setApiKey] = useState("");
  const [view, setView] = useState<View>("deck");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [undo, setUndo] = useState<KnowledgeCard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "favorites" | "history">("all");
  const [algorithm, setAlgorithm] = useState<SpacedAlgorithm>("sm2");
  const [avoidTopKey, setAvoidTopKey] = useState<string | null>(null);
  const [deckIds, setDeckIds] = useState<string[]>([]);
  const deckPinnedIds = useRef(new Set<string>());
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<ArchivePreview | null>(null);
  const [quizDueOnly, setQuizDueOnly] = useState(false);
  const deckLaunchRef = useRef<((direction: SwipeDirection) => void) | null>(null);

  const persistSearchHistory = useCallback(async (next: string[], libraryDir = dir) => {
    setSearchHistory(next);
    await saveSearchHistory(libraryDir, encodeSearchHistory(next));
  }, [dir]);

  const reload = useCallback(async (nextDir?: string) => {
    const snapshot = await loadStore(nextDir);
    const loaded = loadCardList({
      main: snapshot.cards,
      backup: snapshot.backup,
      backup2: snapshot.backup2,
    });
    setDir(snapshot.dir);
    setCards(loaded.cards);
    pruneThemeCache(new Set(loaded.cards.map((card) => card.id)));
    setSettingsFile(parseSettings(snapshot.settings));
    const rawAlgorithm = parseSettings(snapshot.settings).raw.spacedAlgorithm;
    setAlgorithm(rawAlgorithm === "fsrs" ? "fsrs" : "sm2");
    setApiKey(await readApiKey(snapshot.dir));
    setSearchHistory(parseSearchHistory(snapshot.searchHistory));
    setUndo(null);
    setDeckIds([]);
    if (loaded.recoveredFrom === "backup" || loaded.recoveredFrom === "backup2") {
      await saveCards(snapshot.dir, encodeCardList(loaded.cards));
      setNotice(loaded.recoveredFrom === "backup" ? "主文件不可用，已从备份恢复" : "主文件不可用，已从二代备份恢复");
    } else {
      setNotice("");
    }
  }, []);

  useEffect(() => {
    if (!inShell()) {
      setError("这个界面要在桌面壳里打开。在 apps/workbench 运行 npm run tauri dev。");
      return;
    }
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [reload]);

  const { enableAI, preferredCategories, showAIMark, soundEffectsEnabled } = settingsFile.settings;
  const filterSig = deckFilterSignature(enableAI, preferredCategories);
  const pool = useMemo(() => eligibleDeck(cards, enableAI, preferredCategories), [cards, enableAI, preferredCategories]);
  const deckScope = useRef(`${filterSig}|${dir}`);
  useEffect(() => {
    const scope = `${filterSig}|${dir}`;
    if (deckScope.current !== scope) {
      deckScope.current = scope;
      deckPinnedIds.current.clear();
      setDeckIds(buildDeckIds(pool, avoidTopKey));
      return;
    }
    setDeckIds((previous) => refreshDeckIds(previous, pool, avoidTopKey, deckPinnedIds.current));
  }, [pool, filterSig, dir, avoidTopKey]);
  const deck = useMemo(() => deckFromIds(cards, deckIds), [cards, deckIds]);
  const topCard = deck[0] ?? null;
  const selected = cards.find((card) => card.id === selectedId) ?? null;
  const persistCards = useCallback(async (next: KnowledgeCard[], libraryDir = dir) => {
    setCards(next);
    await saveCards(libraryDir, encodeCardList(next));
  }, [dir]);

  const swipe = useCallback(async (direction: SwipeDirection) => {
    if (!topCard) return;
    const before = topCard;
    const after = swipeCard(before, direction);
    const next = cards.map((card) => (card.id === before.id ? after : card));
    deckPinnedIds.current.delete(before.id);
    setDeckIds((ids) => (ids[0] === before.id ? ids.slice(1) : ids.filter((id) => id !== before.id)));
    setUndo(before);
    setAvoidTopKey(themeKeyForCard(before));
    setError("");
    try {
      await persistCards(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [topCard, cards, persistCards]);

  const undoLast = useCallback(async () => {
    if (!undo) return;
    const current = cards.find((card) => card.id === undo.id);
    if (!current) return;
    const restored = undoSwipe(current, undo);
    setUndo(null);
    setDeckIds((ids) => [restored.id, ...ids.filter((id) => id !== restored.id)]);
    try {
      await persistCards(cards.map((card) => (card.id === restored.id ? restored : card)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [undo, cards, persistCards]);

  async function chooseDir() {
    const picked = await pickLibraryDir();
    if (!picked) return;
    setError("");
    await reload(picked);
  }

  async function importCards(next: KnowledgeCard[], message: string) {
    await persistCards(next);
    setNotice(message);
    setView("deck");
  }

  async function importLibrary() {
    const path = await pickImportArchive();
    if (!path) return;
    const payload = await readArchive(path);
    const imported = decodeListSalvaging(payload.cards);
    if (imported.length === 0) {
      setError("所选文件中未检测到有效的 KnowFlick 卡片数据");
      return;
    }
    const name = path.split(/[/\\]/).pop() ?? "archive";
    setImportPreview(buildArchivePreview(name, imported, payload.settings, name.toLowerCase().endsWith(".zip")));
    setError("");
  }

  async function confirmImport(strategy: RestoreStrategy) {
    if (!importPreview) return;
    const { cards: next, result } = applyArchiveRestore(cards, importPreview, strategy);
    await persistCards(next);
    if (strategy === "overwrite" && importPreview.settingsJson) {
      const incoming = parseSettings(importPreview.settingsJson);
      setSettingsFile(incoming);
      await saveSettings(dir, encodeSettings(incoming));
      const rawAlgorithm = incoming.raw.spacedAlgorithm;
      setAlgorithm(rawAlgorithm === "fsrs" ? "fsrs" : "sm2");
    }
    setImportPreview(null);
    setNotice(
      strategy === "overwrite"
        ? `已全量覆盖：${importPreview.totalCards} 张卡片。`
        : `导入完成：新增 ${result.added} 张，合并 ${result.restored} 张，忽略 ${result.ignored} 张。`,
    );
  }

  async function exploreAgain() {
    const next = clearHistory(cards);
    await persistCards(next);
    deckPinnedIds.current.clear();
    setDeckIds([]);
    setUndo(null);
    setNotice("已重置浏览进度，收藏与划卡记录保留。");
    setView("deck");
  }

  async function exportLibrary() {
    const dest = await pickExportPath();
    if (!dest || !dir) return;
    // 「另存为」里选了哪个扩展名就导出哪种：.json 是裸 cards.json（与安卓同一份线格式，
    // 拷过去就能打开），其余走 ZIP 备份包（卡片 + 设置，合并恢复学习进度用）。
    if (dest.toLowerCase().endsWith(".json")) {
      await exportCardsJson(dir, dest);
      setNotice("已导出 cards.json（裸数组，与安卓侧同一份格式）；不含设置与密钥。");
      return;
    }
    await exportArchive(dir, dest);
    setNotice("已导出 cards.json 和 settings.json，密钥没有放进压缩包。");
  }

  async function saveAi(next: AiSettings, key: string) {
    const file = { ...settingsFile, settings: next };
    setSettingsFile(file);
    setApiKey(key);
    await saveSettings(dir, encodeSettings(file));
    await writeApiKey(dir, key);
    setNotice("设置已写入。密钥在单独的文件里，不在 settings.json。");
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") {
        setImportPreview(null);
        setSearchOpen(false);
        setHelpOpen(false);
        if (view === "detail") {
          setView("library");
          return;
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === "?" || ((event.metaKey || event.ctrlKey) && event.key === "/")) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (view !== "deck") return;
      if (event.key === "ArrowLeft") deckLaunchRef.current?.("left");
      if (event.key === "ArrowRight") deckLaunchRef.current?.("right");
      if (event.key === "ArrowDown") deckLaunchRef.current?.("skip");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") undoLast();
      if (event.key === "Enter" && topCard) {
        setSelectedId(topCard.id);
        setView("detail");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, topCard, swipe, undoLast]);

  return (
    <div className="app" data-paper={settingsFile.settings.paperTheme || "SYSTEM"}>
      <aside className="sidebar">
        <p className="brand">KnowFlick</p>
        <p className="group">学习</p>
        <nav>
          <button type="button" className={view === "deck" ? "on" : ""} onClick={() => setView("deck")}>刷卡</button>
          <button type="button" className={view === "quiz" ? "on" : ""} onClick={() => { setQuizDueOnly(false); setView("quiz"); }}>测验</button>
          <button type="button" className={view === "stats" ? "on" : ""} onClick={() => setView("stats")}>统计</button>
        </nav>
        <p className="group">入库</p>
        <nav>
          <button type="button" className={view === "clip" ? "on" : ""} onClick={() => setView("clip")}>剪藏</button>
          <button type="button" className={view === "notes" ? "on" : ""} onClick={() => setView("notes")}>笔记</button>
          <button type="button" className={view === "generate" ? "on" : ""} onClick={() => setView("generate")}>AI 出卡</button>
        </nav>
        <p className="group">资料</p>
        <nav>
          <button type="button" className={view === "library" || view === "detail" ? "on" : ""} onClick={() => setView("library")}>卡库</button>
          <button type="button" onClick={() => setSearchOpen(true)}>搜索 ⌘K</button>
          <button type="button" onClick={() => setHelpOpen(true)}>帮助</button>
        </nav>
        <div className="foot">
          <p className="path" title={dir}>{dir || "尚未打开卡库"}</p>
          <button type="button" onClick={() => chooseDir().catch((err: unknown) => setError(String(err)))}>打开目录</button>
          <button type="button" onClick={() => importLibrary().catch((err: unknown) => setError(String(err)))}>导入</button>
          <button type="button" onClick={() => exportLibrary().catch((err: unknown) => setError(String(err)))}>导出</button>
          <button type="button" className={view === "settings" ? "on" : ""} onClick={() => setView("settings")}>设置</button>
        </div>
      </aside>
      <main className="stage">
      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner">{notice}</p> : null}
        {view === "deck" ? (
          <Deck
            cards={deck}
            librarySize={cards.length}
            unseenCount={pool.length}
            showAiMark={showAIMark}
            soundEffectsEnabled={soundEffectsEnabled}
            canUndo={undo !== null}
            onSwipe={swipe}
            onUndo={undoLast}
            onOpen={(id) => {
              setSelectedId(id);
              setView("detail");
            }}
            launchRef={deckLaunchRef}
            onExploreAgain={() => {
              exploreAgain().catch((err: unknown) => setError(String(err)));
            }}
          />
        ) : null}
        {view === "library" ? (
          <Library
            cards={cards}
            filter={libraryFilter}
            onFilter={setLibraryFilter}
            onOpen={(id) => {
              setSelectedId(id);
              setView("detail");
            }}
          />
        ) : null}
        {view === "detail" && selected ? (
          <Detail
            card={selected}
            showAiMark={showAIMark}
            onBack={() => setView("library")}
            onToggleFavorite={async () => {
              const now = Date.now();
              const next = cards.map((card) => card.id !== selected.id ? card : {
                ...card,
                isFavorite: !card.isFavorite,
                favoritedAt: card.isFavorite ? null : now,
              });
              await persistCards(next);
            }}
          />
        ) : null}
        {view === "quiz" ? (
          <QuizView
            cards={cards}
            algorithm={algorithm}
            dueOnly={quizDueOnly}
            onChange={persistCards}
          />
        ) : null}
        {view === "stats" ? (
          <StatsView
            cards={cards}
            algorithm={algorithm}
            onAlgorithm={(value) => {
              setAlgorithm(value);
              const file = { ...settingsFile, raw: { ...settingsFile.raw, spacedAlgorithm: value } };
              setSettingsFile(file);
              saveSettings(dir, encodeSettings(file)).catch((err: unknown) => setError(String(err)));
            }}
            onStartDueQuiz={() => {
              setQuizDueOnly(true);
              setView("quiz");
            }}
            onOpenCard={(id) => {
              setSelectedId(id);
              setView("detail");
            }}
          />
        ) : null}
        {view === "notes" ? (
          <NotesView cards={cards} settings={settingsFile.settings} apiKey={apiKey} onImported={importCards} />
        ) : null}
        {view === "clip" ? (
          <ClipView cards={cards} settings={settingsFile.settings} apiKey={apiKey} onImported={importCards} />
        ) : null}
        {view === "generate" ? (
          <GenerateView cards={cards} settings={settingsFile.settings} apiKey={apiKey} onImported={importCards} />
        ) : null}
        {view === "settings" ? (
          <Settings
            settings={settingsFile.settings}
            apiKey={apiKey}
            categories={[...new Set(cards.map((card) => card.category).filter(Boolean))].sort()}
            onSave={(next, key) => saveAi(next, key).catch((err: unknown) => setError(String(err)))}
          />
        ) : null}
      </main>
      {searchOpen ? (
        <SearchSheet
          cards={cards}
          searchHistory={searchHistory}
          onAddSearchHistory={(query) => {
            persistSearchHistory(pushSearchHistory(searchHistory, query)).catch((err: unknown) => setError(String(err)));
          }}
          onRemoveSearchHistory={(query) => {
            persistSearchHistory(removeSearchHistory(searchHistory, query)).catch((err: unknown) => setError(String(err)));
          }}
          onClearSearchHistory={() => {
            persistSearchHistory([]).catch((err: unknown) => setError(String(err)));
          }}
          onClose={() => setSearchOpen(false)}
          onOpen={(id) => {
            setSelectedId(id);
            setView("detail");
          }}
          onPromoteToDeck={(id) => {
            deckPinnedIds.current.add(id);
            setDeckIds((previous) => {
              const base = previous.length > 0 ? previous : buildDeckIds(pool, avoidTopKey);
              const withCard = base.includes(id) ? base : [id, ...base];
              return promoteDeckIds(withCard, id);
            });
            setView("deck");
            setSearchOpen(false);
          }}
        />
      ) : null}
      {helpOpen ? <HelpSheet onClose={() => setHelpOpen(false)} /> : null}
      {importPreview ? (
        <ImportRestoreSheet
          preview={importPreview}
          onClose={() => setImportPreview(null)}
          onConfirm={(strategy) => {
            confirmImport(strategy).catch((err: unknown) => setError(String(err)));
          }}
        />
      ) : null}
    </div>
  );
}

function Deck({
  cards,
  librarySize,
  unseenCount,
  showAiMark,
  soundEffectsEnabled,
  canUndo,
  onSwipe,
  onUndo,
  onOpen,
  launchRef,
  onExploreAgain,
}: {
  cards: KnowledgeCard[];
  librarySize: number;
  unseenCount: number;
  showAiMark: boolean;
  soundEffectsEnabled: boolean;
  canUndo: boolean;
  onSwipe: (direction: SwipeDirection) => void;
  onUndo: () => void;
  onOpen: (id: string) => void;
  launchRef?: MutableRefObject<((direction: SwipeDirection) => void) | null>;
  onExploreAgain: () => void;
}) {
  const top = cards[0] ?? null;
  const behind = cards.slice(1, 3);
  const SWIPE_THRESHOLD = 80;
  const HORIZONTAL_DOMINANCE = 1.2;
  const MIN_FLING_VELOCITY = 600;
  const MIN_FLING_DISTANCE = 28;
  const [drag, setDrag] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [snapBack, setSnapBack] = useState(false);
  const [fly, setFly] = useState<SwipeDirection | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const dragRef = useRef({ x: 0, y: 0 });
  const pointerTrack = useRef<{ x: number; t: number } | null>(null);
  const velocityX = useRef(0);
  const busy = useRef(false);
  const launch = useCallback((direction: SwipeDirection) => {
    if (!top || busy.current) return;
    busy.current = true;
    if (soundEffectsEnabled) playSwipeTone(direction);
    setFly(direction);
    window.setTimeout(() => {
      setFly(null);
      setDrag(0);
      setDragY(0);
      dragRef.current = { x: 0, y: 0 };
      busy.current = false;
      onSwipe(direction);
    }, direction === "skip" ? 180 : 160);
  }, [onSwipe, soundEffectsEnabled, top]);
  useEffect(() => {
    if (!launchRef) return;
    launchRef.current = launch;
    return () => { launchRef.current = null; };
  }, [launch, launchRef]);
  if (!top) {
    if (librarySize === 0) {
      return (
        <section className="empty">
          <h1>还没有第一批知识</h1>
          <p>从侧栏打开剪藏、笔记导入或 AI 出卡，第一批卡片会写入本机 store 目录。</p>
        </section>
      );
    }
    return (
      <section className="empty">
        <h1>{unseenCount === 0 ? "今天的知识刷完了" : "卡堆正在整理"}</h1>
        <p>{unseenCount === 0
          ? "换一批已读知识重新探索，或从侧栏剪藏、笔记、AI 出卡补充新卡。"
          : "稍等片刻，或切换到其他页面再回来。"}</p>
        {unseenCount === 0 ? (
          <div className="actions">
            <button type="button" className="primary" onClick={onExploreAgain}>重新探索全部卡片 ↻</button>
          </div>
        ) : null}
      </section>
    );
  }
  function begin(clientX: number, clientY: number) {
    if (fly) return;
    origin.current = { x: clientX, y: clientY };
    pointerTrack.current = { x: clientX, t: performance.now() };
    velocityX.current = 0;
    setSnapBack(false);
    setDragging(true);
    if (soundEffectsEnabled) playPaperSlide();
  }
  function move(clientX: number, clientY: number) {
    if (!dragging || fly) return;
    const now = performance.now();
    const track = pointerTrack.current;
    if (track && now > track.t) {
      velocityX.current = ((clientX - track.x) / (now - track.t)) * 1000;
    }
    pointerTrack.current = { x: clientX, t: now };
    const next = {
      x: clientX - origin.current.x,
      y: clientY - origin.current.y,
    };
    dragRef.current = next;
    setDrag(next.x);
    setDragY(next.y);
  }
  function finish() {
    if (!dragging || fly) return;
    setDragging(false);
    pointerTrack.current = null;
    const { x: distance, y: vertical } = dragRef.current;
    const horizontalDominant = Math.abs(distance) > Math.abs(vertical) * HORIZONTAL_DOMINANCE;
    const vx = velocityX.current;
    const fling = Math.abs(vx) > MIN_FLING_VELOCITY
      && Math.abs(vx) > Math.abs(vertical) * 1.35
      && Math.abs(distance) > MIN_FLING_DISTANCE
      && vx * distance > 0;
    const passed = Math.abs(distance) > SWIPE_THRESHOLD && horizontalDominant;
    if (passed || fling) {
      launch(distance > 0 ? "right" : "left");
      return;
    }
    setSnapBack(true);
    setDrag(0);
    setDragY(0);
    dragRef.current = { x: 0, y: 0 };
    window.setTimeout(() => setSnapBack(false), 220);
  }
  const horizontalDominant = Math.abs(drag) > Math.abs(dragY) * HORIZONTAL_DOMINANCE;
  const reveal = !fly && horizontalDominant ? Math.min(1, Math.abs(drag) / SWIPE_THRESHOLD) : 0;
  const x = fly === "right" ? 720 : fly === "left" ? -720 : drag;
  const y = fly ? 0 : dragY * 0.35;
  const rotate = Math.max(-14, Math.min(14, x / 10));
  const tiltY = fly ? 0 : Math.max(-6.5, Math.min(6.5, drag / 40));
  const motion = fly === "skip"
    ? { transform: "translate(420px, -120px) rotate(10deg)", opacity: 0 }
    : { transform: `translate(${x}px, ${y}px) rotate(${rotate}deg) rotateY(${tiltY}deg)` };
  function backMotion(depth: number): { transform: string } {
    const visualDepth = Math.max(0, depth - reveal);
    const scale = 1 - visualDepth * 0.028;
    const ty = visualDepth * 24;
    return { transform: `scale(${scale}) translateY(${ty}px)` };
  }
  return (
    <section className="deck">
      <div className="stack">
        {behind.slice().reverse().map((card, index) => {
          const depth = behind.length - index;
          const far = depth > 1;
          return (
            <CardSheet
              key={card.id}
              card={card}
              showAiMark={showAiMark}
              className={far ? "sheet back far" : "sheet back"}
              style={dragging || snapBack ? backMotion(depth) : undefined}
            />
          );
        })}
        <CardSheet
          card={top}
          showAiMark={showAiMark}
          className={`sheet top${dragging ? " dragging" : ""}${fly ? " fly" : ""}${snapBack ? " snap-back" : ""}`}
          style={motion}
          dragX={fly ? (fly === "right" ? 120 : fly === "left" ? -120 : 0) : drag}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            begin(event.clientX, event.clientY);
          }}
          onPointerMove={(event) => move(event.clientX, event.clientY)}
          onPointerUp={(event) => {
            const tap = Math.abs(dragRef.current.x) < 6 && Math.abs(dragRef.current.y) < 6;
            finish();
            if (tap) onOpen(top.id);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            finish();
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        />
      </div>
      <p className="remain">未看 {cards.length} 张 · ← 略过 · → 收藏 · ↓ 跳过 · ⌘Z 撤销 · 回车看详情</p>
      <div className="actions">
        <button type="button" className="dislike" onClick={() => launch("left")}>略过</button>
        <button type="button" onClick={() => launch("skip")}>跳过</button>
        <button type="button" onClick={onUndo} disabled={!canUndo}>撤销</button>
        <button type="button" onClick={() => onOpen(top.id)}>详情</button>
        <button type="button" className="like" onClick={() => launch("right")}>收藏</button>
      </div>
    </section>
  );
}

function Library({
  cards,
  filter,
  onFilter,
  onOpen,
}: {
  cards: KnowledgeCard[];
  filter: "all" | "favorites" | "history";
  onFilter: (filter: "all" | "favorites" | "history") => void;
  onOpen: (id: string) => void;
}) {
  const [historySwipe, setHistorySwipe] = useState<SwipeDirection | "all">("all");
  const favorites = cards.filter((card) => card.isFavorite);
  const historyBase = cards
    .filter((card) => card.seenAt !== null)
    .sort((a, b) => (b.seenAt ?? 0) - (a.seenAt ?? 0));
  const history = historySwipe === "all"
    ? historyBase
    : historyBase.filter((card) => card.swiped === historySwipe);
  const visible = filter === "favorites"
    ? favorites
    : filter === "history"
      ? history
      : cards;
  const titleCount = filter === "favorites" ? favorites.length : filter === "history" ? history.length : cards.length;

  return (
    <section className="library">
      <h1>卡库 · {titleCount} 张</h1>
      <div className="actions">
        <button type="button" className={filter === "all" ? "on" : ""} onClick={() => onFilter("all")}>全部</button>
        <button type="button" className={filter === "favorites" ? "on" : ""} onClick={() => onFilter("favorites")}>收藏</button>
        <button type="button" className={filter === "history" ? "on" : ""} onClick={() => onFilter("history")}>历史</button>
      </div>
      {filter === "history" ? (
        <div className="actions history-filters">
          <button type="button" className={historySwipe === "all" ? "on" : ""} onClick={() => setHistorySwipe("all")}>全部</button>
          <button type="button" className={historySwipe === "right" ? "on" : ""} onClick={() => setHistorySwipe("right")}>感兴趣</button>
          <button type="button" className={historySwipe === "left" ? "on" : ""} onClick={() => setHistorySwipe("left")}>不喜欢</button>
        </div>
      ) : null}
      <ul>
        {visible.map((card) => (
          <li key={card.id}>
            <button type="button" onClick={() => onOpen(card.id)}>
              <span className="stamp" style={{ ["--stamp" as string]: stampColor(card.category) }}>{card.category || "未分类"}</span>
              <strong>{card.headline || "无标题"}</strong>
              {filter === "favorites" && card.favoritedAt
                ? <em>♥ 收藏于 {new Date(card.favoritedAt).toLocaleString()}</em>
                : null}
              {filter === "history" && card.seenAt
                ? <em>{swipeDirectionLabel(card.swiped)} {new Date(card.seenAt).toLocaleString()}</em>
                : null}
              {filter === "all" && card.isFavorite ? <em>收藏</em> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detail({
  card,
  showAiMark,
  onBack,
  onToggleFavorite,
}: {
  card: KnowledgeCard;
  showAiMark: boolean;
  onBack: () => void;
  onToggleFavorite: () => void;
}) {
  const due = reviewDay(card);
  return (
    <section className="detail detail-photo">
      <div className="actions">
        <button type="button" onClick={onBack}>返回卡库</button>
        <button type="button" className={card.isFavorite ? "on" : ""} onClick={onToggleFavorite}>
          {card.isFavorite ? "取消收藏" : "收藏"}
        </button>
      </div>
      <CardSheet card={card} showAiMark={showAiMark} className="sheet detail-hero photo" />
      <div className="detail-body">
      <p className="hint detail-meta">
        {card.source === "ai" ? "AI 生成 · " : card.source === "imported" ? "导入 · " : ""}
        {card.reviewCount > 0 ? `已复习 ${card.reviewCount} 次 · 间隔 ${card.intervalDays} 天` : card.seenAt ? "已划过 · 尚未测验" : "未学习"}
        {due ? ` · 下次 ${due}` : ""}
      </p>
      {card.details.split("\n\n").filter(Boolean).map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {card.links.length > 0 ? (
        <ul>
          {card.links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                onClick={(event) => {
                  event.preventDefault();
                  openExternalUrl(link.url).catch((err: unknown) => console.error(err));
                }}
              >
                {link.title || link.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      </div>
    </section>
  );
}

function Settings({
  settings,
  apiKey,
  categories,
  onSave,
}: {
  settings: AiSettings;
  apiKey: string;
  categories: string[];
  onSave: (settings: AiSettings, apiKey: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [key, setKey] = useState(apiKey);
  const [probe, setProbe] = useState("");
  useEffect(() => {
    setDraft(settings);
    setKey(apiKey);
  }, [settings, apiKey]);
  return (
    <form
      className="settings"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft, key);
      }}
    >
      <h1>AI</h1>
      <p>接口和模型写在 settings.json。API 密钥保存在数据目录下 credentials/apiKey.credential（明文文件、仅本机用户可读），不会进 settings 或导出包。</p>
      <label>接口地址<input value={draft.baseURL} onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })} /></label>
      <label>模型<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
      <label>纸面
        <select value={draft.paperTheme} onChange={(event) => setDraft({ ...draft, paperTheme: event.target.value })}>
          <option value="SYSTEM">跟随系统</option>
          <option value="RICE_PAPER">宣纸白</option>
          <option value="PARCHMENT">羊皮纸</option>
          <option value="MORNING_MIST">晨雾灰</option>
          <option value="WARM_OBSIDIAN">暖曜黑</option>
        </select>
      </label>
      <label>API 密钥<input type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" /></label>
      <label className="check">
        <input type="checkbox" checked={draft.enableAI} onChange={(event) => setDraft({ ...draft, enableAI: event.target.checked })} />
        卡堆包含 AI 生成的卡
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.showAIMark} onChange={(event) => setDraft({ ...draft, showAIMark: event.target.checked })} />
        刷卡显示 AI 标记
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.soundEffectsEnabled} onChange={(event) => setDraft({ ...draft, soundEffectsEnabled: event.target.checked })} />
        划卡音效
      </label>
      <fieldset className="pref-cats">
        <legend>优先分类（卡堆里有这些分类时优先刷）</legend>
        {categories.length === 0 ? <p className="hint">卡库里还没有分类</p> : categories.map((category) => (
          <label key={category} className="check">
            <input
              type="checkbox"
              checked={draft.preferredCategories.includes(category)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...draft.preferredCategories, category]
                  : draft.preferredCategories.filter((item) => item !== category);
                setDraft({ ...draft, preferredCategories: next });
              }}
            />
            {category}
          </label>
        ))}
      </fieldset>
      <div className="actions">
        <button type="button" onClick={() => {
          setProbe("测试中…");
          probeConnection(draft, key).then(() => setProbe("连接成功")).catch((err: unknown) => setProbe(String(err)));
        }}>测试连接</button>
        {probe ? <span className="hint">{probe}</span> : null}
      </div>
      <button type="submit" className="primary">保存</button>
    </form>
  );
}

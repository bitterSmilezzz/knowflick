import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { setBridgeGeneration } from "./tauriCoreShim";
import { PreviewMailbox } from "./PreviewMailbox";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ChooseLibrary, ExportNoteMarkdown, ReadWebDAVCredential, WriteWebDAVCredential, DeleteNote, EnableEditing, ExportCardArchive, ExportCardsJSON, ExportSystemBackup, RestoreSystemBackup, UploadBackupToWebDAV, ListDeletedNotes, ListNotes, OpenInitialLibrary, RestoreNote, RestoreNoteRevision, SaveNote, SearchChunkHits, SearchNotes } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { LibraryView, ShortcutStatus } from "./bindings/knowflick.local/workbench-go/models";
import type { ChunkHit } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import type { Note, NoteRevision } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { DeleteSubscription, FetchSubscriptionPayload, ImportSubscriptionMaterials, ListMaterialSourceURLs, ListSubscriptions, MarkSubscriptionPolled, SaveSubscription } from "./bindings/knowflick.local/workbench-go/subscriptionservice";
import { isDue, itemsToMaterials, parseSubscriptionPayload } from "../src/domain/subscription";
import { makeMaterial } from "../src/ui/workspace/model";
import type { Subscription } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { SubscriptionsView } from "../src/ui/workspace/SubscriptionsView";
import { StatsView } from "../src/ui/workspace/StatsView";
import type { Subscription as SharedSubscription } from "../src/domain/subscription";
import { CapsuleWindow } from "../src/ui/workspace/CapsuleWindow";
import { MarkdownRenderer } from "../src/ui/workspace/MarkdownRenderer";
import { buildImportReport, serializeImportReport } from "../src/domain/importReport";
import { decodeCardList } from "../src/domain/card";
// 共享前端用 __TAURI_INTERNALS__ 判定是否运行在桌面壳；Wails 预览同为原生桌面。
if (!("__TAURI_INTERNALS__" in window)) {
  (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {};
}
import "../src/ui/workspace/workspace.css";
import "./preview.css";
import { NoteHistory } from "./NoteHistory";
import { ReviewDeck } from "./ReviewDeck";
import { CardLibrary } from "./CardLibrary";
import { MaterialLibrary } from "./MaterialLibrary";
import { ArtifactsView } from "../src/ui/workspace/ArtifactsView";
import { ProjectsView } from "../src/ui/workspace/ProjectsView";
import { GoalsView } from "../src/ui/workspace/GoalsView";
import { toSharedNote } from "./sharedAdapters";
import { ClaimLibrary } from "./ClaimLibrary";
import { McpGrantPanel } from "../src/ui/workspace/McpGrantPanel";
import { AsrPanel } from "./AsrPanel";
import { AskPanel } from "./AskPanel";
import { CaptureCapsuleMaterial, ExportArchive, ExportCardsJSONFile, GetShortcutStatus, HideCapsule, LoadStore, ReadImportArchiveFile, ReadTextFile, ReplaceCards, SaveAttachment, SaveImportReport } from "./bindings/knowflick.local/workbench-go/previewservice";
import { PreviewSettings } from "./PreviewSettings";
import { SettingsPanel } from "./SettingsPanel";
import { useAttachments } from "./attachments";
import { mediaMimeOfExtension, noteMediaPaths } from "../src/domain/mediaMime";
import { bytesToBase64 } from "../src/shell/base64";
import { insertAttachmentRef } from "../src/domain/noteAttachmentInsert";
import { NoteAttachmentPicker } from "./NoteAttachmentPicker";
import { KnowledgeBasePicker, NoteKnowledgeBases } from "./KnowledgeBases";
import { CreateKnowledgeBase, GetStats, ReadKnowledgeBases, SearchKnowledgeBaseChunks, SearchKnowledgeBaseNotes, SetKnowledgeBaseMembership } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { Stats } from "./bindings/knowflick.local/workbench-go/internal/stats/models";
import type { KnowledgeBaseSnapshot } from "./bindings/knowflick.local/workbench-go/internal/library/models";

function WailsCapsule() {
  const [shortcut, setShortcut] = useState<string>();

  useEffect(() => {
    let active = true;
    void GetShortcutStatus().then((status: ShortcutStatus) => {
      if (active) setShortcut(status.registered ? status.shortcut : "全局快捷键未注册");
    }, () => {
      if (active) setShortcut("快捷键状态不可用");
    });
    return () => { active = false; };
  }, []);

  return <CapsuleWindow saveCapture={CaptureCapsuleMaterial} hide={HideCapsule} shortcut={shortcut} />;
}

function Preview() {
  const [lib, setLib] = useState<LibraryView | null>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [busy, setBusy] = useState(true);
  const [savingAttachment, setSavingAttachment] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trash, setTrash] = useState(false);
  const [view, setView] = useState<"notes" | "materials" | "cards" | "artifacts" | "projects" | "goals" | "claims" | "review" | "mail">("notes");
  const [cardEditing, setCardEditing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [asrOpen, setAsrOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsRevision, setStatsRevision] = useState(0);
  // 共享目标页每次读取都会调用此回调；必须是稳定引用，否则其 effect 会反复触发。
  const handleGoalsChange = useCallback(() => {}, []);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentCursor = useRef<{ area: HTMLTextAreaElement; start: number; end: number } | null>(null);
  const [scope, setScope] = useState("");
  const [knowledge, setKnowledge] = useState<KnowledgeBaseSnapshot | null>(null);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [chunkMode, setChunkMode] = useState(false);
  const [hits, setHits] = useState<ChunkHit[]>([]);
  const [openedMaterialId, setOpenedMaterialId] = useState("");
  const [subsOpen, setSubsOpen] = useState(false);
  const [subs, setSubs] = useState<SharedSubscription[]>([]);

  const [importReportRevision, setImportReportRevision] = useState(0);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const autoPollLock = useRef(false);
  const [restorePending, setRestorePending] = useState(false);
  const [webdavURL, setWebdavURL] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavSecret, setWebdavSecret] = useState("");
  const [webdavRemember, setWebdavRemember] = useState(false);

  useEffect(() => {
    setBridgeGeneration(lib?.generation ?? 0);
    (window as unknown as { __kfGeneration?: number }).__kfGeneration = lib?.generation ?? 0;
    if (!lib) { setStats(null); return; }
    let active = true;
    void GetStats(lib.generation)
      .then((value: Stats) => { if (active) setStats(value); })
      .catch(() => { if (active) setStats(null); });
    return () => { active = false; };
  }, [lib, statsRevision]);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    // 后台邮箱同步写入库后由原生侧发事件；共享 Workspace 也监听同名 DOM 事件。
    // @ts-expect-error: Wails 构建时注入的虚拟模块
    void import("/wails/runtime.js").then(runtime => {
      if (disposed) return;
      off = runtime.Events?.On?.("knowflick:library-changed", () => {
        window.dispatchEvent(new CustomEvent("knowflick:library-changed"));
        setStatsRevision((value) => value + 1);
      });
    }).catch(() => {});
    return () => { disposed = true; off?.(); };
  }, []);
  const notes = lib?.page.notes ?? [];
  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const dirty = selected !== null && (draftTitle !== selected.title || draftBody !== selected.body);

  function adopt(result: LibraryView | null, keepId = false) {
    if (!result) return;
    setBridgeGeneration(result.generation);
    (window as unknown as { __kfGeneration?: number }).__kfGeneration = result.generation;
    setLib(result);
    setOpenedMaterialId("");
    if (!result.writable && view === "mail") setView("notes");
    setScope("");
    setKnowledge(null);
    setKnowledgeError("");
    setHits([]);
    const first = result.page.notes?.[0]?.id ?? "";
    const nextId = keepId && result.page.notes?.some((n) => n.id === selectedId) ? selectedId : first;
    const note = result.page.notes?.find((n: Note) => n.id === nextId) ?? null;
    setSelectedId(note?.id ?? "");
    setDraftTitle(note?.title ?? "");
    setDraftBody(note?.body ?? "");
    // 订阅源在打开库时就加载：自动轮询不依赖用户先展开面板。
    if (result.writable) {
      void ListSubscriptions().then((rows: Subscription[] | null) => setSubs((rows ?? []) as unknown as SharedSubscription[])).catch((cause: unknown) => console.warn("读取订阅源失败", cause));
    }
  }

  function fail(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
    setNotice("");
  }

  useEffect(() => {
    void OpenInitialLibrary().then((r: LibraryView | null) => adopt(r)).catch(fail).finally(() => setBusy(false));
  }, []);

  const generation = lib?.generation;
  useEffect(() => {
    if (generation === undefined) return;
    let current = true;
    setKnowledge(null);
    setKnowledgeError("");
    void (async () => {
      try {
        const snapshot = await ReadKnowledgeBases(generation);
        if (current) setKnowledge(snapshot);
      } catch (cause) {
        if (current) setKnowledgeError("读取知识库失败：" + String(cause));
      }
    })();
    return () => { current = false; };
  }, [generation]);

  async function readNotes(generation: number, term: string, scopeID: string) {
    if (scopeID) return await SearchKnowledgeBaseNotes(generation, scopeID, term);
    return term ? await SearchNotes(generation, term) : await ListNotes(generation, 0);
  }

  async function reload(generation: number, term = submitted, trashMode = trash, scopeID = scope) {
    const page = trashMode ? await ListDeletedNotes(generation, 0) : await readNotes(generation, term, scopeID);
    setLib((prev) => prev?.generation === generation ? { ...prev, page } : prev);
    return page;
  }

  function selectNote(note: Note | null) {
    setSelectedId(note?.id ?? "");
    setDraftTitle(note?.title ?? "");
    setDraftBody(note?.body ?? "");
  }

  async function changeScope(id: string) {
    if (!lib || busy || dirty || id === scope) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const page = await reload(lib.generation, submitted, false, id);
      setScope(id);
      setHits([]);
      selectNote(page.notes?.find((note: Note) => note.id === selectedId) ?? page.notes?.[0] ?? null);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function createKnowledgeBase(name: string, description: string) {
    if (!lib?.writable || busy) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      await CreateKnowledgeBase(lib.generation, crypto.randomUUID(), name, description);
    } catch (cause) {
      fail(cause);
      setBusy(false);
      return false;
    }
    try {
      setKnowledge(await ReadKnowledgeBases(lib.generation));
      setKnowledgeError("");
      setNotice("已创建知识库「" + name.trim() + "」");
    } catch (cause) {
      setKnowledgeError("知识库已创建，刷新列表失败：" + String(cause));
    } finally { setBusy(false); }
    return true;
  }

  async function changeMembership(id: string, member: boolean) {
    if (!lib?.writable || !selected || selected.deleted || busy || dirty) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await SetKnowledgeBaseMembership(lib.generation, id, selected.id, member);
      setKnowledge(await ReadKnowledgeBases(lib.generation));
      setKnowledgeError("");
      if (id === scope && !member) {
        setHits([]);
        const page = await reload(lib.generation);
        selectNote(page.notes?.[0] ?? null);
      }
      setNotice(member ? "已加入知识库" : "已移出知识库");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function choose() {
    setBusy(true); setError(""); setNotice("");
    try { adopt(await ChooseLibrary()); setQuery(""); setSubmitted(""); setTrash(false); }
    catch (fail) {} finally { setBusy(false); }
  }

  async function exportCards(format: "json" | "zip") {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const path = await (format === "zip" ? ExportCardArchive : ExportCardsJSON)(lib.generation);
      if (path) setNotice((format === "zip" ? "已导出卡片与设置到 " : "已导出卡片到 ") + path);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function exportSystemBackup() {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const path = await ExportSystemBackup(lib.generation);
      if (path) setNotice("已导出基础备份到 " + path + "。此备份不含项目、邮箱等新增数据。");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function writeImportReport(ok: string[], failed: Array<{ name: string; reason: string }>) {
    if (!lib) return;
    const report = serializeImportReport(buildImportReport({ ok, skipped: [], failed }));
    try {
      await SaveImportReport(lib.generation, report);
      setImportReportRevision((value) => value + 1);
    } catch (cause) {
      console.warn("导入报告未能落盘:", cause);
    }
  }

  async function importTextNote() {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    let path = "";
    try {
      path = prompt("要导入的文本文件路径：", "notes.txt") ?? "";
      if (!path) return;
      const text = String(await ReadTextFile(path));
      const title = path.split("/").pop()?.replace(/\.(txt|md|markdown)$/i, "") || "导入笔记";
      const now = Date.now();
      const outcome = await SaveNote(lib.generation, { id: "", title, body: text, notebook: null, tagsJson: "[]", pinned: false, favorite: false, archivedAt: null, sourceMaterialId: null, revision: 1, createdAt: now, updatedAt: now, deleted: false, deletedAt: null, excludeFromProfile: false }, 0);
      await writeImportReport([title], []);
      setNotice("已导入「" + title + "」（修订 " + outcome.revision + "）");
      await reload(lib.generation);
    } catch (cause) {
      if (path) await writeImportReport([], [{ name: path, reason: String(cause) }]);
      fail(cause);
    } finally { setBusy(false); }
  }

  async function importLegacyArchive() {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = await ReadImportArchiveFile("cards.json");
      if (!payload.cards.trim()) throw new Error("归档中没有可用的卡片数据");
      const cards = decodeCardList(payload.cards);
      if (cards.length === 0) throw new Error("归档中没有可用的卡片数据");
      await SaveCardsJSONIfNeeded(payload.cards);
      const replacePayload = cards.map((card) => ({ ...card, materialId: card.materialId ?? null, tags: card.tags ?? null, orderKey: card.orderKey ?? null, prereq: card.prereq ?? [] }));
      await ReplaceCards(lib.generation, replacePayload);
      await writeImportReport(["cards.json（" + cards.length + " 张卡片）"], []);
      setNotice("旧归档已导入 " + cards.length + " 张卡片（cards.json 三代轮转），卡片库已按归档重建");
      await reload(lib.generation);
    } catch (cause) {
      await writeImportReport([], [{ name: "cards.json", reason: String(cause) }]);
      fail(cause);
    } finally { setBusy(false); }
  }

  async function SaveCardsJSONIfNeeded(text: string) {
    if (!lib) throw new Error("请先打开资料库");
    const { SaveCardsJSON } = await import("./bindings/knowflick.local/workbench-go/previewservice");
    await SaveCardsJSON(lib.generation, text);
  }

  async function exportLegacyArchive() {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const snapshot = await LoadStore(lib.generation);
      setNotice("旧 JSON 存储快照：cards " + (snapshot.cards ? "有" : "无") + "、备份 " + (snapshot.backup ? "一代" : "无") + "、设置 " + (snapshot.settings ? "有" : "无"));
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function exportArchiveToPath() {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const dest = prompt("导出归档到哪个路径？", "knowflick-backup.kfstore");
      if (!dest) return;
      await ExportArchive(lib.generation, dest);
      setNotice("归档已导出到 " + dest);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function exportCardsToPath() {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const dest = prompt("导出卡片 JSON 到哪个路径？", "cards.json");
      if (!dest) return;
      await ExportCardsJSONFile(lib.generation, dest);
      setNotice("卡片已导出到 " + dest);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  // 自动轮询：每分钟看一次，只抓一个到期订阅；失败只记提示，不打断手上的事。
  useEffect(() => {
    if (!lib?.writable) return;
    let disposed = false;
    const tick = async () => {
      if (disposed || autoPollLock.current || busy) return;
      const due = subs.filter((sub) => isDue(sub as unknown as Parameters<typeof isDue>[0]));
      if (due.length === 0) return;
      autoPollLock.current = true;
      try { await pollSubscription(due[0]); }
      catch (cause) { setNotice(`「${due[0].title}」自动抓取失败：${cause instanceof Error ? cause.message : String(cause)}`); }
      finally { autoPollLock.current = false; }
    };
    const timer = window.setInterval(() => void tick(), 60_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [lib, subs, busy]);
  async function toggleSubscriptions() {
    const next = !subsOpen;
    setSubsOpen(next);
    if (!next) return;
    setBusy(true); setError(""); setNotice("");
    try { setSubs((await ListSubscriptions() ?? []) as unknown as SharedSubscription[]); } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function pollSubscription(sub: SharedSubscription) {
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = await FetchSubscriptionPayload(sub.id);
      const domainSub = sub as unknown as Parameters<typeof parseSubscriptionPayload>[0] & Parameters<typeof itemsToMaterials>[2];
      const items = parseSubscriptionPayload(domainSub, payload);
      if (items.length === 0) throw new Error("这次没有解析出条目，检查订阅地址是否为有效的 feed / GitHub 仓库");
      const existing = await ListMaterialSourceURLs() ?? [];
      const { materials, skipped } = itemsToMaterials(items, existing, domainSub);
      const added = await ImportSubscriptionMaterials(materials.map((entry) => {
        const base = makeMaterial({ title: entry.title, text: entry.text, url: entry.url });
        return { id: base.id, sourceType: base.sourceType, title: base.title, sourceUrl: base.sourceUrl ?? "", rawText: base.rawText, metadataJson: entry.metadataJson, inboxStatus: base.inboxStatus, createdAt: base.createdAt, updatedAt: base.updatedAt };
      }));
      await MarkSubscriptionPolled(sub.id, Date.now());
      setSubs((await ListSubscriptions() ?? []) as unknown as SharedSubscription[]);
      setNotice(`「${sub.title}」抓取完成：新增 ${added} 条素材` + (skipped > 0 ? `，${skipped} 条已存在或无链接` : ""));
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function addSubscription(sub: SharedSubscription) {
    setBusy(true); setError(""); setNotice("");
    try {
      await SaveSubscription(sub as unknown as Subscription);
      setSubs((await ListSubscriptions() ?? []) as unknown as SharedSubscription[]);
      setNotice("订阅源已保存。");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function toggleSubscription(sub: SharedSubscription, active: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      await SaveSubscription({ ...sub, isActive: active } as unknown as Subscription);
      setSubs((await ListSubscriptions() ?? []) as unknown as SharedSubscription[]);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function removeSubscription(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await DeleteSubscription(id);
      setSubs((await ListSubscriptions() ?? []) as unknown as SharedSubscription[]);
      setNotice("订阅源已删除；抓来的素材保留。");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (view !== "notes" || settingsOpen || maintenanceOpen || subsOpen || mcpOpen || askOpen || asrOpen) setStatsOpen(false);
  }, [view, settingsOpen, maintenanceOpen, subsOpen, mcpOpen, askOpen, asrOpen]);

  useEffect(() => {
    if (!lib) return;
    let active = true;
    void ReadWebDAVCredential(lib.generation)
      .then((value: string) => {
        if (!active || !value) return;
        setWebdavSecret(value);
        setWebdavRemember(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [lib?.generation]);

  async function uploadToWebdav() {
    if (!lib || busy || !webdavURL.trim()) { fail(new Error("请填写 WebDAV 地址")); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await UploadBackupToWebDAV(lib.generation, webdavURL.trim(), webdavUser.trim(), webdavSecret, webdavRemember);
      if (webdavRemember) await WriteWebDAVCredential(lib.generation, webdavSecret);
      setNotice(`已上传 ${result.fileName}（${result.bytes} 字节，SHA-256 ${result.sha256}）。这是单向复制，不会删除云端旧对象。`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function restoreBackup() {
    if (!lib || !lib.writable || busy) return;
    setRestorePending(false);
    setBusy(true); setError(""); setNotice("");
    const counts = await RestoreSystemBackup(lib.generation).catch((cause: unknown) => { fail(cause); return null; });
    if (counts) {
      setNotice(`已恢复：素材 ${counts.materials}、卡片 ${counts.cards}、产物 ${counts.artifacts}、笔记 ${counts.notes}、知识库 ${counts.knowledgeBases}、附件 ${counts.media}、订阅 ${counts.subscriptions}、复习事件 ${counts.reviewEvents}、回收站 ${counts.deletedMaterials + counts.deletedCards + counts.deletedArtifacts}、邮箱记录 ${counts.mailAccounts + counts.mailImports}、项目与画像 ${counts.r4Rows}；跳过 ${counts.skipped} 条。`);
      try {
        setKnowledge(await ReadKnowledgeBases(lib.generation));
        setKnowledgeError("");
      } catch (cause) {
        setKnowledgeError("刷新知识库失败：" + String(cause));
      }
    }
    setBusy(false);
  }
  async function enableEditing() {
    if (!lib) return;
    setBusy(true); setError(""); setNotice("");
    try { adopt(await EnableEditing(), true); setNotice("已启用编辑：保存会写进这个资料库文件"); }
    catch (fail) {} finally { setBusy(false); }
  }


  async function toggleTrash() {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = !trash;
      const page = await reload(lib.generation, submitted, next);
      setTrash(next);
      setHits([]);
      selectNote(page.notes?.[0] ?? null);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function createNote() {
    if (!lib || !lib.writable || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const note: Note = { id: crypto.randomUUID(), title: "无标题笔记", body: "", notebook: null, tagsJson: "[]", pinned: false, favorite: false, archivedAt: null, sourceMaterialId: null, revision: 0, createdAt: 0, updatedAt: 0, deleted: false, deletedAt: null, excludeFromProfile: false };
      await SaveNote(lib.generation, note, 0);
      setQuery(""); setSubmitted("");
      const page = await reload(lib.generation, "", false, "");
      setScope("");
      setTrash(false);
      setHits([]);
      selectNote(page.notes?.find((item: Note) => item.id === note.id) ?? null);
      setNotice("已新建笔记");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function restoreNote(id: string) {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const ok = await RestoreNote(lib.generation, id);
      await reload(lib.generation, "", false, "");
      setScope("");
      setQuery("");
      setSubmitted("");
      setTrash(false);
      setNotice(ok ? "已恢复到笔记列表" : "这篇不在回收站里");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!lib || busy || trash || dirty) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const term = query.trim();
      if (chunkMode && term) {
        const found = scope ? await SearchKnowledgeBaseChunks(lib.generation, scope, term, 20) : await SearchChunkHits(lib.generation, term, 20);
        setHits(found ?? []);
        setNotice("分块命中 " + (found?.length ?? 0) + " 处，偏移可回原文");
        return;
      }
      setHits([]);
      const page = await reload(lib.generation, term, false);
      setSubmitted(term);
      selectNote(page.notes?.[0] ?? null);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  useLayoutEffect(() => {
    const cursor = attachmentCursor.current;
    if (!cursor || busy) return;
    attachmentCursor.current = null;
    if (bodyRef.current !== cursor.area) return;
    cursor.area.focus();
    cursor.area.setSelectionRange(cursor.start, cursor.end);
  }, [busy, draftBody]);

  /** 把附件引用插到光标处，并把光标放到引用之后。 */
  function insertReference(path: string, label: string) {
    const area = bodyRef.current;
    if (!area) return;
    const next = insertAttachmentRef({ text: area.value, start: area.selectionStart, end: area.selectionEnd }, path, label);
    if (next.text === area.value && !area.disabled) {
      area.focus();
      area.setSelectionRange(next.start, next.end);
      return;
    }
    attachmentCursor.current = { area, start: next.start, end: next.end };
    setDraftBody(next.text);
  }

  async function addNoteAttachment(file: File) {
    const area = bodyRef.current;
    if (!lib?.writable || !selected || selected.deleted || busy || !area) return;
    setBusy(true);
    setSavingAttachment(true);
    setError("");
    setNotice("");
    try {
      const extension = file.name.slice(file.name.lastIndexOf(".") + 1);
      const mime = mediaMimeOfExtension(extension) ?? file.type;
      const kind = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : null;
      if (!kind) throw new Error("请选择图片或音频文件");
      const maxMiB = kind === "image" ? 16 : 64;
      if (file.size === 0 || file.size > maxMiB * 1024 * 1024) {
        throw new Error("附件须大于 0 字节且不超过 " + maxMiB + " MiB");
      }
      const encoded = await bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      if (bodyRef.current !== area) return;
      const attachmentPath = await SaveAttachment(lib.generation, kind, mime, encoded);
      if (bodyRef.current === area) insertReference(attachmentPath, file.name);
    } catch (cause) {
      fail(cause);
    } finally {
      setSavingAttachment(false);
      setBusy(false);
    }
  }

  async function exportMarkdown() {
    if (!lib || !selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const path = await ExportNoteMarkdown(lib.generation, selected.id);
      if (path) setNotice("已导出：" + path);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function save() {
    if (!lib || !selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const note: Note = { ...selected, title: draftTitle, body: draftBody };
      const outcome = await SaveNote(lib.generation, note, selected.revision);
      await reload(lib.generation);
      setNotice(outcome.created ? "已新建" : "已保存（修订 " + outcome.revision + "）");
    } catch (cause) {
      try { await reload(lib.generation); } catch {}
      fail(cause);
    } finally { setBusy(false); }
  }

  async function restoreHistory(revision: NoteRevision) {
    if (!lib?.writable || !selected || selected.id !== revision.noteId || busy || dirty) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const outcome = await RestoreNoteRevision(lib.generation, selected.id, revision.revision, selected.revision);
      const restored = { ...selected, title: revision.title, body: revision.bodyMd, revision: outcome.revision };
      setLib((prev) => prev && prev.generation === lib.generation ? {
        ...prev,
        page: { ...prev.page, notes: prev.page.notes?.map((note) => note.id === restored.id ? restored : note) ?? [] },
      } : prev);
      setDraftTitle(restored.title);
      setDraftBody(restored.body);
      setNotice(outcome.revision === selected.revision ? "当前内容已与所选版本相同" : "已恢复到第 " + revision.revision + " 版，当前修订为第 " + outcome.revision + " 版");
      try {
        await reload(lib.generation);
      } catch (cause) {
        setError("刷新笔记列表失败：" + String(cause));
      }
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!lib || !selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const gone = await DeleteNote(lib.generation, selected.id);
      await reload(lib.generation);
      setNotice(gone ? "已移进回收站" : "这篇已经在回收站里了");
      setSelectedId(""); setDraftTitle(""); setDraftBody("");
    } catch (fail) {} finally { setBusy(false); }
  }

  return (
    <main className="preview-app" aria-busy={busy}>
      <header className="preview-header">
        <div>
          <h1>KnowFlick <small>Go 版预览</small></h1>
          <p>{lib ? lib.name : "未打开资料库"}{lib && !lib.writable ? "（只读）" : ""}</p>
        </div>
        <div className="preview-actions">
          {lib && !lib.writable && <button type="button" disabled={busy} onClick={() => void enableEditing()}>启用编辑</button>}
          {lib && lib.writable && view === "notes" && <button type="button" disabled={busy} onClick={() => void createNote()}>新建笔记</button>}
          {lib && <div className="preview-more-menu">
            <button type="button" aria-expanded={moreOpen} aria-label="更多功能" onClick={() => setMoreOpen(!moreOpen)}>更多</button>
            {moreOpen && <div className="preview-more-panel">
              <div className="preview-more-group">
                <strong>工作台</strong>
                <button type="button" aria-pressed={view === "materials"} disabled={busy || cardEditing} onClick={() => { setOpenedMaterialId(""); setView(view === "materials" ? "notes" : "materials"); setMoreOpen(false); }}>素材</button>
                <button type="button" disabled={busy} onClick={() => void importLegacyArchive()}>导入旧归档</button>
                <button type="button" disabled={busy} onClick={() => void importTextNote()}>导入文本笔记</button>
                <button type="button" disabled={busy} onClick={() => void exportLegacyArchive()}>查看旧 JSON 快照</button>
                <button type="button" disabled={busy} onClick={() => void exportArchiveToPath()}>导出归档</button>
                <button type="button" disabled={busy} onClick={() => void exportCardsToPath()}>导出卡片 JSON</button>
                <button type="button" aria-pressed={view === "cards"} disabled={busy || cardEditing} onClick={() => { setView(view === "cards" ? "notes" : "cards"); setMoreOpen(false); }}>卡片库</button>
                <button type="button" aria-pressed={view === "artifacts"} disabled={busy || cardEditing} onClick={() => { setView(view === "artifacts" ? "notes" : "artifacts"); setMoreOpen(false); }}>产物</button>
                <button type="button" aria-pressed={view === "projects"} disabled={busy || cardEditing} onClick={() => { setView(view === "projects" ? "notes" : "projects"); setMoreOpen(false); }}>项目</button>
                <button type="button" aria-pressed={view === "goals"} disabled={busy || cardEditing} onClick={() => { setView(view === "goals" ? "notes" : "goals"); setMoreOpen(false); }}>目标</button>
                <button type="button" aria-pressed={view === "claims"} disabled={busy || cardEditing} onClick={() => { setView(view === "claims" ? "notes" : "claims"); setMoreOpen(false); }}>画像</button>
                <button type="button" aria-pressed={view === "review"} disabled={busy || cardEditing} onClick={() => { setView(view === "review" ? "notes" : "review"); setMoreOpen(false); }}>卡片复习</button>
                <button type="button" aria-pressed={askOpen} disabled={busy} onClick={() => { setAskOpen(!askOpen); setMoreOpen(false); }}>知识问答</button>
                <button type="button" disabled={busy || view !== "notes"} onClick={() => { void toggleTrash(); setMoreOpen(false); }}>{trash ? "返回笔记" : "回收站"}</button>
                {view !== "notes" && <button type="button" disabled={busy} onClick={() => { setView("notes"); setMoreOpen(false); }}>返回笔记</button>}
              </div>
              <div className="preview-more-group">
                <strong>接入与备份</strong>
                <button type="button" aria-pressed={subsOpen} disabled={busy} onClick={() => { void toggleSubscriptions(); setMoreOpen(false); }}>订阅源</button>
                {lib.writable && <button type="button" aria-pressed={view === "mail"} disabled={busy || cardEditing} onClick={() => { setView(view === "mail" ? "notes" : "mail"); setMoreOpen(false); }}>邮箱</button>}
                <button type="button" aria-pressed={mcpOpen} disabled={busy} onClick={() => { setMcpOpen(!mcpOpen); setMoreOpen(false); }}>外部授权</button>
                <button type="button" aria-pressed={asrOpen} disabled={busy} onClick={() => { setAsrOpen(!asrOpen); setMoreOpen(false); }}>语音转写</button>
                <button type="button" aria-pressed={settingsOpen} disabled={busy} onClick={() => { setSettingsOpen(!settingsOpen); setMaintenanceOpen(false); setMoreOpen(false); }}>设置与本地文件</button>
                <button type="button" aria-pressed={maintenanceOpen} disabled={busy} onClick={() => { setMaintenanceOpen(!maintenanceOpen); setSettingsOpen(false); setMoreOpen(false); }}>向量与维护</button>
                <button type="button" aria-pressed={statsOpen} disabled={busy} onClick={() => { setStatsOpen(!statsOpen); setMoreOpen(false); }}>统计</button>
                <button type="button" disabled={busy} onClick={() => { void exportCards("json"); setMoreOpen(false); }}>导出卡片</button>
                <button type="button" disabled={busy} onClick={() => { void exportCards("zip"); setMoreOpen(false); }}>导出卡片与设置（ZIP）</button>
                <button type="button" disabled={busy} onClick={() => { void exportSystemBackup(); setMoreOpen(false); }}>导出基础备份</button>
                {lib.writable && !restorePending && <button type="button" disabled={busy} onClick={() => { setRestorePending(true); setMoreOpen(false); }}>恢复备份</button>}
              </div>
            </div>}
          </div>}
          <button type="button" disabled={busy || cardEditing} onClick={() => void choose()}>打开资料库</button>
        </div>
      </header>
      {lib && stats && <p className="preview-stats" role="status">
        卡片 {stats.totalCards} 张 · 素材 {stats.totalMaterials} 条（待处理 {stats.inboxMaterials}） · 收藏 {stats.favoriteCards} · 已学 {stats.seenCards} · 待复习 {stats.dueCards}
      </p>}
      {error && <p className="preview-error" role="alert">{error}</p>}
      {notice && <p className="preview-notice" role="status">{notice}</p>}
      {lib && <section className="preview-confirm" aria-label="云端备份">
        <p>云端备份是单向复制：只上传新对象，不删除云端旧对象。</p>
        <label>WebDAV 地址 <input value={webdavURL} onChange={(event) => setWebdavURL(event.target.value)} placeholder="https://example.com/dav" /></label>
        <label>用户名 <input value={webdavUser} onChange={(event) => setWebdavUser(event.target.value)} /></label>
        <label>应用密码 <input type="password" value={webdavSecret} onChange={(event) => setWebdavSecret(event.target.value)} /></label>
        <label><input type="checkbox" checked={webdavRemember} onChange={(event) => setWebdavRemember(event.target.checked)} /> 记住密码（写入库目录凭据文件）</label>
        <button type="button" disabled={busy} onClick={() => void uploadToWebdav()}>上传备份到 WebDAV</button>
      </section>}
      {restorePending && <section className="preview-confirm" aria-label="确认恢复">
        <p>恢复会把备份里的素材、卡片、笔记、知识库、历史与邮箱记录合并进当前库。同标识但内容不同的记录会被拒绝，且不会覆盖现有内容。</p>
        <button type="button" disabled={busy} onClick={() => void restoreBackup()}>确认恢复</button>
        <button type="button" disabled={busy} onClick={() => setRestorePending(false)}>取消</button>
      </section>}


      {settingsOpen && lib && <PreviewSettings key={"PreviewSettings:" + lib.generation} generation={lib.generation} onBack={() => setSettingsOpen(false)} onReload={async () => { const next = await OpenInitialLibrary(); adopt(next ?? null, true); }} />}
      {maintenanceOpen && lib && <SettingsPanel key={"SettingsPanel:" + lib.generation} generation={lib.generation} writable={lib.writable} busy={busy} onBusy={setBusy} reportRevision={importReportRevision} />}
      {askOpen && <AskPanel key={"AskPanel:" + (lib?.generation ?? 0)} generation={lib?.generation ?? 0} busy={busy} onBusy={setBusy} onOpenNote={(id) => { setSelectedId(id); setView("notes"); setAskOpen(false); }} />}
      {asrOpen && <AsrPanel key={"AsrPanel:" + (lib?.generation ?? 0)} generation={lib?.generation ?? null} writable={lib?.writable ?? false} busy={busy} onBusy={setBusy} />}
      {mcpOpen && lib && <McpGrantPanel dir={lib.path} enabled={lib.writable} />}
      {subsOpen && <section className="preview-mail" aria-label="订阅源页">
        <button type="button" className="ws-bordered" onClick={() => setSubsOpen(false)}>返回</button>
        <SubscriptionsView subscriptions={subs as unknown as SharedSubscription[]} busy={busy} available={Boolean(lib?.writable)} onAdd={addSubscription} onToggle={toggleSubscription} onDelete={async (sub) => { await removeSubscription(sub.id); }} onPoll={pollSubscription} />
      </section>}
      {lib?.writable && <PreviewMailbox key={lib.generation}
        dir={lib.path} generation={lib.generation} open={view === "mail"} settingsOpen={settingsOpen}
        onOpenMaterial={(id) => { setOpenedMaterialId(id); setView("materials"); }}
        onSettings={() => setSettingsOpen(true)}
        onChanged={() => setStatsRevision((value) => value + 1)}
      />}

      {lib && view === "review" && <ReviewDeck key={"ReviewDeck:" + lib.generation} generation={lib.generation} writable={lib.writable} onSaving={setBusy} />}
      {lib && view === "materials" && <MaterialLibrary key={"MaterialLibrary:" + lib.generation + ":" + openedMaterialId} initialMaterialId={openedMaterialId} onOpenMaterial={setOpenedMaterialId} generation={lib.generation} writable={lib.writable} busy={busy} onBusy={setBusy} onChanged={() => setStatsRevision((value) => value + 1)} />}
      {lib && view === "claims" && <ClaimLibrary key={"ClaimLibrary:" + lib.generation} generation={lib.generation} writable={lib.writable} busy={busy} onBusy={setBusy} />}
      {lib && view === "goals" && <GoalsView
        dir={lib.path}
        materials={[]}
        notes={(lib.page.notes ?? []).map(toSharedNote)}
        onGoalsChange={handleGoalsChange}
      />}
      {lib && view === "projects" && <ProjectsView
        dir={lib.path}
        notes={(lib.page.notes ?? []).map((item) => ({ id: item.id, title: item.title }))}
      />}
      {lib && view === "artifacts" && <ArtifactsView
        dir={lib.path}
        cards={[]}
        notes={(lib.page.notes ?? []).map((item) => ({ id: item.id, title: item.title }))}
        onOpenNote={(id) => { setSelectedId(id); setView("notes"); }}
        onOpenCard={() => setNotice("卡片详情请到卡片库查看")}
        onBack={() => setView("notes")}
      />}
      {lib && view === "cards" && <CardLibrary key={"CardLibrary:" + lib.generation} generation={lib.generation} writable={lib.writable} busy={busy} onBusy={setBusy} onEditing={setCardEditing} />}
      {statsOpen && <StatsView stats={stats} onBack={() => setStatsOpen(false)} />}
      {lib && <div className="preview-workspace" hidden={view !== "notes" || statsOpen}>
        <section className="preview-list" aria-label="笔记列表">
          {!trash && <KnowledgeBasePicker key={lib.generation} snapshot={knowledge} error={knowledgeError} scope={scope} busy={busy} dirty={dirty} writable={lib.writable} onScope={changeScope} onCreate={createKnowledgeBase} />}
          {!trash && <form onSubmit={(e) => void search(e)} role="search">
            <input type="search" aria-label="搜索笔记" placeholder={chunkMode ? "搜索分块（可回原文偏移）" : "搜索标题或正文"} value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" aria-pressed={chunkMode} onClick={() => { setChunkMode(!chunkMode); setHits([]); }}>{chunkMode ? "按整篇" : "按分块"}</button>
            <button disabled={busy || dirty}>搜索</button>
          </form>}
          {!trash && scope && !submitted && notes.length === 0 && <p className="preview-meta">这个知识库还没有笔记。</p>}

          {hits.length > 0 && <section className="preview-hits" aria-label="分块命中">
            <p className="preview-count" role="status">分块命中 {hits.length} 处</p>
            <ul>
              {hits.map((hit, i) => <li key={hit.noteId + "-" + hit.chunkIndex + "-" + i}>
                <strong>{hit.noteTitle}</strong>
                <span className="preview-meta">字符 {hit.charStart}–{hit.charEnd} · 块 {hit.chunkIndex}</span>
                <p>{hit.content}</p>
                <button type="button" disabled={busy || dirty} onClick={() => void (async () => {
                  const page = await readNotes(lib.generation, hit.noteTitle, scope);
                  setLib({ ...lib!, page });
                  const found = page.notes?.find((n: Note) => n.id === hit.noteId);
                  if (found) { setSelectedId(found.id); setDraftTitle(found.title); setDraftBody(found.body); }
                })()}>打开原文</button>
              </li>)}
            </ul>
          </section>}
          <p className="preview-count" role="status">{submitted ? "找到 " : "已显示 "}{notes.length} 篇</p>
          <ul>
            {notes.map((note) => <li key={note.id}>
              <div className="preview-note-row">
                <button type="button" disabled={busy} aria-current={note.id === selectedId ? "true" : undefined} onClick={() => { setSelectedId(note.id); setDraftTitle(note.title); setDraftBody(note.body); }}>
                  <strong>{note.title || "无标题笔记"}</strong>
                  {(note.notebook || note.pinned || note.archivedAt != null) && <small>{[note.pinned ? "置顶" : "", note.notebook, note.archivedAt != null ? "已归档" : ""].filter(Boolean).join(" · ")}</small>}
                </button>
                {trash && <button type="button" className="preview-restore" disabled={busy} onClick={() => void restoreNote(note.id)}>恢复</button>}
              </div>
            </li>)}
          </ul>
        </section>

        <section className="preview-note" aria-label="笔记正文">
          {selected ? <div className="preview-editor">
            {lib.writable ? <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label htmlFor="note-title">标题</label>
              <input id="note-title" disabled={busy} value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
              <label htmlFor="note-body">正文（Markdown）</label>
              <textarea key={lib.generation + ":" + selected.id} id="note-body" ref={bodyRef} disabled={busy} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={14} />
              {view === "notes" && !selected.deleted && <NoteAttachmentPicker key={lib.generation} generation={lib.generation} busy={busy} onAddFile={(file) => void addNoteAttachment(file)} onInsert={insertReference} />}
              {savingAttachment && <p className="preview-meta" role="status">正在保存附件…</p>}
              <div className="preview-actions">
                <button type="submit" disabled={busy || !dirty}>保存</button>
                <button type="button" disabled={busy} onClick={() => void exportMarkdown()}>导出 Markdown</button>
                <button type="button" disabled={busy} onClick={() => void remove()}>移进回收站</button>
                <span className="preview-meta">{dirty ? "有未保存改动" : "已保存 · 修订 " + selected.revision}</span>
              </div>
            </form> : <div>
              <h2>{selected.title || "无标题笔记"}</h2>
              <p className="preview-meta">修订 {selected.revision} · {new Date(selected.updatedAt).toLocaleString("zh-CN")} · 只读模式</p>
              {view === "notes" && <PreviewNoteBody generation={lib.generation} text={selected.body} />}
            </div>}
            {lib.writable && view === "notes" && <DraftNotePreview key={selected.id} generation={lib.generation} text={draftBody} />}
            {knowledge && <NoteKnowledgeBases
              key={"membership:" + lib.generation + ":" + selected.id}
              snapshot={knowledge}
              noteID={selected.id}
              busy={busy || dirty}
              writable={lib.writable && !selected.deleted}
              onChange={changeMembership}
            />}
            <NoteHistory
              key={"history:" + lib.generation + ":" + selected.id}
              generation={lib.generation}
              note={selected}
              writable={lib.writable}
              dirty={dirty}
              busy={busy}
              onRestore={restoreHistory}
            />
          </div> : <p className="preview-meta">{submitted ? "没有匹配的笔记" : "这个资料库还没有笔记"}</p>}
        </section>
      </div>}
    </main>
  );
}

function DraftNotePreview({ generation, text }: { generation: number; text: string }) {
  const [open, setOpen] = useState(false);
  return <details className="preview-history" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>正文预览</summary>
    {open && <PreviewNoteBody generation={generation} text={text} />}
  </details>;
}

function PreviewNoteBody({ generation, text }: { generation: number; text: string }) {
  const references = noteMediaPaths(text).join("\n");
  const attachments = useAttachments(generation, references);
  return <>
    {references && !attachments && <p className="preview-meta" role="status">正在读取附件…</p>}
    <MarkdownRenderer text={text} resolveAttachment={attachments ? (path) => attachments.get(path) ?? null : undefined} />
  </>;
}

const root = document.getElementById("root");
const isCapsule = typeof window !== "undefined" && window.location.search.includes("window=capsule");
if (root) createRoot(root).render(isCapsule ? <WailsCapsule /> : <Preview />);

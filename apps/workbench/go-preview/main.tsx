import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ChooseLibrary, DeleteNote, EnableEditing, ExportCardArchive, ExportCardsJSON, ExportSystemBackup, RestoreSystemBackup, UploadBackupToWebDAV, ListDeletedNotes, ListNotes, OpenInitialLibrary, RestoreNote, SaveNote, SearchChunkHits, SearchNotes } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { LibraryView } from "./bindings/knowflick.local/workbench-go/models";
import type { ChunkHit } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import type { Note } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { ListImportedMail, ListMailAccounts, ListRejectedMail, MailAutoSyncStatus, RemoveMailAccount, RetryRejectedMail, SaveMailAccount, TestMailAccount, StartMailAutoSync, StopMailAutoSync, SyncMailAccountNow } from "./bindings/knowflick.local/workbench-go/mailservice";
import { DeleteSubscription, ListSubscriptions, SaveSubscription } from "./bindings/knowflick.local/workbench-go/subscriptionservice";
import type { Account, Config as MailConfig, ImportedMail, RejectedMail } from "./bindings/knowflick.local/workbench-go/internal/mail/models";
import type { MailStatus } from "./bindings/knowflick.local/workbench-go/models";
import type { Outcome } from "./bindings/knowflick.local/workbench-go/internal/mailschedule/models";
import type { Subscription } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { MarkdownRenderer } from "../src/ui/workspace/MarkdownRenderer";
import "../src/ui/workspace/tokens.css";
import "./preview.css";

function Preview() {
  const [lib, setLib] = useState<LibraryView | null>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trash, setTrash] = useState(false);
  const [chunkMode, setChunkMode] = useState(false);
  const [hits, setHits] = useState<ChunkHit[]>([]);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailAccounts, setMailAccounts] = useState<Account[]>([]);
  const [mailStatus, setMailStatus] = useState<MailStatus | null>(null);
  const [mailInterval, setMailInterval] = useState("15");
  const [mailBusy, setMailBusy] = useState(false);
  const [mailFormOpen, setMailFormOpen] = useState(false);
  const [mailForm, setMailForm] = useState<MailConfig>({ id: "", name: "", email: "", host: "", port: 993, username: "", folder: "INBOX", syncLimit: 50, syncIntervalMinutes: 0 });
  const [mailSecret, setMailSecret] = useState("");
  const [mailRemoveId, setMailRemoveId] = useState("");
  const [mailBrowse, setMailBrowse] = useState<{ id: string; title: string; imported: ImportedMail[]; rejected: RejectedMail[] } | null>(null);
  const [subsOpen, setSubsOpen] = useState(false);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [subForm, setSubForm] = useState({ type: "rss", title: "", targetUrl: "", intervalMinutes: 30 });
  const [subRemoveId, setSubRemoveId] = useState("");
  const [restorePending, setRestorePending] = useState(false);
  const [webdavURL, setWebdavURL] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavSecret, setWebdavSecret] = useState("");
  const [webdavRemember, setWebdavRemember] = useState(false);

  const notes = lib?.page.notes ?? [];
  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const dirty = selected !== null && (draftTitle !== selected.title || draftBody !== selected.body);

  function adopt(result: LibraryView | null, keepId = false) {
    if (!result) return;
    setLib(result);
    const first = result.page.notes?.[0]?.id ?? "";
    const nextId = keepId && result.page.notes?.some((n) => n.id === selectedId) ? selectedId : first;
    const note = result.page.notes?.find((n: Note) => n.id === nextId) ?? null;
    setSelectedId(note?.id ?? "");
    setDraftTitle(note?.title ?? "");
    setDraftBody(note?.body ?? "");
  }

  function fail(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
    setNotice("");
  }

  useEffect(() => {
    void OpenInitialLibrary().then((r: LibraryView | null) => adopt(r)).catch(fail).finally(() => setBusy(false));
  }, []);

  async function reload(generation: number, term = submitted, trashMode = trash) {
    const page = trashMode ? await ListDeletedNotes(generation, 0) : term ? await SearchNotes(generation, term) : await ListNotes(generation, 0);
    setLib((prev) => (prev ? { ...prev, page } : prev));
    return page;
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

  async function browseMail(account: Account) {
    setBusy(true); setError(""); setNotice("");
    try {
      const [imported, rejected] = await Promise.all([ListImportedMail(account.config.id), ListRejectedMail(account.config.id)]);
      setMailBrowse({ id: account.config.id, title: account.config.name || account.config.email, imported: imported ?? [], rejected: rejected ?? [] });
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function retryRejected(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const outcome = await RetryRejectedMail(id);
      setNotice(`重试完成：导入 ${outcome.imported} 封，仍被拒 ${outcome.rejected} 封${outcome.error ? "；错误：" + outcome.error : ""}。`);
      await browseMail({ config: { id } } as Account);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function toggleSubscriptions() {
    const next = !subsOpen;
    setSubsOpen(next);
    if (!next) return;
    setBusy(true); setError(""); setNotice("");
    try { setSubs(await ListSubscriptions() ?? []); } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function saveSubscription() {
    setBusy(true); setError(""); setNotice("");
    try {
      await SaveSubscription({ id: crypto.randomUUID(), createdAt: Date.now(), isActive: true, lastPolledAt: null, ...subForm } as Subscription);
      setSubs(await ListSubscriptions() ?? []);
      setSubForm({ type: "rss", title: "", targetUrl: "", intervalMinutes: 30 });
      setNotice("订阅源已保存。");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function removeSubscription(id: string) {
    setBusy(true); setError(""); setNotice(""); setSubRemoveId("");
    try {
      await DeleteSubscription(id);
      setSubs(await ListSubscriptions() ?? []);
      setNotice("订阅源已删除；抓来的素材保留。");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  function openMailForm(account?: Account) {
    setMailForm(account ? { ...account.config } : { id: crypto.randomUUID(), name: "", email: "", host: "", port: 993, username: "", folder: "INBOX", syncLimit: 50, syncIntervalMinutes: 0 });
    setMailSecret(""); setMailFormOpen(true); setError("");
  }

  async function saveMailAccount() {
    setBusy(true); setError(""); setNotice("");
    try {
      await SaveMailAccount(mailForm, mailSecret);
      setMailAccounts(await ListMailAccounts() ?? []);
      setMailFormOpen(false); setMailSecret("");
      setNotice("邮箱账号已保存；密码保存在库目录的 0600 凭据文件里。");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function testMailConnection() {
    setBusy(true); setError(""); setNotice("");
    try {
      const summary = await TestMailAccount(mailForm, mailSecret);
      setNotice(`连接成功：${summary.folder}，共 ${summary.messageCount} 封邮件`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function removeMailAccount(id: string) {
    setBusy(true); setError(""); setNotice(""); setMailRemoveId("");
    try {
      await RemoveMailAccount(id);
      setMailAccounts(await ListMailAccounts() ?? []);
      setNotice("邮箱账号已删除；导入台账保留以免重复导入。");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function uploadToWebdav() {
    if (!lib || busy || !webdavURL.trim()) { fail(new Error("请填写 WebDAV 地址")); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await UploadBackupToWebDAV(lib.generation, webdavURL.trim(), webdavUser.trim(), webdavSecret, webdavRemember);
      setNotice(`已上传 ${result.fileName}（${result.bytes} 字节，SHA-256 ${result.sha256}）。这是单向复制，不会删除云端旧对象。`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function restoreBackup() {
    if (!lib || !lib.writable || busy) return;
    setRestorePending(false);
    setBusy(true); setError(""); setNotice("");
    const counts = await RestoreSystemBackup(lib.generation).catch((cause: unknown) => { fail(cause); return null; });
    if (counts) setNotice(`已恢复：素材 ${counts.materials}、卡片 ${counts.cards}、产物 ${counts.artifacts}、笔记 ${counts.notes}、知识库 ${counts.knowledgeBases}、附件 ${counts.media}、订阅 ${counts.subscriptions}、复习事件 ${counts.reviewEvents}、回收站 ${counts.deletedMaterials + counts.deletedCards + counts.deletedArtifacts}、邮箱记录 ${counts.mailAccounts + counts.mailImports}、项目与画像 ${counts.r4Rows}；跳过 ${counts.skipped} 条。`);
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
      const page = next ? await ListDeletedNotes(lib.generation, 0) : submitted ? await SearchNotes(lib.generation, submitted) : await ListNotes(lib.generation, 0);
      setTrash(next);
      setLib({ ...lib, page });
      setSelectedId(""); setDraftTitle(""); setDraftBody("");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function createNote() {
    if (!lib || !lib.writable || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const note: Note = { id: crypto.randomUUID(), title: "无标题笔记", body: "", notebook: null, tagsJson: "[]", pinned: false, favorite: false, archivedAt: null, sourceMaterialId: null, revision: 0, createdAt: 0, updatedAt: 0, deleted: false, deletedAt: null, excludeFromProfile: false };
      await SaveNote(lib.generation, note, 0);
      setQuery(""); setSubmitted("");
      await reload(lib.generation, "", false);
      setTrash(false);
      setNotice("已新建笔记");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function restoreNote(id: string) {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const ok = await RestoreNote(lib.generation, id);
      await reload(lib.generation, "", false);
      setTrash(false);
      setNotice(ok ? "已恢复到笔记列表" : "这篇不在回收站里");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const term = query.trim();
      if (chunkMode && term) {
        const found = await SearchChunkHits(lib.generation, term, 20);
        setHits(found ?? []);
        setNotice("分块命中 " + (found?.length ?? 0) + " 处，偏移可回原文");
        return;
      }
      setHits([]);
      const page = term ? await SearchNotes(lib.generation, term) : await ListNotes(lib.generation, 0);
      setLib({ ...lib, page });
      setSubmitted(term);
      const first = page.notes?.[0] ?? null;
      setSelectedId(first?.id ?? "");
      setDraftTitle(first?.title ?? "");
      setDraftBody(first?.body ?? "");
    } catch (fail) {} finally { setBusy(false); }
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

  async function refreshMail() {
    setMailBusy(true);
    try {
      const [accounts, status] = await Promise.all([ListMailAccounts(), MailAutoSyncStatus()]);
      setMailAccounts(accounts ?? []);
      setMailStatus(status);
    } catch (fail) {
      setError(String(fail));
    } finally { setMailBusy(false); }
  }

  async function toggleMail() {
    const next = !mailOpen;
    setMailOpen(next);
    if (next) await refreshMail();
  }

  async function syncMailNow() {
    setMailBusy(true);
    try {
      // 手动同步逐个账号跑，**不看自动同步间隔**：间隔为 0 只是关掉自动，
      // 不该让「立即同步」也失效（早期版本就踩过这个，点完只得到「导入 0 封」）。
      const accounts: Account[] = await ListMailAccounts() ?? [];
      const results = await Promise.all(accounts.map((account) => SyncMailAccountNow(account.config.id)));
      const list: Outcome[] = results ?? [];
      const imported = list.reduce((sum, item) => sum + item.imported, 0);
      const rejected = list.reduce((sum, item) => sum + item.rejected, 0);
      const failed = list.filter((item) => item.error);
      setNotice(`邮箱同步：导入 ${imported} 封，拒收 ${rejected} 封` + (failed.length ? `，${failed.length} 个账号报错` : ""));
      setError(failed.map((item) => `${item.accountId}: ${item.error}`).join("；"));
      if (lib) await reload(lib.generation);
      await refreshMail();
    } catch (fail) {
      setError(String(fail));
    } finally { setMailBusy(false); }
  }

  async function startAuto() {
    const minutes = Number(mailInterval);
    if (!Number.isFinite(minutes) || minutes <= 0) { setError("自动同步间隔必须是大于 0 的分钟数"); return; }
    setMailBusy(true);
    try {
      setMailStatus(await StartMailAutoSync(minutes));
      setNotice(`已开启自动同步，每 ${minutes} 分钟检查一次`);
    } catch (fail) { setError(String(fail)); } finally { setMailBusy(false); }
  }

  async function stopAuto() {
    setMailBusy(true);
    try {
      setMailStatus(await StopMailAutoSync());
      setNotice("已停止自动同步");
    } catch (fail) { setError(String(fail)); } finally { setMailBusy(false); }
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
          {lib && lib.writable && <button type="button" disabled={busy} onClick={() => void createNote()}>新建笔记</button>}
          {lib && <button type="button" disabled={busy} aria-pressed={subsOpen} onClick={() => void toggleSubscriptions()}>{subsOpen ? "收起订阅" : "订阅源"}</button>}
          {lib && lib.writable && <button type="button" disabled={busy || mailBusy} aria-pressed={mailOpen} onClick={() => void toggleMail()}>{mailOpen ? "收起邮箱" : "邮箱"}</button>}
          {lib && <button type="button" disabled={busy} onClick={() => void toggleTrash()}>{trash ? "返回笔记" : "回收站"}</button>}
          {lib && <button type="button" disabled={busy} onClick={() => void exportCards("json")}>导出卡片</button>}
          {lib && <button type="button" disabled={busy} onClick={() => void exportCards("zip")}>导出卡片与设置（ZIP）</button>}
          {lib && <button type="button" disabled={busy} onClick={() => void exportSystemBackup()}>导出基础备份</button>}
          {lib && lib.writable && !restorePending && <button type="button" disabled={busy} onClick={() => setRestorePending(true)}>恢复备份</button>}
          <button type="button" disabled={busy} onClick={() => void choose()}>打开资料库</button>
        </div>
      </header>
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


      {subsOpen && <section className="preview-mail" aria-label="订阅源">
        <div className="preview-mail-head">
          <strong>订阅源</strong>
          <span>{subs.length} 条</span>
        </div>
        {subs.length === 0 ? <p className="preview-count">还没有订阅源</p> : (
          <ul className="preview-mail-list">
            {subs.map((sub) => (
              <li key={sub.id}>
                <span>{sub.title} · {sub.type} · 每 {sub.intervalMinutes} 分钟</span>
                <small>{sub.lastPolledAt ? `上次抓取 ${new Date(sub.lastPolledAt).toLocaleString()}` : "还没抓取过"}{sub.isActive ? "" : " · 已停用"}</small>
                <button type="button" disabled={busy || !lib?.writable} onClick={() => setSubRemoveId(sub.id)}>删除</button>
                {subRemoveId === sub.id && <span className="preview-confirm">确认删除这个订阅源？抓来的素材会保留。<button type="button" disabled={busy} onClick={() => void removeSubscription(sub.id)}>确认</button><button type="button" disabled={busy} onClick={() => setSubRemoveId("")}>取消</button></span>}
              </li>
            ))}
          </ul>
        )}
        {lib?.writable && <form className="preview-confirm" onSubmit={(event) => { event.preventDefault(); void saveSubscription(); }} aria-label="新增订阅源">
          <label>类型 <select aria-label="订阅类型" value={subForm.type} onChange={(event) => setSubForm({ ...subForm, type: event.target.value })}><option value="rss">RSS 地址</option><option value="tech_board">站点板块</option><option value="github_release">GitHub 发布（owner/repo）</option><option value="github_trending">GitHub 趋势（语言名）</option></select></label>
          <label>标题 <input aria-label="订阅标题" value={subForm.title} onChange={(event) => setSubForm({ ...subForm, title: event.target.value })} /></label>
          <label>地址 <input aria-label="订阅地址" value={subForm.targetUrl} onChange={(event) => setSubForm({ ...subForm, targetUrl: event.target.value })} /></label>
          <label>间隔（分钟） <input type="number" min={5} aria-label="抓取间隔" value={subForm.intervalMinutes} onChange={(event) => setSubForm({ ...subForm, intervalMinutes: Number(event.target.value) })} /></label>
          <button type="submit" disabled={busy}>添加订阅</button>
        </form>}
      </section>}
      {mailOpen && lib?.writable && <section className="preview-mail" aria-label="邮箱同步">
        <div className="preview-mail-head">
          <strong>邮箱同步</strong>
          <span>{mailAccounts.length} 个账号 · 自动同步{mailStatus?.running ? "运行中" : "已停止"}</span>
        </div>
        {mailAccounts.length === 0 ? <p className="preview-count">还没有配置邮箱账号</p> : (
          <ul className="preview-mail-list">
            {mailAccounts.map((account) => (
              <li key={account.config.id}>
                <span>{account.config.name || account.config.email}</span>
                <button type="button" disabled={busy} onClick={() => void browseMail(account)}>查看邮件</button>
                <button type="button" disabled={busy} onClick={() => openMailForm(account)}>编辑</button>
                <button type="button" disabled={busy} onClick={() => setMailRemoveId(account.config.id)}>删除</button>
                {mailRemoveId === account.config.id && <span className="preview-confirm">确认删除这个账号？<button type="button" disabled={busy} onClick={() => void removeMailAccount(account.config.id)}>确认</button><button type="button" disabled={busy} onClick={() => setMailRemoveId("")}>取消</button></span>}
                <small>{account.hasPassword ? "凭据已保存" : "需要重新输入密码"}{account.lastError ? ` · ${account.lastError}` : ""}</small>
              </li>
            ))}
          </ul>
        )}
        <div className="preview-mail-actions">
          <button type="button" disabled={mailBusy} onClick={() => void syncMailNow()}>立即同步</button>
          <button type="button" disabled={mailBusy} onClick={() => openMailForm()}>添加账号</button>
          <input type="number" min="1" aria-label="自动同步间隔（分钟）" value={mailInterval} onChange={(event) => setMailInterval(event.target.value)} />
          <button type="button" disabled={mailBusy || mailStatus?.running} onClick={() => void startAuto()}>开启自动</button>
          <button type="button" disabled={mailBusy || !mailStatus?.running} onClick={() => void stopAuto()}>停止自动</button>
        </div>
        {mailFormOpen && <form className="preview-confirm" onSubmit={(event) => { event.preventDefault(); void saveMailAccount(); }} aria-label="邮箱账号">
          <label>账号名称 <input aria-label="账号名称" value={mailForm.name} onChange={(event) => setMailForm({ ...mailForm, name: event.target.value })} /></label>
          <label>邮箱地址 <input aria-label="邮箱地址" value={mailForm.email} onChange={(event) => setMailForm({ ...mailForm, email: event.target.value })} /></label>
          <label>IMAP 主机 <input aria-label="IMAP 主机" value={mailForm.host} onChange={(event) => setMailForm({ ...mailForm, host: event.target.value })} /></label>
          <label>端口 <input type="number" aria-label="端口" value={mailForm.port} onChange={(event) => setMailForm({ ...mailForm, port: Number(event.target.value) })} /></label>
          <label>用户名 <input aria-label="邮箱用户名" value={mailForm.username} onChange={(event) => setMailForm({ ...mailForm, username: event.target.value })} /></label>
          <label>文件夹 <input aria-label="邮箱文件夹" value={mailForm.folder} onChange={(event) => setMailForm({ ...mailForm, folder: event.target.value })} /></label>
          <label>每次同步封数 <input type="number" aria-label="每次同步封数" value={mailForm.syncLimit} onChange={(event) => setMailForm({ ...mailForm, syncLimit: Number(event.target.value) })} /></label>
          <label>自动同步间隔（0 关闭） <input type="number" aria-label="自动同步间隔" value={mailForm.syncIntervalMinutes} onChange={(event) => setMailForm({ ...mailForm, syncIntervalMinutes: Number(event.target.value) })} /></label>
          <label>应用密码 <input type="password" aria-label="邮箱应用密码" value={mailSecret} onChange={(event) => setMailSecret(event.target.value)} /></label>
          <button type="button" disabled={busy} onClick={() => void testMailConnection()}>测试连接</button>
          <button type="submit" disabled={busy}>保存账号</button>
          <button type="button" disabled={busy} onClick={() => setMailFormOpen(false)}>取消</button>
        </form>}
        {mailStatus && mailStatus.lastError && <p className="preview-error" role="status">上次错误：{mailStatus.lastError}</p>}
      </section>}

      {mailBrowse && <section className="preview-confirm" aria-label="邮箱邮件">
        <p>{mailBrowse.title} · 已导入 {mailBrowse.imported.length} 封 · 被拒 {mailBrowse.rejected.length} 封</p>
        {mailBrowse.imported.length > 0 && <ul>{mailBrowse.imported.map((item) => <li key={item.id}>{item.title || item.id}</li>)}</ul>}
        {mailBrowse.rejected.length > 0 && <ul>{mailBrowse.rejected.map((item) => <li key={item.folder + "-" + item.uid}>UID {item.uid} · {item.folder} · {item.reason}</li>)}</ul>}
        <button type="button" disabled={busy} onClick={() => void retryRejected(mailBrowse.id)}>重试被拒邮件</button>
        <button type="button" disabled={busy} onClick={() => setMailBrowse(null)}>收起</button>
      </section>}
      {lib && <div className="preview-workspace">
        <section className="preview-list" aria-label="笔记列表">
          <form onSubmit={(e) => void search(e)} role="search">
            <input type="search" aria-label="搜索笔记" placeholder={chunkMode ? "搜索分块（可回原文偏移）" : "搜索标题或正文"} value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" aria-pressed={chunkMode} onClick={() => { setChunkMode(!chunkMode); setHits([]); }}>{chunkMode ? "按整篇" : "按分块"}</button>
            <button disabled={busy}>搜索</button>
          </form>

          {hits.length > 0 && <section className="preview-hits" aria-label="分块命中">
            <p className="preview-count" role="status">分块命中 {hits.length} 处</p>
            <ul>
              {hits.map((hit, i) => <li key={hit.noteId + "-" + hit.chunkIndex + "-" + i}>
                <strong>{hit.noteTitle}</strong>
                <span className="preview-meta">字符 {hit.charStart}–{hit.charEnd} · 块 {hit.chunkIndex}</span>
                <p>{hit.content}</p>
                <button type="button" disabled={busy} onClick={() => void (async () => {
                  const page = await SearchNotes(lib!.generation, hit.noteTitle);
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
                <button type="button" aria-current={note.id === selectedId ? "true" : undefined} onClick={() => { setSelectedId(note.id); setDraftTitle(note.title); setDraftBody(note.body); }}>
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
              <input id="note-title" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
              <label htmlFor="note-body">正文（Markdown）</label>
              <textarea id="note-body" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={14} />
              <div className="preview-actions">
                <button type="submit" disabled={busy || !dirty}>保存</button>
                <button type="button" disabled={busy} onClick={() => void remove()}>移进回收站</button>
                <span className="preview-meta">{dirty ? "有未保存改动" : "已保存 · 修订 " + selected.revision}</span>
              </div>
            </form> : <div>
              <h2>{selected.title || "无标题笔记"}</h2>
              <p className="preview-meta">修订 {selected.revision} · {new Date(selected.updatedAt).toLocaleString("zh-CN")} · 只读模式</p>
              <MarkdownRenderer text={selected.body} />
            </div>}
          </div> : <p className="preview-meta">{submitted ? "没有匹配的笔记" : "这个资料库还没有笔记"}</p>}
        </section>
      </div>}
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);

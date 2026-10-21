import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AiSettings } from "../../domain/settings";
import { filterMail, groupMailThreads, mailCategory, mailMetadata, mailDigestSources, summarizeMail, type MailDigestSource } from "../../domain/mail";
import { inShell, type RawMaterial } from "../../shell/store";
import { mailListAccounts, mailRemoveAccount, mailSaveAccount, mailSyncAccount, mailSyncHistory, mailListRejected, mailRetryRejected, mailTestAccount, type MailAccount, type MailAccountConfig, type RejectedMail } from "../../shell/mail";
import { storeMaterial } from "./repository";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { MailDigestSources } from "./MailDigestSources";
import { Icon } from "./Icon";
import "./mail.css";

interface Props {
  dir: string;
  materials: RawMaterial[];
  settings: AiSettings;
  apiKey: string;
  onRefresh: () => Promise<void>;
  onOpenMaterial: (id: string) => void;
  onSettings: () => void;
  onSaveDigest: (title: string, markdown: string, sources: MailDigestSource[]) => Promise<void>;
  /** Lifted so the unsaved summary survives jumping to an original mail and back. */
  digest: { text: string; sources: MailDigestSource[]; saved: boolean } | null;
  onDigestChange: (digest: { text: string; sources: MailDigestSource[]; saved: boolean } | null) => void;
  digestTitle: string;
  onDigestTitleChange: (title: string) => void;
}
const PRESETS = [
  { id: "qq", name: "QQ 邮箱", host: "imap.qq.com" },
  { id: "163", name: "163 邮箱", host: "imap.163.com" },
  { id: "icloud", name: "iCloud", host: "imap.mail.me.com" },
  { id: "gmail", name: "Gmail", host: "imap.gmail.com" },
  { id: "outlook", name: "Outlook", host: "outlook.office365.com" },
  { id: "custom", name: "自定义 IMAP", host: "" },
];
const STATUS = { all: "全部状态", inbox: "待整理", processed: "已归档", dismissed: "已忽略" } as const;
type MailStatus = keyof typeof STATUS;
const formatTime = (value: number | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未同步";
function errorText(error: unknown, secrets: string[] = []): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret) text = text.split(secret).join("[已隐藏]");
  return text || "操作未完成，请重试";
}

function AccountForm({ account, available, busy, onClose, onAction }: {
  account: MailAccount | null;
  available: boolean;
  busy: boolean;
  onClose: () => void;
  onAction: (mode: "test" | "save", config: MailAccountConfig, password: string) => Promise<string>;
}) {
  const [config, setConfig] = useState<MailAccountConfig>(() => account ? {
    id: account.id, name: account.name, email: account.email, host: account.host,
    port: account.port, username: account.username, folder: account.folder, syncLimit: account.syncLimit,
    syncIntervalMinutes: account.syncIntervalMinutes ?? 0,
  } : { id: crypto.randomUUID(), name: "", email: "", host: PRESETS[0].host, port: 993, username: "", folder: "INBOX", syncLimit: 50, syncIntervalMinutes: 0 });
  const [provider, setProvider] = useState(() => PRESETS.find(p => p.host === config.host)?.id ?? "custom");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const advanced = useRef<HTMLDetailsElement>(null);
  const actionLock = useRef(false);
  const update = <K extends keyof MailAccountConfig>(key: K, value: MailAccountConfig[K]) => {
    setConfig(previous => ({ ...previous, [key]: value }));
    setError(""); setNotice("");
  };
  const validate = (): MailAccountConfig | null => {
    setError(""); setNotice("");
    const value = { ...config, email: config.email.trim(), name: config.name.trim() || config.email.trim(), host: config.host.trim(), username: config.username.trim() || config.email.trim(), folder: config.folder.trim() };
    if (!value.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) { setError("请填写有效的邮箱地址，例如 name@example.com。"); return null; }
    if (!value.host || /[\s/:@]/.test(value.host)) { if (advanced.current) advanced.current.open = true; setError("IMAP 主机请填写域名，不含协议、路径或端口。"); return null; }
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) { if (advanced.current) advanced.current.open = true; setError("端口须为 1–65535 之间的整数。"); return null; }
    if (!value.folder) { setError("请填写邮件文件夹，例如 INBOX。"); return null; }
    if (!password && !account?.hasPassword) { setError("请输入邮箱授权码或应用专用密码（不是登录密码）。"); return null; }
    return value;
  };
  const run = async (mode: "test" | "save") => {
    if (actionLock.current || busy) return;
    const value = validate();
    if (!value || !available) return;
    actionLock.current = true;
    try {
      const message = await onAction(mode, value, password);
      setNotice(message);
      if (mode === "save") { setPassword(""); onClose(); }
    } catch (err) { setError(errorText(err, [password])); }
    finally { actionLock.current = false; }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void run("save"); };
  return <form className="mail-account-form" ref={form} noValidate onSubmit={submit} aria-label={account ? "编辑邮箱账号" : "连接邮箱账号"}>
    <div className="mail-section-heading"><h3>{account ? "编辑账号" : "连接邮箱"}</h3><button type="button" className="ws-icon-button" aria-label="关闭账号表单" disabled={busy} onClick={() => { setPassword(""); onClose(); }}><Icon name="close" size={14} /></button></div>
    <p className="ws-hint">使用 IMAP 加密连接（仅 TLS，通常为 993 端口）。请先在邮箱服务商处开启 IMAP，并使用授权码或应用专用密码。</p>
    {!available && <p className="mail-inline-note" role="status">当前为浏览器体验模式：可检查填写内容；连接测试、保存账号与同步需要 KnowFlick 桌面应用。已有邮件仍可阅读和整理。</p>}
    <fieldset disabled={busy} className="mail-form-fields">
      <div className="mail-form-grid">
        <label className="ws-field">邮箱服务商<select aria-label="邮箱服务商" value={provider} onChange={event => {
          const next = PRESETS.find(p => p.id === event.target.value)!;
          const previous = PRESETS.find(p => p.id === provider);
          setProvider(next.id);
          // Only replace the preset-owned host; retain a host the user has customized.
          if (next.host && (!config.host || config.host === previous?.host)) update("host", next.host);
          setNotice(""); setError("");
        }}>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="ws-field">显示名称<input aria-label="账号显示名称" value={config.name} maxLength={100} placeholder="例如：工作邮箱" onChange={e => update("name", e.target.value)} /></label>
        <label className="ws-field">邮箱地址<input aria-label="邮箱地址" type="email" required value={config.email} autoComplete="off" placeholder="name@example.com" onChange={e => update("email", e.target.value)} /></label>
        <label className="ws-field">授权码 / 应用专用密码<input aria-label="授权码或应用专用密码" type="password" autoComplete="new-password" value={password} required={!account?.hasPassword} placeholder={account?.hasPassword ? "留空沿用已保存凭据" : "由邮箱服务商生成"} onChange={e => { setPassword(e.target.value); setNotice(""); setError(""); }} /></label>
        <label className="ws-field">首次同步上限<select aria-label="首次同步上限" value={config.syncLimit} onChange={e => update("syncLimit", Number(e.target.value))}>{[20, 50, 100, 200].map(limit => <option key={limit} value={limit}>最近 {limit} 封</option>)}</select></label>
        <label className="ws-field">邮件文件夹<input aria-label="邮件文件夹" required value={config.folder} placeholder="INBOX" onChange={e => update("folder", e.target.value)} /></label>
        <label className="ws-field">自动同步<select aria-label="自动同步间隔" value={config.syncIntervalMinutes ?? 0} onChange={e => update("syncIntervalMinutes", Number(e.target.value))}><option value={0}>关闭 · 手动同步</option>{[5, 15, 30, 60, 180, 1440].map(minutes => <option key={minutes} value={minutes}>每 {minutes === 1440 ? "天" : `${minutes} 分钟`}</option>)}</select></label>
        <p className="ws-hint mail-form-note">自动同步仅在应用运行时收取新邮件；历史邮件按需加载，邮件归纳由你手动发起。</p>
      </div>
      <details className="mail-advanced" ref={advanced}><summary>高级连接设置 · {config.host}:{config.port}</summary><div className="mail-form-grid">
        <label className="ws-field">IMAP 主机<input aria-label="IMAP 主机" required value={config.host} autoCapitalize="none" onChange={e => update("host", e.target.value)} /></label>
        <label className="ws-field">TLS 端口<input aria-label="TLS 端口" type="number" min={1} max={65535} required value={config.port || ""} onChange={e => update("port", Number(e.target.value))} /></label>
        <label className="ws-field">登录用户名<input aria-label="登录用户名" value={config.username} autoComplete="off" placeholder="默认使用邮箱地址" onChange={e => update("username", e.target.value)} /></label>
      </div></details>
    </fieldset>
    <div className="mail-form-feedback"><p role="alert" aria-live="assertive">{error}</p><p role="status" aria-live="polite">{notice}</p></div>
    <div className="mail-actions">
      {!available && <button type="button" className="ws-bordered" onClick={() => { if (validate()) setNotice("填写检查通过；请在桌面应用中测试连接并保存。"); }}>检查填写</button>}
      <button type="button" className="ws-bordered" disabled={!available || busy} onClick={() => void run("test")}>测试连接</button>
      <button type="submit" className="ws-primary" disabled={!available || busy}>{busy ? "处理中…" : "保存配置"}</button>
      <span className="ws-hint">凭据仅提交给本机服务，不写入浏览器存储。</span>
    </div>
  </form>;
}

function MailRow({ material, checked, busy, onSelect, onOpen }: {
  material: RawMaterial; checked: boolean; busy: boolean; onSelect: () => void; onOpen: () => void;
}) {
  const meta = mailMetadata(material);
  return <article className="mail-row" data-selected={checked}>
    <label className="mail-checkbox"><input type="checkbox" checked={checked} disabled={busy} aria-label={`选择邮件：${material.title || "无主题"}`} onChange={onSelect} /></label>
    <div className="mail-row-content">
      <div className="mail-row-heading"><strong>{material.title || "（无主题）"}</strong><span className="mail-badge">{STATUS[material.inboxStatus]}</span></div>
      <div className="mail-row-meta"><span>{meta?.from || "发件人未知"}</span><time>{meta?.date || formatTime(material.createdAt)}</time><span>{mailCategory(material)}</span>{!!meta?.attachments.length && <span>附件 {meta.attachments.length}</span>}</div>
      <p className="mail-preview">{material.rawText.slice(0, 180) || "此邮件没有可显示的纯文本正文。"}</p>
      <details className="mail-message-details"><summary>邮件详情与正文</summary>
        {meta && <dl><dt>发件人</dt><dd>{meta.from || "—"}</dd><dt>收件人</dt><dd>{meta.to || "—"}</dd><dt>日期</dt><dd>{meta.date || "—"}</dd><dt>邮件 ID</dt><dd>{meta.messageId || "—"}</dd>{meta.attachments.length > 0 && <><dt>附件名称</dt><dd>{meta.attachments.join("、")}（仅显示名称）</dd></>}</dl>}
        <pre className="mail-plain-body">{material.rawText || "无纯文本正文"}</pre>
      </details>
    </div>
    <button type="button" className="ws-bordered mail-open" onClick={onOpen} aria-label={`打开邮件：${material.title || "无主题"}`}>打开</button>
  </article>;
}

export function MailboxView({ dir, materials, settings, apiKey, onRefresh, onOpenMaterial, onSettings, onSaveDigest, digest, onDigestChange, digestTitle, onDigestTitleChange }: Props) {
  const available = inShell();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(available);
  const [accountBusy, setAccountBusy] = useState("");
  const accountLock = useRef(false);
  const [accountError, setAccountError] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MailAccount | null>(null);
  const [disconnect, setDisconnect] = useState("");
  const [recoveryAccount, setRecoveryAccount] = useState("");
  const [rejectedMails, setRejectedMails] = useState<RejectedMail[]>([]);
  const [query, setQuery] = useState("");
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState<MailStatus>("inbox");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mailBusy, setMailBusy] = useState("");
  const mailLock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let ignored = false;
    setAccounts([]); setLoading(available); setAccountError("");
    if (available) void mailListAccounts(dir).then(result => { if (!ignored) setAccounts(result); })
      .catch(err => { if (!ignored) setAccountError(errorText(err)); })
      .finally(() => { if (!ignored) setLoading(false); });
    return () => { ignored = true; };
  }, [available, dir]);
  useEffect(() => {
    if (!available || !dir) return;
    let current = true;
    const reload = () => {
      void mailListAccounts(dir).then(next => { if (current) setAccounts(next); }).catch(() => {});
    };
    window.addEventListener("knowflick:mail-accounts-changed", reload);
    return () => { current = false; window.removeEventListener("knowflick:mail-accounts-changed", reload); };
  }, [available, dir]);
  useEffect(() => { setSelected(previous => new Set([...previous].filter(id => materials.some(m => m.id === id && m.sourceType === "email")))); }, [materials]);
  const mails = useMemo(() => materials.filter(m => m.sourceType === "email"), [materials]);
  const filtered = useMemo(() => filterMail(mails, { accountId: accountId || undefined, query, status, category: category || undefined }), [mails, accountId, query, status, category]);
  const threads = useMemo(() => groupMailThreads(filtered), [filtered]);
  const categories = useMemo(() => [...new Set(mails.map(mailCategory))].sort(), [mails]);
  const accountOptions = useMemo(() => [...new Set([...accounts.map(a => a.id), ...mails.map(m => mailMetadata(m)?.accountId).filter((id): id is string => !!id)])], [accounts, mails]);
  const chosen = mails.filter(m => selected.has(m.id));
  const visibleSelected = filtered.filter(m => selected.has(m.id)).length;
  const hiddenSelected = chosen.length - visibleSelected;
  const allSelected = filtered.length > 0 && visibleSelected === filtered.length;
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const accountAction = async (label: string, action: () => Promise<string>) => {
    if (accountLock.current) throw new Error("账号操作进行中，请稍候。");
    accountLock.current = true; setAccountBusy(label); setAccountError(""); setAccountNotice("");
    try { const message = await action(); setAccountNotice(message); return message; }
    finally { accountLock.current = false; setAccountBusy(""); }
  };
  const sync = async (account: MailAccount, mode: "new" | "history" | "retry" = "new") => {
    try { await accountAction(account.id, async () => {
      const result = mode === "history" ? await mailSyncHistory(dir, account.id)
        : mode === "retry" ? await mailRetryRejected(dir, account.id) : await mailSyncAccount(dir, account.id);
      setAccounts(await mailListAccounts(dir));
      if (recoveryAccount === account.id) setRejectedMails(await mailListRejected(dir, account.id));
      await onRefresh();
      const label = mode === "history" ? "历史邮件" : mode === "retry" ? "重试隔离邮件" : "新邮件";
      return `${account.name} · ${label}：新增 ${result.imported} 封，跳过 ${result.skipped} 封重复邮件${result.rejected ? `，另有 ${result.rejected} 封仍无法读取` : ""}${mode === "history" && result.historyComplete ? "，历史已加载完毕" : ""}。`;
    }); } catch (err) {
      setAccountError(errorText(err));
      await onRefresh().catch(() => {});
      if (available) void mailListAccounts(dir).then(setAccounts).catch(() => {});
    }
  };
  const showRecovery = async (account: MailAccount) => {
    if (recoveryAccount === account.id) { setRecoveryAccount(""); return; }
    try { await accountAction(account.id, async () => {
      setRejectedMails(await mailListRejected(dir, account.id));
      setRecoveryAccount(account.id);
      return `${account.name}：已读取隔离记录；可重试，其他邮件继续正常同步。`;
    }); } catch (err) { setAccountError(errorText(err)); }
  };
  const remove = async (account: MailAccount) => {
    try { await accountAction(account.id, async () => {
      await mailRemoveAccount(dir, account.id); setAccounts(await mailListAccounts(dir)); setDisconnect("");
      if (editing?.id === account.id) { setEditing(null); setFormOpen(false); }
      return "账号已断开，本地已导入的邮件继续保留。";
    }); } catch (err) { setAccountError(errorText(err)); }
  };
  const organize = async (mode: "archive" | "summary" | "save") => {
    if (mailLock.current) return;
    if (mode !== "save" && chosen.length === 0) return;
    if (mode === "summary" && chosen.length > 30) { setError("一次最多汇总 30 封邮件，请减少选择；没有发送任何邮件。"); return; }
    mailLock.current = true; setMailBusy(mode); setError(""); setNotice("");
    try {
      if (mode === "summary") {
        // Capture source order before awaiting the model; selection and filters
        // can change while a request is in flight.
        const sources = mailDigestSources(chosen);
        const text = await summarizeMail(chosen, settings, apiKey);
        if (!text.trim()) throw new Error("AI 没有返回摘要，请重试或检查模型设置。");
        onDigestChange({ text, sources, saved: false });
        onDigestTitleChange(`邮件摘要 · ${new Date().toLocaleDateString("zh-CN")}`);
        setNotice(`已完成 ${chosen.length} 封邮件的摘要，可检查后保存到素材库。`);
      } else if (mode === "save" && digest) {
        if (!digestTitle.trim()) throw new Error("请填写摘要标题。");
        if (digest.saved) return;
        await onSaveDigest(digestTitle.trim(), digest.text, digest.sources);
        onDigestChange(digest ? { ...digest, saved: true } : null);
        setNotice("邮件摘要及来源已保存到素材库，可随时回看原邮件。");
      } else if (mode === "archive") {
        let completed = 0;
        try {
          for (const material of chosen) { await storeMaterial({ ...material, inboxStatus: "processed", updatedAt: Date.now() }, dir); completed++; }
        } catch (err) {
          // Keep only the still-unarchived mails selected so a retry does not redo finished work.
          setSelected(previous => new Set([...previous].filter(id => !chosen.slice(0, completed).some(m => m.id === id))));
          throw new Error(`已归档 ${completed}/${chosen.length} 封，其余未完成。${errorText(err)}`);
        } finally { await onRefresh(); }
        setSelected(new Set()); setNotice(`已在本地归档 ${completed} 封邮件，原邮件保留。`);
      }
    } catch (err) { setError(errorText(err, [apiKey])); }
    finally { mailLock.current = false; setMailBusy(""); }
  };
  return <div className="mail-view" data-page="mailbox" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key === "f") { event.preventDefault(); searchInput.current?.focus(); }
    if (event.key === "Escape" && !accountBusy) { setDisconnect(""); setFormOpen(false); setEditing(null); }
  }}>
    <header className="mail-header"><div><h1>邮箱</h1><p className="ws-hint">收集邮件，按主题整理，让有价值的信息留在知识库。</p></div><button type="button" className="ws-bordered" disabled={!!accountBusy} aria-expanded={formOpen} aria-controls="mail-account-editor" onClick={() => { setEditing(null); setFormOpen(!formOpen); }}><Icon name="plus" size={14} />连接邮箱</button></header>
    <section className="mail-accounts" data-expanded={formOpen} aria-label="邮箱账号">
      <div className="mail-section-heading"><h2>已连接账号 <span>{accounts.length}</span></h2>{loading && <span className="ws-hint" role="status">正在读取账号…</span>}</div>
      {!available && <p className="ws-hint">浏览器模式可整理已导入的邮件；连接和同步邮箱请使用桌面应用。</p>}
      {available && !loading && !accounts.length && <p className="ws-hint">还没有连接邮箱。通过 IMAP 导入最近的邮件，随时手动同步。</p>}
      {accounts.map(account => <div className="mail-account" key={account.id}>
        <div className="mail-account-info"><strong>{account.name || account.email}</strong><span>{account.email} · {account.folder}</span><span>上次同步：{formatTime(account.lastSyncAt)} · {(account.syncIntervalMinutes ?? 0) > 0 ? `每 ${account.syncIntervalMinutes} 分钟自动同步（应用运行时）` : "手动同步"}</span>{account.lastError && <span className="mail-account-error">同步失败：{account.lastError}。已导入的邮件仍保留，可立即重试。</span>}</div>
        <div className="mail-actions">
          <button className="ws-bordered" type="button" disabled={!!accountBusy || !available} onClick={() => void sync(account)}>{accountBusy === account.id ? "处理中…" : "立即同步"}</button>
          <button className="ws-bordered" type="button" disabled={!!accountBusy || !available || account.historyComplete} onClick={() => void sync(account, "history")}>{account.historyComplete ? "历史已加载完毕" : "加载更早邮件"}</button>
          {account.rejectedCount > 0 && <button className="ws-bordered" type="button" disabled={!!accountBusy} aria-expanded={recoveryAccount === account.id} onClick={() => void showRecovery(account)}>隔离邮件 {account.rejectedCount}</button>}
          <button type="button" disabled={!!accountBusy} onClick={() => { setEditing(account); setFormOpen(true); setDisconnect(""); }}>编辑</button><button type="button" disabled={!!accountBusy} aria-expanded={disconnect === account.id} onClick={() => setDisconnect(disconnect === account.id ? "" : account.id)}>断开</button>
        </div>
        {recoveryAccount === account.id && <div className="mail-recovery" aria-label={`${account.name}隔离邮件`}>
          <p>以下邮件未能导入。重试只处理这些记录，已导入邮件与新邮件游标保持不变。</p>
          <ul>{rejectedMails.map(mail => <li key={`${mail.folder}-${mail.uid}`}><strong>{mail.folder} · UID {mail.uid}</strong><span>{mail.reason}</span><time>{formatTime(mail.rejectedAt)}</time></li>)}</ul>
          <button type="button" className="ws-bordered" disabled={!!accountBusy || !rejectedMails.length} onClick={() => void sync(account, "retry")}>重试隔离邮件</button>
          {!rejectedMails.length && <p role="status">没有待重试的隔离邮件。</p>}
        </div>}
        {disconnect === account.id && <div className="mail-disconnect" role="group" aria-label={`确认断开 ${account.name}`}><span>断开 {account.email}？已导入邮件仍保留，之后不再同步。</span><button type="button" className="ws-bordered" disabled={!!accountBusy} onClick={() => void remove(account)}>确认断开</button><button type="button" disabled={!!accountBusy} onClick={() => setDisconnect("")}>取消</button></div>}
      </div>)}
      <div className="mail-form-feedback"><p role="alert" aria-live="assertive">{accountError}</p><p role="status" aria-live="polite">{accountNotice}</p></div>
      {formOpen && <div id="mail-account-editor"><AccountForm key={editing?.id ?? "new"} account={editing} available={available} busy={!!accountBusy} onClose={() => { setFormOpen(false); setEditing(null); }} onAction={(mode, config, password) => accountAction(mode, async () => {
        if (mode === "test") return errorText((await mailTestAccount(dir, config, password)).message, [password]);
        await mailSaveAccount(dir, config, password);
        setAccounts(await mailListAccounts(dir));
        window.dispatchEvent(new CustomEvent("knowflick:mail-accounts-changed"));
        return "邮箱配置已保存，可立即同步。";
      })} /></div>}
    </section>
    <section className="mail-library" aria-label="邮件整理">
      <div className="mail-library-heading"><h2>邮件 <span>{mails.length}</span></h2><span className="ws-hint">待整理 {mails.filter(m => m.inboxStatus === "inbox").length} · 已归档 {mails.filter(m => m.inboxStatus === "processed").length}</span></div>
      <div className="mail-filters"><label className="mail-search"><Icon name="search" size={15} /><input ref={searchInput} type="search" value={query} aria-label="搜索邮件主题、发件人与正文" placeholder="搜索主题、发件人、正文" onChange={e => setQuery(e.target.value)} /></label><select aria-label="筛选邮箱账号" value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">全部账号</option>{accountOptions.map(id => <option key={id} value={id}>{accounts.find(a => a.id === id)?.name || accounts.find(a => a.id === id)?.email || `已导入账号 · ${id}`}</option>)}</select><select aria-label="筛选邮件状态" value={status} onChange={e => setStatus(e.target.value as MailStatus)}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="筛选邮件分类" value={category} onChange={e => setCategory(e.target.value)}><option value="">全部分类</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></div>
      <div className="mail-selection"><label><input type="checkbox" checked={allSelected} ref={element => { if (element) element.indeterminate = visibleSelected > 0 && !allSelected; }} disabled={!filtered.length || !!mailBusy} onChange={() => setSelected(previous => { const next = new Set(previous); for (const mail of filtered) { if (allSelected) next.delete(mail.id); else next.add(mail.id); } return next; })} />全选当前结果</label><span className="ws-hint">{filtered.length} 封 · {threads.length} 个主题 · 已选 {chosen.length}{hiddenSelected > 0 ? `（含筛选外 ${hiddenSelected} 封）` : ""}</span>{chosen.length > 0 && <button type="button" disabled={!!mailBusy} onClick={() => setSelected(new Set())}>清空选择</button>}<div className="mail-actions"><button type="button" className="ws-bordered" disabled={!chosen.length || !!mailBusy} onClick={() => void organize("archive")}><Icon name="archive" size={14} />{mailBusy === "archive" ? "归档中…" : "本地归档"}</button><button type="button" className="ws-primary" disabled={!chosen.length || chosen.length > 30 || !!mailBusy} onClick={() => void organize("summary")}>{mailBusy === "summary" ? "正在汇总…" : "汇总所选邮件"}</button></div></div>
      <p className="mail-ai-note">点击“汇总所选邮件”会将所选邮件内容发送给当前配置的 AI 服务，每次最多 30 封。{chosen.length > 30 && <strong>当前已选 {chosen.length} 封，请减少选择后汇总。</strong>}<button type="button" onClick={onSettings}>AI 设置</button></p>
      <div className="mail-form-feedback"><p role="alert" aria-live="assertive">{error}</p><p role="status" aria-live="polite">{notice}</p></div>
      {digest && <section className="mail-digest" aria-label="邮件摘要结果"><div className="mail-section-heading"><h3>邮件摘要 · {digest.sources.length} 封</h3><button type="button" className="ws-icon-button" aria-label="收起摘要" disabled={!!mailBusy} onClick={() => onDigestChange(null)}><Icon name="close" size={14} /></button></div><div className="mail-digest-body"><MarkdownRenderer text={digest.text} /></div><MailDigestSources sources={digest.sources} materials={materials} onOpenMaterial={onOpenMaterial} /><div className="mail-digest-save"><input aria-label="邮件摘要标题" value={digestTitle} maxLength={200} disabled={digest.saved} onChange={e => onDigestTitleChange(e.target.value)} /><button type="button" className="ws-bordered" disabled={!!mailBusy || !digestTitle.trim() || digest.saved} onClick={() => void organize("save")}>{mailBusy === "save" ? "保存中…" : digest.saved ? "摘要已保存" : "保存摘要到素材库"}</button></div></section>}
      <div className="mail-thread-list" aria-busy={!!mailBusy}>
        {!filtered.length ? <div className="mail-empty"><Icon name="inbox" size={28} /><h3>{mails.length ? "没有符合条件的邮件" : "邮箱还没有邮件"}</h3><p>{mails.length ? "试试调整账号、状态、分类或搜索词。" : "连接账号后点击“立即同步”；已导入的邮件也会显示在这里。"}</p>{mails.length > 0 && <button type="button" className="ws-bordered" onClick={() => { setQuery(""); setAccountId(""); setStatus("all"); setCategory(""); }}>查看全部邮件</button>}</div> : threads.map(thread => <section className="mail-thread" key={thread.key}><h3 className="mail-thread-heading"><Icon name="layers" size={14} /><span>{thread.subject || "（无主题）"}</span><span className="mail-badge">{thread.messages.length} 封</span></h3>{thread.messages.map(material => <MailRow key={material.id} material={material} checked={selected.has(material.id)} busy={!!mailBusy} onSelect={() => toggle(material.id)} onOpen={() => onOpenMaterial(material.id)} />)}</section>)}
      </div>
    </section>
  </div>;
}

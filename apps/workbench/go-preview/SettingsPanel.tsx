import { useEffect, useState } from "react";
import { LibrarySignature, ListStaleEmbeddingCardIDs, ListUnembeddedCardIDs, ReadAPIKey, ReadImportReport, ReadSearchHistory, ReadSettings, RebuildHashEmbeddings, SaveSearchHistory, SaveSettings, WriteAPIKey } from "./bindings/knowflick.local/workbench-go/previewservice";

type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
};

export function SettingsPanel({ generation, writable, busy, onBusy }: Props) {
  const [settings, setSettings] = useState("");
  const [history, setHistory] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [signature, setSignature] = useState("");
  const [unembedded, setUnembedded] = useState<number | null>(null);
  const [stale, setStale] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [settingsText, historyText, importReport, key, sig] = await Promise.all([
          ReadSettings(generation), ReadSearchHistory(generation), ReadImportReport(generation),
          ReadAPIKey(generation), LibrarySignature(generation),
        ]);
        if (!active) return;
        setSettings(settingsText);
        setHistory(historyText);
        setReport(importReport);
        setApiKey(key);
        setSignature(sig);
        const [unembeddedIDs, staleIDs] = await Promise.all([
          ListUnembeddedCardIDs(generation, 500),
          ListStaleEmbeddingCardIDs(generation, 128, "hash", "char-ngram-128", 500),
        ]);
        if (!active) return;
        setUnembedded(unembeddedIDs?.length ?? 0);
        setStale(staleIDs?.length ?? 0);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    })();
    return () => { active = false; };
  }, [generation]);

  async function run(action: () => Promise<void>) {
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      onBusy(false);
    }
  }

  async function save(kind: "settings" | "history" | "key") {
    if (busy) return;
    await run(async () => {
      if (kind === "settings") { await SaveSettings(generation, settings); setNotice("设置已保存"); }
      if (kind === "history") { await SaveSearchHistory(generation, history); setNotice("搜索历史已保存"); }
      if (kind === "key") {
        await WriteAPIKey(generation, keyDraft);
        setApiKey(keyDraft);
        setKeyDraft("");
        setNotice("接口密钥已写入凭据文件（仅属主可读）");
      }
      setSignature(await LibrarySignature(generation));
    });
  }

  return (
    <section className="preview-mail" aria-label="设置与本地文件">
      <div className="preview-mail-head">
        <strong>设置与本地文件</strong>
        <span>{signature ? "签名 " + signature.slice(0, 24) + "…" : ""}</span>
        <button type="button" disabled={busy} onClick={() => void run(async () => { setSignature(await LibrarySignature(generation)); setNotice("签名已刷新"); })}>刷新签名</button>
      </div>
      {error && <p className="preview-error" role="alert">{error}</p>}
      {notice && <p className="preview-notice" role="status">{notice}</p>}
      <label>设置（settings.json）
        <textarea value={settings} disabled={busy || !writable} onChange={(event) => setSettings(event.target.value)} placeholder="{}" />
      </label>
      <div className="preview-actions">
        <button type="button" disabled={busy || !writable || !settings.trim()} onClick={() => void save("settings")}>保存设置</button>
      </div>
      <label>搜索历史（search_history.json）
        <textarea value={history} disabled={busy || !writable} onChange={(event) => setHistory(event.target.value)} placeholder="[]" />
      </label>
      <div className="preview-actions">
        <button type="button" disabled={busy || !writable || !history.trim()} onClick={() => void save("history")}>保存搜索历史</button>
      </div>
      <div className="preview-confirm">
        <p>向量索引：未嵌入 {unembedded ?? "…"} 张 · 身份不匹配 {stale ?? "…"} 张（当前本地哈希引擎 hash/char-ngram-128，128 维）</p>
        <div className="preview-actions">
          <button type="button" disabled={busy || !writable || !unembedded} onClick={() => void run(async () => {
            const count = await RebuildHashEmbeddings(generation, 100);
            setNotice("已为 " + count + " 张卡片补全哈希向量");
            const [unembeddedIDs, staleIDs] = await Promise.all([
              ListUnembeddedCardIDs(generation, 500),
              ListStaleEmbeddingCardIDs(generation, 128, "hash", "char-ngram-128", 500),
            ]);
            setUnembedded(unembeddedIDs?.length ?? 0);
            setStale(staleIDs?.length ?? 0);
          })}>补全哈希向量</button>
        </div>
      </div>
      <div className="preview-confirm">
        <p>最近一次导入的转换报告：</p>
        <pre className="preview-material-body">{report ?? "（无报告）"}</pre>
      </div>
      <label>AI 接口密钥（凭据文件，导出会被剥掉）
        <input type="password" value={keyDraft} disabled={busy || !writable} placeholder={apiKey ? "已配置，输入以覆盖" : "尚未配置"} onChange={(event) => setKeyDraft(event.target.value)} />
      </label>
      <div className="preview-actions">
        <button type="button" disabled={busy || !writable || !keyDraft} onClick={() => void save("key")}>保存密钥</button>
      </div>
    </section>
  );
}

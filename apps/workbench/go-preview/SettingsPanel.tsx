import { useEffect, useState } from "react";
import { parseImportReport, reportLines, summarizeReport } from "../src/domain/importReport";
import { BackfillMaterialFTS, BrowseCards, CaptureDatabaseSnapshot, CopyBackupToDirectory, GetShortcutStatus, LibrarySignature, ListNoteChunkTexts, ListStaleEmbeddingCardIDs, ListUnembeddedCardIDs, LocalEmbed, ReadAPIKey, ReadImportReport, ReadSearchHistory, ReadSettings, RebuildHashEmbeddings, RequestEmbeddings, SaveCardEmbeddingsBatch, SaveNoteChunkEmbeddings, SaveSearchHistory, SaveSettings, ToggleCapsule, WriteAPIKey } from "./bindings/knowflick.local/workbench-go/previewservice";

import { HASH_IDENTITY, apiEmbeddingConfig, cardText } from "./embeddingConfig";


type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  reportRevision?: number;
};

export function SettingsPanel({ generation, writable, busy, onBusy, reportRevision = 0 }: Props) {
  const [settings, setSettings] = useState("");
  const [history, setHistory] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const parsedReport = parseImportReport(report);
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [signature, setSignature] = useState("");
  const [unembedded, setUnembedded] = useState<number | null>(null);
  const [stale, setStale] = useState<number | null>(null);
  const [chunkPending, setChunkPending] = useState<number | null>(null);
  const [shortcut, setShortcut] = useState<{ shortcut: string; registered: boolean; error: string | null } | null>(null);
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
        const chunkTexts = await ListNoteChunkTexts(generation, 500, HASH_IDENTITY.provider, HASH_IDENTITY.model);
        if (!active) return;
        setChunkPending(chunkTexts?.length ?? 0);
        const shortcutStatus = await GetShortcutStatus();
        if (!active) return;
        setShortcut(shortcutStatus ?? null);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    })();
    return () => { active = false; };
  }, [generation, reportRevision]);

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

  async function backfillMaterials() {
    if (busy || !writable) return;
    await run(async () => {
      const count = await BackfillMaterialFTS(generation);
      setNotice(count > 0 ? "已补全 " + count + " 条素材的全文索引" : "素材索引没有缺项");
    });
  }

  async function embedNoteChunks() {
    if (busy || !writable) return;
    await run(async () => {
      let total = 0;
      for (let round = 0; round < 50; round++) {
        const chunks = await ListNoteChunkTexts(generation, 16, HASH_IDENTITY.provider, HASH_IDENTITY.model);
        if (!chunks?.length) break;
        const vectors = await LocalEmbed(chunks.map((chunk: { content: string }) => chunk.content), false);
        if (!vectors || vectors.length !== chunks.length) break;
        const items = [];
        for (let index = 0; index < chunks.length; index++) {
          const embedding = vectors[index];
          if (!embedding) continue;
          items.push({
            noteId: chunks[index].noteId,
            chunkIndex: chunks[index].chunkIndex,
            contentRevision: chunks[index].contentRevision,
            embedding,
          });
        }
        if (!items.length) break;
        const saved = await SaveNoteChunkEmbeddings(generation, items, HASH_IDENTITY.provider, HASH_IDENTITY.model);
        total += saved;
        if (!saved) break;
      }
      const pending = await ListNoteChunkTexts(generation, 500, HASH_IDENTITY.provider, HASH_IDENTITY.model);
      setChunkPending(pending?.length ?? 0);
      setNotice(total > 0 ? "已向量化 " + total + " 段笔记片段" : "笔记片段没有缺项");
    });
  }

  async function embedCardsViaAPI() {
    if (busy || !writable) return;
    await run(async () => {
      const config = apiEmbeddingConfig(settings, apiKey);
      if (!config) throw new Error("先保存设置里的接口地址，并写入接口密钥，才能用 API 生成向量");
      const { endpoint, provider, model } = config;
      const textByID = new Map<string, string>();
      let offset = 0;
      for (let page = 0; page < 200; page++) {
        const result = await BrowseCards(generation, "", offset);
        const cards = result?.cards ?? [];
        for (const card of cards) textByID.set(card.id, cardText(card.content));
        if (!result?.hasMore || cards.length === 0) break;
        offset += cards.length;
      }
      if (textByID.size === 0) throw new Error("资料库里还没有卡片");
      async function writeBatch(ids: string[]): Promise<number> {
        const pairs = ids.filter((id) => textByID.has(id));
        if (pairs.length === 0) return 0;
        const texts = pairs.map((id) => textByID.get(id)!);
        const vectors = await RequestEmbeddings(endpoint, apiKey.trim(), model, texts);
        if (!vectors || vectors.length !== texts.length) throw new Error("接口返回的向量数量与文本数量不一致");
        await SaveCardEmbeddingsBatch(generation, pairs.map((id, index) => ({ cardId: id, vector: vectors[index] })), provider, model);
        return pairs.length;
      }
      let written = 0;
      for (let round = 0; round < 200; round++) {
        const ids = await ListUnembeddedCardIDs(generation, 20);
        if (!ids?.length) break;
        const count = await writeBatch(ids);
        if (count === 0) break;
        written += count;
      }
      for (let round = 0; round < 200; round++) {
        const ids = await ListStaleEmbeddingCardIDs(generation, 0, provider, model, 20);
        if (!ids?.length) break;
        const count = await writeBatch(ids);
        if (count === 0) break;
        written += count;
      }
      const [unembeddedIDs, staleIDs] = await Promise.all([
        ListUnembeddedCardIDs(generation, 500),
        ListStaleEmbeddingCardIDs(generation, 128, "hash", "char-ngram-128", 500),
      ]);
      setUnembedded(unembeddedIDs?.length ?? 0);
      setStale(staleIDs?.length ?? 0);
      setNotice(written > 0 ? "已用 " + provider + "/" + model + " 向量化 " + written + " 张卡片" : "没有需要向量化的卡片");
    });
  }

  async function downloadSnapshot() {
    if (busy) return;
    await run(async () => {
      const snapshot = await CaptureDatabaseSnapshot(generation);
      const bytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const result = await CopyBackupToDirectory(".", btoa(binary));
      setNotice("备份快照已落盘：" + result.fileName + "（" + result.bytes + " 字节，SHA-256 " + result.sha256.slice(0, 12) + "…）");
    });
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
        {writable && <button type="button" disabled={busy} onClick={() => void backfillMaterials()}>补全素材索引</button>}
        <button type="button" disabled={busy} onClick={() => void downloadSnapshot()}>导出备份快照</button>
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
        <p>向量索引：未嵌入 {unembedded ?? "…"} 张 · 身份不匹配 {stale ?? "…"} 张 · 笔记片段待向量化 {chunkPending ?? "…"} 段（当前本地哈希引擎 hash/char-ngram-128，128 维）</p>
        <div className="preview-actions">
          <button type="button" disabled={busy || !writable || !chunkPending} onClick={() => void embedNoteChunks()}>向量化笔记片段</button>
          <button type="button" disabled={busy || !writable || !apiKey.trim() || (!unembedded && !stale)} onClick={() => void embedCardsViaAPI()}>用 API 向量化卡片</button>
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
        <p>快速记录：{shortcut?.registered ? shortcut.shortcut + " 已注册" : "全局快捷键未注册" + (shortcut?.error ? "：" + shortcut.error : "")}；也可从这里呼出胶囊窗口。</p>
        <div className="preview-actions">
          <button type="button" disabled={busy} onClick={() => void run(async () => { await ToggleCapsule(); setNotice("已切换闪念胶囊窗口"); })}>打开闪念胶囊</button>
        </div>
      </div>
      <div className="preview-confirm">
        <p>最近一次导入的转换报告：</p>
        {parsedReport ? <>
          <p className="preview-meta">{summarizeReport(parsedReport)} · {new Date(parsedReport.at).toLocaleString("zh-CN")}</p>
          <ul>{reportLines(parsedReport).map((line, index) => <li key={index} className="preview-meta">{line.text}</li>)}</ul>
        </> : <pre className="preview-material-body">{report ?? "（无报告）"}</pre>}
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

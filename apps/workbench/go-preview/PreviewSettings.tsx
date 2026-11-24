import { useEffect, useState } from "react";
import { encodeSettings, parseSettings, type SettingsFile } from "../src/domain/settings";
import { WorkspaceSettings } from "../src/ui/workspace/WorkspaceSettings";
import { bytesToBase64 } from "../src/shell/base64";
import {
  CaptureDatabaseSnapshot, CopyBackupToDirectory, ExportCardsJSONFile, ExportSystemBackup,
  PickDirectory, PickSavePath, ReadAPIKey, ReadSettings, RestoreSystemBackup, SaveSettings,
  UploadBackupToWebDAV, WriteAPIKey,
} from "./bindings/knowflick.local/workbench-go/previewservice";

type Props = {
  generation: number;
  onBack: () => void;
  onReload: () => Promise<void>;
};

export function PreviewSettings({ generation, onBack, onReload }: Props) {
  const [file, setFile] = useState<SettingsFile | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setError("");
    void Promise.all([ReadSettings(generation), ReadAPIKey(generation)])
      .then(([text, key]) => {
        if (!active) return;
        setFile(parseSettings(text));
        setApiKey(key);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => { active = false; };
  }, [generation]);

  if (!file) return <p className="preview-count">{error || "正在读取设置…"}</p>;
  return <section aria-label="工作台设置">
    {error ? <p className="preview-error" role="alert">{error}</p> : null}
    <WorkspaceSettings
      dir=""
      file={file}
      apiKey={apiKey}
      reviewEnabled={Boolean(file.raw.reviewPluginEnabled)}
      materials={[]}
      cards={[]}
      mcpServerEnabled
      onBack={onBack}
      onSave={async (next, key) => {
        await SaveSettings(generation, encodeSettings(next));
        await WriteAPIKey(generation, key);
        setFile(next);
        setApiKey(key);
      }}
      onExportKfBackup={async () => { await ExportSystemBackup(generation); }}
      onRestoreKfBackup={async () => { await RestoreSystemBackup(generation); await onReload(); }}
      onExportCardsJson={async () => {
        const dest = await PickSavePath("cards.json", "保存 cards.json");
        if (dest) await ExportCardsJSONFile(generation, dest);
      }}
      onBackupToDirectory={async () => {
        const directory = await PickDirectory("选择备份目录");
        if (!directory) return;
        const snapshot = await CaptureDatabaseSnapshot(generation);
        const bytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
        await CopyBackupToDirectory(directory, await bytesToBase64(bytes));
      }}
      onWebdavUpload={async (target) => {
        const result = await UploadBackupToWebDAV(generation, target.url, target.username, target.password, true);
        return { fileName: result.fileName, sha256: result.sha256, bytes: result.bytes, gaps: result.gaps ?? [], version: result.version };
      }}
    />
  </section>;
}

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { makeMailDigestMetadata } from "../src/domain/mail";
import type { RawMaterial } from "../src/domain/dto";
import { defaultSettings, parseSettings } from "../src/domain/settings";
import { MailboxView } from "../src/ui/workspace/MailboxView";
import { userError } from "../src/ui/workspace/userError";
import { ListEmailMaterials, ReadAPIKey, ReadSettings, SaveMailDigest, UpdateMaterialStatus } from "./bindings/knowflick.local/workbench-go/previewservice";
import { MailAutoSyncStatus } from "./bindings/knowflick.local/workbench-go/mailservice";
import type { MailStatus } from "./bindings/knowflick.local/workbench-go/models";
import { toRawMaterial } from "./sharedAdapters";

type Props = Pick<ComponentProps<typeof MailboxView>, "dir" | "onOpenMaterial" | "onSettings"> & {
  generation: number;
  open: boolean;
  settingsOpen: boolean;
  onChanged: () => void;
};

export function PreviewMailbox({ dir, generation, open, settingsOpen, onOpenMaterial, onSettings, onChanged }: Props) {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const materialRequest = useRef(0);
  const [settings, setSettings] = useState({ ...defaultSettings, enableAI: false });
  const [apiKey, setApiKey] = useState("");
  const [materialsError, setMaterialsError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [digest, setDigest] = useState<ComponentProps<typeof MailboxView>["digest"]>(null);
  const [digestTitle, setDigestTitle] = useState("");
  const lastRounds = useRef<number | null>(null);

  async function readMaterials() {
    const rows: Awaited<ReturnType<typeof ListEmailMaterials>> = await ListEmailMaterials(generation);
    return (rows ?? []).map(toRawMaterial);
  }

  useEffect(() => {
    if (!open) return;
    const request = ++materialRequest.current;
    setMaterialsError("");
    void readMaterials().then(rows => {
      if (request === materialRequest.current) setMaterials(rows);
    }, cause => {
      if (request === materialRequest.current) setMaterialsError(userError(cause, "读取邮件素材失败"));
    });
    return () => { materialRequest.current++; };
  }, [generation, open]);

  useEffect(() => {
    if (!open || settingsOpen) return;
    let active = true;
    setSettingsError("");
    void Promise.all([ReadSettings(generation), ReadAPIKey(generation)]).then(([raw, key]) => {
      if (!active) return;
      setSettings(parseSettings(raw).settings);
      setApiKey(key);
    }, cause => {
      if (!active) return;
      setSettings({ ...defaultSettings, enableAI: false });
      setApiKey("");
      setSettingsError(userError(cause, "读取邮件摘要设置失败"));
    });
    return () => { active = false; };
  }, [generation, open, settingsOpen]);

  async function refresh() {
    const request = ++materialRequest.current;
    const rows = await readMaterials();
    if (request === materialRequest.current) {
      setMaterials(rows);
      setMaterialsError("");
    }
    onChanged();
  }

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      void MailAutoSyncStatus().then((status: MailStatus) => {
        if (disposed) return;
        if (lastRounds.current !== null && lastRounds.current !== status.rounds) void refresh();
        lastRounds.current = status.rounds;
      }).catch(() => {});
    }, 60_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [open]);

  if (!open) return null;
  return <>
    {materialsError && <p className="preview-error" role="alert">{materialsError}</p>}
    {settingsError && <p className="preview-error" role="alert">{settingsError}</p>}
    <MailboxView
      dir={dir} materials={materials} settings={settings} apiKey={apiKey}
      onRefresh={refresh} onOpenMaterial={onOpenMaterial} onSettings={onSettings}
      onArchiveMaterial={(material) => UpdateMaterialStatus(generation, material.id, "processed")}
      onSaveDigest={async (title, markdown, sources) => {
        await SaveMailDigest(generation, title, markdown, makeMailDigestMetadata(sources));
        onChanged();
      }}
      digest={digest} onDigestChange={setDigest}
      digestTitle={digestTitle} onDigestTitleChange={setDigestTitle}
      insights={[]} personalizationOn={false}
    />
  </>;
}

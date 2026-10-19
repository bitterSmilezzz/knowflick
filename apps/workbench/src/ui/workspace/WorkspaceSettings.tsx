import {
  useState,
  useEffect,
  type FormEvent,
} from "react";
import { normalizePaperTheme, type SettingsFile, type AiSettings } from "../../domain/settings";
import { AI_PROVIDER_PRESETS, findPresetById } from "../../domain/aiPresets";
import { probeConnection } from "../../domain/aiChat";
import { inShell } from "../../shell/store";

export interface WorkspaceSettingsProps {
  file: SettingsFile;
  apiKey: string;
  reviewEnabled: boolean;
  onSave: (file: SettingsFile, key: string, reviewEnabled: boolean) => Promise<void>;
  onBack: () => void;
}

export function WorkspaceSettings({
  file,
  apiKey,
  reviewEnabled,
  onSave,
  onBack,
}: WorkspaceSettingsProps) {
  const [draftSettings, setDraftSettings] = useState<AiSettings>(file.settings);
  const [draftKey, setDraftKey] = useState(apiKey);
  const [draftReviewEnabled, setDraftReviewEnabled] = useState(reviewEnabled);

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [probeStatus, setProbeStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [probeMessage, setProbeMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraftSettings(file.settings);
    setDraftKey(apiKey);
    setDraftReviewEnabled(reviewEnabled);
  }, [file, apiKey, reviewEnabled]);

  const handleProbe = async () => {
    if (probeStatus === "testing") return;
    setProbeStatus("testing");
    setProbeMessage("正在向服务商发起连通性测试…");
    try {
      if (!inShell()) throw new Error("请在桌面客户端测试 AI 连接；浏览器体验不发送模型请求");
      await probeConnection(draftSettings, draftKey);
      setProbeStatus("success");
      setProbeMessage("连接成功：服务商响应正常");
    } catch (err: unknown) {
      setProbeStatus("error");
      const msg = err instanceof Error ? err.message : String(err) || "连接失败";
      setProbeMessage(msg);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    setSaveStatus("idle");
    setSaveMessage(null);

    const updatedFile: SettingsFile = {
      ...file,
      settings: {
        ...draftSettings,
      },
    };

    try {
      await onSave(updatedFile, draftKey, draftReviewEnabled);
      setSaveStatus("success");
      setSaveMessage("设置已成功保存");
    } catch (err: unknown) {
      setSaveStatus("error");
      const msg = err instanceof Error ? err.message : String(err) || "保存设置失败，请重试";
      setSaveMessage(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="ws-reader-scroll">
      <div className="ws-reader-inner" data-page="settings">
        <h1>设置</h1>

        {saveStatus !== "idle" && saveMessage ? (
          <div
            role={saveStatus === "error" ? "alert" : "status"}
            className="ws-feedback"
            data-status={saveStatus}
            style={{ border: 0, padding: "8px 0" }}
          >
            <span>{saveMessage}</span>
          </div>
        ) : null}

        <form id="ws-settings-form" className="ws-settings-form" onSubmit={(e) => void handleSubmit(e)}>
          <section data-group="appearance">
            <h2>外观</h2>
            <label className="ws-field">
              <span>界面外观</span>
              <select
                value={normalizePaperTheme(draftSettings.paperTheme)}
                onChange={(e) =>
                  setDraftSettings((prev) => ({ ...prev, paperTheme: e.target.value }))
                }
              >
                <option value="SYSTEM">跟随系统</option>
                <option value="LIGHT">浅色</option>
                <option value="DARK">深色</option>
              </select>
            </label>
            <p className="ws-hint">跟随系统时，系统切换深浅会立即生效，无需重启。</p>
          </section>

          <section data-group="ai">
            <h2>AI 连接</h2>

            <label className="ws-field">
              <span>服务商预设</span>
              <select
                value={draftSettings.providerId || "deepseek"}
                onChange={(e) => {
                  const pId = e.target.value;
                  const preset = findPresetById(pId);
                  if (preset && pId !== "custom") {
                    setDraftSettings((prev) => ({
                      ...prev,
                      providerId: pId,
                      baseURL: preset.baseURL,
                      model: preset.defaultModel,
                    }));
                  } else {
                    setDraftSettings((prev) => ({ ...prev, providerId: "custom" }));
                  }
                }}
              >
                {AI_PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="ws-field">
              <span>接口地址</span>
              <input
                type="text"
                value={draftSettings.baseURL}
                onChange={(e) => setDraftSettings((prev) => ({ ...prev, baseURL: e.target.value }))}
                placeholder="https://api.deepseek.com"
              />
            </label>

            <label className="ws-field">
              <span>模型</span>
              <input
                type="text"
                value={draftSettings.model}
                onChange={(e) => setDraftSettings((prev) => ({ ...prev, model: e.target.value }))}
                placeholder="deepseek-chat"
              />
            </label>

            <label className="ws-field">
              <span>API 密钥</span>
              <input
                type="password"
                autoComplete="off"
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder="输入服务商 API Key"
              />
            </label>
            <p className="ws-hint">
              桌面客户端将密钥单独存入本机文件，当前尚未接入系统钥匙串。浏览器体验仅存于当前标签页的会话存储，不包含在导出备份中。
            </p>

            <div className="ws-editor-actions">
              <button
                className="ws-bordered"
                type="button"
                onClick={() => void handleProbe()}
                disabled={probeStatus === "testing"}
              >
                {probeStatus === "testing" ? "连接测试中…" : "测试连接"}
              </button>
              {probeStatus !== "idle" && probeMessage ? (
                <span
                  className="ws-hint"
                  role={probeStatus === "error" ? "alert" : "status"}
                  data-probe-status={probeStatus}
                >
                  {probeMessage}
                </span>
              ) : null}
            </div>
          </section>

          <section data-group="modules">
            <h2>功能模块</h2>
            <label className="ws-checkbox">
              <input
                type="checkbox"
                checked={draftReviewEnabled}
                onChange={(e) => setDraftReviewEnabled(e.target.checked)}
              />
              <span>启用「温故知新」复习模块</span>
            </label>
            <p className="ws-hint">
              开启后显示 FSRS 间隔复习入口。关闭后保留知识库、搜索、录入和整理功能。当前是内置开关，第三方插件尚未接入。
            </p>
          </section>

        </form>
      </div>
      </div>
      <footer className="ws-reader-foot ws-settings-foot">
        <span>{isSaving ? "正在保存…" : "修改只在你点击保存后生效"}</span>
        <div className="ws-editor-actions">
          <button type="button" onClick={onBack} disabled={isSaving}>
            返回
          </button>
          <button
            className="ws-primary"
            type="submit"
            form="ws-settings-form"
            disabled={isSaving}
          >
            {isSaving ? "正在保存…" : "保存设置"}
          </button>
        </div>
      </footer>
    </>
  );
}

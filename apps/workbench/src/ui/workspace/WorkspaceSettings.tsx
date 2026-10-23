import { useState, useEffect, type FormEvent } from "react";
import { normalizePaperTheme, personalizationEnabled, setPersonalization, type SettingsFile, type AiSettings } from "../../domain/settings";
import { AI_PROVIDER_PRESETS, findPresetById } from "../../domain/aiPresets";
import { probeConnection } from "../../domain/aiChat";
import { OFFICIAL_PLUGINS, PERMISSION_DESCRIPTIONS } from "../../domain/pluginRegistry";
import { pluginEnabledIn, readPluginSettings, togglePluginIn, writePluginSettings } from "../../domain/pluginSettings";
import { generateMcpConfigSnippet } from "../../domain/mcpServer";
import { DEFAULT_ASR_MODEL } from "../../domain/asr";
import { AsrModelPanel } from "./AsrModelPanel";
import { LocalEmbedPanel } from "./LocalEmbedPanel";
import { inShell, type RawMaterial } from "../../shell/store";
import type { KnowledgeCard } from "../../domain/card";
import { SourceInsightPanel } from "./SourceInsightPanel";
import { Icon } from "./Icon";
import { DesktopOnlyHint } from "./DesktopOnlyHint";
import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceSettingsProps {
  file: SettingsFile;
  apiKey: string;
  reviewEnabled: boolean;
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  onSave: (file: SettingsFile, key: string, reviewEnabled: boolean) => Promise<void>;
  onBack: () => void;
  onExportMarkdown?: () => void;
  onExportKfBackup?: () => void;
  onRestoreKfBackup?: () => void;
  /** 导出与安卓同格式的 cards.json（跨端契约）。 */
  onExportCardsJson?: () => void;
  /** 导出 Anki TSV（与安卓端同格式，可直接导入 Anki）。 */
  onExportAnkiTsv?: () => void;
}

export function WorkspaceSettings({
  file,
  apiKey,
  reviewEnabled,
  materials,
  cards,
  onSave,
  onBack,
  onExportMarkdown,
  onExportKfBackup,
  onRestoreKfBackup,
  onExportCardsJson,
  onExportAnkiTsv,
}: WorkspaceSettingsProps) {
  const [draftSettings, setDraftSettings] = useState<AiSettings>(file.settings);
  const [draftKey, setDraftKey] = useState(apiKey);
  const [draftReviewEnabled, setDraftReviewEnabled] = useState(reviewEnabled);
  const [draftPlugins, setDraftPlugins] = useState(() =>
    readPluginSettings(file.raw)
  );
  const [mcpCopied, setMcpCopied] = useState(false);
  const [personalizationOn, setPersonalizationOnState] = useState(() => personalizationEnabled(file.raw));
  const [draftRaw, setDraftRaw] = useState<Record<string, unknown>>(() => file.raw);
  const asrModel =
    (draftPlugins["official-speech-asr"]?.preferences?.model as string | undefined) ?? DEFAULT_ASR_MODEL;
  const mcpSnippet = generateMcpConfigSnippet("tools/mcp-server.mjs");

  const copyMcpConfig = async () => {
    try {
      await navigator.clipboard.writeText(mcpSnippet);
      setMcpCopied(true);
      window.setTimeout(() => setMcpCopied(false), 2500);
    } catch {
      setMcpCopied(false);
    }
  };
  const [shortcutStatus, setShortcutStatus] = useState<{ shortcut: string; registered: boolean; error: string | null } | null>(null);
  useEffect(() => {
    let disposed = false;
    if (inShell()) void invoke<{ shortcut: string; registered: boolean; error: string | null }>("get_shortcut_status")
      .then(status => { if (!disposed) setShortcutStatus(status); })
      .catch(err => { if (!disposed) setShortcutStatus({ shortcut: "Alt+Space", registered: false, error: String(err) }); });
    return () => { disposed = true; };
  }, []);

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [probeStatus, setProbeStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [probeMessage, setProbeMessage] = useState<string | null>(null);

  // Re-seed the draft when the loaded settings change. The dependency is the
  // stored text, not the object: `file` is a new object on every render, and
  // depending on it would wipe the user's unsaved toggle immediately.
  const fileSettingsText = file.settings ? JSON.stringify(file.settings) : "";
  const fileRawText = JSON.stringify(file.raw);
  useEffect(() => {
    setDraftSettings(file.settings);
    setDraftKey(apiKey);
    setDraftReviewEnabled(reviewEnabled);
    setDraftPlugins(readPluginSettings(file.raw));
    setDraftRaw(file.raw);
    setPersonalizationOnState(personalizationEnabled(file.raw));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileSettingsText, fileRawText, apiKey, reviewEnabled]);

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

  const togglePersonalization = (enabled: boolean) => {
    setPersonalizationOnState(enabled);
    // The flag lives in the settings draft, so it is written on save and never
    // applied behind the user's back. Mutating `file.raw` in place would not
    // re-render and would be lost on the next settings load.
    setDraftRaw(previous => setPersonalization(previous, enabled));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    setSaveStatus("idle");
    setSaveMessage(null);

    const pluginMap = {
      ...draftPlugins,
      "official-review-fsrs": {
        ...(draftPlugins["official-review-fsrs"] ?? {}),
        enabled: draftReviewEnabled,
      },
    };

    const updatedFile: SettingsFile = {
      ...file,
      settings: {
        ...draftSettings,
      },
      raw: writePluginSettings(draftRaw, pluginMap),
    };

    try {
      await onSave(updatedFile, draftKey, draftReviewEnabled);
      // The parent now holds the saved settings; mirror it into the local state
      // so the panel next to the switch shows the saved result immediately.
      setPersonalizationOnState(personalizationEnabled(updatedFile.raw));
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

  const currentTheme = normalizePaperTheme(draftSettings.paperTheme);

  return (
    <>
      <div className="ws-reader-scroll">
        <div className="ws-reader-inner" data-page="settings" style={{ maxWidth: 680 }}>
          <header className="ws-settings-header">
            <div>
              <h1>工作台设置</h1>
              <p className="ws-hint">管理知识库外观偏好、模型服务商连接与内置功能模块。</p>
            </div>
          </header>

          {saveStatus !== "idle" && saveMessage ? (
            <div
              role={saveStatus === "error" ? "alert" : "status"}
              className="ws-feedback"
              data-status={saveStatus}
              style={{ border: 0, padding: "8px 0", marginBottom: 12 }}
            >
              <span>{saveMessage}</span>
            </div>
          ) : null}

          <form id="ws-settings-form" className="ws-settings-form" onSubmit={(e) => void handleSubmit(e)}>
            {/* 第一组：外观 */}
            <section data-group="appearance" className="ws-settings-card">
              <div className="ws-settings-card-head">
                <Icon name="star" size={15} />
                <div>
                  <h2>界面外观</h2>
                  <p className="ws-hint">选择适合长时间阅读与整理的视觉模式</p>
                </div>
              </div>

              <div className="ws-settings-row">
                <div className="ws-settings-label">
                  <strong>色彩主题</strong>
                  <span>自适应系统深浅或固定一种模式</span>
                </div>
                <div className="ws-settings-control">
                  <div className="ws-segmented-control" role="radiogroup" aria-label="界面外观选择">
                    {(
                      [
                        ["SYSTEM", "跟随系统"],
                        ["LIGHT", "浅色"],
                        ["DARK", "深色"],
                      ] as const
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        role="radio"
                        aria-checked={currentTheme === val}
                        className={currentTheme === val ? "ws-seg-active" : ""}
                        onClick={() => setDraftSettings((prev) => ({ ...prev, paperTheme: val }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* Keep select in DOM for automation & accessibility */}
                  <select
                    className="ws-hidden-select"
                    value={currentTheme}
                    onChange={(e) =>
                      setDraftSettings((prev) => ({ ...prev, paperTheme: e.target.value }))
                    }
                  >
                    <option value="SYSTEM">跟随系统</option>
                    <option value="LIGHT">浅色</option>
                    <option value="DARK">深色</option>
                  </select>
                </div>
              </div>

              <div className="ws-settings-row">
                <div className="ws-settings-label">
                  <strong>操作音效</strong>
                  <span>复习评分时的轻提示音。与 Android 端共用同一个设置项</span>
                </div>
                <div className="ws-settings-control">
                  <label className="ws-switch-label">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="操作音效"
                      aria-checked={draftSettings.soundEffectsEnabled}
                      className="ws-switch-input"
                      checked={draftSettings.soundEffectsEnabled}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, soundEffectsEnabled: e.target.checked }))}
                    />
                    <span className="ws-switch-slider" />
                  </label>
                </div>
              </div>
            </section>

            <section className="ws-settings-card" data-group="capture">
              <div className="ws-settings-card-head"><Icon name="edit" size={15} /><h2>快速记录</h2></div>
              <div className="ws-settings-body">
                <p className="ws-hint">{inShell() ? "关闭主窗口后仍可从系统托盘呼出胶囊；选择退出会结束应用。" : "全局快捷键与托盘仅在桌面客户端可用。"}</p>
                <DesktopOnlyHint text="" />
                {shortcutStatus ? <p className="ws-hint" role={shortcutStatus.registered ? "status" : "alert"}>
                  {shortcutStatus.registered ? `${/Mac/.test(navigator.platform) ? "Option+Space" : shortcutStatus.shortcut} 已注册` : `全局快捷键未注册：${shortcutStatus.error ?? "快捷键可能被其他应用占用"}。请从文件菜单或系统托盘打开胶囊。`}
                </p> : null}
                {inShell() ? <button type="button" className="ws-bordered" onClick={() => {
                  void invoke("toggle_capsule").catch(err => { setSaveStatus("error"); setSaveMessage(String(err)); });
                }}>打开闪念胶囊</button> : null}
              </div>
            </section>

            {/* 第二组：AI 连接 */}
            <section data-group="ai" className="ws-settings-card">
              <SourceInsightPanel
                materials={materials}
                cards={cards}
                enabled={personalizationOn}
                onToggle={togglePersonalization}
              />

              <div className="ws-settings-card-head">
                <Icon name="ask" size={15} />
                <div>
                  <h2>AI 模型连接</h2>
                  <p className="ws-hint">用于素材提炼、知识问答与卡片标签建议</p>
                </div>
              </div>

              <div className="ws-settings-body">
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

                <div className="ws-field-grid">
                  <label className="ws-field">
                    <span>接口地址 (Base URL)</span>
                    <input
                      type="text"
                      value={draftSettings.baseURL}
                      onChange={(e) =>
                        setDraftSettings((prev) => ({ ...prev, baseURL: e.target.value }))
                      }
                      placeholder="https://api.deepseek.com"
                    />
                  </label>

                  <label className="ws-field">
                    <span>模型名称</span>
                    <input
                      type="text"
                      value={draftSettings.model}
                      onChange={(e) =>
                        setDraftSettings((prev) => ({ ...prev, model: e.target.value }))
                      }
                      placeholder="deepseek-chat"
                    />
                  </label>
                </div>

                <label className="ws-field">
                  <span>API 密钥 (API Key)</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </label>

                <p className="ws-hint">
                  密钥单独存放于本机数据目录；浏览器体验模式仅在当前会话生效。
                </p>

                <div className="ws-probe-row">
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
              </div>
            </section>

            {/* 第三组：官方插件矩阵 (PLUGIN_SPECIFICATION.md §4) */}
            <section data-group="modules" className="ws-settings-card">
              <div className="ws-settings-card-head">
                <Icon name="layers" size={15} />
                <div>
                  <h2>功能模块与官方插件</h2>
                  <p className="ws-hint">
                    插件按清单声明权限后按需启用；关闭的插件不加载代码、不注册监听、不占用内存
                  </p>
                </div>
              </div>

              <div className="ws-plugin-list">
                {OFFICIAL_PLUGINS.map((plugin) => {
                  const enabled =
                    plugin.id === "official-review-fsrs"
                      ? draftReviewEnabled
                      : pluginEnabledIn(
                          { ...file.raw, plugins: { ...readPluginSettings(file.raw), ...draftPlugins } },
                          plugin.id,
                          false
                        );
                  const unavailable = plugin.availability !== "ready";
                  return (
                    <div className="ws-settings-row" key={plugin.id} data-plugin={plugin.id}>
                      <div className="ws-settings-label">
                        <strong>
                          {plugin.name}
                          {unavailable ? (
                            <em className="ws-plugin-badge" data-plugin-availability={plugin.availability}>
                              {plugin.availability === "needs-download" ? "需下载模型" : "待接入"}
                            </em>
                          ) : null}
                        </strong>
                        <span>{plugin.description}</span>
                        {plugin.availabilityNote ? (
                          <span className="ws-plugin-note">{plugin.availabilityNote}</span>
                        ) : null}
                        <span className="ws-plugin-perms">
                          {plugin.permissions.map((perm) => (
                            <em key={perm} title={PERMISSION_DESCRIPTIONS[perm]}>
                              {perm}
                            </em>
                          ))}
                        </span>
                        {plugin.id === "official-speech-asr" ? (
                          <AsrModelPanel
                            model={asrModel}
                            onModelChange={(next) => {
                              setDraftPlugins((prev) => ({
                                ...prev,
                                "official-speech-asr": {
                                  enabled: prev["official-speech-asr"]?.enabled ?? false,
                                  preferences: {
                                    ...(prev["official-speech-asr"]?.preferences ?? {}),
                                    model: next,
                                  },
                                },
                              }));
                            }}
                          />
                        ) : null}
                      </div>
                      <div className="ws-settings-control">
                        <label className="ws-switch-label" aria-label={`启用${plugin.name}`}>
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`启用${plugin.name}`}
                            aria-checked={enabled}
                            data-plugin-toggle={plugin.id}
                            className="ws-switch-input"
                            checked={enabled}
                            onChange={(e) => {
                              if (plugin.id === "official-review-fsrs") {
                                setDraftReviewEnabled(e.target.checked);
                              } else {
                                setDraftPlugins((prev) =>
                                  togglePluginIn({ plugins: prev }, plugin.id, e.target.checked)
                                );
                              }
                            }}
                          />
                          <span className="ws-switch-slider" />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 第四组：数据主权与开放导出 (M4) */}
            <section data-group="data" className="ws-settings-card">
              <div className="ws-settings-card-head">
                <Icon name="archive" size={15} />
                <div>
                  <h2>数据主权与开放导出</h2>
                  <p className="ws-hint">数据完全归你所有，支持导出为通用格式与外部工具互通</p>
                </div>
              </div>

              <div className="ws-settings-body">
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="ws-bordered"
                    onClick={onExportMarkdown}
                  >
                    导出 Markdown 知识库 (Obsidian 友好)
                  </button>
                  <button
                    type="button"
                    className="ws-bordered"
                    data-action="export-anki-tsv"
                    onClick={onExportAnkiTsv}
                  >
                    导出 Anki 词表 (.tsv)
                  </button>
                  <button
                    type="button"
                    className="ws-bordered"
                    data-action="export-kfbackup"
                    onClick={onExportKfBackup}
                  >
                    导出完整备份包 (.kfbackup)
                  </button>
                  <button
                    type="button"
                    className="ws-bordered"
                    data-action="restore-kfbackup"
                    onClick={onRestoreKfBackup}
                  >
                    从备份包恢复…
                  </button>
                  {onExportCardsJson ? (
                    <button
                      type="button"
                      className="ws-bordered"
                      data-action="export-cards-json"
                      onClick={onExportCardsJson}
                    >
                      导出 cards.json（给安卓用）
                    </button>
                  ) : (
                    // 浏览器体验没有本地文件系统，导不出文件——说清楚原因，
                    // 好过让这个按钮凭空消失。
                    <>
                      <span className="ws-hint">导出 cards.json 需要桌面客户端（浏览器体验没有本地文件系统）。</span>
                      <DesktopOnlyHint text="" />
                    </>
                  )}
                </div>
                <p className="ws-hint" style={{ margin: 0 }}>
                  Markdown 归档带 YAML Frontmatter，按分类与收件箱分目录，可直接在 Obsidian 打开；
                  `.kfbackup` 是含清单、校验和与全部层级（素材 / 卡片 / 设置 / 认知产物）的完整备份，可无损还原；
                  `cards.json` 是与安卓端同一份线格式，拷过去就能打开；
                  `.tsv` 是 Anki 可直接导入的词表（正面主张 / 背面解析 / 分类）。
                </p>
              </div>
            </section>

            <LocalEmbedPanel />

            {/* 第五组：MCP 外部 Agent 接入 (PLUGIN_SPECIFICATION.md §6) */}
            <section data-group="mcp" className="ws-settings-card">
              <div className="ws-settings-card-head">
                <Icon name="code" size={15} />
                <div>
                  <h2>MCP 外部代理接入</h2>
                  <p className="ws-hint">
                    让 Cursor / Claude Code / DeepSeek Harness 把这个知识库当作统一外部记忆库调用
                  </p>
                </div>
              </div>

              <div className="ws-settings-body">
                <div className="ws-settings-row" style={{ padding: 0 }}>
                  <div className="ws-settings-label">
                    <strong>Model Context Protocol (stdio)</strong>
                    <span>
                      暴露 search_knowledge / create_flash_card / add_material / get_weekly_briefing /
                      get_knowledge_stats 五个工具，以及 knowflick:// 资源
                    </span>
                  </div>
                  <div className="ws-settings-control">
                    <button
                      type="button"
                      className="ws-bordered"
                      data-action="copy-mcp-config"
                      onClick={() => void copyMcpConfig()}
                    >
                      {mcpCopied ? "已复制配置片段" : "复制 MCP 配置"}
                    </button>
                  </div>
                </div>
                <pre className="ws-mcp-snippet" data-mcp-snippet>{mcpSnippet}</pre>
              </div>
            </section>
          </form>
        </div>
      </div>

      <footer className="ws-reader-foot ws-settings-foot">
        <span>{isSaving ? "正在保存…" : "修改在点击保存后立即生效"}</span>
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

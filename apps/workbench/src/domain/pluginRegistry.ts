/**
 * KnowFlick 官方插件注册表与权限契约
 * 遵循 docs/PLUGIN_SPECIFICATION.md 规范：零开销禁用、细粒度权限声明、官方插件矩阵
 */

export type PluginPermission =
  | "network:fetch"
  | "network:listen"
  | "clipboard:read"
  | "fs:read_temp"
  | "storage:materials:read"
  | "storage:materials:write"
  | "storage:cards:read"
  | "storage:cards:write"
  | "storage:artifacts:write"
  | "ui:views:register";

export interface PluginPreferenceDef {
  name: string;
  type: "select" | "number" | "boolean" | "text";
  title: string;
  default: unknown;
  options?: Array<{ label: string; value: unknown }>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  type: "official" | "community";
  defaultEnabled: boolean;
  permissions: PluginPermission[];
  preferences?: PluginPreferenceDef[];
}

export interface PluginState {
  enabled: boolean;
  preferences?: Record<string, unknown>;
}

export type PluginSettingsMap = Record<string, PluginState>;

/** 官方内置插件矩阵 (PLUGIN_SPECIFICATION.md §4) */
export const OFFICIAL_PLUGINS: readonly PluginManifest[] = [
  {
    id: "official-inbox-sniff",
    name: "多平台智能链接嗅探器",
    version: "1.0.0",
    description: "针对 GitHub 仓库/README、B站视频接口及通用网页自动嗅探并提取核心正文与元数据",
    author: "KnowFlick Official",
    icon: "link",
    type: "official",
    defaultEnabled: true,
    permissions: ["network:fetch", "storage:materials:write"],
  },
  {
    id: "official-doc-extractor",
    name: "本地文档大纲与切片解析器",
    version: "1.0.0",
    description: "纯本地离线解析 Word (.docx)、PDF 文本流、Markdown 与 TXT 标题层级树",
    author: "KnowFlick Official",
    icon: "file-text",
    type: "official",
    defaultEnabled: true,
    permissions: ["fs:read_temp", "storage:materials:write"],
  },
  {
    id: "official-review-fsrs",
    name: "温故知新（FSRS 间隔复习）",
    version: "1.0.0",
    description: "基于现代 FSRS 算法的滑动翻转闪卡测验、掌握度分布与未来 7 天到期负荷预测",
    author: "KnowFlick Official",
    icon: "sparkles",
    type: "official",
    defaultEnabled: false,
    permissions: ["storage:cards:read", "storage:cards:write", "ui:views:register"],
    preferences: [
      {
        name: "algorithm",
        type: "select",
        title: "记忆算法",
        default: "fsrs",
        options: [
          { label: "FSRS 现代间隔复习算法", value: "fsrs" },
          { label: "SM-2 传统算法", value: "sm2" },
        ],
      },
    ],
  },
  {
    id: "official-cognitive-brief",
    name: "认知简报与知识周报",
    version: "1.0.0",
    description: "周期性聚类本周新收录知识点、洞察关注趋势、推荐待温故卡片并支持一键持久化落库",
    author: "KnowFlick Official",
    icon: "brief",
    type: "official",
    defaultEnabled: true,
    permissions: ["storage:cards:read", "storage:artifacts:write"],
  },
  {
    id: "official-mcp-server",
    name: "MCP 外部代理协议服务",
    version: "1.0.0",
    description: "向 Cursor、Claude Code、DeepSeek Harness 等外部 Agent 暴露 Model Context Protocol 统一知识记忆库",
    author: "KnowFlick Official",
    icon: "cpu",
    type: "official",
    defaultEnabled: true,
    permissions: ["storage:cards:read", "storage:materials:write"],
  },
];

export const PERMISSION_DESCRIPTIONS: Record<PluginPermission, string> = {
  "network:fetch": "发起网络抓取请求",
  "network:listen": "监听本地通信端口",
  "clipboard:read": "读取系统剪贴板",
  "fs:read_temp": "读取导入文件",
  "storage:materials:read": "读取原始素材",
  "storage:materials:write": "写入收件箱素材",
  "storage:cards:read": "检索与读取知识卡",
  "storage:cards:write": "修改卡片与复习状态",
  "storage:artifacts:write": "持久化认知产物",
  "ui:views:register": "注册专属导航视图",
};

/** 查询某插件的当前启用状态 */
export function isPluginEnabled(
  pluginId: string,
  settingsMap: PluginSettingsMap = {},
  fallbackReviewEnabled = false
): boolean {
  // 特殊兼容：旧 settings.raw.reviewPluginEnabled 直接映射至 official-review-fsrs
  if (pluginId === "official-review-fsrs" && fallbackReviewEnabled) {
    if (settingsMap[pluginId] === undefined) return true;
  }

  const manifest = OFFICIAL_PLUGINS.find((p) => p.id === pluginId);
  const state = settingsMap[pluginId];
  if (state !== undefined) return state.enabled;
  return manifest ? manifest.defaultEnabled : false;
}

/** 切换插件启用状态 */
export function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
  currentSettings: PluginSettingsMap = {}
): PluginSettingsMap {
  const existing = currentSettings[pluginId] || { enabled: false };
  return {
    ...currentSettings,
    [pluginId]: {
      ...existing,
      enabled,
    },
  };
}

/** 获取插件的全部配置值（含默认值回退） */
export function getPluginPreferenceValues(
  pluginId: string,
  settingsMap: PluginSettingsMap = {}
): Record<string, unknown> {
  const manifest = OFFICIAL_PLUGINS.find((p) => p.id === pluginId);
  const userPrefs = settingsMap[pluginId]?.preferences || {};
  const result: Record<string, unknown> = {};

  if (manifest?.preferences) {
    for (const pref of manifest.preferences) {
      result[pref.name] = userPrefs[pref.name] !== undefined ? userPrefs[pref.name] : pref.default;
    }
  }

  return { ...result, ...userPrefs };
}

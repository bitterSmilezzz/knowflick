import {
  OFFICIAL_PLUGINS,
  getPluginPreferenceValues,
  isPluginEnabled,
  setPluginEnabled,
  type PluginSettingsMap,
} from "./pluginRegistry";

/**
 * 插件状态在 settings.json 里存成一个独立的顶层键 `plugins`。
 *
 * 为什么是这个形状：settings.json 里已有的键（providerId/baseURL/... 与 paperTheme）
 * 是**跨端线格式**——安卓的 `AiSettings` 也读同一份文件，键名与取值都有约定（见
 * settings.ts 顶部注释）。插件是桌面端独有的能力，所以单独开一个键，让老端读不懂时
 * 原样忽略，也不会被桌面端误当成安卓字段写坏。
 */
const PLUGINS_KEY = "plugins";

function readMap(raw: Record<string, unknown>): PluginSettingsMap {
  const value = raw[PLUGINS_KEY];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const map: PluginSettingsMap = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const node = entry as Record<string, unknown>;
    map[id] = {
      enabled: node.enabled === true,
      preferences:
        node.preferences !== null && typeof node.preferences === "object" && !Array.isArray(node.preferences)
          ? (node.preferences as Record<string, unknown>)
          : {},
    };
  }
  return map;
}

/**
 * 读插件表。老用户的 settings.json 里只有 `reviewPluginEnabled` 这一个布尔键
 * （温故复习当时还没做成插件），这里**不**把它折进插件表——那张表代表
 * 「用户显式点过插件开关」，一旦写了就会盖掉旧键。旧键的兼容交给
 * `pluginEnabledIn`：表里没这个插件时以旧键为准。
 */
export function readPluginSettings(raw: Record<string, unknown>): PluginSettingsMap {
  return readMap(raw);
}

/** 写回 settings.json：保留其余键，只替换 `plugins` 一节的启用状态。 */
export function writePluginSettings(
  raw: Record<string, unknown>,
  map: PluginSettingsMap
): Record<string, unknown> {
  const next = { ...raw };
  if (Object.keys(map).length === 0) {
    delete next[PLUGINS_KEY];
    return next;
  }
  const serialized: Record<string, unknown> = {};
  for (const [id, state] of Object.entries(map)) {
    const manifest = OFFICIAL_PLUGINS.find((plugin) => plugin.id === id);
    const entry: Record<string, unknown> = { enabled: state.enabled };
    const prefs = state.preferences ?? {};
    // 只落库与默认值不同的偏好，避免把默认值冻进用户文件。
    const defaults = manifest ? getPluginPreferenceValues(id, {}) : {};
    const diff: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(prefs)) {
      if (defaults[key] !== val) diff[key] = val;
    }
    if (Object.keys(diff).length > 0) entry.preferences = diff;
    serialized[id] = entry;
  }
  next[PLUGINS_KEY] = serialized;
  return next;
}

/** 读取单个插件是否启用（旧键兼容逻辑只在这里一处）。 */
export function pluginEnabledIn(
  raw: Record<string, unknown>,
  pluginId: string,
  legacyReviewEnabled = false
): boolean {
  const map = readPluginSettings(raw);
  // 显式写过插件表就听插件表，否则回落到旧键 / 清单默认值。
  if (map[pluginId] !== undefined) return map[pluginId].enabled;
  return isPluginEnabled(pluginId, {}, legacyReviewEnabled);
}

/** 切换一个插件并返回新的插件表。 */
export function togglePluginIn(
  raw: Record<string, unknown>,
  pluginId: string,
  enabled: boolean
): PluginSettingsMap {
  return setPluginEnabled(pluginId, enabled, readPluginSettings(raw));
}

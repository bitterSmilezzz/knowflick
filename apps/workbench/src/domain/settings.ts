/** settings.json 与 Kotlin `AiSettings` 同键。未知键原样保留，避免写回时丢掉安卓以后新增的字段。 */

export interface AiSettings {
  providerId: string;
  baseURL: string;
  model: string;
  autoGenerate: boolean;
  enableAI: boolean;
  showAIMark: boolean;
  preferredCategories: string[];
  paperTheme: string;
  soundEffectsEnabled: boolean;
}

/**
 * 界面外观只有三档（spec §4）：跟随系统 / 浅色 / 深色。
 *
 * `paperTheme` 这个键名与 Kotlin `AiSettings` 共用，而安卓的 `PaperTheme` 枚举
 * 认的是 `RICE_PAPER` / `WARM_OBSIDIAN`（`shared-ui` 的 `PaperTheme.fromName`）。
 * 所以这里内部用三档规范值，**写盘时映射回两端都认识的旧名称**：
 * `LIGHT → RICE_PAPER`、`DARK → WARM_OBSIDIAN`。改键名或直接写 LIGHT/DARK
 * 会让安卓把它读成 SYSTEM，跨端主题失效。
 */
export const PAPER_THEMES = ["SYSTEM", "LIGHT", "DARK"] as const;
export type PaperTheme = (typeof PAPER_THEMES)[number];

/** 内部三档 → settings.json 的线格式（安卓可读）。 */
const WIRE_PAPER_THEMES: Record<PaperTheme, string> = {
  SYSTEM: "SYSTEM",
  LIGHT: "RICE_PAPER",
  DARK: "WARM_OBSIDIAN",
};

/** settings.json 的线格式 → 内部三档。 */
const LEGACY_PAPER_THEMES: Record<string, PaperTheme> = {
  SYSTEM: "SYSTEM",
  RICE_PAPER: "LIGHT",
  PARCHMENT: "LIGHT",
  MORNING_MIST: "LIGHT",
  WARM_OBSIDIAN: "DARK",
  LIGHT: "LIGHT",
  DARK: "DARK",
};

export function normalizePaperTheme(value: unknown): PaperTheme {
  if (typeof value !== "string") return "SYSTEM";
  return LEGACY_PAPER_THEMES[value.trim().toUpperCase()] ?? "SYSTEM";
}

/** 供 `encodeSettings` 使用：写盘保持安卓可读的旧名称。 */
export function encodePaperTheme(theme: PaperTheme): string {
  return WIRE_PAPER_THEMES[theme] ?? "SYSTEM";
}

export const defaultSettings: AiSettings = {
  providerId: "deepseek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-chat",
  autoGenerate: true,
  enableAI: true,
  showAIMark: true,
  preferredCategories: [],
  paperTheme: "SYSTEM",
  soundEffectsEnabled: true,
};

export interface SettingsFile {
  settings: AiSettings;
  raw: Record<string, unknown>;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseSettings(text: string | null): SettingsFile {
  if (!text) return { settings: { ...defaultSettings }, raw: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { settings: { ...defaultSettings }, raw: {} };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { settings: { ...defaultSettings }, raw: {} };
  }
  const raw = parsed as Record<string, unknown>;
  const settings: AiSettings = {
    providerId: typeof raw.providerId === "string" ? raw.providerId : defaultSettings.providerId,
    baseURL: typeof raw.baseURL === "string" ? raw.baseURL : defaultSettings.baseURL,
    model: typeof raw.model === "string" ? raw.model : defaultSettings.model,
    autoGenerate: asBool(raw.autoGenerate, defaultSettings.autoGenerate),
    enableAI: asBool(raw.enableAI, defaultSettings.enableAI),
    showAIMark: asBool(raw.showAIMark, defaultSettings.showAIMark),
    preferredCategories: asStringList(raw.preferredCategories),
    paperTheme: normalizePaperTheme(raw.paperTheme),
    soundEffectsEnabled: asBool(raw.soundEffectsEnabled, defaultSettings.soundEffectsEnabled),
  };
  return { settings, raw };
}

export function encodeSettings(file: SettingsFile): string {
  return JSON.stringify({
    ...file.raw,
    providerId: file.settings.providerId,
    baseURL: file.settings.baseURL,
    model: file.settings.model,
    autoGenerate: file.settings.autoGenerate,
    enableAI: file.settings.enableAI,
    showAIMark: file.settings.showAIMark,
    preferredCategories: file.settings.preferredCategories,
    paperTheme: encodePaperTheme(file.settings.paperTheme as PaperTheme),
    soundEffectsEnabled: file.settings.soundEffectsEnabled,
  });
}

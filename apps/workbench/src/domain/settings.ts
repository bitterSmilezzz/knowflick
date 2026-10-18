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
    paperTheme: typeof raw.paperTheme === "string" ? raw.paperTheme : defaultSettings.paperTheme,
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
    paperTheme: file.settings.paperTheme,
    soundEffectsEnabled: file.settings.soundEffectsEnabled,
  });
}

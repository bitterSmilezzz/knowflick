import { describe, expect, it } from "vitest";
import { defaultSettings, encodeSettings, parseSettings } from "./settings";

describe("settings", () => {
  it("round-trips known fields and keeps unknown keys", () => {
    const text = JSON.stringify({
      spacedAlgorithm: "fsrs",
      providerId: "openai",
      baseURL: "https://api.example.com/v1",
      model: "gpt-4o-mini",
      enableAI: false,
      preferredCategories: ["物理", "历史"],
      paperTheme: "PARCHMENT",
      legacyToggle: true,
    });
    const file = parseSettings(text);
    expect(file.settings.enableAI).toBe(false);
    expect(file.settings.preferredCategories).toEqual(["物理", "历史"]);
    expect(file.settings.paperTheme).toBe("LIGHT");
    expect(file.raw.legacyToggle).toBe(true);
    expect(file.raw.spacedAlgorithm).toBe("fsrs");
    const parsed = JSON.parse(encodeSettings(file));
    expect(parsed.spacedAlgorithm).toBe("fsrs");
    expect(parsed.legacyToggle).toBe(true);
    expect(parsed.preferredCategories).toEqual(["物理", "历史"]);
  });

  it("normalizes legacy and unknown paper themes to the three shipped values", () => {
    expect(parseSettings(JSON.stringify({ paperTheme: "RICE_PAPER" })).settings.paperTheme).toBe("LIGHT");
    expect(parseSettings(JSON.stringify({ paperTheme: "WARM_OBSIDIAN" })).settings.paperTheme).toBe("DARK");
    expect(parseSettings(JSON.stringify({ paperTheme: "DARK" })).settings.paperTheme).toBe("DARK");
    expect(parseSettings(JSON.stringify({ paperTheme: "neon" })).settings.paperTheme).toBe("SYSTEM");
    expect(parseSettings(JSON.stringify({ paperTheme: 7 })).settings.paperTheme).toBe("SYSTEM");
  });

  it("falls back to defaults for invalid json", () => {
    const file = parseSettings("{not json");
    expect(file.settings).toEqual(defaultSettings);
  });
});

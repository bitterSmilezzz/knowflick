import { describe, expect, it } from "vitest";
import {
  OFFICIAL_PLUGINS,
  PERMISSION_DESCRIPTIONS,
  isPluginEnabled,
  setPluginEnabled,
  getPluginPreferenceValues,
} from "./pluginRegistry";

describe("插件架构与注册表 (PluginRegistry)", () => {
  it("包含 PLUGIN_SPECIFICATION §4 的全部官方插件且都有清单与权限声明", () => {
    const ids = OFFICIAL_PLUGINS.map((p) => p.id);
    for (const specId of [
      "official-inbox-sniff",
      "official-doc-extractor",
      "official-review-fsrs",
      "official-speech-asr",
      "official-cognitive-brief",
    ]) {
      expect(ids).toContain(specId);
    }
    expect(ids).toContain("official-mcp-server");
    expect(OFFICIAL_PLUGINS.length).toBe(6);

    for (const plugin of OFFICIAL_PLUGINS) {
      expect(plugin.name).toBeTruthy();
      expect(plugin.description).toBeTruthy();
      expect(plugin.author).toBe("KnowFlick Official");
      expect(plugin.permissions.length).toBeGreaterThan(0);
      for (const perm of plugin.permissions) {
        expect(PERMISSION_DESCRIPTIONS[perm]).toBeTruthy();
      }
    }
  });

  it("未就绪的插件如实标注状态，不假装可用", () => {
    const asr = OFFICIAL_PLUGINS.find((p) => p.id === "official-speech-asr");
    expect(asr).toBeTruthy();
    expect(asr?.availability).toBe("needs-download");
    expect(asr?.availabilityNote).toBeTruthy();
    expect(asr?.defaultEnabled).toBe(false);

    // 已经能用的插件不该带 availabilityNote
    for (const plugin of OFFICIAL_PLUGINS.filter((p) => p.availability === "ready")) {
      expect(plugin.availabilityNote).toBeUndefined();
    }
  });

  it("插件启用状态查询与默认值回退", () => {
    // 默认嗅探器是开启的
    expect(isPluginEnabled("official-inbox-sniff", {})).toBe(true);
    // 默认温故复习是关闭的
    expect(isPluginEnabled("official-review-fsrs", {})).toBe(false);

    // 兼容历史 raw.reviewPluginEnabled
    expect(isPluginEnabled("official-review-fsrs", {}, true)).toBe(true);
    // 用户显式关闭优先级最高
    expect(
      isPluginEnabled("official-review-fsrs", { "official-review-fsrs": { enabled: false } }, true)
    ).toBe(false);
  });

  it("支持更新插件启用状态", () => {
    const s1 = setPluginEnabled("official-review-fsrs", true, {});
    expect(isPluginEnabled("official-review-fsrs", s1)).toBe(true);

    const s2 = setPluginEnabled("official-inbox-sniff", false, s1);
    expect(isPluginEnabled("official-inbox-sniff", s2)).toBe(false);
    expect(isPluginEnabled("official-review-fsrs", s2)).toBe(true);
  });

  it("偏好设置项与默认值合并", () => {
    const prefs1 = getPluginPreferenceValues("official-review-fsrs", {});
    expect(prefs1.algorithm).toBe("fsrs");

    const prefs2 = getPluginPreferenceValues("official-review-fsrs", {
      "official-review-fsrs": {
        enabled: true,
        preferences: { algorithm: "sm2", customTarget: 30 },
      },
    });
    expect(prefs2.algorithm).toBe("sm2");
    expect(prefs2.customTarget).toBe(30);
  });
});

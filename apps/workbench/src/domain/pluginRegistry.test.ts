import { describe, expect, it } from "vitest";
import {
  OFFICIAL_PLUGINS,
  PERMISSION_DESCRIPTIONS,
  isPluginEnabled,
  setPluginEnabled,
  getPluginPreferenceValues,
} from "./pluginRegistry";

describe("插件架构与注册表 (PluginRegistry)", () => {
  it("包含 5 个官方核心插件且全部具备规范清单与权限声明", () => {
    expect(OFFICIAL_PLUGINS.length).toBe(5);
    const ids = OFFICIAL_PLUGINS.map((p) => p.id);
    expect(ids).toContain("official-inbox-sniff");
    expect(ids).toContain("official-doc-extractor");
    expect(ids).toContain("official-review-fsrs");
    expect(ids).toContain("official-cognitive-brief");
    expect(ids).toContain("official-mcp-server");

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

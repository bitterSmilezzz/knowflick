import { describe, expect, it } from "vitest";
import {
  readPluginSettings,
  writePluginSettings,
  pluginEnabledIn,
  togglePluginIn,
} from "./pluginSettings";

describe("插件状态在 settings.json 中的持久化", () => {
  it("老用户只有 reviewPluginEnabled 时，温故插件按旧键算开启", () => {
    expect(pluginEnabledIn({ reviewPluginEnabled: true }, "official-review-fsrs", true)).toBe(true);
    expect(pluginEnabledIn({ reviewPluginEnabled: false }, "official-review-fsrs", false)).toBe(false);
  });

  it("未写过插件表时回落到清单默认值", () => {
    // 嗅探器默认开、温故默认关
    expect(pluginEnabledIn({}, "official-inbox-sniff")).toBe(true);
    expect(pluginEnabledIn({}, "official-review-fsrs")).toBe(false);
  });

  it("插件表一旦显式写过，就以插件表为准而非旧键", () => {
    const raw = { plugins: { "official-review-fsrs": { enabled: false } } };
    // 旧键说开，但用户在插件页显式关过
    expect(pluginEnabledIn(raw, "official-review-fsrs", true)).toBe(false);
  });

  it("写回插件表不会把旧键折进来（否则会盖掉旧值）", () => {
    const map = readPluginSettings({ reviewPluginEnabled: true });
    expect(map["official-review-fsrs"]).toBeUndefined();
  });

  it("togglePluginIn 保留其它插件状态", () => {
    const raw = { plugins: { "official-inbox-sniff": { enabled: false } } };
    const next = togglePluginIn(raw, "official-review-fsrs", true);
    expect(next["official-inbox-sniff"].enabled).toBe(false);
    expect(next["official-review-fsrs"].enabled).toBe(true);
  });

  it("writePluginSettings 保留 settings.json 的其余键", () => {
    const raw = { providerId: "deepseek", paperTheme: "RICE_PAPER", reviewPluginEnabled: true };
    const written = writePluginSettings(raw, { "official-review-fsrs": { enabled: true } });
    expect(written.providerId).toBe("deepseek");
    expect(written.paperTheme).toBe("RICE_PAPER");
    expect(written.reviewPluginEnabled).toBe(true);
    const plugins = written.plugins as Record<string, { enabled: boolean }>;
    expect(plugins["official-review-fsrs"].enabled).toBe(true);
  });

  it("只把与默认值不同的偏好写进文件", () => {
    const raw = {};
    const written = writePluginSettings(raw, {
      "official-review-fsrs": { enabled: true, preferences: { algorithm: "fsrs", dailyTarget: 50 } },
    });
    const plugins = written.plugins as Record<string, { preferences?: Record<string, unknown> }>;
    // algorithm 的默认值就是 fsrs，不该冻进用户文件
    expect(plugins["official-review-fsrs"].preferences).toEqual({ dailyTarget: 50 });
  });

  it("插件表为空时清掉该键，不留空对象", () => {
    const written = writePluginSettings({ providerId: "deepseek" }, {});
    expect("plugins" in written).toBe(false);
  });

  it("非对象或数组形状的 plugins 键按空表处理，不抛异常", () => {
    expect(readPluginSettings({ plugins: "oops" })).toEqual({});
    expect(readPluginSettings({ plugins: [1, 2, 3] })).toEqual({});
    expect(readPluginSettings({ plugins: { bad: 42 } })).toEqual({});
  });
});

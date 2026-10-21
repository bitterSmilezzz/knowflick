import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawMaterial } from "../../shell/store";

/**
 * 浏览器体验库只有一个 localStorage key（整库 + 设置 + 卡片）。
 * 配额一超，`setItem` 抛 QuotaExceededError；如果把它原样抛给用户，
 * 收到的是一串英文异常，还会以为内容已经存住了。
 */
describe("浏览器库配额", () => {
  afterEach(() => vi.unstubAllGlobals());

  const material: RawMaterial = {
    id: "m1", sourceType: "manual", title: "标题", sourceUrl: null, rawText: "正文",
    contentHash: "", mediaPath: null, mediaSizeBytes: 0, metadataJson: "{}",
    inboxStatus: "inbox", createdAt: 1, updatedAt: 1,
  };

  function stubStorage(throwQuota: boolean) {
    const key = "knowflick.workspace.v1";
    const store: Record<string, string> = {
      [key]: JSON.stringify({ materials: [], cards: [], settings: "{}" }),
    };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        if (throwQuota) {
          const err = new DOMException("The quota has been exceeded.", "QuotaExceededError");
          throw err;
        }
        store[k] = v;
      },
      removeItem: (k: string) => { delete store[k]; },
      length: Object.keys(store).length,
    });
  }

  it("写满时报一句中文，并说明内容没保存", async () => {
    stubStorage(true);
    const { storeMaterial } = await import("./repository");
    await expect(storeMaterial(material, "")).rejects.toThrow(/浏览器存储已满.*没能保存/);
  });

  it("配额正常时照常保存", async () => {
    stubStorage(false);
    const { storeMaterial, readWorkspace } = await import("./repository");
    await storeMaterial(material, "");
    const snapshot = await readWorkspace();
    expect(snapshot.materials.map(m => m.id)).toContain("m1");
  });

  it("配额异常带上当前体积，方便判断还能塞多少", async () => {
    stubStorage(true);
    const { storeMaterial } = await import("./repository");
    await expect(storeMaterial(material, "")).rejects.toThrow(/约 [\d.]+ MB/);
  });
});

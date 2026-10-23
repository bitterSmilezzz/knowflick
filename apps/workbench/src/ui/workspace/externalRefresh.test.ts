import { describe, expect, it } from "vitest";
import {
  EXTERNAL_REFRESH_INTERVAL_MS,
  externalChangeDetected,
} from "./externalRefresh";

describe("外部写入的刷新判定", () => {
  it("签名变了就是要刷新", () => {
    expect(externalChangeDetected("a", "b")).toBe(true);
  });

  it("签名没变就不刷新（避免无意义的重载）", () => {
    expect(externalChangeDetected("a", "a")).toBe(false);
  });

  it("第一次拿到签名**不**刷新——那是建立基线，不是发现改动", () => {
    // 这条很关键：否则应用启动后第一轮轮询就会白刷新一次。
    expect(externalChangeDetected("", "a")).toBe(false);
  });

  it("轮询间隔要短到用户等得起，又不能太频繁", () => {
    expect(EXTERNAL_REFRESH_INTERVAL_MS).toBeGreaterThan(0);
    expect(EXTERNAL_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(5000);
  });
});

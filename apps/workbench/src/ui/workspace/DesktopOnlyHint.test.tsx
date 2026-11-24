import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesktopOnlyHint, DESKTOP_DOWNLOAD_URL } from "./DesktopOnlyHint";

/**
 * 「去桌面端」的入口。
 *
 * 关键的两条：
 * 1. 浏览器体验下要有可点的路（被告知要去，却没地方去，是断链）；
 * 2. 桌面端**不能**显示这个按钮——它本来就能用，提示「去桌面端」是错的。
 */
describe("去桌面端的入口", () => {
  afterEach(() => {
    delete (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("浏览器体验下给出可点的下载入口", () => {
    const html = renderToStaticMarkup(<DesktopOnlyHint text="录音保存不了" />);
    expect(html).toContain("下载桌面客户端");
    expect(html).toContain("录音保存不了");
  });

  it("下载地址指向公开仓库的 Releases", () => {
    expect(DESKTOP_DOWNLOAD_URL).toContain("github.com");
    expect(DESKTOP_DOWNLOAD_URL).toContain("releases");
  });

  it("桌面端不显示「去桌面端」的提示（本来就能用，提示是错的）", () => {
    // 桌面端：Tauri 注入了 __TAURI_INTERNALS__，inShell() 为真。
    (globalThis as unknown as { window: Record<string, unknown> }).window = { __TAURI_INTERNALS__: {} };
    const html = renderToStaticMarkup(<DesktopOnlyHint text="录音保存不了" />);
    expect(html).not.toContain("下载桌面客户端");
    expect(html).not.toContain("录音保存不了");
  });
});

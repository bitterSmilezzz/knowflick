import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EntryInspector } from "./EntryInspector";
import type { Entry } from "./model";
import { cardFromJson } from "../../domain/card";

const noop = async () => {};
function entry(extra: Partial<Entry>): Entry {
  return {
    id: "m1", kind: "material", title: "手写笔记", text: "（手写笔记，2 笔）",
    searchText: "（手写笔记，2 笔）", category: "手写笔记", tags: [],
    date: Date.now(), url: "", ...extra,
    original: extra.original ?? {
      id: "m1", sourceType: "ink", title: "手写笔记", sourceUrl: null,
      rawText: "（手写笔记，2 笔）", contentHash: "", mediaPath: "media/ink/x.json",
      mediaSizeBytes: 10, metadataJson: JSON.stringify({
        savedInline: true,
        ink: { version: 1, width: 800, height: 400, strokes: [
          { points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.6 }], width: 0.004, color: "ink" },
          { points: [{ x: 0.4, y: 0.4 }, { x: 0.9, y: 0.7 }], width: 0.004, color: "ink" },
        ] },
      }),
      inboxStatus: "inbox", createdAt: Date.now(), updatedAt: Date.now(),
    } as never,
  };
}

// 服务端渲染这三条在 Windows runner 上要 8 秒以上（macOS 上不到 1 秒），
// 默认 5 秒上限会把一个慢 runner 误判成功能坏了。
describe("阅读区附件", { timeout: 30_000 }, () => {
  it("手写笔记重开时重绘笔迹，而不是摆一个播放器", () => {
    const html = renderToStaticMarkup(<EntryInspector
      entry={entry({})}
      onSave={noop} onArchive={noop} onConvert={noop} onAi={noop}
      onFetch={noop} onFavorite={noop} busy={false} onSettings={() => {}} aiReady={false}
    />);
    expect(html).toContain("手写笔记，2 笔");
    expect(html).toContain("2 笔 · 保存在本机");
    expect(html).not.toContain("<audio");
  });

  it("录音显示播放器，手写显示重绘画面", () => {
    const audio = entry({
      title: "语音笔记",
      original: {
        id: "a1", sourceType: "audio", title: "语音笔记", sourceUrl: null,
        rawText: "转写", contentHash: "", mediaPath: "media/audio/x.webm",
        mediaSizeBytes: 8, metadataJson: JSON.stringify({ mime: "audio/webm", durationMs: 1000 }),
        inboxStatus: "inbox", createdAt: Date.now(), updatedAt: Date.now(),
      } as never,
    });
    const html = renderToStaticMarkup(<EntryInspector
      entry={audio}
      onSave={noop} onArchive={noop} onConvert={noop} onAi={noop}
      onFetch={noop} onFavorite={noop} busy={false} onSettings={() => {}} aiReady={false}
    />);
    // 服务端渲染不跑 useEffect，音频字节是异步读的；这里能锁住的是
    // 录音条目**不会**被当成手写重绘（正是修复前的错误分支）。
    expect(html).toContain("语音笔记");
    expect(html).not.toContain('role="img" aria-label="手写笔记');
  });

  it("卡片条目没有附件区", () => {
    const c = cardFromJson({ id: "c1", headline: "标题", details: "正文", category: "计算机", createdAt: Date.now() });
    const html = renderToStaticMarkup(<EntryInspector
      entry={{ id: "c1", kind: "card", title: "标题", text: "正文", searchText: "正文", category: "计算机", tags: [], date: Date.now(), url: "", original: c }}
      onSave={noop} onArchive={noop} onConvert={noop} onAi={noop}
      onFetch={noop} onFavorite={noop} busy={false} onSettings={() => {}} aiReady={false}
    />);
    expect(html).not.toContain("ws-attachment");
  });
});

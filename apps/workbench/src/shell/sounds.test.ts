import { afterEach, describe, expect, it, vi } from "vitest";
import { playPaperSlide, playSwipeTone, setSoundEffectsEnabled } from "./sounds";

/**
 * 音效开关是跨端共享设置（settings.json 的 soundEffectsEnabled），
 * 关掉时必须真的不创建 AudioContext——否则用户在安卓上关掉、到桌面还在响。
 */
describe("音效开关", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setSoundEffectsEnabled(true);
  });

  function stubAudio() {
    const created: number[] = [];
    class FakeContext {
      sampleRate = 44100;
      currentTime = 0;
      destination = {};
      constructor() { created.push(Date.now()); }
      createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
      createBufferSource() { return { connect() {}, start() {}, buffer: null }; }
      createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: {}, type: "" }; }
      createGain() { return { connect() {}, gain: { value: 0, exponentialRampToValueAtTime() {} } }; }
      close() { return Promise.resolve(); }
    }
    vi.stubGlobal("AudioContext", FakeContext);
    // sounds.ts 用 window 判断"是否在浏览器里"；node 测试环境没有 window。
    vi.stubGlobal("window", {});
    return created;
  }

  it("开启时播放会创建音频上下文", () => {
    const created = stubAudio();
    setSoundEffectsEnabled(true);
    playSwipeTone("right");
    expect(created.length).toBeGreaterThan(0);
  });

  it("关闭时不创建任何音频上下文", () => {
    const created = stubAudio();
    setSoundEffectsEnabled(false);
    playSwipeTone("left");
    playPaperSlide();
    expect(created).toHaveLength(0);
  });

  it("重新开启后还能响", () => {
    const created = stubAudio();
    setSoundEffectsEnabled(false);
    playSwipeTone("right");
    setSoundEffectsEnabled(true);
    playSwipeTone("right");
    expect(created.length).toBeGreaterThan(0);
  });

  it("音频上下文创建失败时静默降级，不抛错", () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("blocked"); } });
    setSoundEffectsEnabled(true);
    expect(() => playSwipeTone("skip")).not.toThrow();
  });
});

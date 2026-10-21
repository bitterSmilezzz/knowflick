let ctx: AudioContext | null = null;
/**
 * 音效总开关。
 *
 * settings.json 里的 soundEffectsEnabled 是跨端共享字段（Android 端已经接了
 * AudioEffectHelper），但工作台此前只把它解析进模型、从不使用——用户在安卓上
 * 关掉音效，换到桌面照样会响（或者根本关不掉，因为这里连开关都没有）。
 */
let enabled = true;

export function setSoundEffectsEnabled(value: boolean): void {
  enabled = value;
  if (value) return;
  // 关掉时把上下文也释放，避免留一个静默的 AudioContext 占资源。
  void ctx?.close().catch(() => {});
  ctx = null;
}

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !enabled) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  } catch {
    // 浏览器可能因自动播放策略拒绝创建；音效失败不该影响任何操作。
    return null;
  }
}

export function playPaperSlide(): void {
  const context = audio();
  if (!context) return;
  const bufferSize = context.sampleRate * 0.04;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.06;
  }
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = 0.9;
  source.connect(gain);
  gain.connect(context.destination);
  source.start();
}

export function playSwipeTone(direction: "left" | "right" | "skip"): void {
  const context = audio();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = direction === "right" ? 520 : direction === "left" ? 280 : 400;
  gain.gain.value = 0.0001;
  oscillator.connect(gain);
  gain.connect(context.destination);
  const now = context.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  oscillator.start(now);
  oscillator.stop(now + 0.13);
}

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { DesktopOnlyHint } from "./DesktopOnlyHint";
import { addStroke, clearInk, emptyInk, isEmptyInk, normalizePoint, parseInk, undoStroke, INK_COLORS, INK_WIDTHS, type InkColor, type InkDocument, type InkStroke } from "../../domain/ink";
import { formatDuration } from "../../domain/ink";

/** 手写板：记录笔迹并交给调用方保存。 */
export function InkPad({ initial, onCancel, onSave }: {
  initial?: string | null;
  onCancel: () => void;
  onSave: (doc: InkDocument) => Promise<void>;
}) {
  const [doc, setDoc] = useState<InkDocument>(() => {
    if (!initial) return emptyInk();
    try { return parseInk(JSON.parse(initial)); } catch { return emptyInk(); }
  });
  const [color, setColor] = useState<InkColor>("ink");
  const [width, setWidth] = useState<number>(INK_WIDTHS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<InkStroke | null>(null);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const palette: Record<InkColor, string> = {
      ink: getComputedStyle(canvas).getPropertyValue("--ink").trim() || "#1c1e20",
      accent: getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#315e8b",
      muted: getComputedStyle(canvas).getPropertyValue("--muted").trim() || "#596168",
    };
    const strokes = drawing.current ? [...doc.strokes, drawing.current] : doc.strokes;
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, stroke.width * Math.min(rect.width, rect.height));
      ctx.strokeStyle = palette[stroke.color] ?? palette.ink;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      stroke.points.forEach((point, index) => {
        const x = point.x * rect.width;
        const y = point.y * rect.height;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  };

  useEffect(() => { draw(); }, [doc]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  const pointFrom = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return normalizePoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
  };

  const finish = () => {
    const stroke = drawing.current;
    drawing.current = null;
    if (stroke) setDoc(current => addStroke(current, stroke));
    else draw();
  };

  const save = async () => {
    if (busy) return;
    if (isEmptyInk(doc)) { setError("还没有落笔。写几个字再保存。"); return; }
    setBusy(true); setError("");
    try { await onSave(doc); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  return <div className="ink-pad" aria-label="手写笔记">
    <div className="ink-toolbar">
      <div className="ink-group" role="group" aria-label="笔色">
        {/* 颜色名跟着主题走：深色下「主色」其实是浅色笔画，叫「墨黑」会误导。 */}
        {INK_COLORS.map(item => <button key={item} type="button"
          aria-label={`笔色：${item === "ink" ? "主色" : item === "accent" ? "强调色" : "次要色"}`}
          title={item === "ink" ? "主色（跟随主题深浅）" : item === "accent" ? "强调色" : "次要色"}
          aria-pressed={color === item} className="ink-swatch" data-color={item} onClick={() => setColor(item)} />)}
      </div>
      <div className="ink-group" role="group" aria-label="笔宽">
        {INK_WIDTHS.map((item, index) => <button key={item} type="button" aria-label={`笔宽 ${Math.round(item * 1000)}`}
          aria-pressed={width === item} className="ink-width" onClick={() => setWidth(item)}>
          {/* 视觉梯度按档位取固定值：按归一化值直接乘像素时三档看起来一样粗。 */}
          <i style={{ width: [4, 7, 11][index], height: [4, 7, 11][index] }} />
        </button>)}
      </div>
      <div className="ink-actions">
        <button type="button" className="ws-bordered" disabled={busy || isEmptyInk(doc)} onClick={() => setDoc(undoStroke)}>撤销</button>
        <button type="button" className="ws-bordered" disabled={busy || isEmptyInk(doc)} onClick={() => setDoc(clearInk)}>清空</button>
      </div>
    </div>
    <canvas
      ref={canvasRef}
      className="ink-canvas"
      role="img"
      aria-label={`手写画布，当前 ${doc.strokes.length} 笔`}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = { points: [pointFrom(event)], width, color };
        draw();
      }}
      onPointerMove={event => {
        const stroke = drawing.current;
        if (!stroke) return;
        stroke.points.push(pointFrom(event));
        draw();
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={event => { if (drawing.current && event.buttons === 0) finish(); }}
    />
    <div className="ink-foot">
      <span className="ws-hint">{error || `${doc.strokes.length} 笔 · 归一化坐标存盘，换窗口不变形`}</span>
      <div className="ink-actions">
        <button type="button" className="ws-bordered" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className="ws-primary" disabled={busy} onClick={() => void save()}>
          <Icon name="check" size={14} />{busy ? "保存中…" : "保存手写笔记"}
        </button>
      </div>
    </div>
  </div>;
}

/** 录音：MediaRecorder 采集，停止后交回音频字节。 */
export function VoiceRecorder({ onCancel, onSave }: {
  onCancel: () => void;
  onSave: (audio: Blob, durationMs: number) => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "recording" | "ready" | "saving">("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [audio, setAudio] = useState<{ blob: Blob; durationMs: number; url: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);

  const stopTimer = () => { if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; } };
  useEffect(() => () => {
    stopTimer();
    recorderRef.current?.stream.getTracks().forEach(track => track.stop());
    if (audio) URL.revokeObjectURL(audio.url);
  }, [audio]);

  const start = async () => {
    setError("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("当前环境不支持录音。桌面客户端可用；浏览器需要麦克风权限。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find(type => MediaRecorder.isTypeSupported(type)) ?? "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const durationMs = Date.now() - startedAt.current;
        stream.getTracks().forEach(track => track.stop());
        if (!blob.size) { setError("没有录到声音，请检查麦克风后重试。"); setState("idle"); return; }
        setAudio({ blob, durationMs, url: URL.createObjectURL(blob) });
        setState("ready");
      };
      recorderRef.current = recorder;
      startedAt.current = Date.now();
      recorder.start();
      setElapsed(0);
      setState("recording");
      timer.current = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 200);
    } catch (err) {
      setError(err instanceof Error && err.name === "NotAllowedError"
        ? "麦克风权限被拒绝。请在系统设置里允许 KnowFlick 使用麦克风。"
        : "无法开始录音：请检查麦克风是否可用。");
      setState("idle");
    }
  };

  const stop = () => { stopTimer(); recorderRef.current?.stop(); };

  const save = async () => {
    if (!audio || state === "saving") return;
    setState("saving"); setError("");
    try { await onSave(audio.blob, audio.durationMs); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setState("ready"); }
  };

  return <div className="voice-recorder" aria-label="语音笔记">
    <div className="voice-status" data-state={state}>
      <span className="voice-dot" aria-hidden="true" />
      <strong>{state === "recording" ? "正在录音" : state === "ready" ? "录音完成" : state === "saving" ? "正在保存" : "准备录音"}</strong>
      <span className="ws-hint">{state === "recording" ? formatDuration(elapsed) : audio ? formatDuration(audio.durationMs) : "点下面的按钮开始"}</span>
    </div>
    {audio ? <audio className="voice-audio" controls src={audio.url} aria-label="录音回放" /> : null}
    {error ? (
      <div className="voice-error" role="alert">
        <p className="ws-hint">{error}</p>
        {/* 浏览器体验保存不了录音——只说「请用桌面客户端」却没地方去，是断链。
            这里给一条可点的路。 */}
        {error.includes("桌面客户端") ? <DesktopOnlyHint /> : null}
      </div>
    ) : null}
    <div className="ink-actions">
      <button type="button" className="ws-bordered" disabled={state === "saving"} onClick={onCancel}>取消</button>
      {state === "recording"
        ? <button type="button" className="ws-primary" onClick={stop}><Icon name="check" size={14} />停止录音</button>
        : <button type="button" className="ws-bordered" disabled={state === "saving"} onClick={() => { setAudio(null); void start(); }}>
            {audio ? "重录" : "开始录音"}
          </button>}
      <button type="button" className="ws-primary" disabled={!audio || state === "saving"} onClick={() => void save()}>
        <Icon name="check" size={14} />{state === "saving" ? "保存中…" : "保存语音笔记"}
      </button>
    </div>
    <p className="ws-hint">录音保存在本机；转写走本地 Whisper，不上传音频。</p>
  </div>;
}

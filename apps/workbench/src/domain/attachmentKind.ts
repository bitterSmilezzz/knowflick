/**
 * 正文里的附件引用：路径 → 种类（B06）。
 *
 * 为什么需要判定：库内附件有三种（图片 / 录音 / 手写笔迹），它们的**渲染方式完全不同**。
 * 此前一律渲染成 `<img>`——录音塞进 img 标签播不出来，手写笔迹是 JSON、更不是图片。
 * 用户看到的是「一个裂掉的图」，而实际是「我不会渲染这个附件」。
 *
 * 口径与 `MarkdownRenderer` 的安全校验一致：只认 `media/<kind>/<文件名>` 这一种来源，
 * 其它路径（外链、路径穿越）一律不当附件处理。
 */

/** 附件种类。 */
export type AttachmentKind = "image" | "audio" | "ink";

/** 库内附件相对路径：media/<kind>/<文件名>。与 Rust 侧 media.rs 的命名规则一致。 */
const MEDIA_PATH_RE = /^media\/(audio|image|ink)\/[A-Za-z0-9._-]+$/;

/**
 * 判定一个路径是不是库内附件、属于哪一类。
 *
 * 不是附件时返回 null——外链图片与路径穿越都不该被当附件处理，
 * 否则能用正文去探测文件系统。
 */
export function attachmentKindOf(path: string): AttachmentKind | null {
  const match = MEDIA_PATH_RE.exec(path.trim());
  if (!match) return null;
  const kind = match[1];
  if (kind === "audio" || kind === "image" || kind === "ink") return kind;
  return null;
}

/** 附件在界面上的中文名。 */
export function attachmentKindLabel(kind: AttachmentKind): string {
  if (kind === "audio") return "录音";
  if (kind === "ink") return "手写笔迹";
  return "图片";
}

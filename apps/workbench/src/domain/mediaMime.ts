/**
 * 附件 MIME 推断。
 *
 * 落盘时扩展名由 MIME 决定，恢复时又要由扩展名反推 MIME——两处必须同一份映射，
 * 否则会出现「内容是 JPEG、文件却叫 .png」这种错位。
 *
 * 起因：浏览器的 File.type 不是总有的（HEIC 尤其常见），给空时一律当成 PNG
 * 会把 JPEG / HEIC 存成 .png 文件，内容与扩展名不符，有些查看器直接打不开。
 */

/** 库内附件扩展名 → MIME。 */
const BY_EXTENSION: Record<string, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heic",
  json: "application/json",
};

/** 由扩展名反查 MIME；不认识就返回 undefined（调用方据此拒绝该附件）。 */
export function mediaMimeOfExtension(ext: string): string | undefined {
  return BY_EXTENSION[ext.toLowerCase()];
}

/**
 * 推断一张图片的 MIME。
 *
 * 扩展名优先，其次才信浏览器给的 File.type——扩展名更接近「文件本来是什么」。
 */
export function imageMimeOf(fileName: string, declaredType: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const guessed = BY_EXTENSION[ext];
  if (guessed && guessed.startsWith("image/")) return guessed;
  if (declaredType && declaredType.startsWith("image/")) return declaredType;
  return "image/png";
}

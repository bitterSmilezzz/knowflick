import type { RawMaterial } from "../../shell/store";

/**
 * 附件（录音 / 手写 / 图片）的字节与类型处理。
 *
 * 为什么单独抽出来：读回附件这条路径原先只活在 `EntryInspector` 的
 * `useEffect` 里，而那块的测试用 `renderToStaticMarkup`（**服务端渲染，
 * 不跑 effect**）——于是「存进去的字节能不能原样读回来」这条**完全没被测到**。
 *
 * 这里把它变成纯函数：不依赖 DOM、不依赖 Tauri，node 环境下就能测。
 */

/** 附件的 MIME。存盘时记在 metadataJson 里，读回时以它为准。 */
export function attachmentMime(material: RawMaterial): string {
  const fallback = material.sourceType === "image" ? "image/png" : "audio/webm";
  try {
    const meta = JSON.parse(material.metadataJson) as { mime?: unknown };
    return typeof meta.mime === "string" && meta.mime ? meta.mime : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 宿主读回来的字节数组 → 可播放的 Blob。
 *
 * 宿主返回的是 `number[]`（Tauri 对 `Vec<u8>` 的默认序列化），
 * 这里必须原样转换——**不能**用 `new Uint8Array(array)` 之外的方式，
 * 也不能悄悄改字节：附件是用户自己录的内容，读回来必须一模一样。
 */
export function attachmentBlob(bytes: number[] | Uint8Array, mime: string): Blob {
  // TS 的 lib 里 BlobPart 只接受 ArrayBuffer 支撑的视图，Uint8Array 的
  // buffer 可能是 SharedArrayBuffer——这里显式拷进一个新的 ArrayBuffer。
  const view = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return new Blob([copy.buffer], { type: mime || "application/octet-stream" });
}

/**
 * 浏览器体验里的内嵌图片（data URL）。
 *
 * 浏览器模式没有可写的库目录，图片改为内嵌在 metadataJson 里；
 * 只有 `data:image/` 开头才算图片，其它一律当作没有附件。
 */
export function inlineImageUrl(material: RawMaterial): string | null {
  let inline: string | null = null;
  try {
    inline = JSON.parse(material.metadataJson).dataUrl ?? null;
  } catch {
    inline = null;
  }
  return typeof inline === "string" && inline.startsWith("data:image/") ? inline : null;
}

/**
 * 这个素材有没有可回放的附件。
 *
 * 「有 `mediaPath`」不等于「附件还在」：文件可能被人删了。
 * 读不到字节时 `EntryInspector` 会显示「附件不见了」，所以这里只判断
 * **有没有该去读**。
 */
export function hasReadableAttachment(material: RawMaterial): boolean {
  if (material.mediaPath) return true;
  return inlineImageUrl(material) !== null;
}

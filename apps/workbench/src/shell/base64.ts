/**
 * 附件字节 ↔ base64：与 Rust 侧 `media.rs` 的 `encode_b64`/`decode_b64` 同一套契约。
 *
 * 为什么走 base64 而不是数字数组：`Array.from(bytes)` 交给 Tauri IPC 会被
 * JSON 序列化成 `[123,10,…]`——5 MB 录音放大成 ~18 MB 文本，两侧再各花
 * 几十毫秒逐个数字解析（Rust 侧 serde 更慢）；备份导出要读**全部**附件，
 * 这个放大跟着库一起长。base64 只放大 1.33 倍（Tauri 官方文档在 raw payload
 * 不可用时也是这么建议的）。
 *
 * 编码走 `FileReader` 的 dataURL——它就是标准 base64，原生实现比手工逐块
 * 转换快一个数量级（5 MB 实测 14ms vs 181ms）；手工路径留作没有 FileReader
 * 的环境（Node 侧单测）的兜底。解码 `atob` 后按码位取回，5 MB 约 30ms。
 */

const CHUNK = 0x8000;

export async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  if (typeof FileReader !== "undefined") {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("附件编码失败"));
      // Blob 接受 ArrayBufferView 并遵循视图的偏移与长度；这里的 DOM 类型库
      // 还没跟上 Uint8Array 的泛型参数（本函数的调用方都是 ArrayBuffer 背景的
      // 字节，不存在 SharedArrayBuffer 的情形），收窄只是给检查器看的。
      reader.readAsDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    });
    return url.slice(url.indexOf(",") + 1);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Wails 运行时桥接：把共享前端的调用落到 Go 服务上。
 *
 * 为什么用动态 import：`/wails/runtime.js` 是 Wails 构建时注入的虚拟模块，
 * 浏览器模式里不存在；静态 import 会让 `npm run build` 解析失败，所以统一走这里。
 * 浏览器模式下调用会 reject，调用方按「仅桌面可用」处理。
 */
export async function call<T = unknown>(fullName: string, ...args: unknown[]): Promise<T> {
  // @ts-expect-error Wails 只在原生窗口里注入这个模块
  const runtime = await import(/* @vite-ignore */ "/wails/runtime.js");
  return (await runtime.Call.ByName(fullName, ...args)) as T;
}

/** 桌面壳标记：go-preview 的入口会设置 `__TAURI_INTERNALS__`（共享前端沿用它判断 inShell）。 */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Wails 预览通过 Go 调 macOS 通知中心，替代 Tauri notification 插件。 */
import { SendSystemNotification } from "./bindings/knowflick.local/workbench-go/previewservice";

export async function isPermissionGranted(): Promise<boolean> { return true; }
export async function requestPermission(): Promise<"granted" | "denied" | "default"> { return "granted"; }
export async function sendNotification(options?: { title?: string; body?: string }): Promise<void> {
  await SendSystemNotification(options?.title ?? "KnowFlick", options?.body ?? "该回顾一下了");
}

/** 系统通知：桌面走 Go 的 macOS 通知中心；浏览器退化为 Web Notification。 */
import { call, isDesktopShell } from "./wails";

export async function isPermissionGranted(): Promise<boolean> {
  return true;
}

export async function requestPermission(): Promise<"granted" | "denied" | "default"> {
  return "granted";
}

export async function sendNotification(options?: { title?: string; body?: string }): Promise<void> {
  const title = options?.title ?? "KnowFlick";
  const body = options?.body ?? "该回顾一下了";
  if (isDesktopShell()) {
    try {
      await call("main.PreviewService.SendSystemNotification", title, body);
      return;
    } catch {
      // 落到浏览器分支，至少给个可见提示
    }
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

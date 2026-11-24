/** 原生文件对话框：Go 的 PreviewService 负责真正的 NSOpenPanel / NSSavePanel。 */
import { call, isDesktopShell } from "./wails";

type DialogFilter = { name?: string; extensions?: string[] };

function extensionsOf(filters?: DialogFilter[]): string {
  return (filters ?? []).flatMap((filter) => filter.extensions ?? []).join(";");
}

export async function save(options?: { defaultPath?: string; title?: string; filters?: DialogFilter[] }): Promise<string | null> {
  try {
    const selected = await call<string>("main.PreviewService.PickSavePath", options?.defaultPath ?? "", options?.title ?? "保存");
    return selected || null;
  } catch (err) {
    // 桌面里调用失败是真错误（不是用户取消），别伪装成 null 静默吞掉。
    if (isDesktopShell()) throw err;
    return null;
  }
}

export async function open(options?: { directory?: boolean; multiple?: boolean; title?: string; filters?: DialogFilter[] }): Promise<string | string[] | null> {
  try {
    if (options?.directory) {
      const selected = await call<string>("main.PreviewService.PickDirectory", options.title ?? "选择目录");
      return selected || null;
    }
    const selected = await call<string>("main.PreviewService.PickOpenPath", options?.title ?? "打开", extensionsOf(options?.filters));
    return selected || null;
  } catch (err) {
    if (isDesktopShell()) throw err;
    return null;
  }
}

export async function message(): Promise<void> {}
export async function ask(): Promise<boolean> { return false; }
export async function confirm(): Promise<boolean> { return true; }

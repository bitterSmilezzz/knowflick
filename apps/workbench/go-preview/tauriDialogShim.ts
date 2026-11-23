/** Tauri dialog plugin for the Wails preview: delegate to native Go dialogs. */
import { PickDirectory, PickOpenPath, PickSavePath } from "./bindings/knowflick.local/workbench-go/previewservice";

type DialogFilter = { name?: string; extensions?: string[] };

function extensionsOf(filters?: DialogFilter[]): string {
  return (filters ?? []).flatMap((filter) => filter.extensions ?? []).join(";");
}

export async function save(options?: { defaultPath?: string; title?: string }): Promise<string | null> {
  const selected = await PickSavePath(options?.defaultPath ?? "", options?.title ?? "保存");
  return selected || null;
}

export async function open(options?: { directory?: boolean; multiple?: boolean; title?: string; filters?: DialogFilter[] }): Promise<string | string[] | null> {
  if (options?.directory) {
    const selected = await PickDirectory(options.title ?? "选择目录");
    return selected || null;
  }
  const selected = await PickOpenPath(options?.title ?? "打开", extensionsOf(options?.filters));
  return selected || null;
}

export async function message(): Promise<void> {}
export async function ask(): Promise<boolean> { return false; }
export async function confirm(): Promise<boolean> { return true; }

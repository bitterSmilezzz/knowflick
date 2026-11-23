/** Tauri event plugin for the Wails preview: bridge to native events when available. */
export async function listen(name: string, handler: (event: { event: string; id: number; payload: unknown }) => void): Promise<() => void> {
  try {
    // @ts-expect-error Wails injects this virtual module at runtime.
    const runtime = await import("/wails/runtime.js");
    const off = runtime.Events?.On?.(name, (event: { data?: unknown; payload?: unknown }) => handler({ event: name, id: 1, payload: event?.data ?? event?.payload ?? event }));
    return () => off?.();
  } catch {
    return () => {};
  }
}
export async function once(name: string, handler: (event: { event: string; id: number; payload: unknown }) => void): Promise<() => void> {
  return listen(name, handler);
}
export async function emit(): Promise<void> {}

/** 原生事件订阅：Wails 的 Events.On，浏览器模式下返回空退订函数。 */
export async function listen<T = unknown>(name: string, handler: (event: { event: string; id: number; payload: T }) => void): Promise<() => void> {
  try {
    // @ts-expect-error Wails 只在原生窗口里注入这个模块
    const runtime = await import(/* @vite-ignore */ "/wails/runtime.js");
    const off = runtime.Events?.On?.(name, (event: { data?: unknown; payload?: unknown }) =>
      handler({ event: name, id: 1, payload: (event?.data ?? event?.payload ?? event) as T }),
    );
    return () => off?.();
  } catch {
    return () => {};
  }
}

export async function once<T = unknown>(name: string, handler: (event: { event: string; id: number; payload: T }) => void): Promise<() => void> {
  return listen(name, handler);
}

export async function emit(): Promise<void> {}

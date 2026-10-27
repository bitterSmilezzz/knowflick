/**
 * 外部进程改库时，界面该什么时候刷新。
 *
 * 背景：界面刷新只有两个信号——`knowflick:library-changed`（DOM 事件，由**本应用**
 * 的 Tauri 命令派发）与 `storage`（浏览器 localStorage 跨标签页）。
 * 而 MCP server（`tools/mcp-server.mjs`）是**独立进程**，它直接写 SQLite：
 * 两个信号都发不出去，界面就停在旧状态——外部 Agent 写完卡，用户这边什么也看不到，
 * 得重启或切页才看得到。
 *
 * 这里把「该不该刷新」这个判断抽成纯函数：不依赖 DOM、不依赖 Tauri，
 * node 环境下就能测。轮询本身在 `Workspace` 里做（它要拿 dir、要在事件循环里跑）。
 */

/** 轮询间隔：外部写入后用户不该等太久才看到，也不能太频繁。 */
export const EXTERNAL_REFRESH_INTERVAL_MS = 2000;

/**
 * 签名变了就说明库被外部改过 → 需要刷新。
 *
 * 首次拿到签名时**不**刷新：那只是建立基线，不是「发现改动」。
 */
export function externalChangeDetected(previous: string, next: string): boolean {
  if (!previous) return false; // 还没有基线
  return previous !== next;
}

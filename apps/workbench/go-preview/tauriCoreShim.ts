/** Tauri invoke() 在 Wails 预览里的兼容入口。
 *  共享前端的 store/repository 仍用 invoke(name, args) 调原生；这里按生成好的
 *  命令表把它转成 Wails 的 Call.ByName，并把桌面端的 dir 换成当前资料库代号。 */
import { COMMANDS } from "./commandTable.ts";

type BridgeArgs = Record<string, unknown>;
type Dispatcher = (fullName: string, ...args: unknown[]) => Promise<unknown>;

let generation = 0;
let customDispatcher: Dispatcher | null = null;

export function setBridgeGeneration(value: number): void {
  generation = value;
}

/** 仅用于测试注入；生产环境直接走 Wails runtime。 */
export function setBridgeDispatcher(fn: Dispatcher | null): void {
  customDispatcher = fn;
}

function snakeToCamel(value: string): string {
  const parts = value.split("_");
  return parts[0] + parts.slice(1).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

export async function invoke<T = unknown>(name: string, args: BridgeArgs = {}): Promise<T> {
  const entry = COMMANDS[name];
  if (!(name in COMMANDS)) throw new Error("未知的原生命令：" + name);
  if (entry === null) throw new Error("Go 预览还没有实现命令：" + name);
  const values = entry.args.map((param) => {
    if (entry.fixed && param in entry.fixed) return entry.fixed[param];
    if (name === "note_upsert" && param === "note") return noteToGo(args.note);
    const active = (globalThis as unknown as { __kfGeneration?: number }).__kfGeneration ?? generation;
    if (param === "generation") return active;
    if (param === "now") return Date.now();
    if (name === "db_search_cards_fts" && param === "offset") return args.limit ?? 0;
    if (name === "db_load_cards" && param === "query") return "";
    if (param.toLowerCase() === "accountid") {
      if ("id" in args) return args.id;
      if ("accountId" in args) return args.accountId;
    }
    if (param === "secret" && "password" in args) return args.password;
    if (name === "goal_create_cmd" && param === "criteria") {
      const nested = args.goal as Record<string, unknown> | undefined;
      return nested?.doneCriteria ?? null;
    }
    const sources: Record<string, unknown>[] = [args];
    for (const nested of ["goal", "material", "request"]) {
      const value = args[nested];
      if (value && typeof value === "object") sources.push(value as Record<string, unknown>);
    }
    for (const key of [param, snakeToCamel(param)]) {
      for (const source of sources) {
        if (key in source) return source[key];
        const insensitive = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
        if (insensitive) return source[insensitive];
      }
    }
    return null;
  });
  const dispatch: Dispatcher = customDispatcher ?? (async (fullName, ...rest) => {
    // @ts-expect-error: Wails 构建时注入的虚拟模块，类型只存在于运行时
    const runtime = await import("/wails/runtime.js");
    return runtime.Call.ByName(fullName, ...rest);
  });
  const result = await dispatch("main." + entry.service + "." + entry.method, ...values);
  return adaptResult(name, result) as T;
}

/** Wails 返回的嵌套账号结构与共享前端的平铺类型不同，逐字段摊平。 */
function flattenMailAccount(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const item = value as Record<string, unknown>;
  const config = (item.config ?? {}) as Record<string, unknown>;
  return {
    ...config,
    lastSyncAt: item.lastSyncAt ?? null,
    lastError: item.lastError ?? null,
    hasPassword: item.hasPassword ?? false,
    historyComplete: item.historyComplete ?? false,
    rejectedCount: item.rejectedCount ?? 0,
    lastAttemptAt: item.lastAttemptAt ?? null,
  };
}

function cardFromGo(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const card = value as Record<string, unknown>;
  const content = (card.content && typeof card.content === "object" ? card.content : {}) as Record<string, unknown>;
  const tags = Array.isArray(card.tags) ? card.tags : Array.isArray(content.tags) ? content.tags : [];
  return {
    ...card,
    category: card.category ?? content.category ?? "",
    headline: card.headline ?? content.headline ?? "",
    summary: card.summary ?? content.summary ?? "",
    details: card.details ?? content.details ?? "",
    links: Array.isArray(card.links) ? card.links : [],
    tags,
    prereq: Array.isArray(card.prereq) ? card.prereq : [],
    swiped: card.swiped ?? null,
  };
}

function adaptResult(name: string, result: unknown): unknown {
  if (name === "note_list" && result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).notes)) {
    return ((result as Record<string, unknown>).notes as unknown[]).map(noteFromGo);
  }
  if (name === "note_get") return noteFromGo(result);
  if ((name === "db_load_cards" || name === "db_search_cards_fts") && result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).cards)) {
    return ((result as Record<string, unknown>).cards as unknown[]).map(cardFromGo);
  }
  if ((name === "db_search_cards_hybrid" || name === "db_search_cards_vector") && Array.isArray(result)) {
    return (result as unknown[]).map(cardFromGo);
  }
  if (name === "kb_list" && result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).knowledgeBases)) {
    return (result as Record<string, unknown>).knowledgeBases;
  }
  if (name === "kb_membership" && result && typeof result === "object" && "membership" in (result as Record<string, unknown>)) {
    return (result as Record<string, unknown>).membership ?? {};
  }
  if (name === "mail_list_accounts") return Array.isArray(result) ? result.map(flattenMailAccount) : [];
  if (name === "mail_save_account") return flattenMailAccount(result);
  if (name === "mail_list_rejected" || name === "mail_sync_due_accounts") return result ?? [];
  if (name === "mail_test_account" && result && typeof result === "object" && "folder" in result && "messageCount" in result) {
    return { message: `连接成功：${result.folder}，共 ${result.messageCount} 封邮件` };
  }
  return result;
}

/** 共享笔记用 bodyMd / currentRevision / isPinned；Go 用 body / revision / pinned。 */
function noteFromGo(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const item = value as Record<string, unknown>;
  return {
    ...item,
    bodyMd: item.bodyMd ?? item.body ?? "",
    currentRevision: item.currentRevision ?? item.revision ?? 1,
    isPinned: item.isPinned ?? item.pinned ?? false,
    isFavorite: item.isFavorite ?? item.favorite ?? false,
    isDeleted: item.isDeleted ?? item.deleted ?? false,
    tagsJson: item.tagsJson ?? "[]",
  };
}

function noteToGo(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const item = value as Record<string, unknown>;
  const tags = Array.isArray(item.tags) ? JSON.stringify(item.tags) : item.tagsJson;
  return {
    ...item,
    body: item.bodyMd ?? item.body ?? "",
    revision: item.currentRevision ?? item.revision ?? 1,
    pinned: item.isPinned ?? item.pinned ?? false,
    favorite: item.isFavorite ?? item.favorite ?? false,
    deleted: item.isDeleted ?? item.deleted ?? false,
    tagsJson: tags ?? "[]",
  };
}

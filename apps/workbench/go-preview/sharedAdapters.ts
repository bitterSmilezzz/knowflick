import type { Note as SharedNote } from "../src/domain/note";
import type { Note as PreviewNote } from "./bindings/knowflick.local/workbench-go/internal/library/models";

/** Wails 绑定里的笔记与共享前端的领域笔记字段不同；逐字段转换，不靠断言。 */
export function toSharedNote(item: PreviewNote): SharedNote {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(item.tagsJson || "[]");
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    tags = [];
  }
  return {
    id: item.id,
    title: item.title,
    bodyMd: item.body,
    notebook: item.notebook,
    tags,
    isPinned: item.pinned,
    isFavorite: item.favorite,
    archivedAt: item.archivedAt,
    sourceMaterialId: item.sourceMaterialId,
    currentRevision: item.revision,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isDeleted: item.deleted,
    deletedAt: item.deletedAt,
    excludeFromProfile: item.excludeFromProfile,
  };
}

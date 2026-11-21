package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ErrReadOnly 表示这个资料库是以只读方式打开的——写入必须先 OpenForWrite。
var ErrReadOnly = errors.New("资料库以只读方式打开，不能写入")

// ConflictError 表示 base_revision 与库里不一致：调用方拿的是旧草稿。
type ConflictError struct{ CurrentRevision int64 }

func (e *ConflictError) Error() string {
	return fmt.Sprintf("笔记已被别处改动（当前修订 %d），请刷新后再保存", e.CurrentRevision)
}

// SaveOutcome 是一次 upsert 的结果。修订号是**保存后**的当前修订。
type SaveOutcome struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
	Created  bool   `json:"created"`
}

// OpenForWrite 打开可写库（mode=rw：文件必须已存在，不会凭空造库）。
// 只读的 Open 与它分开，避免调用方顺手把预览变成写手。
func OpenForWrite(ctx context.Context, path string) (*Library, error) {
	lib, err := open(ctx, path, "mode=rw")
	if err != nil {
		return nil, err
	}
	lib.writable = true
	return lib, nil
}

// Upsert 保存一篇笔记：语义与 Rust 的 note_upsert 逐条对齐——
// 只有 title/body_md 变化才追加修订；元数据变化只更新当前态；
// base_revision 与库里不一致则拒绝（不静默覆盖）。
func (l *Library) Upsert(ctx context.Context, note Note, baseRevision, now int64) (SaveOutcome, error) {
	if !l.writable {
		return SaveOutcome{}, ErrReadOnly
	}
	existing, err := l.get(ctx, note.ID)
	if err != nil {
		return SaveOutcome{}, err
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return SaveOutcome{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if existing != nil {
		if baseRevision != existing.Revision {
			return SaveOutcome{}, &ConflictError{CurrentRevision: existing.Revision}
		}
		next := existing.Revision
		contentChanged := existing.Title != note.Title || existing.Body != note.Body
		if contentChanged {
			next++
		}
		if _, err := tx.ExecContext(ctx, "UPDATE notes SET title=?2, body_md=?3, notebook=?4, tags_json=?5, is_pinned=?6, is_favorite=?7, archived_at=?8, source_material_id=?9, current_revision=?10, updated_at=?11, exclude_from_profile=?12 WHERE id=?1", note.ID, note.Title, note.Body, note.Notebook, tagsOf(note), note.Pinned, note.Favorite, note.ArchivedAt, note.SourceMaterialID, next, now, note.ExcludeFromProfile); err != nil {
			return SaveOutcome{}, err
		}
		if contentChanged {
			if err := afterContentChange(ctx, tx, note, next, now); err != nil {
				return SaveOutcome{}, err
			}
		}
		if err := tx.Commit(); err != nil {
			return SaveOutcome{}, err
		}
		return SaveOutcome{ID: note.ID, Revision: next}, nil
	}
	if baseRevision != 0 {
		return SaveOutcome{}, &ConflictError{CurrentRevision: 0}
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO notes (id, title, body_md, notebook, tags_json, is_pinned, is_favorite, archived_at, source_material_id, current_revision, created_at, updated_at, is_deleted, deleted_at, exclude_from_profile) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,?10,0,NULL,?11)", note.ID, note.Title, note.Body, note.Notebook, tagsOf(note), note.Pinned, note.Favorite, note.ArchivedAt, note.SourceMaterialID, now, note.ExcludeFromProfile); err != nil {
		return SaveOutcome{}, err
	}
	if err := afterContentChange(ctx, tx, note, 1, now); err != nil {
		return SaveOutcome{}, err
	}
	if err := tx.Commit(); err != nil {
		return SaveOutcome{}, err
	}
	return SaveOutcome{ID: note.ID, Revision: 1, Created: true}, nil
}

// afterContentChange 是「内容变了之后必须一起做」的三件事：追加修订、重建分块、同步整篇 FTS。
func afterContentChange(ctx context.Context, tx *sql.Tx, note Note, revision, now int64) error {
	if _, err := tx.ExecContext(ctx, "INSERT INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES (?1,?2,?3,?4,?5)", note.ID, revision, note.Title, note.Body, now); err != nil {
		return err
	}
	if err := rebuildNoteChunks(ctx, tx, note.ID, note.Body, revision); err != nil {
		return err
	}
	return syncNoteFTS(ctx, tx, note.ID, note.Title, note.Body, note.Deleted)
}

// rebuildNoteChunks 重建一篇笔记的分块与分块 FTS（与 Rust 同：先清后插）。
func rebuildNoteChunks(ctx context.Context, tx *sql.Tx, noteID, body string, revision int64) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM note_chunks WHERE note_id=?1", noteID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM fts_note_chunks WHERE note_id=?1", noteID); err != nil {
		return err
	}
	for _, chunk := range ChunkMarkdown(body) {
		if _, err := tx.ExecContext(ctx, "INSERT INTO note_chunks (note_id, chunk_index, content, char_start, char_end, content_revision) VALUES (?1,?2,?3,?4,?5,?6)", noteID, chunk.Index, chunk.Content, chunk.CharStart, chunk.CharEnd, revision); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO fts_note_chunks (note_id, chunk_index, content) VALUES (?1,?2,?3)", noteID, chunk.Index, chunk.Content); err != nil {
			return err
		}
	}
	return nil
}

// syncNoteFTS 让整篇索引与删除态一致：回收站里的笔记不进检索。
func syncNoteFTS(ctx context.Context, tx *sql.Tx, noteID, title, body string, deleted bool) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM fts_notes WHERE note_id=?1", noteID); err != nil {
		return err
	}
	if deleted {
		return nil
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO fts_notes (note_id, title, body) VALUES (?1,?2,?3)", noteID, title, body)
	return err
}

// get 读一篇笔记（含回收站里的）。不存在返回 nil, nil。
func (l *Library) get(ctx context.Context, id string) (*Note, error) {
	rows, err := l.db.QueryContext(ctx, "SELECT "+noteColumns+" FROM notes n WHERE n.id=?1", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, rows.Err()
	}
	var note Note
	if err := scanNote(rows, &note); err != nil {
		return nil, err
	}
	return &note, nil
}

// Delete 是软删（进回收站）：索引同步移除，搜索立即搜不到；与 Rust 的 note_delete 同义。
func (l *Library) Delete(ctx context.Context, id string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, "UPDATE notes SET is_deleted=1, deleted_at=?2 WHERE id=?1 AND is_deleted=0", id, now)
	if err != nil {
		return false, err
	}
	changed, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	if changed == 0 {
		return false, nil
	}
	for _, statement := range []string{"DELETE FROM fts_notes WHERE note_id=?1", "DELETE FROM fts_note_chunks WHERE note_id=?1"} {
		if _, err := tx.ExecContext(ctx, statement, id); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// tagsOf 空标签落回 []，与 Rust 的默认值一致。
func tagsOf(note Note) string {
	if note.TagsJSON == "" {
		return "[]"
	}
	return note.TagsJSON
}

// Restore 把回收站里的笔记恢复：清删除态、重进 FTS、按当前修订重建分块。
// 与 Rust 的 note_restore 同义；不在回收站里的直接返回 false。
func (l *Library) Restore(ctx context.Context, id string) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	note, err := l.get(ctx, id)
	if err != nil {
		return false, err
	}
	if note == nil || !note.Deleted {
		return false, nil
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "UPDATE notes SET is_deleted=0, deleted_at=NULL WHERE id=?1", id); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO fts_notes (note_id, title, body) VALUES (?1,?2,?3)", id, note.Title, note.Body); err != nil {
		return false, err
	}
	if err := rebuildNoteChunks(ctx, tx, id, note.Body, note.Revision); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// ListDeleted 列出回收站（按删除时间倒序），与 Rust 的 scope=deleted 同义。
func (l *Library) ListDeleted(ctx context.Context, offset int) (Page, error) {
	return l.query(ctx, "SELECT "+noteColumns+" FROM notes n WHERE n.is_deleted=1"+
		" ORDER BY n.deleted_at DESC, n.id LIMIT ? OFFSET ?", PageSize+1, offset)
}

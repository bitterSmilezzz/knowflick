package library

import (
	"context"
	"database/sql"
	"errors"
)

// NoteRevisionSummary 是一版修订的元信息，不含正文：列表不需要搬几十万字。
type NoteRevisionSummary struct {
	Revision int64  `json:"revision"`
	Title    string `json:"title"`
	SavedAt  int64  `json:"savedAt"`
	Chars    int64  `json:"chars"`
}

// NoteRevision 是一版修订的完整内容。
type NoteRevision struct {
	NoteID   string `json:"noteId"`
	Revision int64  `json:"revision"`
	Title    string `json:"title"`
	BodyMD   string `json:"bodyMd"`
	SavedAt  int64  `json:"savedAt"`
}

// NoteHistory 按修订号倒序列出历史（新版在前）。
func (l *Library) History(ctx context.Context, noteID string) ([]NoteRevisionSummary, error) {
	rows, err := l.db.QueryContext(ctx, "SELECT revision,title,saved_at,length(body_md) FROM note_revisions WHERE note_id = ?1 ORDER BY revision DESC", noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]NoteRevisionSummary, 0)
	for rows.Next() {
		var item NoteRevisionSummary
		if err := rows.Scan(&item.Revision, &item.Title, &item.SavedAt, &item.Chars); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ReadRevision 读取指定修订的正文。缺失的修订返回 nil。
func (l *Library) ReadRevision(ctx context.Context, noteID string, revision int64) (*NoteRevision, error) {
	return scanRevision(l.db.QueryRowContext(ctx, revisionQuery, noteID, revision))
}

const revisionQuery = "SELECT note_id, revision, title, body_md, saved_at FROM note_revisions WHERE note_id = ? AND revision = ?"

func scanRevision(row *sql.Row) (*NoteRevision, error) {
	var item NoteRevision
	err := row.Scan(&item.NoteID, &item.Revision, &item.Title, &item.BodyMD, &item.SavedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// RestoreRevision 按当前编辑器的修订号验冲突，并把历史正文保存为一次新修订。
func (l *Library) RestoreRevision(ctx context.Context, noteID string, revision, baseRevision, now int64) (SaveOutcome, error) {
	if !l.writable {
		return SaveOutcome{}, ErrReadOnly
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return SaveOutcome{}, err
	}
	defer tx.Rollback()

	note := Note{ID: noteID}
	err = tx.QueryRowContext(ctx, "SELECT title, body_md, current_revision FROM notes WHERE id = ? AND is_deleted = 0", noteID).
		Scan(&note.Title, &note.Body, &note.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return SaveOutcome{}, errors.New("笔记不存在或已移进回收站")
	}
	if err != nil {
		return SaveOutcome{}, err
	}
	if note.Revision != baseRevision {
		return SaveOutcome{}, &ConflictError{CurrentRevision: note.Revision}
	}
	history, err := scanRevision(tx.QueryRowContext(ctx, revisionQuery, noteID, revision))
	if err != nil {
		return SaveOutcome{}, err
	}
	if history == nil {
		return SaveOutcome{}, errors.New("找不到这一版修订")
	}
	if note.Title == history.Title && note.Body == history.BodyMD {
		return SaveOutcome{ID: noteID, Revision: note.Revision}, nil
	}

	note.Title, note.Body = history.Title, history.BodyMD
	next := note.Revision + 1
	if _, err := tx.ExecContext(ctx, "UPDATE notes SET title = ?, body_md = ?, current_revision = ?, updated_at = ? WHERE id = ?",
		note.Title, note.Body, next, now, noteID); err != nil {
		return SaveOutcome{}, err
	}
	if err := afterContentChange(ctx, tx, note, next, now); err != nil {
		return SaveOutcome{}, err
	}
	if err := tx.Commit(); err != nil {
		return SaveOutcome{}, err
	}
	return SaveOutcome{ID: noteID, Revision: next}, nil
}

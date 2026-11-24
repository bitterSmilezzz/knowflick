package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// EnsureNoteFromMaterial 把素材映射成一篇笔记（幂等）：已映射过就返回既有笔记，
// 不重复建。正文优先取清洗后的 Markdown，没有才用原始正文。
func (l *Library) EnsureNoteFromMaterial(ctx context.Context, materialID string, now int64) (SaveOutcome, error) {
	if !l.writable {
		return SaveOutcome{}, ErrReadOnly
	}
	var existing Note
	err := l.db.QueryRowContext(ctx, "SELECT "+noteColumns+
		" FROM notes n WHERE source_material_id = ? AND is_deleted = 0", materialID).
		Scan(&existing.ID, &existing.Title, &existing.Body, &existing.Notebook, &existing.TagsJSON,
			&existing.Pinned, &existing.Favorite, &existing.ArchivedAt, &existing.SourceMaterialID, &existing.Revision,
			&existing.CreatedAt, &existing.UpdatedAt, &existing.Deleted, &existing.DeletedAt, &existing.ExcludeFromProfile)
	if err == nil {
		return SaveOutcome{ID: existing.ID, Revision: existing.Revision, Created: false}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SaveOutcome{}, err
	}

	var title, rawText string
	var cleaned sql.NullString
	err = l.db.QueryRowContext(ctx, "SELECT title, raw_text, cleaned_markdown FROM materials WHERE id = ?", materialID).
		Scan(&title, &rawText, &cleaned)
	if errors.Is(err, sql.ErrNoRows) {
		return SaveOutcome{}, fmt.Errorf("找不到素材 %s，可能已被删除", materialID)
	}
	if err != nil {
		return SaveOutcome{}, err
	}
	body := rawText
	if cleaned.Valid && strings.TrimSpace(cleaned.String) != "" {
		body = cleaned.String
	}
	source := materialID
	note := Note{
		ID: uuid.NewString(), Title: title, Body: body, SourceMaterialID: &source,
		CreatedAt: now, UpdatedAt: now,
	}
	outcome, err := l.Upsert(ctx, note, 0, now)
	if err != nil {
		var conflict *ConflictError
		if errors.As(err, &conflict) {
			return SaveOutcome{}, fmt.Errorf("笔记修订冲突（当前修订 %d）——该素材可能刚被映射过，请刷新", conflict.CurrentRevision)
		}
		return SaveOutcome{}, err
	}
	return outcome, nil
}

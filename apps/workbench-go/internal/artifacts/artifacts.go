package artifacts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

// Artifact 是一条认知产物，线格式与桌面端 Artifact 一致。
type Artifact struct {
	ID              string   `json:"id"`
	ArtifactType    string   `json:"artifactType"`
	Title           string   `json:"title"`
	ContentMarkdown string   `json:"contentMarkdown"`
	SourceCardIDs   []string `json:"sourceCardIds"`
	SourceNoteIDs   []string `json:"sourceNoteIds"`
	DateScopeStart  *int64   `json:"dateScopeStart"`
	DateScopeEnd    *int64   `json:"dateScopeEnd"`
	CreatedAt       int64    `json:"createdAt"`
	UpdatedAt       int64    `json:"updatedAt"`
	IsDeleted       bool     `json:"isDeleted"`
}

const columns = "id,artifact_type,title,content_markdown,source_card_ids,source_note_ids," +
	"date_scope_start,date_scope_end,created_at,updated_at,is_deleted"

// List 列出未删除产物，按创建时间倒序（与桌面端 db_list_artifacts 同序）。
func List(ctx context.Context, db *sql.DB, limit, offset int) ([]Artifact, error) {
	return read(ctx, db, "SELECT "+columns+" FROM artifacts WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?", limit, offset)
}

// Get 读一条产物；不存在或已删除返回 nil。
func Get(ctx context.Context, db *sql.DB, id string) (*Artifact, error) {
	items, err := read(ctx, db, "SELECT "+columns+" FROM artifacts WHERE id = ? AND is_deleted = 0", id, 1)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return &items[0], nil
}

// Save 新增或更新产物：更新不改 created_at，总是把 is_deleted 复位（与 Rust save_artifact 同语义）。
func Save(ctx context.Context, db *sql.DB, artifact Artifact) error {
	artifact.Title = strings.TrimSpace(artifact.Title)
	if artifact.ID == "" || !utf8.ValidString(artifact.ID) || hasControl(artifact.ID) {
		return errors.New("产物标识无效")
	}
	if artifact.Title == "" || len([]rune(artifact.Title)) > 200 {
		return errors.New("产物标题不能为空，且不能超过 200 字")
	}
	if !utf8.ValidString(artifact.ContentMarkdown) || hasControl(artifact.ContentMarkdown) {
		return errors.New("产物正文不能包含控制字符")
	}
	sourceCards, err := encodeIDs(artifact.SourceCardIDs)
	if err != nil {
		return err
	}
	sourceNotes, err := encodeIDs(artifact.SourceNoteIDs)
	if err != nil {
		return err
	}
	if artifact.CreatedAt <= 0 || artifact.UpdatedAt <= 0 {
		return errors.New("产物时间无效")
	}
	_, err = db.ExecContext(ctx, "INSERT INTO artifacts "+
		"(id, artifact_type, title, content_markdown, source_card_ids, "+
		"date_scope_start, date_scope_end, created_at, updated_at, is_deleted, source_note_ids) "+
		"VALUES (?,?,?,?,?,?,?,?,?,0,?) "+
		"ON CONFLICT(id) DO UPDATE SET "+
		"artifact_type = excluded.artifact_type, "+
		"title = excluded.title, "+
		"content_markdown = excluded.content_markdown, "+
		"source_card_ids = excluded.source_card_ids, "+
		"source_note_ids = excluded.source_note_ids, "+
		"date_scope_start = excluded.date_scope_start, "+
		"date_scope_end = excluded.date_scope_end, "+
		"updated_at = excluded.updated_at, "+
		"is_deleted = 0",
		artifact.ID, artifact.ArtifactType, artifact.Title, artifact.ContentMarkdown,
		sourceCards, artifact.DateScopeStart, artifact.DateScopeEnd,
		artifact.CreatedAt, artifact.UpdatedAt, sourceNotes)
	return err
}

// Delete 软删除产物：硬删会让「依据这 N 张卡片生成的简报」凭空消失。
func Delete(ctx context.Context, db *sql.DB, id string, now int64) error {
	result, err := db.ExecContext(ctx, "UPDATE artifacts SET is_deleted = 1, updated_at = ? WHERE id = ? AND is_deleted = 0", now, id)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return errors.New("产物不存在或已删除")
	}
	return nil
}

func encodeIDs(ids []string) (string, error) {
	if ids == nil {
		ids = []string{}
	}
	for _, id := range ids {
		if id == "" || hasControl(id) {
			return "", errors.New("产物来源标识无效")
		}
	}
	encoded, err := json.Marshal(ids)
	if err != nil {
		return "", errors.New("产物来源标识序列化失败")
	}
	return string(encoded), nil
}

func read(ctx context.Context, db *sql.DB, query string, args ...any) ([]Artifact, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Artifact, 0)
	for rows.Next() {
		var item Artifact
		var sourceCards, sourceNotes string
		var deleted int64
		if err := rows.Scan(&item.ID, &item.ArtifactType, &item.Title, &item.ContentMarkdown,
			&sourceCards, &sourceNotes, &item.DateScopeStart, &item.DateScopeEnd,
			&item.CreatedAt, &item.UpdatedAt, &deleted); err != nil {
			return nil, err
		}
		item.SourceCardIDs = decodeIDs(sourceCards)
		item.SourceNoteIDs = decodeIDs(sourceNotes)
		item.IsDeleted = deleted != 0
		items = append(items, item)
	}
	return items, rows.Err()
}

// decodeIDs 对旧库里损坏的 JSON 宽容处理：列表照常显示，来源显示为空。
func decodeIDs(raw string) []string {
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil || ids == nil {
		return []string{}
	}
	return ids
}

func hasControl(value string) bool {
	for _, r := range value {
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) {
			return true
		}
	}
	return false
}

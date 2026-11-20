package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"knowflick.local/workbench-go/internal/archive"
	"knowflick.local/workbench-go/internal/cards"
	"knowflick.local/workbench-go/internal/libfiles"
	"knowflick.local/workbench-go/internal/media"
)

// CoreRestoreCounts 是核心数据恢复结果。
type CoreRestoreCounts struct {
	Materials      int `json:"materials"`
	Cards          int `json:"cards"`
	Artifacts      int `json:"artifacts"`
	Media          int `json:"media"`
	Notes          int `json:"notes"`
	Revisions      int `json:"revisions"`
	KnowledgeBases int `json:"knowledgeBases"`
	Membership     int `json:"membership"`
	Skipped        int `json:"skipped"`
}

// RestoreCoreBackup 把校验过的备份写入目标库：素材、卡片、产物、附件与设置。
// 同标识记录已存在时按主键冲突跳过并计数——恢复是合并，不是覆盖。
// 笔记、知识库、历史、订阅、邮箱、回收站与 R4 仍未迁移。
func (l *Library) RestoreCoreBackup(ctx context.Context, backup archive.SystemBackup, dir string) (CoreRestoreCounts, error) {
	var counts CoreRestoreCounts
	var materials []backupMaterial
	if err := json.Unmarshal(backup.Materials, &materials); err != nil || materials == nil {
		return counts, errors.New("materials.json 必须是有效的 JSON 数组")
	}
	var cardList []cards.Card
	if err := json.Unmarshal(backup.Cards, &cardList); err != nil || cardList == nil {
		return counts, errors.New("cards.json 必须是有效的 JSON 数组")
	}
	var artifactList []backupArtifact
	if err := json.Unmarshal(backup.Artifacts, &artifactList); err != nil || artifactList == nil {
		return counts, errors.New("artifacts.json 必须是有效的 JSON 数组")
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return counts, fmt.Errorf("打开恢复事务失败：%w", err)
	}
	defer tx.Rollback()
	for _, item := range materials {
		inserted, err := insertIgnore(ctx, tx, "INSERT INTO materials (id,source_type,title,source_url,raw_text,cleaned_markdown,content_hash,media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
			item.ID, item.SourceType, item.Title, item.SourceURL, item.RawText, item.CleanedMarkdown, item.ContentHash, item.MediaPath, item.MediaSizeBytes, item.MetadataJSON, item.InboxStatus, item.CreatedAt, item.UpdatedAt)
		if err != nil {
			return counts, fmt.Errorf("恢复素材失败：%w", err)
		}
		if inserted {
			counts.Materials++
		} else {
			counts.Skipped++
		}
	}
	for _, card := range cardList {
		links, tags, prereq, err := encodeCardJSON(card)
		if err != nil {
			return counts, err
		}
		inserted, err := insertIgnore(ctx, tx, "INSERT INTO cards (id,material_id,category,headline,summary,details,links_json,tags_json,source,seen_at,swiped,is_favorite,favorited_at,review_count,mastery_level,last_reviewed_at,repetition,interval_days,ease_factor,stability,difficulty,subject,branch,level,track,order_key,prereq_json,created_at,edited_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
			card.ID, card.MaterialID, card.Category, card.Headline, card.Summary, card.Details, links, tags, card.Source, card.SeenAt, card.Swiped, favoriteValue(card.IsFavorite), card.FavoritedAt, card.ReviewCount, card.MasteryLevel, card.LastReviewedAt, card.Repetition, card.IntervalDays, card.EaseFactor, card.Stability, card.Difficulty, card.Subject, card.Branch, card.Level, card.Track, card.OrderKey, prereq, card.CreatedAt, card.EditedAt, card.CreatedAt)
		if err != nil {
			return counts, fmt.Errorf("恢复卡片失败：%w", err)
		}
		if inserted {
			counts.Cards++
		} else {
			counts.Skipped++
		}
	}
	for _, item := range artifactList {
		cardIDs, noteIDs, err := encodeArtifactIDs(item)
		if err != nil {
			return counts, err
		}
		inserted, err := insertIgnore(ctx, tx, "INSERT INTO artifacts (id,artifact_type,title,content_markdown,source_card_ids,source_note_ids,date_scope_start,date_scope_end,created_at,updated_at,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
			item.ID, item.ArtifactType, item.Title, item.ContentMarkdown, cardIDs, noteIDs, item.DateScopeStart, item.DateScopeEnd, item.CreatedAt, item.UpdatedAt, artifactDeletedValue(item.IsDeleted))
		if err != nil {
			return counts, fmt.Errorf("恢复产物失败：%w", err)
		}
		if inserted {
			counts.Artifacts++
		} else {
			counts.Skipped++
		}
	}
	var notes []backupNote
	if len(backup.Notes) > 0 {
		if err := json.Unmarshal(backup.Notes, &notes); err != nil || notes == nil {
			return counts, errors.New("notes.json 必须是有效的 JSON 数组")
		}
	}
	for _, note := range notes {
		noteTags, err := json.Marshal(note.Tags)
		if err != nil {
			return counts, err
		}
		inserted, err := insertIgnore(ctx, tx, "INSERT INTO notes (id,title,body_md,notebook,tags_json,is_pinned,is_favorite,archived_at,source_material_id,current_revision,created_at,updated_at,is_deleted,deleted_at,exclude_from_profile) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
			note.ID, note.Title, note.BodyMD, note.Notebook, string(noteTags), favoriteValue(note.IsPinned), favoriteValue(note.IsFavorite), note.ArchivedAt, note.SourceMaterialID, note.CurrentRevision, note.CreatedAt, note.UpdatedAt, favoriteValue(note.IsDeleted), note.DeletedAt, favoriteValue(note.ExcludeFromProfile))
		if err != nil {
			return counts, fmt.Errorf("恢复笔记失败：%w", err)
		}
		if inserted {
			counts.Notes++
		} else {
			counts.Skipped++
		}
	}
	var revisionList []backupNoteRevision
	if len(backup.NoteRevisions) > 0 {
		if err := json.Unmarshal(backup.NoteRevisions, &revisionList); err != nil || revisionList == nil {
			return counts, errors.New("note_revisions.json 必须是有效的 JSON 数组")
		}
	}
	for _, revision := range revisionList {
		inserted, err := insertIgnore(ctx, tx, "INSERT INTO note_revisions (note_id,revision,title,body_md,saved_at) VALUES (?,?,?,?,?) ON CONFLICT(note_id,revision) DO NOTHING",
			revision.NoteID, revision.Revision, revision.Title, revision.BodyMD, revision.SavedAt)
		if err != nil {
			return counts, fmt.Errorf("恢复笔记历史失败：%w", err)
		}
		if inserted {
			counts.Revisions++
		} else {
			counts.Skipped++
		}
	}
	var knowledgeBases struct {
		Items      []backupKnowledgeBase `json:"knowledgeBases"`
		Membership map[string]int64      `json:"membership"`
	}
	if len(backup.KnowledgeBases) > 0 {
		if err := json.Unmarshal(backup.KnowledgeBases, &knowledgeBases); err != nil || knowledgeBases.Items == nil {
			return counts, errors.New("knowledge_bases.json 结构无效")
		}
	}
	for _, base := range knowledgeBases.Items {
		inserted, err := insertIgnore(ctx, tx, "INSERT INTO knowledge_bases (id,name,description,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
			base.ID, base.Name, base.Description, base.CreatedAt, base.UpdatedAt)
		if err != nil {
			return counts, fmt.Errorf("恢复知识库失败：%w", err)
		}
		if inserted {
			counts.KnowledgeBases++
		} else {
			counts.Skipped++
		}
	}
	for key, addedAt := range knowledgeBases.Membership {
		parts := strings.Split(key, "\n")
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			return counts, errors.New("知识库成员关系键无效")
		}
		inserted, err := insertIgnore(ctx, tx, "INSERT INTO kb_membership (kb_id,note_id,added_at) VALUES (?,?,?) ON CONFLICT(kb_id,note_id) DO NOTHING",
			parts[0], parts[1], addedAt)
		if err != nil {
			return counts, fmt.Errorf("恢复知识库成员关系失败：%w", err)
		}
		if inserted {
			counts.Membership++
		} else {
			counts.Skipped++
		}
	}
	if err := tx.Commit(); err != nil {
		return counts, fmt.Errorf("提交恢复事务失败：%w", err)
	}
	if len(backup.Settings) > 0 && string(backup.Settings) != "{}" {
		if err := libfiles.SaveSettings(dir, string(backup.Settings)); err != nil {
			return counts, fmt.Errorf("恢复设置失败：%w", err)
		}
	}
	for relative, body := range backup.Media {
		if _, err := media.Restore(dir, relative, body); err != nil {
			return counts, fmt.Errorf("恢复附件 %s 失败：%w", relative, err)
		}
		counts.Media++
	}
	return counts, nil
}

func insertIgnore(ctx context.Context, tx *sql.Tx, statement string, args ...any) (bool, error) {
	result, err := tx.ExecContext(ctx, statement, args...)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

func encodeCardJSON(card cards.Card) (string, string, string, error) {
	links, err := json.Marshal(card.Links)
	if err != nil {
		return "", "", "", err
	}
	tags, err := json.Marshal(card.Tags)
	if err != nil {
		return "", "", "", err
	}
	prereq, err := json.Marshal(card.Prereq)
	if err != nil {
		return "", "", "", err
	}
	return string(links), string(tags), string(prereq), nil
}

func encodeArtifactIDs(item backupArtifact) (string, string, error) {
	cardIDs, err := json.Marshal(item.SourceCardIDs)
	if err != nil {
		return "", "", err
	}
	noteIDs, err := json.Marshal(item.SourceNoteIDs)
	if err != nil {
		return "", "", err
	}
	return string(cardIDs), string(noteIDs), nil
}

func favoriteValue(favorite bool) int {
	if favorite {
		return 1
	}
	return 0
}

func artifactDeletedValue(deleted bool) int {
	if deleted {
		return 1
	}
	return 0
}

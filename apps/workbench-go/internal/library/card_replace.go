package library

import (
	"context"
	"encoding/json"

	"knowflick.local/workbench-go/internal/cards"
)

// ReplaceCards 与 Rust replace_cards 同语义：传入列表即活跃全集——
// 不在列表里的未删除卡片软删除并清 FTS；传入的卡片全量 upsert 并重建索引；
// 最后打 legacy_cards_migrated 标记（旧 cards.json 迁移完成）。
func (l *Library) ReplaceCards(ctx context.Context, list []cards.Card, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "CREATE TEMP TABLE IF NOT EXISTS temp_active_ids (id TEXT PRIMARY KEY)"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM temp_active_ids"); err != nil {
		return err
	}
	for _, card := range list {
		if _, err := tx.ExecContext(ctx, "INSERT OR REPLACE INTO temp_active_ids (id) VALUES (?)", card.ID); err != nil {
			return err
		}
	}
	// 未在传入列表中的未删除卡片软删除。
	if _, err := tx.ExecContext(ctx, "UPDATE cards SET is_deleted = 1, deleted_at = ? WHERE is_deleted = 0 AND id NOT IN (SELECT id FROM temp_active_ids)", now); err != nil {
		return err
	}
	// FTS 清理所有软删除的卡片。
	if _, err := tx.ExecContext(ctx, "DELETE FROM fts_cards WHERE card_id IN (SELECT id FROM cards WHERE is_deleted = 1)"); err != nil {
		return err
	}
	for _, card := range list {
		links, err := json.Marshal(card.Links)
		if err != nil {
			return err
		}
		tags, err := json.Marshal(card.Tags)
		if err != nil {
			return err
		}
		prereq, err := json.Marshal(card.Prereq)
		if err != nil {
			return err
		}
		updatedAt := now
		if card.EditedAt != nil {
			updatedAt = *card.EditedAt
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO cards
			(id, material_id, category, headline, summary, details,
			 links_json, tags_json, source, seen_at, swiped, is_favorite,
			 favorited_at, review_count, mastery_level, last_reviewed_at,
			 repetition, interval_days, ease_factor, stability, difficulty,
			 subject, branch, level, track, order_key, prereq_json,
			 created_at, edited_at, updated_at, version, is_deleted, deleted_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,NULL)
			ON CONFLICT(id) DO UPDATE SET
				material_id=excluded.material_id, category=excluded.category,
				headline=excluded.headline, summary=excluded.summary, details=excluded.details,
				links_json=excluded.links_json, tags_json=excluded.tags_json, source=excluded.source,
				seen_at=excluded.seen_at, swiped=excluded.swiped, is_favorite=excluded.is_favorite,
				favorited_at=excluded.favorited_at, review_count=excluded.review_count,
				mastery_level=excluded.mastery_level, last_reviewed_at=excluded.last_reviewed_at,
				repetition=excluded.repetition, interval_days=excluded.interval_days,
				ease_factor=excluded.ease_factor, stability=excluded.stability, difficulty=excluded.difficulty,
				subject=excluded.subject, branch=excluded.branch, level=excluded.level,
				track=excluded.track, order_key=excluded.order_key, prereq_json=excluded.prereq_json,
				edited_at=excluded.edited_at, updated_at=excluded.updated_at,
				version=cards.version+1, is_deleted=0, deleted_at=NULL`,
			card.ID, card.MaterialID, card.Category, card.Headline, card.Summary, card.Details,
			string(links), string(tags), card.Source, card.SeenAt, card.Swiped, boolInt(card.IsFavorite),
			card.FavoritedAt, card.ReviewCount, card.MasteryLevel, card.LastReviewedAt,
			card.Repetition, card.IntervalDays, card.EaseFactor, card.Stability, card.Difficulty,
			card.Subject, card.Branch, card.Level, card.Track, card.OrderKey, string(prereq),
			card.CreatedAt, card.EditedAt, updatedAt); err != nil {
			return err
		}
		if err := cards.InvalidateEmbedding(ctx, tx, card.ID); err != nil {
			return err
		}
		if err := cards.IndexContent(ctx, tx, card.ID, cards.Content{Category: card.Category, Headline: card.Headline, Summary: card.Summary, Details: card.Details, Tags: card.Tags}); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_cards_migrated', '1')"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM temp_active_ids"); err != nil {
		return err
	}
	return tx.Commit()
}

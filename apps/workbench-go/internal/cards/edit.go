package cards

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

type Content struct {
	Category string   `json:"category"`
	Headline string   `json:"headline"`
	Summary  string   `json:"summary"`
	Details  string   `json:"details"`
	Tags     []string `json:"tags"`
}

type EditableCard struct {
	ID      string  `json:"id"`
	Version int64   `json:"version"`
	Content Content `json:"content"`
	// 出处字段只在新建时写入：编辑表单不拥有它们，更新路径保持库里原值。
	MaterialID *string       `json:"materialId,omitempty"`
	Source     string        `json:"source,omitempty"`
	Links      []ScienceLink `json:"links,omitempty"`
}

// Browse lists active cards or searches their full-text index, with the desktop LIKE fallback.
func Browse(ctx context.Context, db *sql.DB, query string, limit, offset int) ([]EditableCard, error) {
	const columns = "SELECT c.id,c.version,c.category,c.headline,c.summary,c.details,c.tags_json"
	const order = " ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?"
	clean := strings.TrimSpace(query)
	if clean == "" {
		return readEditable(ctx, db, columns+" FROM cards c WHERE c.is_deleted = 0"+order, limit, offset)
	}
	words := strings.Fields(clean)
	for i, word := range words {
		words[i] = `"` + strings.ReplaceAll(word, `"`, `""`) + `"*`
	}
	match := strings.Join(words, " AND ")
	// Choose between result sets before pagination so an empty later FTS page does not fall back to LIKE.
	const search = ` WITH matches AS (
		SELECT f.card_id, bm25(fts_cards) AS score FROM fts_cards f JOIN cards c ON c.id = f.card_id
		WHERE c.is_deleted = 0 AND fts_cards MATCH ?1
	)
	`
	return readEditable(ctx, db, search+columns+` FROM cards c
		LEFT JOIN matches m ON m.card_id = c.id WHERE c.is_deleted = 0 AND (
			m.card_id IS NOT NULL OR (NOT EXISTS (SELECT 1 FROM matches) AND
			(c.headline LIKE ?2 OR c.details LIKE ?2 OR c.summary LIKE ?2 OR c.category LIKE ?2))
		) ORDER BY m.score ASC, c.created_at DESC, c.id LIMIT ?3 OFFSET ?4`, match, "%"+clean+"%", limit, offset)
}

func readEditable(ctx context.Context, db *sql.DB, query string, args ...any) ([]EditableCard, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]EditableCard, 0)
	for rows.Next() {
		var item EditableCard
		var tags string
		content := &item.Content
		if err := rows.Scan(&item.ID, &item.Version, &content.Category, &content.Headline, &content.Summary, &content.Details, &tags); err != nil {
			return nil, err
		}
		content.Tags = parseStrings(tags)
		items = append(items, item)
	}
	return items, rows.Err()
}

// SaveContent creates a card at version zero or updates the displayed version.
func SaveContent(ctx context.Context, db *sql.DB, card EditableCard, now int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := SaveContentTx(ctx, tx, card, now); err != nil {
		return err
	}
	return tx.Commit()
}

// SaveContentTx 在调用方的事务里写卡片：素材转卡要与素材状态一起提交。
// 版本冲突、内容校验与索引更新都在这里，调用方只负责事务的提交。
func SaveContentTx(ctx context.Context, tx *sql.Tx, card EditableCard, now int64) error {
	content := card.Content
	content.Headline = strings.TrimSpace(content.Headline)
	for _, value := range append([]string{content.Headline, content.Details, content.Category}, content.Tags...) {
		if hasCardControl(value) {
			return errors.New("卡片内容不能包含控制字符")
		}
	}
	if len([]rune(content.Headline)) > 200 {
		return errors.New("卡片标题不能超过 200 字")
	}
	if content.Headline == "" || strings.TrimSpace(content.Details) == "" {
		return errors.New("标题和正文不能为空")
	}
	if card.ID == "" || card.Version < 0 {
		return errors.New("卡片标识或版本无效")
	}
	if content.Tags == nil {
		content.Tags = []string{}
	}
	tags, err := json.Marshal(content.Tags)
	if err != nil {
		return err
	}

	if card.Version == 0 {
		links, err := json.Marshal(card.Links)
		if err != nil {
			return err
		}
		source := card.Source
		if source == "" {
			source = "imported"
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO cards
			(id, material_id, category, headline, summary, details, links_json, tags_json, source, created_at, updated_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
			card.ID, card.MaterialID, content.Category, content.Headline, content.Summary, content.Details,
			string(links), string(tags), source, now, now)
		if err := requireChanged(result, err); err != nil {
			return err
		}
	} else {
		var previous Content
		var previousTags string
		err := tx.QueryRowContext(ctx, `SELECT category,headline,summary,details,tags_json FROM cards
			WHERE id = ? AND is_deleted = 0 AND version = ?`, card.ID, card.Version).
			Scan(&previous.Category, &previous.Headline, &previous.Summary, &previous.Details, &previousTags)
		if errors.Is(err, sql.ErrNoRows) {
			return errCardChanged
		}
		if err != nil {
			return err
		}
		if previous.Category != content.Category || previous.Headline != content.Headline || previous.Summary != content.Summary || previous.Details != content.Details || previousTags != string(tags) {
			result, err := tx.ExecContext(ctx, `UPDATE cards SET category = ?, headline = ?, summary = ?, details = ?,
				tags_json = ?, edited_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND is_deleted = 0 AND version = ?`,
				content.Category, content.Headline, content.Summary, content.Details, string(tags), now, now, card.ID, card.Version)
			if err := requireChanged(result, err); err != nil {
				return err
			}
			if err := InvalidateEmbedding(ctx, tx, card.ID); err != nil {
				return err
			}
		}
	}
	return IndexContent(ctx, tx, card.ID, content)
}

// DeleteContent soft-deletes the displayed card and removes its search index and embedding.
func DeleteContent(ctx context.Context, db *sql.DB, id string, version, now int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE cards SET is_deleted = 1, deleted_at = ?, version = version + 1
		WHERE id = ? AND is_deleted = 0 AND version = ?`, now, id, version)
	if err := requireChanged(result, err); err != nil {
		return err
	}
	if err := removeIndex(ctx, tx, id); err != nil {
		return err
	}
	if err := InvalidateEmbedding(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit()
}

var errCardChanged = errors.New("卡片已被修改或删除，请重新读取卡片后再操作")

func hasCardControl(value string) bool {
	for _, r := range value {
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) {
			return true
		}
	}
	return false
}

func requireChanged(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return errCardChanged
	}
	return nil
}

func IndexContent(ctx context.Context, tx *sql.Tx, id string, content Content) error {
	if err := removeIndex(ctx, tx, id); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO fts_cards (card_id,headline,summary,details,category,tags) VALUES (?,?,?,?,?,?)",
		id, content.Headline, content.Summary, content.Details, content.Category, strings.Join(content.Tags, " "))
	return err
}

func removeIndex(ctx context.Context, tx *sql.Tx, id string) error {
	_, err := tx.ExecContext(ctx, "DELETE FROM fts_cards WHERE card_id = ?", id)
	return err
}

// InvalidateEmbedding 清掉一张卡片的向量：内容或身份变了就作废，等重算。
func InvalidateEmbedding(ctx context.Context, tx *sql.Tx, id string) error {
	_, err := tx.ExecContext(ctx, "DELETE FROM card_embeddings WHERE card_id = ?", id)
	return err
}

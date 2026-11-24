package embed

import (
	"context"
	"database/sql"
	"encoding/binary"
	"math"
	"time"
)

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

// Item 是一条待写入的卡片向量。
type Item struct {
	CardID string    `json:"cardId"`
	Vector []float32 `json:"vector"`
}

// Save 写入（或覆盖）一张卡片的向量，连同维度与向量身份一起存。
func Save(ctx context.Context, db *sql.DB, cardID string, vector []float32, provider, model string) error {
	_, err := db.ExecContext(ctx, "INSERT INTO card_embeddings (card_id, dim, embedding, updated_at, provider, model)"+
		" VALUES (?,?,?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET dim = excluded.dim,"+
		" embedding = excluded.embedding, updated_at = excluded.updated_at,"+
		" provider = excluded.provider, model = excluded.model",
		cardID, int64(len(vector)), packFloats(vector), nowMillis(), provider, model)
	return err
}

// SaveBatch 在一个事务里批量写向量：要么全部生效，要么全部不生效。
func SaveBatch(ctx context.Context, db *sql.DB, items []Item, provider, model string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := nowMillis()
	for _, item := range items {
		if _, err := tx.ExecContext(ctx, "INSERT INTO card_embeddings (card_id, dim, embedding, updated_at, provider, model)"+
			" VALUES (?,?,?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET dim = excluded.dim,"+
			" embedding = excluded.embedding, updated_at = excluded.updated_at,"+
			" provider = excluded.provider, model = excluded.model",
			item.CardID, int64(len(item.Vector)), packFloats(item.Vector), now, provider, model); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListUnembedded 列出还没有向量的卡片，按创建时间倒序。
func ListUnembedded(ctx context.Context, db *sql.DB, limit int64) ([]string, error) {
	return queryIDs(ctx, db, "SELECT c.id FROM cards c"+
		" LEFT JOIN card_embeddings e ON c.id = e.card_id"+
		" WHERE c.is_deleted = 0 AND e.card_id IS NULL"+
		" ORDER BY c.created_at DESC LIMIT ?", limit)
}

// ListStale 列出「向量身份与当前引擎不匹配」的卡片：维度或 provider/model
// 对不上都算过期（同维度不同模型不混算）。dim <= 0 时只比身份。
func ListStale(ctx context.Context, db *sql.DB, dim int64, provider, model string, limit int64) ([]string, error) {
	if dim > 0 {
		return queryIDs(ctx, db, "SELECT c.id FROM cards c"+
			" INNER JOIN card_embeddings e ON c.id = e.card_id"+
			" WHERE c.is_deleted = 0 AND (e.dim <> ? OR e.provider <> ? OR e.model <> ?)"+
			" ORDER BY c.created_at DESC LIMIT ?", dim, provider, model, limit)
	}
	return queryIDs(ctx, db, "SELECT c.id FROM cards c"+
		" INNER JOIN card_embeddings e ON c.id = e.card_id"+
		" WHERE c.is_deleted = 0 AND (e.provider <> ? OR e.model <> ?)"+
		" ORDER BY c.created_at DESC LIMIT ?", provider, model, limit)
}

// HashIdentity 是哈希投影的向量身份（与前端 HASH_IDENTITY 一致）。
const (
	HashProvider = "hash"
	HashModel    = "char-ngram-128"
)

func queryIDs(ctx context.Context, db *sql.DB, query string, args ...any) ([]string, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// packFloats 按小端编码 f32，与 Rust 的 to_le_bytes 序列一致。
func packFloats(vector []float32) []byte {
	bytes := make([]byte, len(vector)*4)
	for index, value := range vector {
		binary.LittleEndian.PutUint32(bytes[index*4:], math.Float32bits(value))
	}
	return bytes
}

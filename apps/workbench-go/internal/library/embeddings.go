package library

import (
	"context"
	"encoding/json"
	"strings"

	"knowflick.local/workbench-go/internal/embed"
)

// RebuildHashEmbeddings 给还没有向量的卡片补一组确定性哈希向量：
// 与网页端 localSemanticHashEmbedding 同一算法（128 维，identity = hash/char-ngram-128），
// 文本拼接与前端 cardToEmbeddingText 一致。返回补全的卡片数。
func (l *Library) RebuildHashEmbeddings(ctx context.Context, limit int64) (int, error) {
	if !l.writable {
		return 0, ErrReadOnly
	}
	ids, err := embed.ListUnembedded(ctx, l.db, limit)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	texts, err := l.embeddingTexts(ctx, ids)
	if err != nil {
		return 0, err
	}
	items := make([]embed.Item, 0, len(ids))
	for _, id := range ids {
		vector := embed.HashEmbedding(texts[id], embed.HashDim)
		converted := make([]float32, len(vector))
		for index, value := range vector {
			converted[index] = float32(value)
		}
		items = append(items, embed.Item{CardID: id, Vector: converted})
	}
	if err := embed.SaveBatch(ctx, l.db, items, embed.HashProvider, embed.HashModel); err != nil {
		return 0, err
	}
	return len(items), nil
}

// embeddingTexts 按前端 cardToEmbeddingText 的拼法取每张卡的索引文本。
func (l *Library) embeddingTexts(ctx context.Context, ids []string) (map[string]string, error) {
	placeholders := make([]string, len(ids))
	args := make([]any, 0, len(ids))
	for index, id := range ids {
		placeholders[index] = "?"
		args = append(args, id)
	}
	rows, err := l.db.QueryContext(ctx, "SELECT id, category, headline, summary, details, tags_json FROM cards"+
		" WHERE id IN ("+strings.Join(placeholders, ",")+")", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	texts := make(map[string]string, len(ids))
	for rows.Next() {
		var id, category, headline, summary, details, tagsJSON string
		if err := rows.Scan(&id, &category, &headline, &summary, &details, &tagsJSON); err != nil {
			return nil, err
		}
		texts[id] = embeddingText(category, headline, summary, details, tagsJSON)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return texts, nil
}

func embeddingText(category, headline, summary, details, tagsJSON string) string {
	parts := make([]string, 0, 5)
	if category != "" {
		parts = append(parts, "["+category+"]")
	}
	parts = append(parts, headline, summary, details)
	var tags []string
	if err := json.Unmarshal([]byte(tagsJSON), &tags); err == nil {
		rendered := make([]string, 0, len(tags))
		for _, tag := range tags {
			if tag != "" {
				rendered = append(rendered, "#"+tag)
			}
		}
		if len(rendered) > 0 {
			parts = append(parts, strings.Join(rendered, " "))
		}
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

// SaveCardEmbedding 写入一张卡片的向量（含维度与身份）。
func (l *Library) SaveCardEmbedding(ctx context.Context, cardID string, vector []float32, provider, model string) error {
	if !l.writable {
		return ErrReadOnly
	}
	return embed.Save(ctx, l.db, cardID, vector, provider, model)
}

// SaveCardEmbeddingBatch 在一个事务里批量写向量。
func (l *Library) SaveCardEmbeddingBatch(ctx context.Context, items []embed.Item, provider, model string) error {
	if !l.writable {
		return ErrReadOnly
	}
	return embed.SaveBatch(ctx, l.db, items, provider, model)
}

// ListUnembeddedCards 列出还没有向量的卡片。
func (l *Library) ListUnembeddedCards(ctx context.Context, limit int64) ([]string, error) {
	return embed.ListUnembedded(ctx, l.db, limit)
}

// ListStaleEmbeddingCards 列出身份与当前引擎不匹配、需要重算的卡片。
func (l *Library) ListStaleEmbeddingCards(ctx context.Context, dim int64, provider, model string, limit int64) ([]string, error) {
	return embed.ListStale(ctx, l.db, dim, provider, model, limit)
}

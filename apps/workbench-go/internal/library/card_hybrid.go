package library

import (
	"context"
	"strings"

	"knowflick.local/workbench-go/internal/cards"
)

// HybridCardHit 是混合召回命中：卡片加 RRF 融合分数。
type HybridCardHit struct {
	Card  cards.Card `json:"card"`
	Score float64    `json:"score"`
}

// SearchCardsHybrid 关键词 FTS + 向量余弦做 RRF 融合（k=60，与 Rust 一致）。
// 向量为空或维度不符时自动退化为纯关键词召回。
func (l *Library) SearchCardsHybrid(ctx context.Context, query string, queryEmbedding []float32, provider, model string, limit int) ([]HybridCardHit, error) {
	if limit <= 0 {
		return []HybridCardHit{}, nil
	}
	const k = 60.0
	scores := make(map[string]float64)
	ids := make([]string, 0)
	addScore := func(id string, contribution float64) {
		if _, exists := scores[id]; !exists {
			ids = append(ids, id)
		}
		scores[id] += contribution
	}
	if strings.TrimSpace(query) != "" {
		ftsResults, err := cards.Browse(ctx, l.db, query, limit*2, 0)
		if err == nil {
			for rank, card := range ftsResults {
				addScore(card.ID, 1.0/(k+float64(rank)+1.0))
			}
		}
	}
	if len(queryEmbedding) > 0 {
		vecResults, err := l.SearchCardsVector(ctx, queryEmbedding, provider, model, limit*2)
		if err == nil {
			for rank, hit := range vecResults {
				addScore(hit.Card.ID, 1.0/(k+float64(rank)+1.0))
			}
		}
	}
	sortIdsByScore(ids, scores)
	if len(ids) > limit {
		ids = ids[:limit]
	}
	out := make([]HybridCardHit, 0, len(ids))
	for _, id := range ids {
		card, err := cards.CardByID(ctx, l.db, id)
		if err != nil {
			continue
		}
		out = append(out, HybridCardHit{Card: card, Score: scores[id]})
	}
	return out, nil
}

// sortIdsByScore 按融合分排序；同分保持先出现的条目在前（稳定序）。
func sortIdsByScore(ids []string, scores map[string]float64) {
	for i := 1; i < len(ids); i++ {
		for j := i; j > 0 && scores[ids[j]] > scores[ids[j-1]]; j-- {
			ids[j], ids[j-1] = ids[j-1], ids[j]
		}
	}
}

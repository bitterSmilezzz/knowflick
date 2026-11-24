package library

import (
	"context"
	"encoding/binary"
	"math"
	"sort"

	"knowflick.local/workbench-go/internal/cards"
)

// CardVectorHit 是向量召回命中：卡片加相似度分数。
type CardVectorHit struct {
	Card  cards.Card `json:"card"`
	Score float32    `json:"score"`
}

type vectorScore struct {
	id    string
	score float32
}

// SearchCardsVector 只比同一向量空间（dim + provider + model）的暴力余弦召回。
// 与 Rust search_cards_vector 同口径：先扫向量取前 N，再按 id 取回完整卡片。
func (l *Library) SearchCardsVector(ctx context.Context, query []float32, provider, model string, limit int) ([]CardVectorHit, error) {
	if len(query) == 0 || limit <= 0 {
		return []CardVectorHit{}, nil
	}
	rows, err := l.db.QueryContext(ctx,
		"SELECT e.card_id, e.embedding FROM card_embeddings e JOIN cards c ON c.id = e.card_id "+
			"WHERE c.is_deleted = 0 AND e.dim = ? AND e.provider = ? AND e.model = ?",
		len(query), provider, model)
	if err != nil {
		return nil, err
	}
	hits := make([]vectorScore, 0, 64)
	for rows.Next() {
		var id string
		var bytes []byte
		if err := rows.Scan(&id, &bytes); err != nil {
			rows.Close()
			return nil, err
		}
		if len(bytes)%4 != 0 {
			continue
		}
		vector := make([]float32, len(bytes)/4)
		for i := range vector {
			vector[i] = math.Float32frombits(binary.LittleEndian.Uint32(bytes[i*4:]))
		}
		hits = append(hits, vectorScore{id, cosine32(query, vector)})
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	if len(hits) > limit {
		hits = hits[:limit]
	}
	out := make([]CardVectorHit, 0, len(hits))
	for _, hit := range hits {
		card, err := cards.CardByID(ctx, l.db, hit.id)
		if err != nil {
			continue
		}
		out = append(out, CardVectorHit{Card: card, Score: hit.score})
	}
	return out, nil
}

func cosine32(a, b []float32) float32 {
	if len(a) != len(b) {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return float32(dot / (math.Sqrt(na) * math.Sqrt(nb)))
}

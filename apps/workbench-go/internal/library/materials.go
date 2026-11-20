package library

import (
	"context"
	"time"

	"knowflick.local/workbench-go/internal/materials"
)

func (l *Library) ListMaterials(ctx context.Context, inboxOnly bool, limit, offset int) ([]materials.Material, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	return materials.List(ctx, l.db, inboxOnly, limit, offset)
}

func (l *Library) SearchMaterials(ctx context.Context, query string, limit int) ([]materials.Material, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	return materials.Search(ctx, l.db, query, limit)
}

func (l *Library) UpdateMaterialStatus(ctx context.Context, id, status string, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return materials.UpdateStatus(ctx, l.db, id, status, now)
}

// ConvertMaterialToCard 把素材转成卡片并标为已处理；同一事务提交。
func (l *Library) ConvertMaterialToCard(ctx context.Context, materialID, cardID string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return materials.ConvertToCard(ctx, l.db, materialID, cardID, now)
}

var _ = time.Now

package library

import (
	"context"

	"knowflick.local/workbench-go/internal/archive"
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

// MaterialAttachment 是可写进笔记正文的库内素材附件。
type MaterialAttachment struct {
	Path  string `json:"path"`
	Title string `json:"title"`
}

func (l *Library) ListMaterialAttachments(ctx context.Context) ([]MaterialAttachment, error) {
	rows, err := l.db.QueryContext(ctx, "SELECT media_path, title FROM materials "+
		"WHERE is_deleted = 0 AND media_path IS NOT NULL AND media_path <> '' ORDER BY created_at DESC, id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]MaterialAttachment, 0)
	seen := make(map[string]struct{})
	for rows.Next() {
		var item MaterialAttachment
		if err := rows.Scan(&item.Path, &item.Title); err != nil {
			return nil, err
		}
		if !archive.IsSystemMediaPath(item.Path) {
			continue
		}
		if _, exists := seen[item.Path]; exists {
			continue
		}
		seen[item.Path] = struct{}{}
		items = append(items, item)
	}
	return items, rows.Err()
}

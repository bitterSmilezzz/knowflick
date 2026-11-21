package cards

import (
	"context"
	"database/sql"
)

// DeletedCard 是回收站里的一张卡片及其删除时间。
type DeletedCard struct {
	Card      Card
	DeletedAt *int64
}

// ListDeleted 读取回收站卡片（含删除时间），供 v11 备份使用。
func ListDeleted(ctx context.Context, tx *sql.Tx) ([]DeletedCard, error) {
	idRows, err := tx.QueryContext(ctx, "SELECT id, deleted_at FROM cards WHERE is_deleted = 1 ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	stamps := make(map[string]*int64)
	for idRows.Next() {
		var id string
		var deletedAt *int64
		if err := idRows.Scan(&id, &deletedAt); err != nil {
			idRows.Close()
			return nil, err
		}
		stamps[id] = deletedAt
	}
	idRows.Close()
	rows, err := tx.QueryContext(ctx, "SELECT "+columnList+" FROM cards WHERE is_deleted = 1 ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	deleted := make([]DeletedCard, 0, len(stamps))
	for rows.Next() {
		card, scanErr := scanCard(rows, true)
		if scanErr != nil {
			return nil, scanErr
		}
		deleted = append(deleted, DeletedCard{Card: card, DeletedAt: stamps[card.ID]})
	}
	return deleted, rows.Err()
}

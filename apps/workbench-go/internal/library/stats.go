package library

import (
	"context"

	"knowflick.local/workbench-go/internal/stats"
)

// Stats 取首屏数字，口径与桌面端 get_db_stats 一致。
func (l *Library) Stats(ctx context.Context, now int64) (stats.Stats, error) {
	return stats.Get(ctx, l.db, now)
}

package stats

import (
	"context"
	"database/sql"
)

// Stats 是首屏的一组数字，与桌面端 DbStatsDto 同口径。
type Stats struct {
	TotalCards     int64 `json:"totalCards"`
	TotalMaterials int64 `json:"totalMaterials"`
	InboxMaterials int64 `json:"inboxMaterials"`
	FavoriteCards  int64 `json:"favoriteCards"`
	SeenCards      int64 `json:"seenCards"`
	DueCards       int64 `json:"dueCards"`
}

// Get 一次查询取全部数字：到期只算已学过的卡片，且按间隔天数判断。
func Get(ctx context.Context, db *sql.DB, now int64) (Stats, error) {
	var stats Stats
	err := db.QueryRowContext(ctx, "SELECT "+
		"(SELECT COUNT(*) FROM cards WHERE is_deleted = 0), "+
		"(SELECT COUNT(*) FROM materials WHERE is_deleted = 0), "+
		"(SELECT COUNT(*) FROM materials WHERE is_deleted = 0 AND inbox_status = 'inbox'), "+
		"(SELECT COUNT(*) FROM cards WHERE is_deleted = 0 AND is_favorite = 1), "+
		"(SELECT COUNT(*) FROM cards WHERE is_deleted = 0 AND seen_at IS NOT NULL), "+
		"(SELECT COUNT(*) FROM cards WHERE is_deleted = 0 AND seen_at IS NOT NULL"+
		" AND (last_reviewed_at IS NULL OR (? - last_reviewed_at) >= (interval_days * 86400000)))", now).
		Scan(&stats.TotalCards, &stats.TotalMaterials, &stats.InboxMaterials,
			&stats.FavoriteCards, &stats.SeenCards, &stats.DueCards)
	return stats, err
}

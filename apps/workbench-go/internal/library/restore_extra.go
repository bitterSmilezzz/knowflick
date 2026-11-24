package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"knowflick.local/workbench-go/internal/errtext"

	"knowflick.local/workbench-go/internal/archive"
	"knowflick.local/workbench-go/internal/reviewhistory"
)

// restoreSubscriptions 恢复订阅：同标识但内容不同即拒绝（合并，不覆盖）。
func restoreSubscriptions(ctx context.Context, tx *sql.Tx, backup archive.SystemBackup) (int, error) {
	if len(backup.Subscriptions) == 0 {
		return 0, nil
	}
	var snapshot backupSubscriptions
	if err := json.Unmarshal(backup.Subscriptions, &snapshot); err != nil || snapshot.Version != 1 {
		return 0, errors.New("subscriptions.json 结构无效")
	}
	for _, item := range snapshot.Items {
		if !safeSubscriptionTarget(item.Type, item.TargetURL) || validateSubscription(item) != nil {
			return 0, errors.New("订阅备份包含无效记录")
		}
	}
	inserted := 0
	for _, item := range snapshot.Items {
		var existingTitle, existingURL string
		var existingInterval int64
		var existingActive int64
		err := tx.QueryRowContext(ctx, "SELECT title,target_url,interval_minutes,is_active FROM subscriptions WHERE id = ?", item.ID).Scan(&existingTitle, &existingURL, &existingInterval, &existingActive)
		if err == nil {
			if existingTitle != item.Title || existingURL != item.TargetURL || existingInterval != item.IntervalMinutes || (existingActive != 0) != item.IsActive {
				return 0, errors.New("本地存在同标识但内容不同的订阅，未恢复备份")
			}
			continue
		} else if !errors.Is(err, sql.ErrNoRows) {
			return 0, errtext.Wrap("读取本地订阅失败", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO subscriptions (id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at) VALUES (?,?,?,?,?,?,?,?)",
			item.ID, item.Type, item.Title, item.TargetURL, item.IntervalMinutes, item.LastPolledAt, favoriteValue(item.IsActive), item.CreatedAt); err != nil {
			return 0, errtext.Wrap("恢复订阅失败", err)
		}
		inserted++
	}
	return inserted, nil
}

// restoreReviewHistory 恢复逐次复习事件，并把覆盖起点推进到两者较晚的一端。
func restoreReviewHistory(ctx context.Context, tx *sql.Tx, backup archive.SystemBackup) (int, error) {
	if len(backup.ReviewHistory) == 0 {
		return 0, nil
	}
	var snapshot reviewhistory.Snapshot
	if err := json.Unmarshal(backup.ReviewHistory, &snapshot); err != nil || snapshot.Version != 1 {
		return 0, errors.New("review_history.json 结构无效")
	}
	if err := reviewhistory.Validate(snapshot); err != nil {
		return 0, errtext.Wrap("复习历史快照无效", err)
	}
	inserted := 0
	for _, event := range snapshot.Events {
		projects, err := json.Marshal(event.ProjectIDs)
		if err != nil {
			return 0, err
		}
		result, err := tx.ExecContext(ctx, "INSERT INTO review_events (event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete) VALUES (?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING",
			event.ID, event.CardID, event.ReviewedAt, string(event.Rating), string(event.Algorithm), string(projects), favoriteValue(event.ProjectAttributionComplete))
		if err != nil {
			return 0, errtext.Wrap("恢复复习历史失败", err)
		}
		if rows, err := result.RowsAffected(); err == nil && rows > 0 {
			inserted++
		}
	}
	var current int64
	err := tx.QueryRowContext(ctx, "SELECT value FROM meta WHERE key = 'review_history_started_at'").Scan(&current)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, errtext.Wrap("读取复习覆盖起点失败", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO meta (key,value) VALUES ('review_history_started_at',?)", fmt.Sprintf("%d", snapshot.CoverageStartedAt)); err != nil {
			return 0, errtext.Wrap("写入复习覆盖起点失败", err)
		}
	} else if snapshot.CoverageStartedAt > current {
		if _, err := tx.ExecContext(ctx, "UPDATE meta SET value = ? WHERE key = 'review_history_started_at'", fmt.Sprintf("%d", snapshot.CoverageStartedAt)); err != nil {
			return 0, errtext.Wrap("更新复习覆盖起点失败", err)
		}
	}
	return inserted, nil
}

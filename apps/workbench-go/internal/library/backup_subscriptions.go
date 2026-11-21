package library

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"regexp"
)

type backupSubscription struct {
	ID              string `json:"id"`
	Type            string `json:"type"`
	Title           string `json:"title"`
	TargetURL       string `json:"targetUrl"`
	IntervalMinutes int64  `json:"intervalMinutes"`
	LastPolledAt    *int64 `json:"lastPolledAt"`
	IsActive        bool   `json:"isActive"`
	CreatedAt       int64  `json:"createdAt"`
}

type backupSubscriptions struct {
	Version       int                  `json:"version"`
	Items         []backupSubscription `json:"items"`
	ExcludedCount int                  `json:"excludedCount"`
}

const maxSafeInteger = 9007199254740991

var githubReleaseTarget = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
var githubTrendingTarget = regexp.MustCompile(`^[A-Za-z0-9+#.-]*$`)

// safeSubscriptionTarget 拒绝带凭据或查询参数的地址：备份包会被分享，
// 订阅地址里的 token 不该跟着走。被排除的记录计入 excludedCount，导出回执据此如实说明。
func safeSubscriptionTarget(kind, target string) bool {
	if len(target) > 8192 {
		return false
	}
	for _, r := range target {
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) {
			return false
		}
	}
	switch kind {
	case "rss", "tech_board":
		parsed, err := url.Parse(target)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return false
		}
		return parsed.User == nil && parsed.RawQuery == "" && parsed.Fragment == ""
	case "github_release":
		return githubReleaseTarget.MatchString(target)
	case "github_trending":
		return githubTrendingTarget.MatchString(target)
	}
	return false
}

func validateSubscription(item backupSubscription) error {
	if item.ID == "" || item.IntervalMinutes <= 0 || item.IntervalMinutes > maxSafeInteger {
		return fmt.Errorf("订阅备份包含无效记录")
	}
	if item.CreatedAt < -maxSafeInteger || item.CreatedAt > maxSafeInteger {
		return fmt.Errorf("订阅备份包含无效记录")
	}
	if item.LastPolledAt != nil && (*item.LastPolledAt < -maxSafeInteger || *item.LastPolledAt > maxSafeInteger) {
		return fmt.Errorf("订阅备份包含无效记录")
	}
	return nil
}

func captureSubscriptions(ctx context.Context, tx *sql.Tx) (backupSubscriptions, error) {
	snapshot := backupSubscriptions{Version: 1, Items: make([]backupSubscription, 0)}
	rows, err := tx.QueryContext(ctx, "SELECT id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at FROM subscriptions ORDER BY created_at,id")
	if err != nil {
		return snapshot, fmt.Errorf("读取订阅失败：%w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item backupSubscription
		var active int64
		if err := rows.Scan(&item.ID, &item.Type, &item.Title, &item.TargetURL, &item.IntervalMinutes, &item.LastPolledAt, &active, &item.CreatedAt); err != nil {
			return snapshot, fmt.Errorf("读取订阅失败：%w", err)
		}
		if active != 0 && active != 1 {
			return snapshot, fmt.Errorf("订阅启用标记无效")
		}
		item.IsActive = active != 0
		if !safeSubscriptionTarget(item.Type, item.TargetURL) {
			snapshot.ExcludedCount++
			continue
		}
		if err := validateSubscription(item); err != nil {
			return snapshot, err
		}
		snapshot.Items = append(snapshot.Items, item)
	}
	return snapshot, rows.Err()
}

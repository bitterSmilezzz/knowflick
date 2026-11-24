package library

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// Subscription 是一条订阅源记录；字段与 Rust SubscriptionDto 一一对应。
type Subscription struct {
	ID              string `json:"id"`
	Type            string `json:"type"`
	Title           string `json:"title"`
	TargetURL       string `json:"targetUrl"`
	IntervalMinutes int64  `json:"intervalMinutes"`
	LastPolledAt    *int64 `json:"lastPolledAt"`
	IsActive        bool   `json:"isActive"`
	CreatedAt       int64  `json:"createdAt"`
}

// SubscriptionSchema 与 Rust db.rs 的建表语句逐列一致：Go 不做数据迁移，
// 只在缺表时补建（旧库由 Rust 迁移创建，新库缺表时这里兜底）。
const SubscriptionSchema = "CREATE TABLE IF NOT EXISTS subscriptions (" +
	"id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, target_url TEXT NOT NULL, " +
	"interval_minutes INTEGER NOT NULL DEFAULT 360, last_polled_at INTEGER, " +
	"is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)"

// ValidateSubscription 拒绝不安全或不完整的订阅：地址不能带凭据或查询参数，
// 类型必须是四种之一，间隔 5–1440 分钟（0 表示停用自动抓取）。
func ValidateSubscription(item Subscription) error {
	if item.ID == "" || strings.TrimSpace(item.Title) == "" || len(item.Title) > 200 {
		return errors.New("订阅需要标题（不超过 200 字）与标识")
	}
	if !safeSubscriptionTarget(item.Type, item.TargetURL) {
		return errors.New("订阅地址无效：只接受不带账号、查询参数的 http(s) 地址，GitHub 类型填 owner/repo 或语言名")
	}
	if item.IntervalMinutes < 5 || item.IntervalMinutes > 1440 {
		return errors.New("自动抓取间隔须为 5 至 1440 分钟")
	}
	if item.CreatedAt <= 0 {
		return errors.New("订阅缺少创建时间")
	}
	return nil
}

// ListSubscriptions 按创建时间列出订阅。
func ListSubscriptions(ctx context.Context, db *sql.DB) ([]Subscription, error) {
	rows, err := db.QueryContext(ctx, "SELECT id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at FROM subscriptions ORDER BY created_at,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Subscription, 0)
	for rows.Next() {
		var item Subscription
		var polled sql.NullInt64
		var active int
		if err := rows.Scan(&item.ID, &item.Type, &item.Title, &item.TargetURL, &item.IntervalMinutes, &polled, &active, &item.CreatedAt); err != nil {
			return nil, err
		}
		if polled.Valid {
			value := polled.Int64
			item.LastPolledAt = &value
		}
		item.IsActive = active != 0
		items = append(items, item)
	}
	return items, rows.Err()
}

// SaveSubscription 新增或更新订阅。更新只覆盖类型、标题、地址、间隔与启用状态，
// 不动 created_at 与 last_polled_at——抓取进度不该被一次编辑清掉。
func SaveSubscription(ctx context.Context, db *sql.DB, item Subscription) error {
	if err := ValidateSubscription(item); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, "INSERT INTO subscriptions (id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at) VALUES (?,?,?,?,?,?,?,?) "+
		"ON CONFLICT(id) DO UPDATE SET type=excluded.type,title=excluded.title,target_url=excluded.target_url,interval_minutes=excluded.interval_minutes,is_active=excluded.is_active",
		item.ID, item.Type, item.Title, item.TargetURL, item.IntervalMinutes, item.LastPolledAt, boolInt(item.IsActive), item.CreatedAt)
	return err
}

// DeleteSubscription 硬删除订阅；素材与卡片保留，来源标注随订阅消失。
func DeleteSubscription(ctx context.Context, db *sql.DB, id string) error {
	result, err := db.ExecContext(ctx, "DELETE FROM subscriptions WHERE id = ?", id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errors.New("订阅不存在")
	}
	return nil
}

// MarkSubscriptionPolled 只更新轮询时间：抓完一条订阅不该顺手覆盖它的类型或标题。
func MarkSubscriptionPolled(ctx context.Context, db *sql.DB, id string, polledAt int64) error {
	result, err := db.ExecContext(ctx, "UPDATE subscriptions SET last_polled_at = ? WHERE id = ?", polledAt, id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errors.New("订阅不存在")
	}
	return nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

package reviewhistory

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
)

// CardState 是评分后需要保存的学习字段。
type CardState struct {
	ID             string  `json:"id"`
	ReviewCount    int64   `json:"reviewCount"`
	MasteryLevel   int64   `json:"masteryLevel"`
	LastReviewedAt *int64  `json:"lastReviewedAt"`
	Repetition     int64   `json:"repetition"`
	IntervalDays   float64 `json:"intervalDays"`
	EaseFactor     float64 `json:"easeFactor"`
	Stability      float64 `json:"stability"`
	Difficulty     float64 `json:"difficulty"`
}

// Record 保存一次评分。相同事件重试时返回 false，且不会再次推进卡片状态。
func Record(ctx context.Context, db *sql.DB, state CardState, event Event) (bool, error) {
	if err := ValidateEvent(event); err != nil {
		return false, err
	}
	if state.ID != event.CardID || state.ReviewCount < 1 || state.LastReviewedAt == nil || *state.LastReviewedAt != event.ReviewedAt {
		return false, errors.New("复习事件与卡片学习状态不一致")
	}
	for _, value := range []float64{state.IntervalDays, state.EaseFactor, state.Stability, state.Difficulty} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false, errors.New("卡片学习状态数值无效")
		}
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if err := validateSchema(tx); err != nil {
		return false, err
	}
	local, found, err := existingEvent(tx, event.ID)
	if err != nil {
		return false, err
	}
	if found {
		if equalEvent(local, event) {
			return false, nil
		}
		return false, errors.New("复习事件标识已被不同内容占用")
	}

	// 评分只改学习字段，保留期间发生的正文编辑、收藏和索引。
	result, err := tx.ExecContext(ctx, `UPDATE cards SET
		review_count = ?, mastery_level = ?, last_reviewed_at = ?, repetition = ?,
		interval_days = ?, ease_factor = ?, stability = ?, difficulty = ?, version = version + 1
		WHERE id = ? AND is_deleted = 0 AND review_count = ?`,
		state.ReviewCount, state.MasteryLevel, event.ReviewedAt, state.Repetition,
		state.IntervalDays, state.EaseFactor, state.Stability, state.Difficulty, state.ID, state.ReviewCount-1)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if changed == 0 {
		var active bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM cards WHERE id = ? AND is_deleted = 0)", state.ID).Scan(&active); err != nil {
			return false, err
		}
		if active {
			return false, errors.New("卡片学习状态已变化，请重新载入后再评分")
		}
		return false, errors.New("复习卡片已删除或不存在")
	}
	if err := appendEvent(tx, event); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func appendEvent(tx *sql.Tx, event Event) error {
	projects := event.ProjectIDs
	if projects == nil {
		projects = []string{}
	}
	encoded, err := json.Marshal(projects)
	if err != nil {
		return errors.New("复习项目序列化失败")
	}
	_, err = tx.Exec(`INSERT INTO review_events
		(event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete)
		VALUES (?,?,?,?,?,?,?)`,
		event.ID, event.CardID, event.ReviewedAt, event.Rating, event.Algorithm, string(encoded), event.ProjectAttributionComplete)
	return err
}

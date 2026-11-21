package goals

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Goal 是一个目标（R4/D04）：完成条件显式，缺证据不判失败。
type Goal struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	DoneCriteria  string  `json:"doneCriteria"`
	Scope         *string `json:"scope"`
	CreatedAt     int64   `json:"createdAt"`
	AchievedAt    *int64  `json:"achievedAt"`
	AbandonedAt   *int64  `json:"abandonedAt"`
	ReviewNote    string  `json:"reviewNote"`
	EvidenceCount int64   `json:"evidenceCount"`
}

// CreateInput 是新建目标的输入。
type CreateInput struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	DoneCriteria string  `json:"doneCriteria"`
	Scope        *string `json:"scope"`
}

// EvidenceItem 是一条证据关联；原件缺失或已删时 Title 为 nil。
type EvidenceItem struct {
	GoalID     string  `json:"goalId"`
	EvidenceID string  `json:"evidenceId"`
	Kind       string  `json:"kind"`
	LinkedAt   int64   `json:"linkedAt"`
	Title      *string `json:"title"`
}

// Snapshot 是一个复盘周期内的目标与关联，绑定在同一读事务里。
type Snapshot struct {
	Goals    []Goal         `json:"goals"`
	Evidence []EvidenceItem `json:"evidence"`
}

const goalColumns = "g.id,g.title,g.done_criteria,g.scope,g.created_at,g.achieved_at,g.abandoned_at,g.review_note"

// Create 新建目标：标题与完成条件必填；范围只能指向未封存的项目。
func Create(ctx context.Context, db *sql.DB, goal CreateInput, now int64) error {
	title := strings.TrimSpace(goal.Title)
	criteria := strings.TrimSpace(goal.DoneCriteria)
	if title == "" {
		return errors.New("目标标题不能为空")
	}
	if criteria == "" {
		return errors.New("完成条件不能为空——判定只认这个，不靠记录多少（这是「缺少记录不得判为失败」的前提：条件必须显式）")
	}
	result, err := db.ExecContext(ctx, "INSERT INTO goals (id,title,done_criteria,scope,created_at,review_note)"+
		" SELECT ?1,?2,?3,?4,?5,'' WHERE ?4 IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ?4 AND archived_at IS NULL)",
		goal.ID, title, criteria, goal.Scope, now)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return errors.New("项目不存在或已封存，请重新选择")
	}
	return nil
}

// ListActive 列出活跃目标；证据数是派生列，没有证据也算 0，不判失败。
func ListActive(ctx context.Context, db *sql.DB) ([]Goal, error) {
	rows, err := db.QueryContext(ctx, "SELECT "+goalColumns+
		", (SELECT COUNT(*) FROM goal_evidence e WHERE e.goal_id = g.id) FROM goals g"+
		" WHERE g.achieved_at IS NULL AND g.abandoned_at IS NULL ORDER BY g.created_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Goal, 0)
	for rows.Next() {
		goal, err := scanGoal(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, goal)
	}
	return items, rows.Err()
}

// SetScope 调整活跃目标的归属；单语句同时检查项目状态，避免封存与写入竞争。
func SetScope(ctx context.Context, db *sql.DB, id string, scope *string) error {
	result, err := db.ExecContext(ctx, "UPDATE goals SET scope = ?2 WHERE id = ?1"+
		" AND achieved_at IS NULL AND abandoned_at IS NULL"+
		" AND (?2 IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ?2 AND archived_at IS NULL))", id, scope)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return errors.New("目标不可用，或项目不存在、已封存；请刷新后重试")
	}
	return nil
}

// LinkEvidence 幂等关联证据：只认 note 与 material，且原件必须存在。
func LinkEvidence(ctx context.Context, db *sql.DB, goalID, evidenceID, kind string, now int64) error {
	var exists int
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM goals WHERE id = ?)", goalID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return errors.New("目标不存在")
	}
	if kind != "note" && kind != "material" {
		return fmt.Errorf("证据类型只认 note 或 material，收到 %s", kind)
	}
	table := "notes"
	if kind == "material" {
		table = "materials"
	}
	var target int
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM "+table+" WHERE id = ?)", evidenceID).Scan(&target); err != nil {
		return err
	}
	if target == 0 {
		return fmt.Errorf("%s 里没有 id 为 %s 的记录", kind, evidenceID)
	}
	_, err := db.ExecContext(ctx, "INSERT INTO goal_evidence (goal_id,evidence_id,kind,linked_at) VALUES (?,?,?,?)"+
		" ON CONFLICT(goal_id,evidence_id) DO NOTHING", goalID, evidenceID, kind, now)
	return err
}

// EvidenceInPeriod 列出闭区间内关联的证据；保留已删除原件的关联事实（Title 为 nil）。
func EvidenceInPeriod(ctx context.Context, db queryer, from, to int64) ([]EvidenceItem, error) {
	if from > to {
		return nil, errors.New("复盘周期起点不能晚于终点")
	}
	rows, err := db.QueryContext(ctx, "SELECT e.goal_id,e.evidence_id,e.kind,e.linked_at,"+
		" CASE e.kind WHEN 'note' THEN n.title WHEN 'material' THEN m.title ELSE NULL END"+
		" FROM goal_evidence e JOIN goals g ON g.id = e.goal_id"+
		" LEFT JOIN notes n ON e.kind = 'note' AND n.id = e.evidence_id AND n.is_deleted = 0"+
		" LEFT JOIN materials m ON e.kind = 'material' AND m.id = e.evidence_id AND m.is_deleted = 0"+
		" WHERE e.linked_at >= ?1 AND e.linked_at <= ?2 AND g.created_at <= ?2"+
		" AND (g.achieved_at IS NULL OR g.achieved_at >= ?1)"+
		" AND (g.abandoned_at IS NULL OR g.abandoned_at >= ?1)"+
		" ORDER BY e.linked_at DESC, e.goal_id, e.evidence_id", from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]EvidenceItem, 0)
	for rows.Next() {
		var item EvidenceItem
		var title sql.NullString
		if err := rows.Scan(&item.GoalID, &item.EvidenceID, &item.Kind, &item.LinkedAt, &title); err != nil {
			return nil, err
		}
		if title.Valid {
			value := title.String
			item.Title = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ReviewSnapshot 在同一读事务里取周期内的目标与关联，避免状态与明细来自不同时间点。
func ReviewSnapshot(ctx context.Context, db *sql.DB, from, to int64) (Snapshot, error) {
	var snapshot Snapshot
	if from > to {
		return snapshot, errors.New("复盘周期起点不能晚于终点")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return snapshot, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT "+goalColumns+
		", (SELECT COUNT(*) FROM goal_evidence e WHERE e.goal_id = g.id AND e.linked_at <= ?2) FROM goals g"+
		" WHERE g.created_at <= ?2 AND (g.achieved_at IS NULL OR g.achieved_at >= ?1)"+
		" AND (g.abandoned_at IS NULL OR g.abandoned_at >= ?1)"+
		" ORDER BY g.created_at ASC, g.id", from, to)
	if err != nil {
		return snapshot, err
	}
	for rows.Next() {
		goal, err := scanGoal(rows)
		if err != nil {
			rows.Close()
			return snapshot, err
		}
		snapshot.Goals = append(snapshot.Goals, goal)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return snapshot, err
	}
	rows.Close()
	evidence, err := EvidenceInPeriod(ctx, tx, from, to)
	if err != nil {
		return snapshot, err
	}
	snapshot.Evidence = evidence
	return snapshot, tx.Commit()
}

// Achieve 是用户显式确认达成：判定只来自这一步，证据多少不参与。
func Achieve(ctx context.Context, db *sql.DB, id, reviewNote string, now int64) (bool, error) {
	return stamp(ctx, db, "achieved_at", id, reviewNote, now)
}

// Abandon 是用户决定放弃（与失败区分：不是系统判定）。
func Abandon(ctx context.Context, db *sql.DB, id, reviewNote string, now int64) (bool, error) {
	return stamp(ctx, db, "abandoned_at", id, reviewNote, now)
}

func stamp(ctx context.Context, db *sql.DB, column, id, reviewNote string, now int64) (bool, error) {
	result, err := db.ExecContext(ctx, "UPDATE goals SET "+column+" = ?2, review_note = ?3"+
		" WHERE id = ?1 AND achieved_at IS NULL AND abandoned_at IS NULL", id, now, reviewNote)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return changed > 0, nil
}

type rowScanner interface{ Scan(dest ...any) error }

// queryer 同时满足 *sql.DB 与 *sql.Tx：复盘快照要在事务里读明细。
type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// scanGoal 读一列目标：scope 是项目 id 文本，两个时间列是可空整型。
func scanGoal(row rowScanner) (Goal, error) {
	var goal Goal
	var scope sql.NullString
	var achieved, abandoned sql.NullInt64
	if err := row.Scan(&goal.ID, &goal.Title, &goal.DoneCriteria, &scope, &goal.CreatedAt,
		&achieved, &abandoned, &goal.ReviewNote, &goal.EvidenceCount); err != nil {
		return Goal{}, err
	}
	if scope.Valid {
		value := scope.String
		goal.Scope = &value
	}
	if achieved.Valid {
		value := achieved.Int64
		goal.AchievedAt = &value
	}
	if abandoned.Valid {
		value := abandoned.Int64
		goal.AbandonedAt = &value
	}
	return goal, nil
}

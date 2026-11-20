// Package reviewhistory 迁自 Rust 的 review_history.rs：逐次评分的不可变账本。
//
// 与原实现一致的口径：
// - 事件标识必须是**标准小写连字符格式的 UUID v4**；项目标识只要求标准格式（不限版本）。
// - 项目标识必须唯一且严格升序——顺序不是装饰，是「同一份快照两侧可逐字节比对」的前提。
// - 快照 version 必须是 1，覆盖起点不得为负。
// - 恢复时：内容完全相同的本地事件算「跳过」，同标识不同内容直接报错，不覆盖。
// - 合并后的覆盖起点取两侧最大值——宁可承认覆盖更晚，也不谎称覆盖更早。
package reviewhistory

import (
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strconv"
	"unicode"
)

// Rating 是一次评分的档位。
type Rating string

const (
	RatingAgain Rating = "again"
	RatingHard  Rating = "hard"
	RatingGood  Rating = "good"
	RatingEasy  Rating = "easy"
)

// Algorithm 是调度算法。
type Algorithm string

const (
	AlgorithmSm2  Algorithm = "sm2"
	AlgorithmFsrs Algorithm = "fsrs"
)

// Event 是一条复习事件。
type Event struct {
	ID                         string    `json:"id"`
	CardID                     string    `json:"cardId"`
	ReviewedAt                 int64     `json:"reviewedAt"`
	Rating                     Rating    `json:"rating"`
	Algorithm                  Algorithm `json:"algorithm"`
	ProjectIDs                 []string  `json:"projectIds"`
	ProjectAttributionComplete bool      `json:"projectAttributionComplete"`
}

// Snapshot 是一份复习历史快照。
type Snapshot struct {
	Version           int     `json:"version"`
	CoverageStartedAt int64   `json:"coverageStartedAt"`
	Events            []Event `json:"events"`
}

// RestoreCounts 是恢复结果。
type RestoreCounts struct {
	Inserted int `json:"inserted"`
	Skipped  int `json:"skipped"`
}

var canonicalUUID = regexp.MustCompile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

// validEventID 要求标准小写 UUID 且版本号为 4。
func validEventID(id string) bool {
	if !canonicalUUID.MatchString(id) {
		return false
	}
	// 版本号在第三段的第一个十六进制位。
	return id[14] == '4'
}

func hasControl(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// ValidateEvent 校验单条事件。
func ValidateEvent(event Event) error {
	if !validEventID(event.ID) {
		return errors.New("复习事件标识必须是标准 UUID v4")
	}
	if event.CardID == "" || len(event.CardID) > 256 || hasControl(event.CardID) {
		return errors.New("复习事件卡片标识无效")
	}
	if event.ReviewedAt < 0 {
		return errors.New("复习事件时间无效")
	}
	seen := map[string]struct{}{}
	for _, id := range event.ProjectIDs {
		if !canonicalUUID.MatchString(id) {
			return errors.New("复习事件项目标识无效")
		}
		if _, duplicate := seen[id]; duplicate {
			return errors.New("复习事件项目标识重复或格式无效")
		}
		seen[id] = struct{}{}
	}
	// 严格升序：两个元素及以上时逐对比较，任何一对不升序都算无效。
	for i := 1; i < len(event.ProjectIDs); i++ {
		if event.ProjectIDs[i-1] >= event.ProjectIDs[i] {
			return errors.New("复习事件项目标识顺序无效")
		}
	}
	return nil
}

// Validate 校验整份快照。
func Validate(snapshot Snapshot) error {
	if snapshot.Version != 1 || snapshot.CoverageStartedAt < 0 {
		return errors.New("复习历史快照版本或覆盖起点无效")
	}
	ids := make(map[string]struct{}, len(snapshot.Events))
	for _, event := range snapshot.Events {
		if err := ValidateEvent(event); err != nil {
			return err
		}
		if _, duplicate := ids[event.ID]; duplicate {
			return errors.New("复习历史包含重复事件标识")
		}
		ids[event.ID] = struct{}{}
	}
	return nil
}

// SortProjectIDs 把项目标识排序（调用方可用它把输入规范化成契约要求的严格升序）。
func SortProjectIDs(ids []string) []string {
	copyIDs := append([]string(nil), ids...)
	sort.Strings(copyIDs)
	return copyIDs
}

// ErrSchemaMismatch 表示库里的复习事件表结构与备份契约不一致。
var ErrSchemaMismatch = errors.New("复习事件表结构与备份契约不一致")

type column struct {
	name       string
	typeName   string
	notNull    bool
	primaryKey int64
}

// expectedColumns 与 Rust 的 expected 表逐项一致。
var expectedColumns = []column{
	{"event_id", "TEXT", false, 1},
	{"card_id", "TEXT", true, 0},
	{"reviewed_at", "INTEGER", true, 0},
	{"rating", "TEXT", true, 0},
	{"algorithm", "TEXT", true, 0},
	{"project_ids_json", "TEXT", true, 0},
	{"project_attribution_complete", "INTEGER", true, 0},
}

func validateSchema(queryer interface {
	Query(string, ...any) (*sql.Rows, error)
}) error {
	rows, err := queryer.Query("PRAGMA table_info(review_events)")
	if err != nil {
		return err
	}
	defer rows.Close()
	columns := make([]column, 0, len(expectedColumns))
	for rows.Next() {
		var cid int64
		var name, typeName string
		var notNull int64
		var defaultValue sql.NullString
		var primaryKey int64
		if err := rows.Scan(&cid, &name, &typeName, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		// 默认值不参与比对：契约只钉名字、类型、非空与主键位置。
		columns = append(columns, column{name: name, typeName: typeName, notNull: notNull != 0, primaryKey: primaryKey})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(columns) != len(expectedColumns) {
		return ErrSchemaMismatch
	}
	for i, want := range expectedColumns {
		got := columns[i]
		if got.name != want.name || got.typeName != want.typeName || got.notNull != want.notNull || got.primaryKey != want.primaryKey {
			return ErrSchemaMismatch
		}
	}
	return nil
}

func coverageStartedAt(queryer interface {
	QueryRow(string, ...any) *sql.Row
}) (int64, error) {
	var raw sql.NullString
	err := queryer.QueryRow("SELECT value FROM meta WHERE key='review_history_started_at'").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !raw.Valid) {
		return 0, errors.New("复习历史覆盖起点缺失")
	}
	if err != nil {
		return 0, err
	}
	value, convErr := strconv.ParseInt(raw.String, 10, 64)
	if convErr != nil {
		return 0, errors.New("复习历史覆盖起点无效")
	}
	if value < 0 {
		return 0, errors.New("复习历史覆盖起点无效")
	}
	return value, nil
}

func scanEvent(rows *sql.Rows) (Event, error) {
	var event Event
	var rating, algorithm, projects string
	var complete int64
	if err := rows.Scan(&event.ID, &event.CardID, &event.ReviewedAt, &rating, &algorithm, &projects, &complete); err != nil {
		return Event{}, err
	}
	event.Rating = Rating(rating)
	event.Algorithm = Algorithm(algorithm)
	if err := json.Unmarshal([]byte(projects), &event.ProjectIDs); err != nil {
		return Event{}, errors.New("复习事件的工程标识不是合法 JSON")
	}
	if event.ProjectIDs == nil {
		event.ProjectIDs = []string{}
	}
	switch complete {
	case 0:
		event.ProjectAttributionComplete = false
	case 1:
		event.ProjectAttributionComplete = true
	default:
		return Event{}, errors.New("复习事件的归属完整性字段取值无效")
	}
	return event, nil
}

func readEvents(queryer interface {
	Query(string, ...any) (*sql.Rows, error)
}, from, to *int64) ([]Event, error) {
	rows, err := queryer.Query(`SELECT event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete
		FROM review_events WHERE (?1 IS NULL OR reviewed_at>=?1) AND (?2 IS NULL OR reviewed_at<=?2)
		ORDER BY reviewed_at,event_id`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]Event, 0)
	for rows.Next() {
		event, scanErr := scanEvent(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		if err := ValidateEvent(event); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

// Capture 读全部复习事件（按 reviewed_at、event_id 升序）。
func Capture(db *sql.DB) (Snapshot, error) {
	if err := validateSchema(db); err != nil {
		return Snapshot{}, err
	}
	coverage, err := coverageStartedAt(db)
	if err != nil {
		return Snapshot{}, err
	}
	events, err := readEvents(db, nil, nil)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot := Snapshot{Version: 1, CoverageStartedAt: coverage, Events: events}
	if err := Validate(snapshot); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

// Period 读一段周期内的复习事件（含两端）。
func Period(db *sql.DB, from, to int64) (Snapshot, error) {
	if from < 0 || to < from {
		return Snapshot{}, errors.New("复习历史查询周期无效")
	}
	if err := validateSchema(db); err != nil {
		return Snapshot{}, err
	}
	coverage, err := coverageStartedAt(db)
	if err != nil {
		return Snapshot{}, err
	}
	events, err := readEvents(db, &from, &to)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot := Snapshot{Version: 1, CoverageStartedAt: coverage, Events: events}
	if err := Validate(snapshot); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

type queryer interface {
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
}

const eventColumns = "SELECT event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete FROM review_events"

func existingEvent(q queryer, id string) (Event, bool, error) {
	rows, err := q.Query(eventColumns+" WHERE event_id=?1", id)
	if err != nil {
		return Event{}, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		return Event{}, false, rows.Err()
	}
	event, err := scanEvent(rows)
	if err != nil {
		return Event{}, false, err
	}
	return event, true, nil
}

// equalEvent 按全部字段比较（含项目标识顺序），顺序不同即视为不同内容。
func equalEvent(a, b Event) bool {
	if a.ID != b.ID || a.CardID != b.CardID || a.ReviewedAt != b.ReviewedAt ||
		a.Rating != b.Rating || a.Algorithm != b.Algorithm ||
		a.ProjectAttributionComplete != b.ProjectAttributionComplete ||
		len(a.ProjectIDs) != len(b.ProjectIDs) {
		return false
	}
	for i := range a.ProjectIDs {
		if a.ProjectIDs[i] != b.ProjectIDs[i] {
			return false
		}
	}
	return true
}

// ValidateDestination 检查目标库；返回会被跳过（内容完全相同）的事件数。
// 同标识不同内容直接报错：恢复不该静默覆盖本地记录。
func ValidateDestination(db *sql.DB, snapshot Snapshot) (int, error) {
	if err := Validate(snapshot); err != nil {
		return 0, err
	}
	if err := validateSchema(db); err != nil {
		return 0, err
	}
	skipped := 0
	for _, event := range snapshot.Events {
		local, found, err := existingEvent(db, event.ID)
		if err != nil {
			return 0, err
		}
		if !found {
			continue
		}
		if equalEvent(local, event) {
			skipped++
			continue
		}
		return 0, errors.New("本地存在同标识但内容不同的复习事件，未恢复复习历史")
	}
	return skipped, nil
}

// Restore 合并快照：跳过内容相同的事件，插入缺失的事件，覆盖起点取两侧最大值。
func Restore(db *sql.DB, snapshot Snapshot) (RestoreCounts, error) {
	tx, err := db.Begin()
	if err != nil {
		return RestoreCounts{}, err
	}
	defer func() { _ = tx.Rollback() }()
	skipped, err := ValidateDestinationDB(tx, snapshot)
	if err != nil {
		return RestoreCounts{}, err
	}
	inserted := 0
	for _, event := range snapshot.Events {
		_, found, lookupErr := existingEvent(tx, event.ID)
		if lookupErr != nil {
			return RestoreCounts{}, lookupErr
		}
		if found {
			continue
		}
		projects, marshalErr := json.Marshal(event.ProjectIDs)
		if marshalErr != nil {
			return RestoreCounts{}, errors.New("复习项目序列化失败")
		}
		complete := 0
		if event.ProjectAttributionComplete {
			complete = 1
		}
		if _, execErr := tx.Exec("INSERT INTO review_events(event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete) VALUES(?1,?2,?3,?4,?5,?6,?7)",
			event.ID, event.CardID, event.ReviewedAt, string(event.Rating), string(event.Algorithm), string(projects), complete); execErr != nil {
			return RestoreCounts{}, execErr
		}
		inserted++
	}
	localStart, err := coverageStartedAt(tx)
	if err != nil {
		return RestoreCounts{}, err
	}
	merged := localStart
	if snapshot.CoverageStartedAt > merged {
		merged = snapshot.CoverageStartedAt
	}
	if _, err := tx.Exec("UPDATE meta SET value=?1 WHERE key='review_history_started_at'", strconv.FormatInt(merged, 10)); err != nil {
		return RestoreCounts{}, err
	}
	if err := tx.Commit(); err != nil {
		return RestoreCounts{}, err
	}
	return RestoreCounts{Inserted: inserted, Skipped: skipped}, nil
}

// ValidateDestinationDB 是 ValidateDestination 的事务版本（恢复要在同一事务里做检查）。
func ValidateDestinationDB(tx queryer, snapshot Snapshot) (int, error) {
	if err := Validate(snapshot); err != nil {
		return 0, err
	}
	if err := validateSchema(tx); err != nil {
		return 0, err
	}
	skipped := 0
	for _, event := range snapshot.Events {
		local, found, err := existingEvent(tx, event.ID)
		if err != nil {
			return 0, err
		}
		if !found {
			continue
		}
		if equalEvent(local, event) {
			skipped++
			continue
		}
		return 0, errors.New("本地存在同标识但内容不同的复习事件，未恢复复习历史")
	}
	return skipped, nil
}

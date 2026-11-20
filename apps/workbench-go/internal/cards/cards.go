// Package cards 迁自 Rust db.rs 的卡片读取：KnowledgeCardDto 与 list_cards。
//
// 与原实现一致的口径：
//   - 只读未删除的卡片，按 created_at **降序**；
//   - 旧卡片导出宽容解析 JSON 列。资料库备份遇到损坏字段时返回错误；
//   - is_favorite 在库里是整数，DTO 里是布尔（非 0 即 true）；
//   - 可空列一律映射成指针，JSON 里序列化为 null 而不是省略字段——
//     与 Android 共享的线格式要求字段齐全。
package cards

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"unicode/utf8"

	"knowflick.local/workbench-go/internal/jsonx"
	"knowflick.local/workbench-go/internal/libfiles"
)

// ScienceLink 是卡片上的一条学科链接。
type ScienceLink struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

// Card 是一张卡片，字段与 Rust 的 KnowledgeCardDto 一一对应（camelCase 线格式）。
type Card struct {
	ID             string        `json:"id"`
	MaterialID     *string       `json:"materialId"`
	Category       string        `json:"category"`
	Headline       string        `json:"headline"`
	Summary        string        `json:"summary"`
	Details        string        `json:"details"`
	Links          []ScienceLink `json:"links"`
	Tags           []string      `json:"tags"`
	Source         string        `json:"source"`
	SeenAt         *int64        `json:"seenAt"`
	Swiped         *string       `json:"swiped"`
	IsFavorite     bool          `json:"isFavorite"`
	FavoritedAt    *int64        `json:"favoritedAt"`
	ReviewCount    int64         `json:"reviewCount"`
	MasteryLevel   int64         `json:"masteryLevel"`
	LastReviewedAt *int64        `json:"lastReviewedAt"`
	Repetition     int64         `json:"repetition"`
	IntervalDays   float64       `json:"intervalDays"`
	EaseFactor     float64       `json:"easeFactor"`
	Stability      float64       `json:"stability"`
	Difficulty     float64       `json:"difficulty"`
	Subject        *string       `json:"subject"`
	Branch         *string       `json:"branch"`
	Level          *int64        `json:"level"`
	Track          *string       `json:"track"`
	OrderKey       *string       `json:"orderKey"`
	Prereq         []string      `json:"prereq"`
	CreatedAt      int64         `json:"createdAt"`
	EditedAt       *int64        `json:"editedAt"`
}

// columnList 与 Rust 的列顺序一致（map_card_row 按下标取值）。
const columnList = "id, material_id, category, headline, summary, details, " +
	"links_json, tags_json, source, seen_at, swiped, is_favorite, " +
	"favorited_at, review_count, mastery_level, last_reviewed_at, " +
	"repetition, interval_days, ease_factor, stability, difficulty, " +
	"subject, branch, level, track, order_key, prereq_json, created_at, edited_at"

// List 读卡片：只读未删除的，按 created_at 降序。
// limit < 0 表示不限制（与 Rust 的 LIMIT -1 分支一致）。
func List(ctx context.Context, db *sql.DB, limit, offset int64) ([]Card, error) {
	return list(ctx, db, limit, offset, false)
}

// ListForBackup 读取同一个备份事务中的活动卡片，损坏的 JSON 字段会中止备份。
func ListForBackup(ctx context.Context, tx *sql.Tx) ([]Card, error) {
	return list(ctx, tx, -1, 0, true)
}

type cardQuery interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func list(ctx context.Context, db cardQuery, limit, offset int64, strict bool) ([]Card, error) {
	rows, err := db.QueryContext(ctx, "SELECT "+columnList+" FROM cards WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?", limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := make([]Card, 0)
	for rows.Next() {
		card, scanErr := scanCard(rows, strict)
		if scanErr != nil {
			return nil, scanErr
		}
		cards = append(cards, card)
	}
	return cards, rows.Err()
}

// ReadJSON 优先导出数据库中的卡片，旧库缺表或没有可导出卡片时读取旧文件。
func ReadJSON(ctx context.Context, db *sql.DB, dir string) (string, error) {
	var hasCardsTable bool
	err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cards')").Scan(&hasCardsTable)
	if err != nil {
		return "", err
	}
	if hasCardsTable {
		cards, err := List(ctx, db, 100_000, 0)
		if err != nil {
			return "", err
		}
		if len(cards) > 0 {
			return ToJSON(cards)
		}
	}
	legacy, err := libfiles.ReadOptional(filepath.Join(dir, "cards.json"))
	if err != nil {
		return "", err
	}
	if legacy == nil {
		return "[]", nil
	}
	if !utf8.ValidString(*legacy) {
		return "", errors.New("旧卡片文件不是有效的 UTF-8 文本")
	}
	return *legacy, nil
}

// scanCard 按列下标取值——下标顺序就是 columnList 的顺序，
// 与 Rust 的 map_card_row 一一对应。下标错了不会报错，只会取到别人的值，
// 所以列顺序在测试里被钉住。
func scanCard(rows *sql.Rows, strict bool) (Card, error) {
	var card Card
	var isFavorite int64
	var linksJSON, tagsJSON, prereqJSON string
	if err := rows.Scan(
		&card.ID, &card.MaterialID, &card.Category, &card.Headline, &card.Summary, &card.Details,
		&linksJSON, &tagsJSON, &card.Source, &card.SeenAt, &card.Swiped, &isFavorite,
		&card.FavoritedAt, &card.ReviewCount, &card.MasteryLevel, &card.LastReviewedAt,
		&card.Repetition, &card.IntervalDays, &card.EaseFactor, &card.Stability, &card.Difficulty,
		&card.Subject, &card.Branch, &card.Level, &card.Track, &card.OrderKey, &prereqJSON, &card.CreatedAt, &card.EditedAt,
	); err != nil {
		return Card{}, err
	}
	card.IsFavorite = isFavorite != 0
	if strict {
		links, linksErr := decodeBackupLinks(linksJSON)
		tags, tagsErr := jsonx.DecodeArray[string](tagsJSON)
		prereq, prereqErr := jsonx.DecodeArray[string](prereqJSON)
		if linksErr != nil || tagsErr != nil || prereqErr != nil {
			return Card{}, errors.New("卡片链接、标签或先修数据损坏")
		}
		card.Links, card.Tags, card.Prereq = links, tags, prereq
		return card, nil
	}
	// 旧卡片 JSON 导出沿用宽容解析，损坏的列按空数组处理。
	card.Links = parseLinks(linksJSON)
	card.Tags = parseStrings(tagsJSON)
	card.Prereq = parseStrings(prereqJSON)
	return card, nil
}

func decodeBackupLinks(raw string) ([]ScienceLink, error) {
	objects, err := jsonx.DecodeArray[map[string]json.RawMessage](raw)
	if err != nil {
		return nil, err
	}
	links := make([]ScienceLink, len(objects))
	for i, fields := range objects {
		for name, target := range map[string]*string{"title": &links[i].Title, "url": &links[i].URL} {
			if raw, exists := fields[name]; exists {
				var value *string
				if json.Unmarshal(raw, &value) != nil || value == nil {
					return nil, errors.New("卡片链接的标题或地址无效")
				}
				*target = *value
			}
		}
	}
	return links, nil
}

func parseLinks(raw string) []ScienceLink {
	links := make([]ScienceLink, 0)
	if err := json.Unmarshal([]byte(raw), &links); err != nil {
		return []ScienceLink{}
	}
	if links == nil {
		return []ScienceLink{}
	}
	return links
}

func parseStrings(raw string) []string {
	values := make([]string, 0)
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return []string{}
	}
	if values == nil {
		return []string{}
	}
	return values
}

// ToJSON 导出成与 Android 共享的 cards.json 线格式（裸数组）。
func ToJSON(cards []Card) (string, error) {
	encoded, err := json.Marshal(cards)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// CardByID 按主键读一张未删除的卡片；找不到返回 sql.ErrNoRows。
func CardByID(ctx context.Context, db *sql.DB, id string) (Card, error) {
	row := db.QueryRowContext(ctx, "SELECT "+columnList+" FROM cards WHERE id = ? AND is_deleted = 0", id)
	return scanCardRow(row, false)
}

// scanCardRow 是单行版本的 scanCard：QueryRowContext 没有列下标迭代器，
// 但列顺序一致，所以按同样的下标顺序取值。
func scanCardRow(row *sql.Row, strict bool) (Card, error) {
	var card Card
	var isFavorite int64
	var linksJSON, tagsJSON, prereqJSON string
	if err := row.Scan(
		&card.ID, &card.MaterialID, &card.Category, &card.Headline, &card.Summary, &card.Details,
		&linksJSON, &tagsJSON, &card.Source, &card.SeenAt, &card.Swiped, &isFavorite,
		&card.FavoritedAt, &card.ReviewCount, &card.MasteryLevel, &card.LastReviewedAt,
		&card.Repetition, &card.IntervalDays, &card.EaseFactor, &card.Stability, &card.Difficulty,
		&card.Subject, &card.Branch, &card.Level, &card.Track, &card.OrderKey, &prereqJSON, &card.CreatedAt, &card.EditedAt,
	); err != nil {
		return Card{}, err
	}
	card.IsFavorite = isFavorite != 0
	// 单卡读取用于向量召回等展示路径，沿用宽容解析。
	card.Links = parseLinks(linksJSON)
	card.Tags = parseStrings(tagsJSON)
	card.Prereq = parseStrings(prereqJSON)
	return card, nil
}

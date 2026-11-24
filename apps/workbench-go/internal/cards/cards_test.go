package cards

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE cards (
  id TEXT PRIMARY KEY, material_id TEXT, category TEXT NOT NULL, headline TEXT NOT NULL,
  summary TEXT NOT NULL, details TEXT NOT NULL, links_json TEXT NOT NULL, tags_json TEXT NOT NULL,
  source TEXT NOT NULL, seen_at INTEGER, swiped TEXT, is_favorite INTEGER NOT NULL,
  favorited_at INTEGER, review_count INTEGER NOT NULL, mastery_level INTEGER NOT NULL,
  last_reviewed_at INTEGER, repetition INTEGER NOT NULL, interval_days REAL NOT NULL,
  ease_factor REAL NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL,
  subject TEXT, branch TEXT, level INTEGER, track TEXT, order_key TEXT,
  prereq_json TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER,
  is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER
);
`

func openCards(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "lib.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func insertCard(t *testing.T, db *sql.DB, id string, createdAt int64, headline string) {
	t.Helper()
	statement := "INSERT INTO cards (id, material_id, category, headline, summary, details, links_json, tags_json, source, seen_at, swiped, is_favorite, favorited_at, review_count, mastery_level, last_reviewed_at, repetition, interval_days, ease_factor, stability, difficulty, subject, branch, level, track, order_key, prereq_json, created_at, edited_at, is_deleted) " +
		"VALUES (?1, NULL, '', ?2, '', '', '', '', 'imported', NULL, NULL, 0, NULL, 0, 0, NULL, 0, 0, 2.5, 0, 0, NULL, NULL, NULL, NULL, NULL, '', ?3, NULL, 0)"
	if _, err := db.Exec(statement, id, headline, createdAt); err != nil {
		t.Fatal(err)
	}
}

func TestListOrdersByCreatedAtDescending(t *testing.T) {
	db := openCards(t)
	insertCard(t, db, "old", 100, "旧卡片")
	insertCard(t, db, "new", 300, "新卡片")
	insertCard(t, db, "mid", 200, "中间卡片")
	// 删除的不该出现。
	statement := "UPDATE cards SET is_deleted=1 WHERE id='mid'"
	if _, err := db.Exec(statement); err != nil {
		t.Fatal(err)
	}
	list, err := List(context.Background(), db, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != "new" || list[1].ID != "old" {
		t.Fatalf("order/filter: %+v", list)
	}
	// limit < 0 表示不限（Rust 的 LIMIT -1 分支）。
	all, err := List(context.Background(), db, -1, 0)
	if err != nil || len(all) != 2 {
		t.Fatalf("unlimited: %d %v", len(all), err)
	}
	page, err := List(context.Background(), db, 1, 1)
	if err != nil || len(page) != 1 || page[0].ID != "old" {
		t.Fatalf("offset: %+v %v", page, err)
	}
}

func TestListMapsNullsAndLenientJSON(t *testing.T) {
	db := openCards(t)
	insertCard(t, db, "a", 100, "带空值")
	// 三个 JSON 列故意写坏：宽容解析必须给出空数组而不是报错。
	statement := "UPDATE cards SET links_json='{bad', tags_json='[oops', prereq_json='not-json' WHERE id='a'"
	if _, err := db.Exec(statement); err != nil {
		t.Fatal(err)
	}
	list, err := List(context.Background(), db, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("cards: %+v", list)
	}
	card := list[0]
	if card.MaterialID != nil || card.SeenAt != nil || card.Subject != nil || card.EditedAt != nil {
		t.Fatalf("nulls should be nil pointers: %+v", card)
	}
	if card.Links == nil || card.Tags == nil || card.Prereq == nil {
		t.Fatalf("broken json must yield empty slices, not nil: %+v %+v %+v", card.Links, card.Tags, card.Prereq)
	}
	if len(card.Links) != 0 || len(card.Tags) != 0 || len(card.Prereq) != 0 {
		t.Fatalf("broken json should be empty: %+v", card)
	}
	if card.IsFavorite || card.EaseFactor != 2.5 {
		t.Fatalf("defaults: %+v", card)
	}
}

func TestToJSONEmitsCamelCaseAndNulls(t *testing.T) {
	db := openCards(t)
	insertCard(t, db, "a", 100, "标题")
	list, err := List(context.Background(), db, 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := ToJSON(list)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"id"`, `"materialId"`, `"isFavorite"`, `"createdAt"`, `"intervalDays"`, `"easeFactor"`, `"prereq"`} {
		if !strings.Contains(encoded, key) {
			t.Fatalf("missing key %s in %s", key, encoded)
		}
	}
	// 可空字段必须显式为 null，不能省略——Android 共享的线格式要求字段齐全。
	if !strings.Contains(encoded, `"materialId":null`) {
		t.Fatalf("null field omitted: %s", encoded)
	}
	var back []Card
	err = json.Unmarshal([]byte(encoded), &back)
	if err != nil || len(back) != 1 || back[0].ID != "a" {
		t.Fatalf("round trip: %+v %v", back, err)
	}
}

// TestExportCardsJSON 从真实库导出 Go 的卡片 JSON，供 Rust 读回对拍。
func TestExportCardsJSON(t *testing.T) {
	source := os.Getenv("KF_CARDS_DB")
	target := os.Getenv("KF_GO_CARDS_JSON")
	if source == "" || target == "" {
		t.Skip("set KF_CARDS_DB and KF_GO_CARDS_JSON")
	}
	db, err := sql.Open("sqlite", source)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	encoded, err := ReadJSON(context.Background(), db, filepath.Dir(source))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte(encoded), 0644); err != nil {
		t.Fatal(err)
	}
}

// TestReadRustCardsJSON 比较两侧：同一个库，Rust 的导出与 Go 的导出必须语义相同。
func TestReadRustCardsJSON(t *testing.T) {
	source := os.Getenv("KF_CARDS_DB")
	rustJSON := os.Getenv("KF_RUST_CARDS_JSON")
	if source == "" || rustJSON == "" {
		t.Skip("set KF_CARDS_DB and KF_RUST_CARDS_JSON")
	}
	db, err := sql.Open("sqlite", source)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	mine, err := List(context.Background(), db, -1, 0)
	if err != nil {
		t.Fatal(err)
	}
	var theirs []Card
	raw, err := os.ReadFile(rustJSON)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &theirs); err != nil {
		t.Fatalf("Rust 导出的 JSON 解不开: %v", err)
	}
	if len(mine) == 0 || !reflect.DeepEqual(mine, theirs) {
		t.Fatalf("Go 与 Rust 的卡片导出不一致（Go %d 条，Rust %d 条）", len(mine), len(theirs))
	}
}

func TestReadJSONUsesLiveCardsThenLegacyFile(t *testing.T) {
	ctx := context.Background()
	db := openCards(t)
	dir := t.TempDir()
	assertExport := func(want string) {
		t.Helper()
		got, err := ReadJSON(ctx, db, dir)
		if err != nil || got != want {
			t.Fatalf("export = %q, %v, want %q", got, err, want)
		}
	}
	assertExport("[]")
	legacy := "[ {\"id\":\"legacy\"} ]\n"
	if err := os.WriteFile(filepath.Join(dir, "cards.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	assertExport(legacy)
	insertCard(t, db, "active", 1_700_000_000_000, "数据库卡片")
	got, err := ReadJSON(ctx, db, dir)
	if err != nil {
		t.Fatal(err)
	}
	var result []Card
	if err := json.Unmarshal([]byte(got), &result); err != nil || len(result) != 1 || result[0].ID != "active" {
		t.Fatalf("export = %q, %v", got, err)
	}
	if _, err := db.Exec("UPDATE cards SET is_deleted = 1"); err != nil {
		t.Fatal(err)
	}
	assertExport(legacy)
	if _, err := db.Exec("DROP TABLE cards"); err != nil {
		t.Fatal(err)
	}
	assertExport(legacy)
	if _, err := db.Exec("CREATE TABLE cards (id TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadJSON(ctx, db, dir); err == nil {
		t.Fatal("invalid SQLite schema fell back to the legacy file")
	}
}

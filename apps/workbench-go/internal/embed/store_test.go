package embed

import (
	"context"
	"database/sql"
	"encoding/binary"
	"math"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func openStore(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "lib.db")+"?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	for _, statement := range []string{
		"CREATE TABLE cards (id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', headline TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', is_deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
		"CREATE TABLE card_embeddings (card_id TEXT PRIMARY KEY, dim INTEGER NOT NULL, embedding BLOB NOT NULL, updated_at INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '')",
		"INSERT INTO cards (id, headline, created_at) VALUES ('c1','标题一',1),('c2','标题二',2),('c3','标题三',3)",
		"UPDATE cards SET is_deleted = 1 WHERE id = 'c3'",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestSaveListAndStale(t *testing.T) {
	db := openStore(t)
	ctx := context.Background()
	ids, err := ListUnembedded(ctx, db, 10)
	if err != nil || len(ids) != 2 || ids[0] != "c2" || ids[1] != "c1" {
		t.Fatalf("unembedded: %+v, %v", ids, err)
	}
	vector := []float32{0.5, -1.25, 3}
	if err := Save(ctx, db, "c1", vector, HashProvider, HashModel); err != nil {
		t.Fatal(err)
	}
	var dim int64
	var raw []byte
	var provider, model string
	if err := db.QueryRow("SELECT dim, embedding, provider, model FROM card_embeddings WHERE card_id='c1'").Scan(&dim, &raw, &provider, &model); err != nil {
		t.Fatal(err)
	}
	if dim != 3 || provider != HashProvider || model != HashModel || len(raw) != 12 {
		t.Fatalf("stored: %d %q %q %d", dim, provider, model, len(raw))
	}
	if got := math.Float32frombits(binary.LittleEndian.Uint32(raw[4:])); math.Abs(float64(got-(-1.25))) > 1e-6 {
		t.Fatalf("little-endian decode: %v", got)
	}
	ids, err = ListUnembedded(ctx, db, 10)
	if err != nil || len(ids) != 1 || ids[0] != "c2" {
		t.Fatalf("unembedded after save: %+v, %v", ids, err)
	}
	// 维度与身份不匹配都算过期。
	stale, err := ListStale(ctx, db, 128, HashProvider, HashModel, 10)
	if err != nil || len(stale) != 1 || stale[0] != "c1" {
		t.Fatalf("stale by dim: %+v, %v", stale, err)
	}
	if err := Save(ctx, db, "c1", vector, "other", HashModel); err != nil {
		t.Fatal(err)
	}
	stale, err = ListStale(ctx, db, 3, HashProvider, HashModel, 10)
	if err != nil || len(stale) != 1 {
		t.Fatalf("stale by identity: %+v, %v", stale, err)
	}
	stale, err = ListStale(ctx, db, 3, "other", HashModel, 10)
	if err != nil || len(stale) != 0 {
		t.Fatalf("matching identity is not stale: %+v, %v", stale, err)
	}
	if err := SaveBatch(ctx, db, []Item{{CardID: "c2", Vector: vector}}, HashProvider, HashModel); err != nil {
		t.Fatal(err)
	}
	ids, err = ListUnembedded(ctx, db, 10)
	if err != nil || len(ids) != 0 {
		t.Fatalf("unembedded after batch: %+v, %v", ids, err)
	}
}

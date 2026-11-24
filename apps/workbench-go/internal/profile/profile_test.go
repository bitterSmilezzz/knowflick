package profile

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

const profileSchema = `
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER);
CREATE TABLE profile_claims (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL, evidence_json TEXT NOT NULL, scope TEXT NOT NULL,
  created_at INTEGER NOT NULL, confirmed_at INTEGER, expires_at INTEGER, denied_at INTEGER, superseded_by TEXT, status TEXT NOT NULL
);
CREATE TABLE profile_denials (evidence_fingerprint TEXT PRIMARY KEY, denied_at INTEGER NOT NULL);
`

func openProfile(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "lib.db")+"?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(profileSchema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO projects (id,name,created_at,updated_at) VALUES ('p1','项目甲',1,1),('p2','项目乙',1,1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE projects SET archived_at = 2 WHERE id = 'p2'"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func testClaim(id, scope string) Claim {
	return Claim{ID: id, Kind: "inference", Content: "用户在做检索方向的工作",
		EvidenceJSON: "[" + strings.Join([]string{"'" + id + "'"}, ",") + "]", Scope: scope}
}

func TestFingerprintMatchesDesktopFormula(t *testing.T) {
	// 手工复算：排序后的 JSON 数组 → SHA-256 → 前 8 字节大端整数。
	evidence := "[\"n2\",\"n1\"]"
	canonical := "[\"n1\",\"n2\"]"
	digest := sha256.Sum256([]byte(canonical))
	want := hex.EncodeToString(digest[:8])
	got := Fingerprint(evidence)
	if got != want {
		t.Fatalf("fingerprint: got %s, want %s", got, want)
	}
	if len(got) != 16 || got != Fingerprint("[\"n1\",\"n2\"]") {
		t.Fatalf("fingerprint unstable: %q", got)
	}
	// 排序与字节序必须与 Rust 的 u64::from_be_bytes 一致。
	_ = binary.BigEndian.Uint64(digest[:8])
	if Fingerprint("") == Fingerprint("[\"a\"]") {
		t.Fatal("empty evidence must not collide with real evidence")
	}
}

func TestDenyBlocksRebuildAndUserCanClear(t *testing.T) {
	db := openProfile(t)
	ctx := context.Background()
	claim := testClaim("c1", "global")
	if err := Add(ctx, db, claim, 100); err != nil {
		t.Fatal(err)
	}
	if err := Add(ctx, db, claim, 101); err == nil {
		t.Fatal("duplicate claim accepted")
	}
	active, err := ListActive(ctx, db, 200)
	if err != nil || len(active) != 1 || active[0].ID != "c1" {
		t.Fatalf("active: %+v, %v", active, err)
	}
	if confirmed, err := Confirm(ctx, db, "c1", 300); err != nil || !confirmed {
		t.Fatalf("confirm: %v, %v", confirmed, err)
	}
	if answers, err := ListForAnswer(ctx, db, 400); err != nil || len(answers) != 1 {
		t.Fatalf("answers: %+v, %v", answers, err)
	}
	if paused, err := Pause(ctx, db, "c1"); err != nil || !paused {
		t.Fatalf("pause: %v, %v", paused, err)
	}
	if answers, err := ListForAnswer(ctx, db, 400); err != nil || len(answers) != 0 {
		t.Fatalf("paused claim leaked into answers: %+v, %v", answers, err)
	}
	if resumed, err := Resume(ctx, db, "c1"); err != nil || !resumed {
		t.Fatalf("resume: %v, %v", resumed, err)
	}
	if denied, err := Deny(ctx, db, "c1", 500); err != nil || !denied {
		t.Fatalf("deny: %v, %v", denied, err)
	}
	if denied, err := Deny(ctx, db, "c1", 501); err != nil || denied {
		t.Fatalf("re-deny: %v, %v", denied, err)
	}
	// 被否认的证据源不得重建。
	if err := Add(ctx, db, claim, 600); err == nil || !strings.Contains(err.Error(), "已被否认过") {
		t.Fatalf("rebuild after deny: %v", err)
	}
	denials, err := ListDenials(ctx, db)
	if err != nil || len(denials) != 1 || denials[0].EvidenceFingerprint != Fingerprint(claim.EvidenceJSON) {
		t.Fatalf("denials: %+v, %v", denials, err)
	}
	if cleared, err := ClearDenialByEvidence(ctx, db, claim.EvidenceJSON); err != nil || !cleared {
		t.Fatalf("clear denial: %v, %v", cleared, err)
	}
	if cleared, err := ClearDenialByEvidence(ctx, db, claim.EvidenceJSON); err != nil || cleared {
		t.Fatalf("re-clear denial: %v, %v", cleared, err)
	}
	rebuilt := claim
	rebuilt.ID = "c2"
	if err := Add(ctx, db, rebuilt, 700); err != nil {
		t.Fatalf("rebuild after clearing: %v", err)
	}
	// 删除 = 否认 + 物理移除：未否认的断言可以删，已否认的会先被 Deny 判定为「无变化」。
	fresh := claim
	fresh.ID = "c3"
	fresh.EvidenceJSON = `["n3"]`
	if err := Add(ctx, db, fresh, 750); err != nil {
		t.Fatal(err)
	}
	if deleted, err := Delete(ctx, db, "c3", 800); err != nil || !deleted {
		t.Fatalf("delete: %v, %v", deleted, err)
	}
	if deleted, err := Delete(ctx, db, "c3", 801); err != nil || deleted {
		t.Fatalf("re-delete: %v, %v", deleted, err)
	}
	all, err := ListAll(ctx, db)
	if err != nil || len(all) != 2 {
		t.Fatalf("all after delete: %+v, %v", all, err)
	}
	denials, err = ListDenials(ctx, db)
	if err != nil || len(denials) != 1 {
		t.Fatalf("denial kept after delete: %+v, %v", denials, err)
	}
}

func TestScopesAndGovernanceLists(t *testing.T) {
	db := openProfile(t)
	ctx := context.Background()
	claim := Claim{ID: "c1", Kind: "fact", Content: "内容", EvidenceJSON: "[\"n1\"]", Scope: "p1"}
	if err := Add(ctx, db, claim, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := ListForProjectAnswer(ctx, db, 200, "p2"); err == nil || !strings.Contains(err.Error(), "不存在或已封存") {
		t.Fatalf("archived project: %v", err)
	}
	if _, err := ListForProjectAnswer(ctx, db, 200, "missing"); err == nil {
		t.Fatal("missing project accepted")
	}
	if answers, err := ListForProjectAnswer(ctx, db, 200, "p1"); err != nil || len(answers) != 0 {
		t.Fatalf("unconfirmed project claim: %+v, %v", answers, err)
	}
	if confirmed, err := Confirm(ctx, db, "c1", 300); err != nil || !confirmed {
		t.Fatalf("confirm: %v, %v", confirmed, err)
	}
	if answers, err := ListForProjectAnswer(ctx, db, 400, "p1"); err != nil || len(answers) != 1 {
		t.Fatalf("project answers: %+v, %v", answers, err)
	}
	if answers, err := ListForAnswer(ctx, db, 400); err != nil || len(answers) != 0 {
		t.Fatalf("project claim leaked into global answers: %+v, %v", answers, err)
	}
	if _, err := Confirm(ctx, db, "missing", 1); err != nil {
		t.Fatal(err)
	}
	if changed, err := Confirm(ctx, db, "c1", 1); err != nil || !changed {
		t.Fatalf("re-confirm: %v, %v", changed, err)
	}
	// 过期与被取代都要从有效列表里消失。
	if _, err := db.Exec("UPDATE profile_claims SET expires_at = 500 WHERE id = 'c1'"); err != nil {
		t.Fatal(err)
	}
	if active, err := ListActive(ctx, db, 600); err != nil || len(active) != 0 {
		t.Fatalf("expired claim: %+v, %v", active, err)
	}
	all, err := ListAll(ctx, db)
	if err != nil || len(all) != 1 || all[0].ExpiresAt == nil {
		t.Fatalf("all: %+v, %v", all, err)
	}
}

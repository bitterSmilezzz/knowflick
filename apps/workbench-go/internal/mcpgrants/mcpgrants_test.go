package mcpgrants

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

const mcpSchema = `
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER);
CREATE TABLE mcp_grants (
    id                  TEXT PRIMARY KEY,
    client_label        TEXT NOT NULL,
    scope               TEXT NOT NULL CHECK (scope IN ('project', 'library')),
    project_id          TEXT REFERENCES projects(id),
    token_hash          TEXT NOT NULL UNIQUE,
    library_read        INTEGER NOT NULL DEFAULT 0 CHECK (library_read IN (0, 1)),
    card_write          INTEGER NOT NULL DEFAULT 0 CHECK (card_write IN (0, 1)),
    material_write      INTEGER NOT NULL DEFAULT 0 CHECK (material_write IN (0, 1)),
    created_at          INTEGER NOT NULL,
    revoked_at          INTEGER,
    policy_version      INTEGER NOT NULL,
    CHECK ((scope = 'project' AND project_id IS NOT NULL AND library_read = 0 AND card_write = 0 AND material_write = 0)
        OR (scope = 'library' AND project_id IS NULL AND (library_read = 1 OR card_write = 1 OR material_write = 1)))
);
`

func openGrants(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "lib.db")+"?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(mcpSchema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO projects (id,name,created_at,updated_at) VALUES ('p1','项目',1,1)"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func projectRequest() Request {
	project := "p1"
	return Request{ClientLabel: "客户端", Scope: "project", ProjectID: &project}
}

func TestCreatesDistinctTokensButOnlyStoresHashes(t *testing.T) {
	db := openGrants(t)
	ctx := context.Background()
	a, err := Create(ctx, db, projectRequest(), 100)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Create(ctx, db, projectRequest(), 101)
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Token) != 64 || a.Token == b.Token {
		t.Fatalf("tokens: %q %q", a.Token, b.Token)
	}
	var stored string
	if err := db.QueryRow("SELECT token_hash FROM mcp_grants WHERE id = ?", a.Grant.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != TokenHash(a.Token) || stored == a.Token {
		t.Fatalf("stored hash: %q", stored)
	}
	grants, err := List(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(grants)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), a.Token) || strings.Contains(string(encoded), stored) {
		t.Fatalf("token leaked into list: %s", encoded)
	}
}

func TestPermissionsAreExplicitAndSeparate(t *testing.T) {
	db := openGrants(t)
	ctx := context.Background()
	invalid := projectRequest()
	invalid.CardWrite = true
	if _, err := Create(ctx, db, invalid, 1); err == nil {
		t.Fatal("project grant with card write accepted")
	}
	invalid.Scope = "library"
	if _, err := Create(ctx, db, invalid, 1); err == nil {
		t.Fatal("library scope with project id accepted")
	}
	invalid.ProjectID = nil
	created, err := Create(ctx, db, invalid, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !created.Grant.CardWrite || created.Grant.LibraryRead {
		t.Fatalf("library grant: %+v", created.Grant)
	}
	invalid.CardWrite = false
	if _, err := Create(ctx, db, invalid, 1); err == nil {
		t.Fatal("library grant without any permission accepted")
	}
	blank := projectRequest()
	blank.ClientLabel = "   "
	if _, err := Create(ctx, db, blank, 1); err == nil || !strings.Contains(err.Error(), "连接名称") {
		t.Fatalf("blank label: %v", err)
	}
	if _, err := db.Exec("UPDATE projects SET archived_at = 2 WHERE id = 'p1'"); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(ctx, db, projectRequest(), 2); err == nil || !strings.Contains(err.Error(), "不存在或已封存") {
		t.Fatalf("archived project: %v", err)
	}
	grants, err := List(ctx, db)
	if err != nil || len(grants) != 1 {
		t.Fatalf("grants: %+v, %v", grants, err)
	}
}

func TestRevokeIsIdempotent(t *testing.T) {
	db := openGrants(t)
	ctx := context.Background()
	a, err := Create(ctx, db, projectRequest(), 1)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Create(ctx, db, projectRequest(), 2)
	if err != nil {
		t.Fatal(err)
	}
	if changed, err := Revoke(ctx, db, a.Grant.ID, 10); err != nil || !changed {
		t.Fatalf("revoke: %v, %v", changed, err)
	}
	if changed, err := Revoke(ctx, db, a.Grant.ID, 20); err != nil || !changed {
		t.Fatalf("re-revoke: %v, %v", changed, err)
	}
	if changed, err := Revoke(ctx, db, "missing", 20); err != nil || changed {
		t.Fatalf("missing revoke: %v, %v", changed, err)
	}
	grants, err := List(ctx, db)
	if err != nil || len(grants) != 2 {
		t.Fatalf("grants: %+v, %v", grants, err)
	}
	for _, grant := range grants {
		switch grant.ID {
		case a.Grant.ID:
			if grant.RevokedAt == nil || *grant.RevokedAt != 10 {
				t.Fatalf("first revoke time: %+v", grant.RevokedAt)
			}
		case b.Grant.ID:
			if grant.RevokedAt != nil {
				t.Fatalf("other grant revoked: %+v", grant)
			}
		}
	}
}

func TestDatabaseRejectsProjectGrantWithLibraryPermissions(t *testing.T) {
	db := openGrants(t)
	_, err := db.Exec("INSERT INTO mcp_grants (id,client_label,scope,project_id,token_hash,card_write,created_at,policy_version)" +
		" VALUES ('bad','客户端','project','p1','hash',1,1,1)")
	if err == nil {
		t.Fatal("check constraint did not fire")
	}
	grants, err := List(context.Background(), db)
	if err != nil || len(grants) != 0 {
		t.Fatalf("grants: %+v, %v", grants, err)
	}
}

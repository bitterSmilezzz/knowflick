// Package library reads the existing KnowFlick SQLite schema without running migrations.
package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

const PageSize = 60

type Library struct{ db *sql.DB }

type Note struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	Body       string  `json:"body"`
	Notebook   *string `json:"notebook"`
	Pinned     bool    `json:"pinned"`
	ArchivedAt *int64  `json:"archivedAt"`
	Revision   int64   `json:"revision"`
	UpdatedAt  int64   `json:"updatedAt"`
}

type Page struct {
	Notes   []Note `json:"notes"`
	HasMore bool   `json:"hasMore"`
}

const noteColumns = "n.id, n.title, n.body_md, n.notebook, n.is_pinned, n.archived_at, n.current_revision, n.updated_at"

func Open(ctx context.Context, path string) (*Library, error) {
	uri, err := databaseURI(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("需要选择 SQLite 资料库文件")
	}
	uri.RawQuery = "mode=ro&_pragma=busy_timeout(5000)&_pragma=query_only(1)"
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	for _, statement := range []string{
		"SELECT " + noteColumns + ", n.is_deleted FROM notes n LIMIT 0",
		"SELECT note_id, title, body FROM fts_notes LIMIT 0",
	} {
		rows, err := db.QueryContext(ctx, statement)
		if err != nil {
			db.Close()
			return nil, fmt.Errorf("无法读取 KnowFlick 笔记结构: %w", err)
		}
		rows.Close()
	}
	return &Library{db: db}, nil
}

func databaseURI(path string) (url.URL, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return url.URL{}, err
	}
	slashPath := filepath.ToSlash(absolute)
	if !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}
	return url.URL{Scheme: "file", Path: slashPath}, nil
}

func (l *Library) Close() error { return l.db.Close() }

func (l *Library) List(ctx context.Context, offset int) (Page, error) {
	return l.query(ctx, "SELECT "+noteColumns+" FROM notes n WHERE n.is_deleted=0"+
		" ORDER BY n.is_pinned DESC, n.updated_at DESC, n.id LIMIT ? OFFSET ?", PageSize+1, offset)
}

// Search matches Rust's FTS5 token-prefix AND query and its LIKE fallback.
func (l *Library) Search(ctx context.Context, query string) (Page, error) {
	clean := strings.TrimSpace(query)
	if clean == "" {
		return l.List(ctx, 0)
	}
	terms := strings.Fields(clean)
	for i, term := range terms {
		terms[i] = `"` + strings.ReplaceAll(term, `"`, `""`) + `"*`
	}
	page, err := l.query(ctx, "SELECT "+noteColumns+" FROM fts_notes f JOIN notes n ON f.note_id=n.id"+
		" WHERE n.is_deleted=0 AND fts_notes MATCH ? ORDER BY bm25(fts_notes), n.id LIMIT ?", strings.Join(terms, " AND "), PageSize+1)
	if err != nil || len(page.Notes) > 0 {
		return page, err
	}
	wildcard := "%" + clean + "%"
	return l.query(ctx, "SELECT "+noteColumns+" FROM notes n WHERE n.is_deleted=0 AND (n.title LIKE ? OR n.body_md LIKE ?)"+
		" ORDER BY n.updated_at DESC, n.id LIMIT ?", wildcard, wildcard, PageSize+1)
}

func (l *Library) query(ctx context.Context, statement string, args ...any) (Page, error) {
	rows, err := l.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	page := Page{Notes: make([]Note, 0)}
	for rows.Next() {
		var note Note
		if err := rows.Scan(&note.ID, &note.Title, &note.Body, &note.Notebook, &note.Pinned, &note.ArchivedAt, &note.Revision, &note.UpdatedAt); err != nil {
			return Page{}, err
		}
		page.Notes = append(page.Notes, note)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	page.HasMore = len(page.Notes) > PageSize
	if page.HasMore {
		page.Notes = page.Notes[:PageSize]
	}
	return page, nil
}

package library

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"slices"
	"time"

	"knowflick.local/workbench-go/internal/archive"
	"knowflick.local/workbench-go/internal/cards"
	"knowflick.local/workbench-go/internal/jsonx"
	"knowflick.local/workbench-go/internal/libfiles"
	"knowflick.local/workbench-go/internal/media"
)

type backupMaterial struct {
	ID              string  `json:"id"`
	SourceType      string  `json:"sourceType"`
	Title           string  `json:"title"`
	SourceURL       *string `json:"sourceUrl"`
	RawText         string  `json:"rawText"`
	CleanedMarkdown *string `json:"cleanedMarkdown"`
	ContentHash     string  `json:"contentHash"`
	MediaPath       *string `json:"mediaPath"`
	MediaSizeBytes  int64   `json:"mediaSizeBytes"`
	MetadataJSON    string  `json:"metadataJson"`
	InboxStatus     string  `json:"inboxStatus"`
	CreatedAt       int64   `json:"createdAt"`
	UpdatedAt       int64   `json:"updatedAt"`
}

type backupArtifact struct {
	ID              string   `json:"id"`
	ArtifactType    string   `json:"artifactType"`
	Title           string   `json:"title"`
	ContentMarkdown string   `json:"contentMarkdown"`
	SourceCardIDs   []string `json:"sourceCardIds"`
	SourceNoteIDs   []string `json:"sourceNoteIds"`
	DateScopeStart  *int64   `json:"dateScopeStart"`
	DateScopeEnd    *int64   `json:"dateScopeEnd"`
	CreatedAt       int64    `json:"createdAt"`
	UpdatedAt       int64    `json:"updatedAt"`
	IsDeleted       bool     `json:"isDeleted"`
}

type backupNote struct {
	ID                 string   `json:"id"`
	Title              string   `json:"title"`
	BodyMD             string   `json:"bodyMd"`
	Notebook           *string  `json:"notebook"`
	Tags               []string `json:"tags"`
	IsPinned           bool     `json:"isPinned"`
	IsFavorite         bool     `json:"isFavorite"`
	ArchivedAt         *int64   `json:"archivedAt"`
	SourceMaterialID   *string  `json:"sourceMaterialId"`
	CurrentRevision    int64    `json:"currentRevision"`
	CreatedAt          int64    `json:"createdAt"`
	UpdatedAt          int64    `json:"updatedAt"`
	IsDeleted          bool     `json:"isDeleted"`
	DeletedAt          *int64   `json:"deletedAt"`
	ExcludeFromProfile bool     `json:"excludeFromProfile"`
}

type backupNoteRevision struct {
	NoteID   string `json:"noteId"`
	Revision int64  `json:"revision"`
	Title    string `json:"title"`
	BodyMD   string `json:"bodyMd"`
	SavedAt  int64  `json:"savedAt"`
}

type backupKnowledgeBase struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type backupMembership struct {
	kbID, noteID string
	addedAt      int64
}

type backupKnowledgeBases struct {
	Items      []backupKnowledgeBase `json:"knowledgeBases"`
	Membership map[string]int64      `json:"membership"`
}

type backupDatabase struct {
	cards          []cards.Card
	materials      []backupMaterial
	artifacts      []backupArtifact
	notes          []backupNote
	noteRevisions  []backupNoteRevision
	subscriptions  backupSubscriptions
	mail           backupMailSnapshot
	r4             json.RawMessage
	knowledgeBases backupKnowledgeBases
}

var noteAttachment = regexp.MustCompile(`!\[[^\]]*\]\((media/(?:audio|image|ink)/[A-Za-z0-9._-]+)\)`)

// WriteSystemBackupV4 采集已落盘的资料库数据并写入基础 .kfbackup。
// SQLite 查询共用只读事务。设置和附件在事务外读取，引用附件不可用时返回错误。
func (l *Library) WriteSystemBackupV4(ctx context.Context, dst io.Writer, dir string, exportedAt time.Time) error {
	database, err := l.captureBackupDatabase(ctx)
	if err != nil {
		return err
	}
	var snapshot archive.SystemSnapshotV4
	for _, item := range []struct {
		data any
		dest *json.RawMessage
	}{
		{database.cards, &snapshot.Cards},
		{database.materials, &snapshot.Materials},
		{database.artifacts, &snapshot.Artifacts},
		{database.notes, &snapshot.Notes},
		{database.knowledgeBases, &snapshot.KnowledgeBases},
		{database.noteRevisions, &snapshot.NoteRevisions},
		{database.r4, &snapshot.R4},
		{database.subscriptions, &snapshot.Subscriptions},
		{database.mail, &snapshot.Mail},
	} {
		*item.dest, err = json.Marshal(item.data)
		if err != nil {
			return fmt.Errorf("无法编码备份快照：%w", err)
		}
	}
	settings, err := libfiles.ReadOptional(filepath.Join(dir, "settings.json"))
	if err != nil {
		return fmt.Errorf("无法读取备份设置：%w", err)
	}
	if settings != nil {
		snapshot.Settings = *settings
	}
	snapshot.Media, err = database.readBackupMedia(ctx, dir)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return archive.WriteSystemBackupV4(dst, snapshot, exportedAt)
}

func (l *Library) captureBackupDatabase(ctx context.Context) (backupDatabase, error) {
	tx, err := l.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return backupDatabase{}, fmt.Errorf("无法打开备份快照：%w", err)
	}
	defer tx.Rollback()
	materials, err := readBackupRows(ctx, tx, `SELECT id,source_type,title,source_url,raw_text,cleaned_markdown,
		content_hash,media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at
		FROM materials WHERE is_deleted=0 ORDER BY created_at DESC`, scanBackupMaterial)
	if err != nil {
		return backupDatabase{}, fmt.Errorf("读取备份素材失败：%w", err)
	}
	activeCards, err := cards.ListForBackup(ctx, tx)
	if err != nil {
		return backupDatabase{}, fmt.Errorf("读取备份卡片失败：%w", err)
	}
	notes, err := readBackupRows(ctx, tx, "SELECT "+noteColumns+" FROM notes n ORDER BY n.is_pinned DESC, n.updated_at DESC", scanBackupNote)
	if err != nil {
		return backupDatabase{}, fmt.Errorf("读取备份笔记失败：%w", err)
	}
	artifacts, err := readBackupRows(ctx, tx, `SELECT id,artifact_type,title,content_markdown,source_card_ids,source_note_ids,
		date_scope_start,date_scope_end,created_at,updated_at,is_deleted FROM artifacts WHERE is_deleted=0 ORDER BY created_at DESC`, scanBackupArtifact)
	if err != nil {
		return backupDatabase{}, fmt.Errorf("读取备份产物失败：%w", err)
	}
	bases, err := readBackupRows(ctx, tx, "SELECT id,name,description,created_at,updated_at FROM knowledge_bases ORDER BY created_at ASC",
		func(rows *sql.Rows, base *backupKnowledgeBase) error {
			return rows.Scan(&base.ID, &base.Name, &base.Description, &base.CreatedAt, &base.UpdatedAt)
		})
	if err != nil {
		return backupDatabase{}, fmt.Errorf("读取备份知识库失败：%w", err)
	}
	members, err := readBackupRows(ctx, tx, "SELECT kb_id,note_id,added_at FROM kb_membership",
		func(rows *sql.Rows, member *backupMembership) error {
			return rows.Scan(&member.kbID, &member.noteID, &member.addedAt)
		})
	if err != nil {
		return backupDatabase{}, fmt.Errorf("读取备份成员关系失败：%w", err)
	}
	revisions, err := readBackupRows(ctx, tx, "SELECT note_id,revision,title,body_md,saved_at FROM note_revisions ORDER BY note_id,revision",
		func(rows *sql.Rows, item *backupNoteRevision) error {
			return rows.Scan(&item.NoteID, &item.Revision, &item.Title, &item.BodyMD, &item.SavedAt)
		})
	if err != nil {
		return backupDatabase{}, fmt.Errorf("读取笔记历史失败：%w", err)
	}
	if err := validateRevisions(revisions, notes); err != nil {
		return backupDatabase{}, err
	}
	subscriptions, err := captureSubscriptions(ctx, tx)
	if err != nil {
		return backupDatabase{}, err
	}
	mailSnapshot, err := captureMailSnapshot(ctx, tx, materials)
	if err != nil {
		return backupDatabase{}, err
	}
	r4, err := captureR4(ctx, tx)
	if err != nil {
		return backupDatabase{}, err
	}
	if err := tx.Commit(); err != nil {
		return backupDatabase{}, fmt.Errorf("读取备份快照失败：%w", err)
	}
	membership := make(map[string]int64, len(members))
	for _, member := range members {
		membership[member.kbID+"\n"+member.noteID] = member.addedAt
	}
	return backupDatabase{
		cards: activeCards, materials: materials, artifacts: artifacts, notes: notes,
		noteRevisions:  revisions,
		subscriptions:  subscriptions,
		mail:           mailSnapshot,
		r4:             r4,
		knowledgeBases: backupKnowledgeBases{Items: bases, Membership: membership},
	}, nil
}

var r4Schemas = map[string][][4]any{
	"projects":        {{"id", "TEXT", false, 1}, {"name", "TEXT", true, 0}, {"description", "TEXT", true, 0}, {"created_at", "INTEGER", true, 0}, {"updated_at", "INTEGER", true, 0}, {"archived_at", "INTEGER", false, 0}},
	"goals":           {{"id", "TEXT", false, 1}, {"title", "TEXT", true, 0}, {"done_criteria", "TEXT", true, 0}, {"scope", "TEXT", false, 0}, {"created_at", "INTEGER", true, 0}, {"achieved_at", "INTEGER", false, 0}, {"abandoned_at", "INTEGER", false, 0}, {"review_note", "TEXT", true, 0}},
	"profile_claims":  {{"id", "TEXT", false, 1}, {"kind", "TEXT", true, 0}, {"content", "TEXT", true, 0}, {"evidence_json", "TEXT", true, 0}, {"scope", "TEXT", true, 0}, {"created_at", "INTEGER", true, 0}, {"confirmed_at", "INTEGER", false, 0}, {"expires_at", "INTEGER", false, 0}, {"denied_at", "INTEGER", false, 0}, {"superseded_by", "TEXT", false, 0}, {"status", "TEXT", true, 0}},
	"profile_denials": {{"evidence_fingerprint", "TEXT", false, 1}, {"denied_at", "INTEGER", true, 0}},
	"project_members": {{"project_id", "TEXT", true, 1}, {"note_id", "TEXT", true, 2}, {"added_at", "INTEGER", true, 0}},
	"goal_evidence":   {{"goal_id", "TEXT", true, 1}, {"evidence_id", "TEXT", true, 2}, {"kind", "TEXT", true, 0}, {"linked_at", "INTEGER", true, 0}},
}

func captureR4(ctx context.Context, tx *sql.Tx) (json.RawMessage, error) {
	tables := make(map[string][]map[string]any, len(r4Schemas))
	for _, name := range []string{"projects", "goals", "profile_claims", "profile_denials", "project_members", "goal_evidence"} {
		expected := r4Schemas[name]
		rows, err := tx.QueryContext(ctx, "PRAGMA table_info("+name+")")
		if err != nil {
			return nil, fmt.Errorf("读取项目与画像表结构失败：%w", err)
		}
		var actual [][4]any
		for rows.Next() {
			var cid, notNull, pk int
			var colName, kind string
			var defaultValue any
			if err := rows.Scan(&cid, &colName, &kind, &notNull, &defaultValue, &pk); err != nil {
				rows.Close()
				return nil, fmt.Errorf("读取项目与画像表结构失败：%w", err)
			}
			actual = append(actual, [4]any{colName, kind, notNull != 0, pk})
		}
		rows.Close()
		if len(actual) != len(expected) {
			return nil, fmt.Errorf("备份表 %s 的结构不匹配，需更新备份版本", name)
		}
		for i := range expected {
			if actual[i] != expected[i] {
				return nil, fmt.Errorf("备份表 %s 的结构不匹配，需更新备份版本", name)
			}
		}
		items, err := readBackupRows(ctx, tx, "SELECT * FROM "+name, func(rows *sql.Rows, item *map[string]any) error {
			values, err := rows.Columns()
			if err != nil {
				return err
			}
			raw := make([]any, len(values))
			pointers := make([]any, len(values))
			for i := range raw {
				pointers[i] = &raw[i]
			}
			if err := rows.Scan(pointers...); err != nil {
				return err
			}
			row := make(map[string]any, len(values))
			for i, key := range values {
				switch value := raw[i].(type) {
				case nil, int64, string:
					row[key] = value
				default:
					return fmt.Errorf("备份表 %s 含不支持的字段类型", name)
				}
			}
			*item = row
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("读取项目与画像数据失败：%w", err)
		}
		tables[name] = items
	}
	noteBindings := map[string]string{}
	for _, row := range tables["project_members"] {
		id, _ := row["note_id"].(string)
		fingerprint, err := fingerprintRow(ctx, tx, "SELECT title,body_md,current_revision,is_deleted FROM notes WHERE id=?", id)
		if err != nil || fingerprint == "" {
			return nil, fmt.Errorf("项目成员笔记不存在：%s", id)
		}
		noteBindings[id] = fingerprint
	}
	evidenceBindings := map[string]any{}
	for _, row := range tables["goal_evidence"] {
		kind, _ := row["kind"].(string)
		id, _ := row["evidence_id"].(string)
		if kind != "note" && kind != "material" {
			return nil, fmt.Errorf("目标证据类型无效，无法安全备份")
		}
		query := "SELECT title,raw_text,source_url,is_deleted,updated_at FROM materials WHERE id=?"
		if kind == "note" {
			query = "SELECT title,body_md,current_revision,is_deleted FROM notes WHERE id=?"
		}
		fingerprint, err := fingerprintRow(ctx, tx, query, id)
		if err != nil {
			return nil, err
		}
		if fingerprint == "" {
			evidenceBindings[kind+"\n"+id] = nil
		} else {
			evidenceBindings[kind+"\n"+id] = fingerprint
		}
	}
	profileBindings := map[string]any{}
	profileIDs := map[string]struct{}{}
	for _, row := range tables["profile_claims"] {
		raw, _ := row["evidence_json"].(string)
		var ids []string
		if json.Unmarshal([]byte(raw), &ids) != nil {
			return nil, fmt.Errorf("画像证据格式无效，无法安全备份")
		}
		for _, id := range ids {
			profileIDs[id] = struct{}{}
		}
	}
	for id := range profileIDs {
		note, err := fingerprintRow(ctx, tx, "SELECT title,body_md,current_revision,is_deleted FROM notes WHERE id=?", id)
		if err != nil {
			return nil, err
		}
		material, err := fingerprintRow(ctx, tx, "SELECT title,raw_text,source_url,is_deleted,updated_at FROM materials WHERE id=?", id)
		if err != nil {
			return nil, err
		}
		card, err := fingerprintRow(ctx, tx, "SELECT headline,summary,details,category,links_json,tags_json,is_deleted,edited_at FROM cards WHERE id=?", id)
		if err != nil {
			return nil, err
		}
		binding := map[string]any{"note": nil, "material": nil, "card": nil}
		if note != "" {
			binding["note"] = note
		}
		if material != "" {
			binding["material"] = material
		}
		if card != "" {
			binding["card"] = card
		}
		profileBindings[id] = binding
	}
	encoded, err := json.Marshal(map[string]any{
		"version": 1, "tables": tables,
		"note_bindings": noteBindings, "evidence_bindings": evidenceBindings, "profile_bindings": profileBindings,
	})
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func fingerprintRow(ctx context.Context, tx *sql.Tx, query, id string) (string, error) {
	rows, err := tx.QueryContext(ctx, query, id)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	if !rows.Next() {
		return "", rows.Err()
	}
	columns, err := rows.Columns()
	if err != nil {
		return "", err
	}
	raw := make([]any, len(columns))
	pointers := make([]any, len(columns))
	for i := range raw {
		pointers[i] = &raw[i]
	}
	if err := rows.Scan(pointers...); err != nil {
		return "", err
	}
	values := make([]any, len(raw))
	for i, value := range raw {
		switch v := value.(type) {
		case nil, int64, string:
			values[i] = v
		default:
			return "", fmt.Errorf("指纹来源含不支持的字段类型")
		}
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func validateRevisions(revisions []backupNoteRevision, notes []backupNote) error {
	byID := make(map[string]backupNote, len(notes))
	for _, note := range notes {
		byID[note.ID] = note
	}
	seen := make(map[string]struct{}, len(revisions))
	for _, revision := range revisions {
		note, found := byID[revision.NoteID]
		if !found || revision.Revision < 1 || revision.Revision > note.CurrentRevision {
			return fmt.Errorf("笔记历史引用或修订号无效：%s", revision.NoteID)
		}
		key := fmt.Sprintf("%s\n%d", revision.NoteID, revision.Revision)
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("笔记历史修订重复：%s", key)
		}
		seen[key] = struct{}{}
		if revision.Revision == note.CurrentRevision && (revision.Title != note.Title || revision.BodyMD != note.BodyMD) {
			return fmt.Errorf("当前笔记与历史修订不一致：%s", revision.NoteID)
		}
	}
	return nil
}

func readBackupRows[T any](ctx context.Context, tx *sql.Tx, query string, scan func(*sql.Rows, *T) error) ([]T, error) {
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]T, 0)
	for rows.Next() {
		var item T
		if err := scan(rows, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanBackupMaterial(rows *sql.Rows, item *backupMaterial) error {
	return rows.Scan(&item.ID, &item.SourceType, &item.Title, &item.SourceURL, &item.RawText, &item.CleanedMarkdown,
		&item.ContentHash, &item.MediaPath, &item.MediaSizeBytes, &item.MetadataJSON, &item.InboxStatus, &item.CreatedAt, &item.UpdatedAt)
}

func scanBackupNote(rows *sql.Rows, item *backupNote) error {
	var note Note
	if err := scanNote(rows, &note); err != nil {
		return err
	}
	tags, err := jsonx.DecodeArray[string](note.TagsJSON)
	if err != nil {
		return fmt.Errorf("笔记标签数据损坏：%w", err)
	}
	*item = backupNote{
		ID: note.ID, Title: note.Title, BodyMD: note.Body, Notebook: note.Notebook, Tags: tags,
		IsPinned: note.Pinned, IsFavorite: note.Favorite, ArchivedAt: note.ArchivedAt,
		SourceMaterialID: note.SourceMaterialID, CurrentRevision: note.Revision, CreatedAt: note.CreatedAt,
		UpdatedAt: note.UpdatedAt, IsDeleted: note.Deleted, DeletedAt: note.DeletedAt, ExcludeFromProfile: note.ExcludeFromProfile,
	}
	return nil
}

func scanBackupArtifact(rows *sql.Rows, item *backupArtifact) error {
	var cardIDs, noteIDs string
	if err := rows.Scan(&item.ID, &item.ArtifactType, &item.Title, &item.ContentMarkdown,
		&cardIDs, &noteIDs, &item.DateScopeStart, &item.DateScopeEnd, &item.CreatedAt, &item.UpdatedAt, &item.IsDeleted); err != nil {
		return err
	}
	var err error
	item.SourceCardIDs, err = jsonx.DecodeArray[string](cardIDs)
	if err != nil {
		return fmt.Errorf("产物引用的卡片数据损坏：%w", err)
	}
	item.SourceNoteIDs, err = jsonx.DecodeArray[string](noteIDs)
	if err != nil {
		return fmt.Errorf("产物引用的笔记数据损坏：%w", err)
	}
	return nil
}

func (snapshot backupDatabase) readBackupMedia(ctx context.Context, dir string) (map[string][]byte, error) {
	wanted := make(map[string]struct{})
	for _, item := range snapshot.materials {
		if item.MediaPath != nil && *item.MediaPath != "" {
			wanted[*item.MediaPath] = struct{}{}
		}
	}
	for _, note := range snapshot.notes {
		for _, match := range noteAttachment.FindAllStringSubmatch(note.BodyMD, -1) {
			wanted[match[1]] = struct{}{}
		}
	}
	for _, revision := range snapshot.noteRevisions {
		for _, match := range noteAttachment.FindAllStringSubmatch(revision.BodyMD, -1) {
			wanted[match[1]] = struct{}{}
		}
	}
	paths := make([]string, 0, len(wanted))
	for path := range wanted {
		paths = append(paths, path)
	}
	slices.Sort(paths)
	attachments := make(map[string][]byte, len(paths))
	for _, path := range paths {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !archive.IsSystemMediaPath(path) {
			return nil, fmt.Errorf("备份包含无效的附件路径")
		}
		data, err := media.Read(dir, path)
		if err != nil {
			return nil, fmt.Errorf("读取备份附件 %s 失败：%w", path, err)
		}
		attachments[path] = data
	}
	return attachments, nil
}

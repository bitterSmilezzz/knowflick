package projects

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Project 是一个项目（R4 上下文范围），字段与桌面端 ProjectDto 对应。
type Project struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
	ArchivedAt  *int64 `json:"archivedAt"`
}

// Member 是项目的成员笔记：摘录只给界面看，导出走全文。
type Member struct {
	NoteID    string `json:"noteId"`
	Title     string `json:"title"`
	Excerpt   string `json:"excerpt"`
	AddedAt   int64  `json:"addedAt"`
	IsDeleted bool   `json:"isDeleted"`
}

// Create 新建项目：名称去空白后必填，且不允许重名。
func Create(ctx context.Context, db *sql.DB, id, name, description string, now int64) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("项目名不能为空")
	}
	var duplicates int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM projects WHERE name = ?", name).Scan(&duplicates); err != nil {
		return err
	}
	if duplicates > 0 {
		return fmt.Errorf("已有名为「%s」的项目", name)
	}
	_, err := db.ExecContext(ctx, "INSERT INTO projects (id,name,description,created_at,updated_at) VALUES (?,?,?,?,?)", id, name, description, now, now)
	return err
}

// List 按创建时间列出项目；默认排除已封存的。
func List(ctx context.Context, db *sql.DB, includeArchived bool) ([]Project, error) {
	query := "SELECT id,name,description,created_at,updated_at,archived_at FROM projects"
	if !includeArchived {
		query += " WHERE archived_at IS NULL"
	}
	query += " ORDER BY created_at ASC"
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Project, 0)
	for rows.Next() {
		var item Project
		var archived sql.NullInt64
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &item.CreatedAt, &item.UpdatedAt, &archived); err != nil {
			return nil, err
		}
		if archived.Valid {
			value := archived.Int64
			item.ArchivedAt = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// AddNote 幂等加入成员：重复加入不报错、不重复行。
func AddNote(ctx context.Context, db *sql.DB, projectID, noteID string, now int64) error {
	var exists int
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?)", projectID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return errors.New("项目不存在")
	}
	var noteExists int
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM notes WHERE id = ?)", noteID).Scan(&noteExists); err != nil {
		return err
	}
	if noteExists == 0 {
		return errors.New("笔记不存在")
	}
	_, err := db.ExecContext(ctx, "INSERT INTO project_members (project_id,note_id,added_at) VALUES (?,?,?) ON CONFLICT(project_id,note_id) DO NOTHING", projectID, noteID, now)
	return err
}

// RemoveNote 移出成员；不在项目里也不算错误。
func RemoveNote(ctx context.Context, db *sql.DB, projectID, noteID string) error {
	_, err := db.ExecContext(ctx, "DELETE FROM project_members WHERE project_id = ? AND note_id = ?", projectID, noteID)
	return err
}

// MemberIndex 返回全量「笔记 → 项目」索引，只含未封存项目的成员。
// 封存项目不再参与其它上下文，索引里必须剔除。
func MemberIndex(ctx context.Context, db *sql.DB) ([][2]string, error) {
	rows, err := db.QueryContext(ctx, "SELECT pm.note_id, pm.project_id FROM project_members pm"+
		" JOIN projects p ON p.id = pm.project_id WHERE p.archived_at IS NULL"+
		" ORDER BY pm.note_id, pm.project_id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	pairs := make([][2]string, 0)
	for rows.Next() {
		var pair [2]string
		if err := rows.Scan(&pair[0], &pair[1]); err != nil {
			return nil, err
		}
		pairs = append(pairs, pair)
	}
	return pairs, rows.Err()
}

// MemberList 列出一个项目的成员笔记；摘录是正文压平后的前 80 字。
func MemberList(ctx context.Context, db *sql.DB, projectID string) ([]Member, error) {
	rows, err := db.QueryContext(ctx, "SELECT n.id,n.title,n.body_md,pm.added_at,n.is_deleted"+
		" FROM project_members pm JOIN notes n ON n.id = pm.note_id"+
		" WHERE pm.project_id = ? ORDER BY pm.added_at ASC", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members := make([]Member, 0)
	for rows.Next() {
		var member Member
		var body string
		var deleted int64
		if err := rows.Scan(&member.NoteID, &member.Title, &body, &member.AddedAt, &deleted); err != nil {
			return nil, err
		}
		member.IsDeleted = deleted != 0
		member.Excerpt = excerpt(body, 80)
		members = append(members, member)
	}
	return members, rows.Err()
}

// Archive 封存项目：不删数据，导出与检索跳过。返回是否真的封存了。
func Archive(ctx context.Context, db *sql.DB, projectID string, now int64) (bool, error) {
	result, err := db.ExecContext(ctx, "UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL", now, now, projectID)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return changed > 0, nil
}

// ExportMarkdown 生成项目记忆包：项目说明 + 成员笔记全文 + 来源清单。
// 封存项目拒绝导出——不悄悄把旧上下文发出去。
func ExportMarkdown(ctx context.Context, db *sql.DB, projectID, exportDate string) (string, error) {
	var name, description string
	var archived sql.NullInt64
	err := db.QueryRowContext(ctx, "SELECT name,description,archived_at FROM projects WHERE id = ?", projectID).
		Scan(&name, &description, &archived)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errors.New("项目不存在")
	}
	if err != nil {
		return "", err
	}
	if archived.Valid {
		return "", fmt.Errorf("项目「%s」已封存——封存的项目不导出（避免旧上下文继续污染）。如需导出请先解除封存", name)
	}
	rows, err := db.QueryContext(ctx, "SELECT n.title,n.body_md,n.source_material_id FROM project_members pm"+
		" JOIN notes n ON n.id = pm.note_id WHERE pm.project_id = ? AND n.is_deleted = 0"+
		" ORDER BY pm.added_at ASC", projectID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	type exportedNote struct{ title, body, source string }
	notes := make([]exportedNote, 0)
	for rows.Next() {
		var note exportedNote
		var source sql.NullString
		if err := rows.Scan(&note.title, &note.body, &source); err != nil {
			return "", err
		}
		if source.Valid {
			note.source = source.String
		}
		notes = append(notes, note)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	var out strings.Builder
	fmt.Fprintf(&out, "# 项目：%s\n\n", name)
	if description != "" {
		fmt.Fprintf(&out, "%s\n\n", description)
	}
	fmt.Fprintf(&out, "导出时间：%s ｜ 成员笔记 %d 篇\n\n---\n\n", exportDate, len(notes))
	for i, note := range notes {
		fmt.Fprintf(&out, "## 笔记 %d：%s\n\n%s\n\n", i+1, note.title, note.body)
		if note.source != "" {
			fmt.Fprintf(&out, "（来源素材：%s，可在应用中回溯原文）\n\n", note.source)
		}
		out.WriteString("---\n\n")
	}
	return out.String(), nil
}

// excerpt 把正文压平成一行，再取前 limit 个字符（与 Rust 的 take(80) 一致）。
func excerpt(body string, limit int) string {
	flat := strings.Join(strings.Fields(body), " ")
	runes := []rune(flat)
	if len(runes) <= limit {
		return flat
	}
	return string(runes[:limit])
}

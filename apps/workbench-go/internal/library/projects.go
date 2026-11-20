package library

import (
	"context"
	"database/sql"
	"errors"

	"knowflick.local/workbench-go/internal/projects"
)

// ProjectSnapshot 是导出技能包用的一份快照：项目状态与成员笔记全文绑定在同一读事务里。
type ProjectSnapshot struct {
	Project projects.Project `json:"project"`
	Members []Note           `json:"members"`
}

func (l *Library) Projects(ctx context.Context, includeArchived bool) ([]projects.Project, error) {
	return projects.List(ctx, l.db, includeArchived)
}

func (l *Library) CreateProject(ctx context.Context, id, name, description string, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return projects.Create(ctx, l.db, id, name, description, now)
}

// ArchiveProject 封存项目；返回是否真的封存（已封存再封存为 false）。
func (l *Library) ArchiveProject(ctx context.Context, id string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return projects.Archive(ctx, l.db, id, now)
}

func (l *Library) AddProjectNote(ctx context.Context, projectID, noteID string, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return projects.AddNote(ctx, l.db, projectID, noteID, now)
}

func (l *Library) RemoveProjectNote(ctx context.Context, projectID, noteID string) error {
	if !l.writable {
		return ErrReadOnly
	}
	return projects.RemoveNote(ctx, l.db, projectID, noteID)
}

func (l *Library) ProjectMembers(ctx context.Context, projectID string) ([]projects.Member, error) {
	return projects.MemberList(ctx, l.db, projectID)
}

func (l *Library) ExportProjectMarkdown(ctx context.Context, projectID, exportDate string) (string, error) {
	return projects.ExportMarkdown(ctx, l.db, projectID, exportDate)
}

// ProjectExportSnapshot 绑定项目状态与未删除的成员笔记全文。
func (l *Library) ProjectExportSnapshot(ctx context.Context, projectID string) (ProjectSnapshot, error) {
	tx, err := l.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return ProjectSnapshot{}, err
	}
	defer tx.Rollback()
	var project projects.Project
	var archived sql.NullInt64
	err = tx.QueryRowContext(ctx, "SELECT id,name,description,created_at,updated_at,archived_at FROM projects WHERE id = ?", projectID).
		Scan(&project.ID, &project.Name, &project.Description, &project.CreatedAt, &project.UpdatedAt, &archived)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectSnapshot{}, errors.New("项目不存在")
	}
	if err != nil {
		return ProjectSnapshot{}, err
	}
	if archived.Valid {
		return ProjectSnapshot{}, errors.New("项目「" + project.Name + "」已封存，禁止导出技能包")
	}
	rows, err := tx.QueryContext(ctx, "SELECT "+noteColumns+" FROM notes n WHERE n.is_deleted = 0 AND n.id IN"+
		" (SELECT note_id FROM project_members WHERE project_id = ?) ORDER BY n.id", projectID)
	if err != nil {
		return ProjectSnapshot{}, err
	}
	defer rows.Close()
	members := make([]Note, 0)
	for rows.Next() {
		var note Note
		if err := scanNote(rows, &note); err != nil {
			return ProjectSnapshot{}, err
		}
		members = append(members, note)
	}
	if err := rows.Err(); err != nil {
		return ProjectSnapshot{}, err
	}
	return ProjectSnapshot{Project: project, Members: members}, nil
}

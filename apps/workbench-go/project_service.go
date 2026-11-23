package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"knowflick.local/workbench-go/internal/backupname"
	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/projects"
)

func (s *PreviewService) ListProjects(ctx context.Context, generation int, includeArchived bool) ([]projects.Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	items, err := s.current.Projects(ctx, includeArchived)
	if items == nil {
		items = []projects.Project{}
	}
	return items, err
}

// CreateProject 新建项目；标识由服务端生成。
func (s *PreviewService) CreateProject(ctx context.Context, generation int, name, description string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	id := uuid.NewString()
	return id, s.current.CreateProject(ctx, id, name, description, time.Now().UnixMilli())
}

// ArchiveProject 封存项目；返回是否真的封存了。
func (s *PreviewService) ArchiveProject(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.ArchiveProject(ctx, id, time.Now().UnixMilli())
}

func (s *PreviewService) AddProjectNote(ctx context.Context, generation int, projectID, noteID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.AddProjectNote(ctx, projectID, noteID, time.Now().UnixMilli())
}

func (s *PreviewService) RemoveProjectNote(ctx context.Context, generation int, projectID, noteID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.RemoveProjectNote(ctx, projectID, noteID)
}

func (s *PreviewService) ListProjectMembers(ctx context.Context, generation int, projectID string) ([]projects.Member, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ProjectMembers(ctx, projectID)
}

// ExportProjectMarkdown 生成项目记忆包；导出日期与 Rust 的日期标签同格式。
func (s *PreviewService) ExportProjectMarkdown(ctx context.Context, generation int, projectID string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	year, month, day := backupname.CivilFromDays(time.Now().UnixMilli() / 86400000)
	return s.current.ExportProjectMarkdown(ctx, projectID, fmt.Sprintf("%04d-%02d-%02d", year, month, day))
}

// ExportProjectSnapshot 取项目与成员笔记全文的同一读事务快照（技能包用）。
func (s *PreviewService) ExportProjectSnapshot(ctx context.Context, generation int, projectID string) (library.ProjectSnapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.ProjectSnapshot{}, errors.New("请重新打开资料库")
	}
	return s.current.ProjectExportSnapshot(ctx, projectID)
}

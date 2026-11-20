package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"knowflick.local/workbench-go/internal/library"
)

// PreviewService 是预览窗口的后端：默认只读，用户显式启用编辑后才可写。
type PreviewService struct {
	app         *application.App
	window      application.Window
	initialPath string
	mu          sync.RWMutex
	current     *library.Library
	path        string
	writable    bool
	generation  int
}

// LibraryView 是打开资料库后的返回：名称、代号与首页。
type LibraryView struct {
	Name       string       `json:"name"`
	Writable   bool         `json:"writable"`
	Generation int          `json:"generation"`
	Page       library.Page `json:"page"`
}

func (s *PreviewService) OpenInitialLibrary(ctx context.Context) (*LibraryView, error) {
	if s.initialPath == "" {
		return nil, nil
	}
	return s.open(ctx, s.initialPath, false)
}

// ChooseLibrary 打开另一个库：重新选择一律回到只读，避免「顺手」继承了写权限。
func (s *PreviewService) ChooseLibrary(ctx context.Context) (*LibraryView, error) {
	path, err := s.app.Dialog.OpenFile().AttachToWindow(s.window).SetTitle("选择 KnowFlick 资料库").AddFilter("SQLite 资料库", "*.db;*.sqlite;*.sqlite3").PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	return s.open(ctx, path, false)
}

// EnableEditing 以同一路径重新打开为可写。只读打开时写方法会拒绝，
// 所以「能不能写」由这一步显式决定，不是隐式默认。
func (s *PreviewService) EnableEditing(ctx context.Context) (*LibraryView, error) {
	s.mu.RLock()
	path := s.path
	s.mu.RUnlock()
	if path == "" {
		return nil, errors.New("请先打开资料库")
	}
	return s.open(ctx, path, true)
}

func (s *PreviewService) open(ctx context.Context, path string, writable bool) (*LibraryView, error) {
	var (
		next *library.Library
		err  error
	)
	if writable {
		next, err = library.OpenForWrite(ctx, path)
	} else {
		next, err = library.Open(ctx, path)
	}
	if err != nil {
		return nil, fmt.Errorf("打开资料库失败: %w", err)
	}
	page, err := next.List(ctx, 0)
	if err != nil {
		next.Close()
		return nil, fmt.Errorf("读取笔记失败: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil {
		s.current.Close()
	}
	s.current = next
	s.path = path
	s.writable = writable
	s.generation++
	return &LibraryView{Name: filepath.Base(filepath.Dir(path)) + " / " + filepath.Base(path), Writable: writable, Generation: s.generation, Page: page}, nil
}

// ListNotes 分页列笔记；代号不符说明界面拿的是旧库，直接拒绝而不是串库。
func (s *PreviewService) ListNotes(ctx context.Context, generation, offset int) (library.Page, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.Page{}, errors.New("请重新打开资料库")
	}
	if offset < 0 {
		return library.Page{}, errors.New("页码无效")
	}
	return s.current.List(ctx, offset)
}

// SearchNotes 检索；空查询退回列表。
func (s *PreviewService) SearchNotes(ctx context.Context, generation int, query string) (library.Page, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.Page{}, errors.New("请重新打开资料库")
	}
	return s.current.Search(ctx, query)
}

// SaveNote 保存一篇笔记。冲突不是错误信息泛化，而是明确说「已被别处改动」。
func (s *PreviewService) SaveNote(ctx context.Context, generation int, note library.Note, baseRevision int64) (library.SaveOutcome, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.SaveOutcome{}, errors.New("请重新打开资料库")
	}
	if !s.writable {
		return library.SaveOutcome{}, errors.New("当前是只读模式，请先点「启用编辑」")
	}
	if note.ID == "" {
		return library.SaveOutcome{}, errors.New("笔记缺少标识")
	}
	now := time.Now().UnixMilli()
	outcome, err := s.current.Upsert(ctx, note, baseRevision, now)
	var conflict *library.ConflictError
	if errors.As(err, &conflict) {
		return library.SaveOutcome{}, fmt.Errorf("这篇笔记已被别处改动（当前修订 %d），已刷新列表，请重试", conflict.CurrentRevision)
	}
	return outcome, err
}

// DeleteNote 把笔记移进回收站；索引同步移除。
func (s *PreviewService) DeleteNote(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	if !s.writable {
		return false, errors.New("当前是只读模式，请先点「启用编辑」")
	}
	return s.current.Delete(ctx, id, time.Now().UnixMilli())
}

func (s *PreviewService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil {
		return s.current.Close()
	}
	return nil
}

// ListDeletedNotes 列出回收站；代号不符直接拒绝。
func (s *PreviewService) ListDeletedNotes(ctx context.Context, generation, offset int) (library.Page, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.Page{}, errors.New("请重新打开资料库")
	}
	return s.current.ListDeleted(ctx, offset)
}

// RestoreNote 恢复一篇回收站笔记；恢复后索引立即回来。
func (s *PreviewService) RestoreNote(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	if !s.writable {
		return false, errors.New("当前是只读模式，请先点「启用编辑」")
	}
	return s.current.Restore(ctx, id)
}

package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"knowflick.local/workbench-go/internal/library"
)

type PreviewService struct {
	app         *application.App
	window      application.Window
	initialPath string
	mu          sync.RWMutex
	current     *library.Library
	generation  int
}

type LibraryView struct {
	Name       string       `json:"name"`
	Generation int          `json:"generation"`
	Page       library.Page `json:"page"`
}

func (s *PreviewService) OpenInitialLibrary(ctx context.Context) (*LibraryView, error) {
	if s.initialPath == "" {
		return nil, nil
	}
	return s.open(ctx, s.initialPath)
}

func (s *PreviewService) ChooseLibrary(ctx context.Context) (*LibraryView, error) {
	path, err := s.app.Dialog.OpenFile().AttachToWindow(s.window).SetTitle("选择 KnowFlick 资料库").AddFilter("SQLite 资料库", "*.db;*.sqlite;*.sqlite3").PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	return s.open(ctx, path)
}

func (s *PreviewService) open(ctx context.Context, path string) (*LibraryView, error) {
	next, err := library.Open(ctx, path)
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
	s.generation++
	return &LibraryView{Name: filepath.Base(filepath.Dir(path)) + " / " + filepath.Base(path), Generation: s.generation, Page: page}, nil
}

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

func (s *PreviewService) SearchNotes(ctx context.Context, generation int, query string) (library.Page, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.Page{}, errors.New("请重新打开资料库")
	}
	return s.current.Search(ctx, query)
}

func (s *PreviewService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil {
		return s.current.Close()
	}
	return nil
}

package main

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"knowflick.local/workbench-go/internal/library"
)

// ExportNoteMarkdown 把一篇笔记导出为 Markdown 文件，路径由系统保存对话框选择。
func (s *PreviewService) ExportNoteMarkdown(ctx context.Context, generation int, noteID string) (string, error) {
	s.mu.RLock()
	if s.current == nil || s.generation != generation {
		s.mu.RUnlock()
		return "", errors.New("请重新打开资料库")
	}
	note, err := s.current.NoteByID(ctx, noteID)
	s.mu.RUnlock()
	if err != nil {
		return "", err
	}
	name := library.SafeExportFileName(note.Title)
	path, err := s.app.Dialog.SaveFile().AttachToWindow(s.window).SetMessage("导出笔记为 Markdown").SetFilename(name).
		AddFilter("Markdown", "*.md").PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	if err := library.ExportTextFile(path, note.Body); err != nil {
		return "", err
	}
	return path, nil
}

// OpenURL 用系统默认浏览器打开 http/https 链接。
func (s *PreviewService) OpenURL(ctx context.Context, raw string) error {
	trimmed, err := safeBrowserURL(raw)
	if err != nil {
		return err
	}
	return s.app.Browser.OpenURL(trimmed)
}

func safeBrowserURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("只支持 http/https 链接")
	}
	return parsed.String(), nil
}

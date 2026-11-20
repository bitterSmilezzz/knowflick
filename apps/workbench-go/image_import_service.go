package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"knowflick.local/workbench-go/internal/library"
)

type ImageImportResult struct {
	ImportedIDs []string `json:"importedIds"`
	Skipped     int      `json:"skipped"`
	Failures    []string `json:"failures"`
}

// ImportImages 选择本机图片并逐个导入收件箱。
func (s *PreviewService) ImportImages(ctx context.Context, generation int) (ImageImportResult, error) {
	s.mu.RLock()
	err := s.checkImageImport(generation)
	s.mu.RUnlock()
	if err != nil {
		return ImageImportResult{}, err
	}
	paths, err := s.app.Dialog.OpenFile().AttachToWindow(s.window).SetTitle("选择要导入的图片").
		AddFilter("图片", "*.png;*.jpg;*.jpeg;*.webp;*.gif;*.heic").PromptForMultipleSelection()
	if err != nil || len(paths) == 0 {
		return ImageImportResult{}, err
	}
	return s.importImages(ctx, generation, paths)
}

func (s *PreviewService) importImages(ctx context.Context, generation int, paths []string) (ImageImportResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.checkImageImport(generation); err != nil {
		return ImageImportResult{}, err
	}
	var result ImageImportResult
	for _, path := range paths {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		id, err := s.current.ImportImage(ctx, filepath.Dir(s.path), path, time.Now().UnixMilli())
		switch {
		case err != nil:
			result.Failures = append(result.Failures, fmt.Sprintf("%s：%v", filepath.Base(path), err))
		case id == "":
			result.Skipped++
		default:
			result.ImportedIDs = append(result.ImportedIDs, id)
		}
	}
	return result, nil
}

// checkImageImport 在持有 s.mu 的情况下校验库代号和写权限。
func (s *PreviewService) checkImageImport(generation int) error {
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	if !s.writable {
		return library.ErrReadOnly
	}
	return nil
}

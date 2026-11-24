package main

import (
	"context"
	"errors"
	"path/filepath"

	"knowflick.local/workbench-go/internal/creds"
	"knowflick.local/workbench-go/internal/libfiles"
)

// libraryDir 是当前资料库所在目录；设置、历史、凭据都落在这里。
func (s *PreviewService) libraryDir() (string, error) {
	if s.current == nil || s.path == "" {
		return "", errors.New("请重新打开资料库")
	}
	return filepath.Dir(s.path), nil
}

func (s *PreviewService) requireGeneration(generation int) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return nil
}

// SaveSettings 写 settings.json（与桌面端同名同目录）。
func (s *PreviewService) SaveSettings(ctx context.Context, generation int, text string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	dir, err := s.libraryDir()
	if err != nil {
		return err
	}
	return libfiles.SaveSettings(dir, text)
}

// ReadSettings 读设置；没有文件返回空串。
func (s *PreviewService) ReadSettings(ctx context.Context, generation int) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	dir, err := s.libraryDir()
	if err != nil {
		return "", err
	}
	text, err := libfiles.ReadOptional(filepath.Join(dir, "settings.json"))
	if err != nil || text == nil {
		return "", err
	}
	return *text, nil
}

// BackfillMaterialFTS 为缺失全文索引的素材补建索引。
func (s *PreviewService) BackfillMaterialFTS(ctx context.Context, generation int) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return 0, errors.New("请重新打开资料库")
	}
	return s.current.BackfillMaterialFTS(ctx)
}

// SaveSearchHistory 写搜索历史。
func (s *PreviewService) SaveSearchHistory(ctx context.Context, generation int, text string) error {
	if err := s.requireGeneration(generation); err != nil {
		return err
	}
	dir, err := s.libraryDir()
	if err != nil {
		return err
	}
	return libfiles.SaveSearchHistory(dir, text)
}

// ReadSearchHistory 读搜索历史；没有文件返回空串。
func (s *PreviewService) ReadSearchHistory(ctx context.Context, generation int) (string, error) {
	if err := s.requireGeneration(generation); err != nil {
		return "", err
	}
	dir, err := s.libraryDir()
	if err != nil {
		return "", err
	}
	text, err := libfiles.ReadOptional(filepath.Join(dir, "search_history.json"))
	if err != nil || text == nil {
		return "", err
	}
	return *text, nil
}

// SaveImportReport 写最近一次导入的转换报告。
func (s *PreviewService) SaveImportReport(ctx context.Context, generation int, text string) error {
	if err := s.requireGeneration(generation); err != nil {
		return err
	}
	dir, err := s.libraryDir()
	if err != nil {
		return err
	}
	return libfiles.SaveImportReport(dir, text)
}

// ReadImportReport 读导入报告；没有报告返回 nil（界面显示「无报告」）。
func (s *PreviewService) ReadImportReport(ctx context.Context, generation int) (*string, error) {
	if err := s.requireGeneration(generation); err != nil {
		return nil, err
	}
	dir, err := s.libraryDir()
	if err != nil {
		return nil, err
	}
	return libfiles.ReadImportReport(dir)
}

// ReadAPIKey 读 AI 接口密钥；没有文件返回空串，不报错。
func (s *PreviewService) ReadAPIKey(ctx context.Context, generation int) (string, error) {
	if err := s.requireGeneration(generation); err != nil {
		return "", err
	}
	dir, err := s.libraryDir()
	if err != nil {
		return "", err
	}
	return creds.Read(dir, creds.APIKeyFile)
}

// WriteAPIKey 写 AI 接口密钥：原子写并把文件收紧为仅属主可读写。
func (s *PreviewService) WriteAPIKey(ctx context.Context, generation int, value string) error {
	if err := s.requireGeneration(generation); err != nil {
		return err
	}
	dir, err := s.libraryDir()
	if err != nil {
		return err
	}
	return creds.WriteAPIKey(dir, value)
}

// LibrarySignature 是给轮询用的内容签名：关键文件指纹串联，改动会变。
func (s *PreviewService) LibrarySignature(ctx context.Context, generation int) (string, error) {
	if err := s.requireGeneration(generation); err != nil {
		return "", err
	}
	dir, err := s.libraryDir()
	if err != nil {
		return "", err
	}
	return libfiles.LibrarySignature(dir), nil
}

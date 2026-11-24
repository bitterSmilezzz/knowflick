package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"knowflick.local/workbench-go/internal/archive"
	"knowflick.local/workbench-go/internal/libfiles"
)

// StoreSnapshot 是卡库目录里各 JSON 文件的快照，与 Rust StoreSnapshot 同形。
type StoreSnapshot struct {
	Dir           string  `json:"dir"`
	Cards         *string `json:"cards"`
	Backup        *string `json:"backup"`
	Backup2       *string `json:"backup2"`
	Settings      *string `json:"settings"`
	SearchHistory *string `json:"searchHistory"`
}

// libraryDirForGeneration 返回当前资料库目录；代号不符或未打开时报错。
func (s *PreviewService) libraryDirForGeneration(generation int) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	return filepath.Dir(s.path), nil
}

// LoadStore 读取资料库目录的 JSON 快照（cards.json 与两代备份、设置、搜索历史）。
func (s *PreviewService) LoadStore(ctx context.Context, generation int) (StoreSnapshot, error) {
	dir, err := s.libraryDirForGeneration(generation)
	if err != nil {
		return StoreSnapshot{}, err
	}
	files, err := libfiles.Read(dir)
	if err != nil {
		return StoreSnapshot{}, err
	}
	return StoreSnapshot{
		Dir: dir, Cards: files.Cards, Backup: files.Backup, Backup2: files.Backup2,
		Settings: files.Settings, SearchHistory: files.SearchHistory,
	}, nil
}

// SaveCardsJSON 保存 cards.json（带三代轮转）。
func (s *PreviewService) SaveCardsJSON(ctx context.Context, generation int, text string) error {
	dir, err := s.libraryDirForGeneration(generation)
	if err != nil {
		return err
	}
	return libfiles.SaveCards(dir, text)
}

// SaveSettingsJSON 保存 settings.json。
func (s *PreviewService) SaveSettingsJSON(ctx context.Context, generation int, text string) error {
	dir, err := s.libraryDirForGeneration(generation)
	if err != nil {
		return err
	}
	return libfiles.SaveSettings(dir, text)
}

// ReadImportArchiveFile 读用户选定的导入归档：ZIP（cards.json + settings.json）或纯文本。
func (s *PreviewService) ReadImportArchiveFile(ctx context.Context, path string) (archive.Payload, error) {
	if path == "" {
		return archive.Payload{}, errors.New("没有选择要导入的归档")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return archive.Payload{}, errors.New("无法读取所选归档")
	}
	return archive.Read(data)
}

// ExportArchive 把 cards.json 与净化后的 settings.json 打包成 ZIP 写到用户选定的路径。
func (s *PreviewService) ExportArchive(ctx context.Context, generation int, dest string) error {
	dir, err := s.libraryDirForGeneration(generation)
	if err != nil {
		return err
	}
	cardsText, err := s.current.CardsJSON(ctx, dir)
	if err != nil {
		return err
	}
	settingsText, err := libfiles.ReadOptional(filepath.Join(dir, "settings.json"))
	if err != nil {
		return err
	}
	settings := "{}"
	if settingsText != nil {
		settings = *settingsText
	}
	payload, err := archive.Write(cardsText, archive.StripSecretSettings(settings))
	if err != nil {
		return err
	}
	if parent := filepath.Dir(dest); parent != "." && parent != "" {
		if err := os.MkdirAll(parent, 0o755); err != nil {
			return errors.New("无法创建导出目录")
		}
	}
	return os.WriteFile(dest, payload, 0o644)
}

// ExportCardsJSONFile 只导出卡片数据（与 Android cards.json 同一线格式）。
func (s *PreviewService) ExportCardsJSONFile(ctx context.Context, generation int, dest string) error {
	dir, err := s.libraryDirForGeneration(generation)
	if err != nil {
		return err
	}
	cardsText, err := s.current.CardsJSON(ctx, dir)
	if err != nil {
		return err
	}
	if parent := filepath.Dir(dest); parent != "." && parent != "" {
		if err := os.MkdirAll(parent, 0o755); err != nil {
			return errors.New("无法创建导出目录")
		}
	}
	return os.WriteFile(dest, []byte(cardsText), 0o644)
}

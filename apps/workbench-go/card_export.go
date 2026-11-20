package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"knowflick.local/workbench-go/internal/archive"
	"knowflick.local/workbench-go/internal/creds"
	"knowflick.local/workbench-go/internal/libfiles"
)

// ExportCardsJSON 将当前库中的卡片保存为 Android 可读取的 JSON。
func (s *PreviewService) ExportCardsJSON(ctx context.Context, generation int) (string, error) {
	return s.promptCardExport(ctx, generation, "cards.json", "JSON 文件")
}

// ExportCardArchive 将当前库中的卡片与设置保存为 ZIP。
func (s *PreviewService) ExportCardArchive(ctx context.Context, generation int) (string, error) {
	return s.promptCardExport(ctx, generation, "knowflick-cards.zip", "ZIP 文件")
}

// ExportSystemBackup 将当前 SQLite 资料库和媒体文件保存为基础 .kfbackup。
// 导出不依赖内存界面状态：在只读事务里读取权威数据，避免漏掉没有打开过的笔记。
func (s *PreviewService) ExportSystemBackup(ctx context.Context, generation int) (string, error) {
	s.mu.RLock()
	current := s.current != nil && s.generation == generation
	path := s.path
	s.mu.RUnlock()
	if !current {
		return "", errors.New("请重新打开资料库")
	}
	dest, err := s.app.Dialog.SaveFile().AttachToWindow(s.window).
		SetFilename("knowflick.kfbackup").AddFilter("KnowFlick 备份", "*.kfbackup").PromptForSingleSelection()
	if err != nil || dest == "" {
		return "", err
	}
	return s.saveSystemBackup(ctx, generation, path, dest)
}

func (s *PreviewService) saveSystemBackup(ctx context.Context, generation int, source, dest string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	if !strings.EqualFold(filepath.Ext(dest), ".kfbackup") {
		return "", errors.New("请选择 .kfbackup 文件")
	}
	if info, err := os.Stat(dest); err == nil {
		from, err := os.Stat(source)
		if err != nil {
			return "", err
		}
		if os.SameFile(info, from) {
			return "", errors.New("导出文件不能覆盖当前资料库")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	temp, err := os.CreateTemp(filepath.Dir(dest), ".knowflick-backup-*.tmp")
	if err != nil {
		return "", fmt.Errorf("无法创建备份文件：%w", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := s.current.WriteSystemBackupV4(ctx, temp, filepath.Dir(source), time.Now()); err != nil {
		temp.Close()
		return "", err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return "", fmt.Errorf("备份没有写完整：%w", err)
	}
	if err := temp.Close(); err != nil {
		return "", fmt.Errorf("备份没有写完整：%w", err)
	}
	if err := os.Rename(tempName, dest); err != nil {
		return "", fmt.Errorf("无法保存备份文件：%w", err)
	}
	return dest, nil
}

func (s *PreviewService) promptCardExport(ctx context.Context, generation int, filename, filter string) (string, error) {
	s.mu.RLock()
	current := s.current != nil && s.generation == generation
	s.mu.RUnlock()
	if !current {
		return "", errors.New("请重新打开资料库")
	}
	extension := filepath.Ext(filename)
	dest, err := s.app.Dialog.SaveFile().AttachToWindow(s.window).
		SetFilename(filename).AddFilter(filter, "*"+extension).PromptForSingleSelection()
	if err != nil || dest == "" {
		return "", err
	}
	return s.saveCardExport(ctx, generation, dest, extension)
}

func (s *PreviewService) saveCardExport(ctx context.Context, generation int, dest, extension string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	if !strings.EqualFold(filepath.Ext(dest), extension) {
		return "", fmt.Errorf("请选择 %s 文件", extension)
	}
	if info, err := os.Stat(dest); err == nil {
		source, err := os.Stat(s.path)
		if err != nil {
			return "", err
		}
		if os.SameFile(info, source) {
			return "", errors.New("导出文件不能覆盖当前资料库")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	dir := filepath.Dir(s.path)
	text, err := s.current.CardsJSON(ctx, dir)
	if err != nil {
		return "", fmt.Errorf("读取卡片失败：%w", err)
	}
	data := []byte(text)
	if extension == ".zip" {
		data, err = packCardArchive(dir, text)
		if err != nil {
			return "", err
		}
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := creds.AtomicWrite(dest, data); err != nil {
		return "", fmt.Errorf("保存导出文件失败：%w", err)
	}
	return dest, nil
}

func packCardArchive(dir, cards string) ([]byte, error) {
	settings, err := libfiles.ReadOptional(filepath.Join(dir, "settings.json"))
	if err != nil {
		return nil, fmt.Errorf("读取设置失败：%w", err)
	}
	text := "{}"
	if settings != nil {
		text = *settings
	}
	return archive.Write(cards, text)
}

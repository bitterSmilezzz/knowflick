package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"knowflick.local/workbench-go/internal/errtext"
	"os"
	"path/filepath"
	"strings"
	"time"

	"knowflick.local/workbench-go/internal/archive"
	"knowflick.local/workbench-go/internal/creds"
	"knowflick.local/workbench-go/internal/libfiles"
	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/webdavbackup"
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
		return "", errtext.Wrap("无法创建备份文件", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := s.current.WriteSystemBackupV4(ctx, temp, filepath.Dir(source), time.Now()); err != nil {
		temp.Close()
		return "", err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return "", errtext.Wrap("备份没有写完整", err)
	}
	if err := temp.Close(); err != nil {
		return "", errtext.Wrap("备份没有写完整", err)
	}
	if err := os.Rename(tempName, dest); err != nil {
		return "", errtext.Wrap("无法保存备份文件", err)
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
		return "", errtext.Wrap("读取卡片失败", err)
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
		return "", errtext.Wrap("保存导出文件失败", err)
	}
	return dest, nil
}

func packCardArchive(dir, cards string) ([]byte, error) {
	settings, err := libfiles.ReadOptional(filepath.Join(dir, "settings.json"))
	if err != nil {
		return nil, errtext.Wrap("读取设置失败", err)
	}
	text := "{}"
	if settings != nil {
		text = *settings
	}
	return archive.Write(cards, text)
}

// RestoreSystemBackup 选择 .kfbackup，校验后用当前可写资料库恢复。
// 恢复是合并：同标识记录跳过或按冲突拒绝，不做覆盖。
func (s *PreviewService) RestoreSystemBackup(ctx context.Context, generation int) (library.CoreRestoreCounts, error) {
	var counts library.CoreRestoreCounts
	s.mu.RLock()
	current := s.current != nil && s.generation == generation && s.writable
	path := s.path
	s.mu.RUnlock()
	if !current {
		return counts, errors.New("请先启用编辑再恢复备份")
	}
	source, err := s.app.Dialog.OpenFile().AttachToWindow(s.window).SetTitle("选择 KnowFlick 备份").AddFilter("KnowFlick 备份", "*.kfbackup").PromptForSingleSelection()
	if err != nil || source == "" {
		return counts, err
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return counts, errtext.Wrap("无法读取备份文件", err)
	}
	backup, err := archive.ReadSystemBackup(data)
	if err != nil {
		return counts, err
	}
	dir := filepath.Dir(path)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation || !s.writable {
		return counts, errors.New("请重新打开资料库")
	}
	return s.current.RestoreCoreBackup(ctx, backup, dir)
}

// UploadBackupToWebDAV 从当前库生成备份并单向复制到 WebDAV。密码只用于本次请求；显式勾选后才写入凭据文件。
func (s *PreviewService) UploadBackupToWebDAV(ctx context.Context, generation int, baseURL, username, secret string, remember bool) (webdavbackup.Result, error) {
	var result webdavbackup.Result
	s.mu.RLock()
	current := s.current != nil && s.generation == generation
	path := s.path
	s.mu.RUnlock()
	if !current {
		return result, errors.New("请重新打开资料库")
	}
	var buffer bytes.Buffer
	s.mu.RLock()
	err := s.current.WriteSystemBackupV4(ctx, &buffer, filepath.Dir(path), time.Now())
	s.mu.RUnlock()
	if err != nil {
		return result, errtext.Wrap("生成备份失败", err)
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	result, err = webdavbackup.Upload(ctx, baseURL, username, secret, buffer.Bytes(), time.Now())
	if err != nil {
		return result, err
	}
	if remember && secret != "" {
		if err := creds.Write(filepath.Dir(path), "webdav.credential", secret); err != nil {
			return result, errtext.Wrap("备份已上传，但凭据未保存", err)
		}
	}
	return result, nil
}

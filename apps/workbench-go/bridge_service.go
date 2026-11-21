package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"knowflick.local/workbench-go/internal/library"
)

// GetNote 按标识读单篇笔记（共享前端 note_get 的等价入口）。
func (s *PreviewService) GetNote(ctx context.Context, generation int, id string) (*library.Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	note, err := s.current.NoteByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return &note, nil
}

// WriteTextFile 把内容写到用户指定路径（笔记导出用），父目录不存在时创建。
func (s *PreviewService) WriteTextFile(ctx context.Context, path, contents string) error {
	if path == "" {
		return errors.New("没有选择导出位置")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("无法创建导出目录：%w", err)
		}
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		return fmt.Errorf("写入导出文件失败：%w", err)
	}
	return nil
}

// SaveMaterial 新建一条收件箱素材（共享前端 db_save_material 的等价入口）。
func (s *PreviewService) SaveMaterial(ctx context.Context, generation int, title, text, sourceURL string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	return s.current.Capture(ctx, library.CaptureInput{Title: title, Text: text, URL: sourceURL}, time.Now().UnixMilli())
}

// RestoreKnowledgeBaseMembership 批量恢复知识库成员关系（共享前端 kb_restore_membership）。
func (s *PreviewService) RestoreKnowledgeBaseMembership(ctx context.Context, generation int, entries []library.MembershipRestoreEntry) ([]library.MembershipRestoreOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.RestoreMembership(ctx, entries)
}

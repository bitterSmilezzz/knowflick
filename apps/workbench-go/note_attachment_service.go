package main

import (
	"context"
	"errors"

	"knowflick.local/workbench-go/internal/library"
)

// ListMaterialAttachments 返回当前资料库中可插入笔记的素材附件。
func (s *PreviewService) ListMaterialAttachments(ctx context.Context, generation int) ([]library.MaterialAttachment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ListMaterialAttachments(ctx)
}

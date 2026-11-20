package main

import (
	"context"
	"errors"
	"path/filepath"
	"time"
)

// SaveInkMaterial 将手写笔迹保存为收件箱素材。
func (s *PreviewService) SaveInkMaterial(ctx context.Context, generation int, documentJSON string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	return s.current.SaveInk(ctx, filepath.Dir(s.path), documentJSON, time.Now().UnixMilli())
}

package main

import (
	"context"
	"errors"
	"time"

	"knowflick.local/workbench-go/internal/library"
)

// ListNoteHistory 按修订号倒序列出一篇笔记的历史；只要求库已打开。
func (s *PreviewService) ListNoteHistory(ctx context.Context, generation int, id string) ([]library.NoteRevisionSummary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.History(ctx, id)
}

// ReadNoteHistory 读一版历史正文；不存在返回 null，不当作错误。
func (s *PreviewService) ReadNoteHistory(ctx context.Context, generation int, id string, revision int64) (*library.NoteRevision, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ReadRevision(ctx, id, revision)
}

// RestoreNoteRevision 把某一版内容写回笔记：正文按新修订追加，历史不丢。
func (s *PreviewService) RestoreNoteRevision(ctx context.Context, generation int, id string, revision, baseRevision int64) (library.SaveOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return library.SaveOutcome{}, errors.New("请重新打开资料库")
	}
	return s.current.RestoreRevision(ctx, id, revision, baseRevision, time.Now().UnixMilli())
}

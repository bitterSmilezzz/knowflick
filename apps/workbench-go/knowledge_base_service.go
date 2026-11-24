package main

import (
	"context"
	"errors"
	"time"

	"knowflick.local/workbench-go/internal/library"
)

func (s *PreviewService) ReadKnowledgeBases(ctx context.Context, generation int) (library.KnowledgeBaseSnapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.KnowledgeBaseSnapshot{}, errors.New("请重新打开资料库")
	}
	return s.current.KnowledgeBases(ctx)
}

func (s *PreviewService) CreateKnowledgeBase(ctx context.Context, generation int, id, name, description string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.CreateKnowledgeBase(ctx, id, name, description, time.Now().UnixMilli())
}

func (s *PreviewService) SetKnowledgeBaseMembership(ctx context.Context, generation int, kbID, noteID string, member bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.SetKnowledgeBaseMembership(ctx, kbID, noteID, member, time.Now().UnixMilli())
}

func (s *PreviewService) SearchKnowledgeBaseNotes(ctx context.Context, generation int, kbID, query string) (library.Page, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.Page{}, errors.New("请重新打开资料库")
	}
	return s.current.SearchKnowledgeBaseNotes(ctx, kbID, query)
}

func (s *PreviewService) SearchKnowledgeBaseChunks(ctx context.Context, generation int, kbID, query string, limit int) ([]library.ChunkHit, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	if limit < 1 || limit > 200 {
		return nil, errors.New("命中条数无效")
	}
	return s.current.SearchKnowledgeBaseChunks(ctx, kbID, query, limit)
}

package main

import (
	"context"
	"errors"
	"time"

	"knowflick.local/workbench-go/internal/cards"
	"knowflick.local/workbench-go/internal/library"
)

func (s *PreviewService) BrowseCards(ctx context.Context, generation int, query string, offset int) (library.CardPage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.CardPage{}, errors.New("请重新打开资料库")
	}
	if offset < 0 {
		return library.CardPage{}, errors.New("页码无效")
	}
	return s.current.BrowseCards(ctx, query, offset)
}

func (s *PreviewService) SaveCardContent(ctx context.Context, generation int, card cards.EditableCard) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.SaveCardContent(ctx, card, time.Now().UnixMilli())
}

func (s *PreviewService) DeleteCardContent(ctx context.Context, generation int, id string, version int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.DeleteCardContent(ctx, id, version, time.Now().UnixMilli())
}

package main

import (
	"context"
	"errors"

	"knowflick.local/workbench-go/internal/library"
)

// SearchCardsVector 卡片向量召回。
func (s *PreviewService) SearchCardsVector(ctx context.Context, generation int, query []float32, provider, model string, limit int) ([]library.CardVectorHit, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.SearchCardsVector(ctx, query, provider, model, limit)
}

// SearchCardsHybrid 关键词 + 向量 RRF 融合。
func (s *PreviewService) SearchCardsHybrid(ctx context.Context, generation int, query string, queryEmbedding []float32, provider, model string, limit int) ([]library.HybridCardHit, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.SearchCardsHybrid(ctx, query, queryEmbedding, provider, model, limit)
}

// ListNoteChunkTexts 列出待向量化的笔记分块。
func (s *PreviewService) ListNoteChunkTexts(ctx context.Context, generation int, limit int64, provider, model string) ([]library.NoteChunkText, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ListNoteChunkTexts(ctx, limit, provider, model)
}

// SaveNoteChunkEmbeddings 写入分块向量。
func (s *PreviewService) SaveNoteChunkEmbeddings(ctx context.Context, generation int, items []library.NoteChunkEmbeddingItem, provider, model string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return 0, errors.New("请重新打开资料库")
	}
	return s.current.SaveNoteChunkEmbeddings(ctx, items, provider, model)
}

// SearchNoteChunksVector 块级向量召回。
func (s *PreviewService) SearchNoteChunksVector(ctx context.Context, generation int, query []float32, provider, model string, limit int) ([]library.ChunkHit, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.SearchNoteChunksVector(ctx, query, provider, model, limit)
}

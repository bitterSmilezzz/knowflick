package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"

	"knowflick.local/workbench-go/internal/cards"
	"knowflick.local/workbench-go/internal/libfiles"
	"knowflick.local/workbench-go/internal/reviewhistory"
)

type ReviewDeck struct {
	Cards        []cards.Card        `json:"cards"`
	Projects     map[string][]string `json:"projects"`
	SoundEnabled bool                `json:"soundEnabled"`
}

func (s *PreviewService) LoadReviewDeck(ctx context.Context, generation int) (ReviewDeck, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return ReviewDeck{}, errors.New("请重新打开资料库")
	}
	items, err := s.current.ReviewCards(ctx)
	if err != nil {
		return ReviewDeck{}, err
	}
	projects, err := s.current.ReviewProjects(ctx)
	if err != nil {
		return ReviewDeck{}, err
	}
	settings, err := libfiles.ReadOptional(filepath.Join(filepath.Dir(s.path), "settings.json"))
	if err != nil {
		return ReviewDeck{}, err
	}
	var preferences struct {
		SoundEnabled *bool `json:"soundEffectsEnabled"`
	}
	soundEnabled := true
	if settings != nil && json.Unmarshal([]byte(*settings), &preferences) == nil && preferences.SoundEnabled != nil {
		soundEnabled = *preferences.SoundEnabled
	}
	return ReviewDeck{Cards: items, Projects: projects, SoundEnabled: soundEnabled}, nil
}

func (s *PreviewService) ReadReviewHistoryPeriod(generation int, from, to int64) (reviewhistory.Snapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return reviewhistory.Snapshot{}, errors.New("请重新打开资料库")
	}
	return s.current.ReviewHistoryPeriod(from, to)
}

// RecordReview 接收**评分后的整张卡片**（前端持的就是它）并映射成学习字段。
//
// 线上参数名是 card：共享工作台在评分后把 next 列表里的那张卡连同事件一起发来，
// 它已经带了新的 review_count/last_reviewed_at/间隔等字段。早先这里只声明 state，
// 前端发来的 card 被丢弃、state 为空 → 真机上卡片评分数永远不落库。
func (s *PreviewService) RecordReview(ctx context.Context, generation int, card cards.Card, event reviewhistory.Event) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.RecordReview(ctx, reviewhistory.CardState{
		ID:             card.ID,
		ReviewCount:    card.ReviewCount,
		MasteryLevel:   card.MasteryLevel,
		LastReviewedAt: card.LastReviewedAt,
		Repetition:     card.Repetition,
		IntervalDays:   card.IntervalDays,
		EaseFactor:     card.EaseFactor,
		Stability:      card.Stability,
		Difficulty:     card.Difficulty,
	}, event)
}

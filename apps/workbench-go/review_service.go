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

func (s *PreviewService) RecordReview(ctx context.Context, generation int, state reviewhistory.CardState, event reviewhistory.Event) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.RecordReview(ctx, state, event)
}

package main

import (
	"context"
	"errors"
	"time"

	"knowflick.local/workbench-go/internal/stats"
)

func (s *PreviewService) GetStats(ctx context.Context, generation int) (stats.Stats, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return stats.Stats{}, errors.New("请重新打开资料库")
	}
	return s.current.Stats(ctx, time.Now().UnixMilli())
}

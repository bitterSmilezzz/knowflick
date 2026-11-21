package main

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"knowflick.local/workbench-go/internal/goals"
)

func (s *PreviewService) ListGoals(ctx context.Context, generation int) ([]goals.Goal, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.Goals(ctx)
}

// CreateGoal 新建目标；scope 为空串表示全局目标。
func (s *PreviewService) CreateGoal(ctx context.Context, generation int, title, criteria, scope string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	id := uuid.NewString()
	var project *string
	if scope != "" {
		project = &scope
	}
	return id, s.current.CreateGoal(ctx, id, title, criteria, project, time.Now().UnixMilli())
}

func (s *PreviewService) SetGoalScope(ctx context.Context, generation int, id, scope string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	var project *string
	if scope != "" {
		project = &scope
	}
	return s.current.SetGoalScope(ctx, id, project)
}

// LinkGoalEvidence 关联笔记或素材；kind 只接受 note / material。
func (s *PreviewService) LinkGoalEvidence(ctx context.Context, generation int, goalID, evidenceID, kind string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.LinkGoalEvidence(ctx, goalID, evidenceID, kind, time.Now().UnixMilli())
}

// GoalReview 取复盘周期内的目标与证据快照。
func (s *PreviewService) GoalReview(ctx context.Context, generation int, from, to int64) (goals.Snapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return goals.Snapshot{}, errors.New("请重新打开资料库")
	}
	return s.current.GoalReview(ctx, from, to)
}

// AchieveGoal 是用户显式确认达成——证据数量不参与判定。
func (s *PreviewService) AchieveGoal(ctx context.Context, generation int, id, reviewNote string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.AchieveGoal(ctx, id, reviewNote, time.Now().UnixMilli())
}

func (s *PreviewService) AbandonGoal(ctx context.Context, generation int, id, reviewNote string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.AbandonGoal(ctx, id, reviewNote, time.Now().UnixMilli())
}

package library

import (
	"context"

	"knowflick.local/workbench-go/internal/goals"
)

func (l *Library) Goals(ctx context.Context) ([]goals.Goal, error) {
	return goals.ListActive(ctx, l.db)
}

func (l *Library) CreateGoal(ctx context.Context, id, title, criteria string, scope *string, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return goals.Create(ctx, l.db, goals.CreateInput{ID: id, Title: title, DoneCriteria: criteria, Scope: scope}, now)
}

func (l *Library) SetGoalScope(ctx context.Context, id string, scope *string) error {
	if !l.writable {
		return ErrReadOnly
	}
	return goals.SetScope(ctx, l.db, id, scope)
}

func (l *Library) LinkGoalEvidence(ctx context.Context, goalID, evidenceID, kind string, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return goals.LinkEvidence(ctx, l.db, goalID, evidenceID, kind, now)
}

func (l *Library) GoalReview(ctx context.Context, from, to int64) (goals.Snapshot, error) {
	return goals.ReviewSnapshot(ctx, l.db, from, to)
}

func (l *Library) AchieveGoal(ctx context.Context, id, reviewNote string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return goals.Achieve(ctx, l.db, id, reviewNote, now)
}

func (l *Library) AbandonGoal(ctx context.Context, id, reviewNote string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return goals.Abandon(ctx, l.db, id, reviewNote, now)
}

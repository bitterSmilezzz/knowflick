package main

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"knowflick.local/workbench-go/internal/profile"
)

// AddClaim 新建画像断言；证据标识由调用方给，服务端生成断言标识。
func (s *PreviewService) AddClaim(ctx context.Context, generation int, kind, content string, evidenceIDs []string, scope string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	if evidenceIDs == nil {
		evidenceIDs = []string{}
	}
	encoded, err := json.Marshal(evidenceIDs)
	if err != nil {
		return "", errors.New("证据标识序列化失败")
	}
	id := uuid.NewString()
	claim := profile.Claim{ID: id, Kind: kind, Content: content, EvidenceJSON: string(encoded), Scope: scope}
	return id, s.current.AddClaim(ctx, claim, time.Now().UnixMilli())
}

func (s *PreviewService) ListClaims(ctx context.Context, generation int, mode string, now int64) ([]profile.Claim, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	switch mode {
	case "all":
		return s.current.AllClaims(ctx)
	case "global":
		return s.current.ClaimAnswers(ctx, now)
	case "project":
		return nil, errors.New("项目范围查询需要项目标识")
	}
	return s.current.Claims(ctx, now)
}

// ListProjectClaims 只列所选活跃项目的记忆。
func (s *PreviewService) ListProjectClaims(ctx context.Context, generation int, projectID string) ([]profile.Claim, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ClaimProjectAnswers(ctx, time.Now().UnixMilli(), projectID)
}

func (s *PreviewService) ListClaimDenials(ctx context.Context, generation int) ([]profile.Denial, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ClaimDenials(ctx)
}

func (s *PreviewService) ConfirmClaim(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.ConfirmClaim(ctx, id, time.Now().UnixMilli())
}

func (s *PreviewService) PauseClaim(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.PauseClaim(ctx, id)
}

func (s *PreviewService) ResumeClaim(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.ResumeClaim(ctx, id)
}

// DenyClaim 否认断言并阻止同源重建。
func (s *PreviewService) DenyClaim(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.DenyClaim(ctx, id, time.Now().UnixMilli())
}

func (s *PreviewService) DeleteClaim(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.DeleteClaim(ctx, id, time.Now().UnixMilli())
}

// ClearClaimDenial 允许某证据源重新被学习。
func (s *PreviewService) ClearClaimDenial(ctx context.Context, generation int, evidenceIDs []string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	encoded, err := json.Marshal(evidenceIDs)
	if err != nil {
		return false, errors.New("证据标识序列化失败")
	}
	return s.current.ClearClaimDenial(ctx, string(encoded))
}

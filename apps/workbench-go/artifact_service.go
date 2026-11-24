package main

import (
	"context"
	"errors"
	"time"

	"knowflick.local/workbench-go/internal/artifacts"
)

func (s *PreviewService) ListArtifacts(ctx context.Context, generation, limit, offset int) ([]artifacts.Artifact, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	if offset < 0 {
		return nil, errors.New("页码无效")
	}
	return s.current.ListArtifacts(ctx, limit, offset)
}

func (s *PreviewService) GetArtifact(ctx context.Context, generation int, id string) (*artifacts.Artifact, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.GetArtifact(ctx, id)
}

func (s *PreviewService) SaveArtifact(ctx context.Context, generation int, artifact artifacts.Artifact) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	if artifact.CreatedAt == 0 {
		artifact.CreatedAt = time.Now().UnixMilli()
	}
	artifact.UpdatedAt = time.Now().UnixMilli()
	return s.current.SaveArtifact(ctx, artifact)
}

func (s *PreviewService) DeleteArtifact(ctx context.Context, generation int, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.DeleteArtifact(ctx, id, time.Now().UnixMilli())
}

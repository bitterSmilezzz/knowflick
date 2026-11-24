package library

import (
	"context"

	"knowflick.local/workbench-go/internal/artifacts"
)

func (l *Library) ListArtifacts(ctx context.Context, limit, offset int) ([]artifacts.Artifact, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	return artifacts.List(ctx, l.db, limit, offset)
}

func (l *Library) GetArtifact(ctx context.Context, id string) (*artifacts.Artifact, error) {
	return artifacts.Get(ctx, l.db, id)
}

// SaveArtifact 新增或更新产物；更新复位删除标记，与桌面端同语义。
func (l *Library) SaveArtifact(ctx context.Context, artifact artifacts.Artifact) error {
	if !l.writable {
		return ErrReadOnly
	}
	return artifacts.Save(ctx, l.db, artifact)
}

// DeleteArtifact 软删除产物：保留「依据这些卡片生成」的痕迹。
func (l *Library) DeleteArtifact(ctx context.Context, id string, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return artifacts.Delete(ctx, l.db, id, now)
}

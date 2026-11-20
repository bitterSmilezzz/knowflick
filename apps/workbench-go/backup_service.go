package main

import (
	"context"
	"encoding/json"
	"errors"

	"knowflick.local/workbench-go/internal/library"
)

// CaptureDatabaseSnapshot 采集整个资料库的备份快照（backup_capture_database）。
func (s *PreviewService) CaptureDatabaseSnapshot(ctx context.Context, generation int) (library.DatabaseBackupSnapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.DatabaseBackupSnapshot{}, errors.New("请重新打开资料库")
	}
	return s.current.CaptureDatabaseSnapshot(ctx)
}

// RestoreBackupMaterial 恢复一条素材（backup_restore_material）。
func (s *PreviewService) RestoreBackupMaterial(ctx context.Context, generation int, protected bool, fingerprint *string, material library.BackupMaterialDTO) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.RestoreMaterial(ctx, protected, fingerprint, library.BackupMaterialFromDTO(material))
}

// RestoreBackupArtifact 恢复一条产物（backup_restore_artifact）。
func (s *PreviewService) RestoreBackupArtifact(ctx context.Context, generation int, artifact json.RawMessage) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.RestoreArtifactJSON(ctx, artifact)
}

// ValidateR4Destination 校验目标库能否接收项目与画像快照。
func (s *PreviewService) ValidateR4Destination(ctx context.Context, generation int, snapshot json.RawMessage) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.ValidateR4Destination(ctx, snapshot)
}

// RestoreR4Snapshot 恢复项目与画像快照（backup_restore_r4）。
func (s *PreviewService) RestoreR4Snapshot(ctx context.Context, generation int, snapshot json.RawMessage) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return 0, errors.New("请重新打开资料库")
	}
	return s.current.RestoreR4Snapshot(ctx, snapshot)
}

// ValidateSubscriptionDestination 校验订阅快照目标。
func (s *PreviewService) ValidateSubscriptionDestination(ctx context.Context, generation int, snapshot json.RawMessage) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.ValidateSubscriptionDestination(ctx, snapshot)
}

// RestoreSubscriptionSnapshot 恢复订阅快照（backup_restore_subscriptions）。
func (s *PreviewService) RestoreSubscriptionSnapshot(ctx context.Context, generation int, snapshot json.RawMessage) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return 0, errors.New("请重新打开资料库")
	}
	return s.current.RestoreSubscriptionSnapshot(ctx, snapshot)
}

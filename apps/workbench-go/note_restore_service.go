package main

import (
	"context"
	"errors"

	"knowflick.local/workbench-go/internal/library"
)

// RestoreNoteSnapshot 恢复一篇笔记（backup_restore_note）。
func (s *PreviewService) RestoreNoteSnapshot(ctx context.Context, generation int, note library.Note, revision int64, protected bool, fingerprint *string) (library.RestoreOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return library.RestoreOutcome{}, errors.New("请重新打开资料库")
	}
	var binding *string
	if protected {
		binding = fingerprint
	}
	return s.current.RestoreNoteWithHistory(ctx, note, revision, binding, nil)
}

// RestoreNoteSnapshotWithHistory 恢复笔记及其历史（backup_restore_note_history）。
func (s *PreviewService) RestoreNoteSnapshotWithHistory(ctx context.Context, generation int, note library.Note, revision int64, protected bool, fingerprint *string, history []library.BackupNoteRevisionDTO) (library.RestoreOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return library.RestoreOutcome{}, errors.New("请重新打开资料库")
	}
	var binding *string
	if protected {
		binding = fingerprint
	}
	items := make([]library.BackupNoteRevisionDTO, 0, len(history))
	items = append(items, history...)
	return s.current.RestoreNoteWithHistoryDTO(ctx, note, revision, binding, items)
}

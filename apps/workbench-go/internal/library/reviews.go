package library

import (
	"context"

	"knowflick.local/workbench-go/internal/cards"
	"knowflick.local/workbench-go/internal/reviewhistory"
)

func (l *Library) ReviewCards(ctx context.Context) ([]cards.Card, error) {
	return cards.List(ctx, l.db, -1, 0)
}

// ReviewProjects returns nil when the library predates project membership.
func (l *Library) ReviewProjects(ctx context.Context) (map[string][]string, error) {
	var hasMembers bool
	if err := l.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'project_members')").Scan(&hasMembers); err != nil || !hasMembers {
		return nil, err
	}
	rows, err := l.db.QueryContext(ctx, `SELECT DISTINCT n.source_material_id, pm.project_id
		FROM project_members pm JOIN notes n ON n.id = pm.note_id
		WHERE n.is_deleted = 0 AND n.source_material_id IS NOT NULL
		AND EXISTS (SELECT 1 FROM cards c WHERE c.is_deleted = 0 AND c.material_id = n.source_material_id)
		ORDER BY n.source_material_id, pm.project_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := make(map[string][]string)
	for rows.Next() {
		var materialID, projectID string
		if err := rows.Scan(&materialID, &projectID); err != nil {
			return nil, err
		}
		projects[materialID] = append(projects[materialID], projectID)
	}
	return projects, rows.Err()
}

func (l *Library) ReviewHistoryPeriod(from, to int64) (reviewhistory.Snapshot, error) {
	return reviewhistory.Period(l.db, from, to)
}

func (l *Library) RecordReview(ctx context.Context, state reviewhistory.CardState, event reviewhistory.Event) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return reviewhistory.Record(ctx, l.db, state, event)
}

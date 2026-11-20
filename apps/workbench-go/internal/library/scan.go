package library

import "database/sql"

// scanNote 按 noteColumns 的顺序扫一行。
func scanNote(rows *sql.Rows, note *Note) error {
	return rows.Scan(&note.ID, &note.Title, &note.Body, &note.Notebook, &note.TagsJSON,
		&note.Pinned, &note.Favorite, &note.ArchivedAt, &note.SourceMaterialID, &note.Revision,
		&note.CreatedAt, &note.UpdatedAt, &note.Deleted, &note.DeletedAt, &note.ExcludeFromProfile)
}

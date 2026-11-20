package library

import (
	"context"
)

// BackfillMaterialFTS 为缺失全文索引的未删除素材补建索引，返回补上的条数。
// 与 Rust backfill_material_fts 同口径：只补缺，不重建已有条目。
func (l *Library) BackfillMaterialFTS(ctx context.Context) (int, error) {
	if !l.writable {
		return 0, ErrReadOnly
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT m.id, m.title, m.raw_text, COALESCE(m.source_url, '') "+
		"FROM materials m LEFT JOIN fts_materials f ON f.material_id = m.id "+
		"WHERE m.is_deleted = 0 AND f.material_id IS NULL")
	if err != nil {
		return 0, err
	}
	type missingMaterial struct {
		id, title, text, sourceURL string
	}
	var missing []missingMaterial
	for rows.Next() {
		var item missingMaterial
		if err := rows.Scan(&item.id, &item.title, &item.text, &item.sourceURL); err != nil {
			rows.Close()
			return 0, err
		}
		missing = append(missing, item)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, item := range missing {
		if _, err := tx.ExecContext(ctx, "INSERT INTO fts_materials (material_id, title, raw_text, source_url) VALUES (?,?,?,?)",
			item.id, item.title, item.text, item.sourceURL); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(missing), nil
}

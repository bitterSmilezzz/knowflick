package library

import (
	"context"
	"database/sql"
	"encoding/binary"
	"math"
	"sort"
)

// NoteChunkText 是待向量化的一块笔记正文。
type NoteChunkText struct {
	NoteID          string `json:"noteId"`
	ChunkIndex      int64  `json:"chunkIndex"`
	Content         string `json:"content"`
	ContentRevision int64  `json:"contentRevision"`
}

// ListNoteChunkTexts 列出还没有当前引擎向量的笔记分块（修订号不匹配也算缺）。
func (l *Library) ListNoteChunkTexts(ctx context.Context, limit int64, provider, model string) ([]NoteChunkText, error) {
	rows, err := l.db.QueryContext(ctx,
		"SELECT n.note_id, n.chunk_index, n.content, n.content_revision "+
			"FROM note_chunks n JOIN notes n2 ON n2.id = n.note_id "+
			"WHERE n2.is_deleted = 0 AND NOT EXISTS ( "+
			"SELECT 1 FROM note_chunk_embeddings e "+
			"WHERE e.note_id = n.note_id AND e.chunk_index = n.chunk_index "+
			"AND e.content_revision = n.content_revision AND e.provider = ? AND e.model = ?) "+
			"ORDER BY n2.updated_at DESC, n.note_id, n.chunk_index LIMIT ?",
		provider, model, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]NoteChunkText, 0)
	for rows.Next() {
		var item NoteChunkText
		if err := rows.Scan(&item.NoteID, &item.ChunkIndex, &item.Content, &item.ContentRevision); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// NoteChunkEmbeddingItem 是要写入的一块向量。
type NoteChunkEmbeddingItem struct {
	NoteID          string    `json:"noteId"`
	ChunkIndex      int64     `json:"chunkIndex"`
	ContentRevision int64     `json:"contentRevision"`
	Embedding       []float32 `json:"embedding"`
}

// SaveNoteChunkEmbeddings 写入分块向量；写入前核对修订号，过期的条目被跳过。
func (l *Library) SaveNoteChunkEmbeddings(ctx context.Context, items []NoteChunkEmbeddingItem, provider, model string) (int, error) {
	if !l.writable {
		return 0, ErrReadOnly
	}
	saved := 0
	for _, item := range items {
		if len(item.Embedding) == 0 {
			continue
		}
		bytes := make([]byte, len(item.Embedding)*4)
		for i, value := range item.Embedding {
			binary.LittleEndian.PutUint32(bytes[i*4:], math.Float32bits(value))
		}
		result, err := l.db.ExecContext(ctx,
			"INSERT INTO note_chunk_embeddings (note_id, chunk_index, dim, embedding, provider, model, content_revision, updated_at) "+
				"SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%s','now') "+
				"FROM note_chunks n JOIN notes n2 ON n2.id = n.note_id "+
				"WHERE n.note_id = ?1 AND n.chunk_index = ?2 AND n.content_revision = ?7 AND n2.is_deleted = 0 "+
				"ON CONFLICT(note_id, chunk_index) DO UPDATE SET dim = excluded.dim, embedding = excluded.embedding, "+
				"provider = excluded.provider, model = excluded.model, content_revision = excluded.content_revision, updated_at = excluded.updated_at",
			item.NoteID, item.ChunkIndex, len(item.Embedding), bytes, provider, model, item.ContentRevision)
		if err != nil {
			return saved, err
		}
		if changed, err := result.RowsAffected(); err == nil && changed > 0 {
			saved++
		}
	}
	return saved, nil
}

// SearchNoteChunksVector 块级向量召回：命中块带父笔记标题与原文偏移。
// 只比同一 (provider, model, dim) 且修订号与分块一致的向量。
func (l *Library) SearchNoteChunksVector(ctx context.Context, query []float32, provider, model string, limit int) ([]ChunkHit, error) {
	if len(query) == 0 || limit <= 0 {
		return []ChunkHit{}, nil
	}
	rows, err := l.db.QueryContext(ctx,
		"SELECT e.note_id, e.chunk_index, e.embedding, n.content, n.char_start, n.char_end, n2.title "+
			"FROM note_chunk_embeddings e "+
			"JOIN note_chunks n ON n.note_id = e.note_id AND n.chunk_index = e.chunk_index "+
			"JOIN notes n2 ON n2.id = e.note_id "+
			"WHERE n2.is_deleted = 0 AND e.dim = ? AND e.provider = ? AND e.model = ? "+
			"AND e.content_revision = n.content_revision",
		len(query), provider, model)
	if err != nil {
		return nil, err
	}
	type scoredHit struct {
		hit   ChunkHit
		score float32
	}
	hits := make([]scoredHit, 0, 64)
	for rows.Next() {
		var hit ChunkHit
		var bytes []byte
		if err := rows.Scan(&hit.NoteID, &hit.ChunkIndex, &bytes, &hit.Content, &hit.CharStart, &hit.CharEnd, &hit.NoteTitle); err != nil {
			rows.Close()
			return nil, err
		}
		if len(bytes)%4 != 0 {
			continue
		}
		vector := make([]float32, len(bytes)/4)
		for i := range vector {
			vector[i] = math.Float32frombits(binary.LittleEndian.Uint32(bytes[i*4:]))
		}
		hits = append(hits, scoredHit{hit, cosine32(query, vector)})
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	if len(hits) > limit {
		hits = hits[:limit]
	}
	out := make([]ChunkHit, 0, len(hits))
	for _, entry := range hits {
		out = append(out, entry.hit)
	}
	return out, nil
}

var _ = sql.ErrNoRows

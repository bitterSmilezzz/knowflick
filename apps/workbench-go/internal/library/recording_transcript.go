package library

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf16"
)

type RecordingSource struct {
	Path        string
	Version     int64
	Transcribed bool
}

// RecordingSource identifies the audio and revision used for local transcription.
func (l *Library) RecordingSource(ctx context.Context, id string) (RecordingSource, error) {
	var source RecordingSource
	var metadata string
	err := l.db.QueryRowContext(ctx, "SELECT COALESCE(media_path, ''), version, metadata_json FROM materials WHERE id = ? AND source_type = 'audio' AND is_deleted = 0", id).
		Scan(&source.Path, &source.Version, &metadata)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && source.Path == "") {
		return RecordingSource{}, errors.New("找不到这条素材的录音附件")
	}
	if err != nil {
		return RecordingSource{}, err
	}
	var details recordingMetadata
	if err := json.Unmarshal([]byte(metadata), &details); err != nil {
		return RecordingSource{}, errors.New("录音素材的元数据无效")
	}
	source.Transcribed = details.Transcribed
	return source, nil
}

// SaveRecordingTranscript updates the source metadata, searchable text and title together.
func (l *Library) SaveRecordingTranscript(ctx context.Context, id string, source RecordingSource, text string, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("转写内容为空")
	}
	title := transcriptTitle(text)
	sum := sha256.Sum256([]byte(text))
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE materials SET title = ?, raw_text = ?, content_hash = ?,
		metadata_json = json_set(metadata_json, '$.transcript', ?, '$.transcribed', json('true')),
		updated_at = ?, version = version + 1
		WHERE id = ? AND source_type = 'audio' AND is_deleted = 0 AND version = ? AND media_path = ?`,
		title, text, hex.EncodeToString(sum[:]), text, now, id, source.Version, source.Path)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed != 1 {
		return errors.New("转写期间录音素材已变动，请刷新后重试")
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM fts_materials WHERE material_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO fts_materials (material_id, title, raw_text, source_url)
		SELECT id, title, raw_text, COALESCE(source_url, '') FROM materials WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func transcriptTitle(text string) string {
	first, _, _ := strings.Cut(text, "\n")
	first = strings.TrimSpace(first)
	units := utf16.Encode([]rune(first))
	if len(units) <= 80 {
		return first
	}
	end := 80
	if units[end-1] >= 0xd800 && units[end-1] <= 0xdbff {
		end--
	}
	return string(utf16.Decode(units[:end])) + "…"
}

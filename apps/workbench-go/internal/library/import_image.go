package library

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"knowflick.local/workbench-go/internal/media"
)

// ImportImage 导入原图与素材记录。同名同大小的现有图片返回空 ID。
func (l *Library) ImportImage(ctx context.Context, dir, path string, now int64) (string, error) {
	if !l.writable {
		return "", ErrReadOnly
	}
	name := filepath.Base(path)
	ext := filepath.Ext(name)
	mime := imageMIME(ext)
	if mime == "" {
		return "", errors.New("请选择 PNG、JPEG、WebP、GIF 或 HEIC 图片")
	}
	data, err := readImportImage(path)
	if err != nil {
		return "", err
	}
	metadata, err := json.Marshal(map[string]string{"mime": mime, "fileName": name})
	if err != nil {
		return "", err
	}
	body := "（图片素材：" + name + "）"
	title := strings.TrimSpace(strings.TrimSuffix(name, ext))
	if title == "" {
		title = body
	}
	material := ImportedMaterial{
		ID: uuid.NewString(), SourceType: "image", Title: title, RawText: body,
		MetadataJSON: string(metadata), InboxStatus: "inbox", CreatedAt: now, UpdatedAt: now,
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	// 先写入未提交的记录，取得 SQLite 的写事务，再查重，避免并发导入重复图片。
	inserted, err := insertImportedMaterial(ctx, tx, material)
	if err != nil {
		return "", err
	}
	if !inserted {
		return "", errors.New("素材标识冲突，请重试")
	}
	var duplicate bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM materials "+
		"WHERE id <> ? AND is_deleted = 0 AND source_type = 'image' AND media_size_bytes = ? "+
		"AND json_extract(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, '$.fileName') = ?)",
		material.ID, len(data), name).Scan(&duplicate); err != nil {
		return "", err
	}
	if duplicate {
		return "", nil
	}
	err = commitMaterialAttachment(ctx, tx, material.ID, dir, "image", mime, data)
	if err != nil {
		return "", err
	}
	return material.ID, nil
}

func readImportImage(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("无法读取所选图片")
	}
	if info.Size() > media.MaxImage {
		return nil, errors.New("图片超过 16 MB 上限")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, errors.New("无法打开所选图片")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, media.MaxImage+1))
	if err != nil {
		return nil, errors.New("无法读取所选图片")
	}
	if len(data) > media.MaxImage {
		return nil, errors.New("图片超过 16 MB 上限")
	}
	if len(data) == 0 {
		return nil, errors.New("所选图片是空文件")
	}
	return data, nil
}

func imageMIME(extension string) string {
	switch strings.ToLower(extension) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".heic":
		return "image/heic"
	default:
		return ""
	}
}

package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"knowflick.local/workbench-go/internal/media"
)

type inkPoint struct {
	X *float64 `json:"x"`
	Y *float64 `json:"y"`
}

type inkStroke struct {
	Points []inkPoint `json:"points"`
	Width  float64    `json:"width"`
	Color  string     `json:"color"`
}

type inkDocument struct {
	Version int         `json:"version"`
	Width   float64     `json:"width"`
	Height  float64     `json:"height"`
	Strokes []inkStroke `json:"strokes"`
}

// SaveInk 保存笔迹原件、素材和全文索引，关联失败时清理本次落盘的附件。
func (l *Library) SaveInk(ctx context.Context, dir, documentJSON string, now int64) (string, error) {
	if !l.writable {
		return "", ErrReadOnly
	}
	if len(documentJSON) > media.MaxInk {
		return "", errors.New("笔迹附件超过 8 MB 上限")
	}
	document := []byte(documentJSON)
	var ink inkDocument
	if err := json.Unmarshal(document, &ink); err != nil || ink.Version != 1 || ink.Width <= 0 || ink.Height <= 0 {
		return "", errors.New("笔迹文档格式无效")
	}
	if len(ink.Strokes) == 0 {
		return "", errors.New("还没有落笔。写几个字再保存")
	}
	for _, stroke := range ink.Strokes {
		if len(stroke.Points) < 2 || stroke.Width < 0.0005 || stroke.Width > 0.05 ||
			(stroke.Color != "ink" && stroke.Color != "accent" && stroke.Color != "muted") {
			return "", errors.New("笔画格式无效")
		}
		for _, point := range stroke.Points {
			if !validInkCoordinate(point.X) || !validInkCoordinate(point.Y) {
				return "", errors.New("笔迹坐标无效")
			}
		}
	}
	date := time.UnixMilli(now)
	count := len(ink.Strokes)
	title := fmt.Sprintf("手写笔记 · %d月%d日（%d 笔）", int(date.Month()), date.Day(), count)
	metadata, err := json.Marshal(map[string]any{"ink": json.RawMessage(document), "savedInline": false})
	if err != nil {
		return "", err
	}
	material := ImportedMaterial{
		ID: uuid.NewString(), SourceType: "ink", Title: title,
		RawText:      fmt.Sprintf("%s\n\n（手写笔记，%d 笔；笔迹以附件保存，可在阅读区重看。）", title, count),
		MetadataJSON: string(metadata), InboxStatus: "inbox", CreatedAt: now, UpdatedAt: now,
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	inserted, err := insertImportedMaterial(ctx, tx, material)
	if err != nil {
		return "", err
	}
	if !inserted {
		return "", errors.New("素材标识冲突，请重试")
	}
	if err := commitMaterialAttachment(ctx, tx, material.ID, dir, "ink", "application/json", document); err != nil {
		return "", err
	}
	return material.ID, nil
}

func validInkCoordinate(value *float64) bool {
	return value != nil && *value >= 0 && *value <= 1
}

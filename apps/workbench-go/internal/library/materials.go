package library

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"

	"knowflick.local/workbench-go/internal/archive"
	"knowflick.local/workbench-go/internal/errtext"
	"knowflick.local/workbench-go/internal/materials"
)

func (l *Library) ListMaterials(ctx context.Context, inboxOnly bool, limit, offset int) ([]materials.Material, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	return materials.List(ctx, l.db, inboxOnly, limit, offset)
}

func (l *Library) ListEmailMaterials(ctx context.Context) ([]materials.Material, error) {
	return materials.ListEmail(ctx, l.db)
}

func (l *Library) GetMaterial(ctx context.Context, id string) (*materials.Material, error) {
	return materials.ByID(ctx, l.db, id)
}

// SaveMailDigest 保存摘要和生成时的来源顺序，沿用素材与全文索引的事务。
func (l *Library) SaveMailDigest(ctx context.Context, title, markdown, metadataJSON string, now int64) (string, error) {
	if !l.writable {
		return "", ErrReadOnly
	}
	title, markdown = strings.TrimSpace(title), strings.TrimSpace(markdown)
	if title == "" || markdown == "" {
		return "", errors.New("邮件摘要缺少标题或正文")
	}
	if !json.Valid([]byte(metadataJSON)) {
		return "", errors.New("邮件摘要来源格式无效")
	}
	id := uuid.NewString()
	inserted, err := SaveImportedMaterial(ctx, l.db, ImportedMaterial{
		ID: id, SourceType: "email-digest", Title: title, RawText: markdown,
		MetadataJSON: metadataJSON, InboxStatus: "inbox", CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		return "", err
	}
	if !inserted {
		return "", errors.New("素材标识冲突，请重试")
	}
	return id, nil
}

func (l *Library) SearchMaterials(ctx context.Context, query string, limit int) ([]materials.Material, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	return materials.Search(ctx, l.db, query, limit)
}

// UpsertMaterial 按共享前端的素材形状落库：同 id 已存在就更新，不存在就插入。
//
// 共享工作台的录音、图片与手写都走这条路径——附件相对路径、字节数与元数据
// 必须一起写进素材行，否则音频文件落盘了却挂不到素材上（Rust 时期的 save_material
// 就是按整条 DTO 写的，Go 版一度只传标题正文，把附件字段丢了）。
func (l *Library) UpsertMaterial(ctx context.Context, material materials.Material) (string, error) {
	if !l.writable {
		return "", ErrReadOnly
	}
	if material.ID == "" || strings.TrimSpace(material.RawText) == "" {
		return "", errors.New("素材缺少标识或正文")
	}
	if !json.Valid([]byte(material.MetadataJSON)) {
		return "", errors.New("素材元数据格式无效")
	}
	switch material.InboxStatus {
	case "inbox", "processed", "dismissed":
	default:
		return "", errors.New("素材状态无效")
	}
	sum := sha256.Sum256([]byte(material.RawText))
	hash := hex.EncodeToString(sum[:])
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return "", errtext.Wrap("无法开始保存素材", err)
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, "INSERT INTO materials (id,source_type,title,source_url,raw_text,cleaned_markdown,content_hash,media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at,version,is_deleted) "+
		"VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,0) ON CONFLICT(id) DO UPDATE SET "+
		"source_type=excluded.source_type,title=excluded.title,source_url=excluded.source_url,raw_text=excluded.raw_text,"+
		"cleaned_markdown=excluded.cleaned_markdown,content_hash=excluded.content_hash,media_path=excluded.media_path,"+
		"media_size_bytes=excluded.media_size_bytes,metadata_json=excluded.metadata_json,inbox_status=excluded.inbox_status,"+
		"updated_at=excluded.updated_at,version=materials.version+1,is_deleted=0",
		material.ID, material.SourceType, material.Title, nullablePointer(material.SourceURL), material.RawText,
		nullablePointer(material.CleanedMarkdown), hash, material.MediaPath, material.MediaSizeBytes,
		material.MetadataJSON, material.InboxStatus, material.CreatedAt, material.UpdatedAt)
	if err != nil {
		return "", errtext.Wrap("保存素材失败", err)
	}
	// fts_materials 是 FTS5 虚表，没有主键约束，不能用 ON CONFLICT upsert：
	// 先删旧索引行再按素材行重建（与 recording_transcript 同做法）。
	if _, err := tx.ExecContext(ctx, "DELETE FROM fts_materials WHERE material_id = ?", material.ID); err != nil {
		return "", errtext.Wrap("更新素材索引失败", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO fts_materials (material_id,title,raw_text,source_url) "+
		"SELECT id, title, raw_text, COALESCE(source_url, '') FROM materials WHERE id = ?", material.ID); err != nil {
		return "", errtext.Wrap("保存素材索引失败", err)
	}
	if err := tx.Commit(); err != nil {
		return "", errtext.Wrap("保存素材失败", err)
	}
	return material.ID, nil
}

// nullablePointer 把可空文本列还原成 nil 或字符串。
func nullablePointer(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func (l *Library) UpdateMaterialStatus(ctx context.Context, id, status string, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return materials.UpdateStatus(ctx, l.db, id, status, now)
}

// ConvertMaterialToCard 把素材转成卡片并标为已处理；同一事务提交。
func (l *Library) ConvertMaterialToCard(ctx context.Context, materialID, cardID string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return materials.ConvertToCard(ctx, l.db, materialID, cardID, now)
}

// MaterialAttachment 是可写进笔记正文的库内素材附件。
type MaterialAttachment struct {
	Path  string `json:"path"`
	Title string `json:"title"`
}

func (l *Library) ListMaterialAttachments(ctx context.Context) ([]MaterialAttachment, error) {
	rows, err := l.db.QueryContext(ctx, "SELECT media_path, title FROM materials "+
		"WHERE is_deleted = 0 AND media_path IS NOT NULL AND media_path <> '' ORDER BY created_at DESC, id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]MaterialAttachment, 0)
	seen := make(map[string]struct{})
	for rows.Next() {
		var item MaterialAttachment
		if err := rows.Scan(&item.Path, &item.Title); err != nil {
			return nil, err
		}
		if !archive.IsSystemMediaPath(item.Path) {
			continue
		}
		if _, exists := seen[item.Path]; exists {
			continue
		}
		seen[item.Path] = struct{}{}
		items = append(items, item)
	}
	return items, rows.Err()
}

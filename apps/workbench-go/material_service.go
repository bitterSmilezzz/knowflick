package main

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"knowflick.local/workbench-go/internal/materials"
)

// ListMaterials 列出素材；inboxOnly 为 true 时只看收件箱。
func (s *PreviewService) ListMaterials(ctx context.Context, generation int, inboxOnly bool, limit, offset int) ([]materials.Material, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	if offset < 0 {
		return nil, errors.New("页码无效")
	}
	return s.current.ListMaterials(ctx, inboxOnly, limit, offset)
}

// SearchMaterials 检索素材：全文索引优先，连续中文等用子串回退。
func (s *PreviewService) SearchMaterials(ctx context.Context, generation int, query string, limit int) ([]materials.Material, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.SearchMaterials(ctx, query, limit)
}

// UpdateMaterialStatus 调整收件箱状态（inbox / processed / dismissed）。
func (s *PreviewService) UpdateMaterialStatus(ctx context.Context, generation int, id, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.UpdateMaterialStatus(ctx, id, status, time.Now().UnixMilli())
}

// ConvertMaterialToCard 转卡并标为已处理；返回是否新建了卡片。
func (s *PreviewService) ConvertMaterialToCard(ctx context.Context, generation int, materialID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.ConvertMaterialToCard(ctx, materialID, uuid.NewString(), time.Now().UnixMilli())
}

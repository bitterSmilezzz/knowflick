package main

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"knowflick.local/workbench-go/internal/httpx"
	"knowflick.local/workbench-go/internal/library"
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

// CaptureMaterial 新建一条收件箱素材（闪念/剪贴），返回素材标识。
func (s *PreviewService) CaptureMaterial(ctx context.Context, generation int, title, text, sourceURL string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	return s.current.Capture(ctx, library.CaptureInput{Title: title, Text: text, URL: sourceURL}, time.Now().UnixMilli())
}

// FetchClipPage 抓取网页原文（HTML/正文），由前端 digest 抽取后再入库。
func (s *PreviewService) FetchClipPage(ctx context.Context, generation int, url string) (httpx.ClipPage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return httpx.ClipPage{}, errors.New("请重新打开资料库")
	}
	return httpx.FetchClip(ctx, url)
}

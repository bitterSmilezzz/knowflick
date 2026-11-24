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

// ListEmailMaterials 读取共享邮箱页所需的邮件原件。
func (s *PreviewService) ListEmailMaterials(ctx context.Context, generation int) ([]materials.Material, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ListEmailMaterials(ctx)
}

// GetMaterial 按标识打开原件，支持不在素材列表首屏的引用。
func (s *PreviewService) GetMaterial(ctx context.Context, generation int, id string) (*materials.Material, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.GetMaterial(ctx, id)
}

// SaveMailDigest 将用户确认的邮件摘要保存到素材库。
func (s *PreviewService) SaveMailDigest(ctx context.Context, generation int, title, markdown, metadataJSON string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	return s.current.SaveMailDigest(ctx, title, markdown, metadataJSON, time.Now().UnixMilli())
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

// CaptureCapsuleMaterial 写入当前资料库的收件箱。胶囊与主窗口共享编辑权限。
func (s *PreviewService) CaptureCapsuleMaterial(ctx context.Context, text string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || !s.writable {
		return "", errors.New("请先在主窗口打开资料库并启用编辑")
	}
	return s.current.Capture(ctx, library.CaptureInput{Text: text}, time.Now().UnixMilli())
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

// EnsureNoteFromMaterial 把素材转成笔记（幂等）；返回笔记标识与是否新建。
func (s *PreviewService) EnsureNoteFromMaterial(ctx context.Context, generation int, materialID string) (library.SaveOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return library.SaveOutcome{}, errors.New("请重新打开资料库")
	}
	return s.current.EnsureNoteFromMaterial(ctx, materialID, time.Now().UnixMilli())
}

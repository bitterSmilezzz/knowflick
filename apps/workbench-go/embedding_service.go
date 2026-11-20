package main

import (
	"context"
	"errors"

	"knowflick.local/workbench-go/internal/dataroot"
	"knowflick.local/workbench-go/internal/embed"
	"knowflick.local/workbench-go/internal/httpx"
)

// SaveCardEmbedding 写入一张卡片的向量。
func (s *PreviewService) SaveCardEmbedding(ctx context.Context, generation int, cardID string, vector []float32, provider, model string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.SaveCardEmbedding(ctx, cardID, vector, provider, model)
}

// SaveCardEmbeddingsBatch 批量写向量（同一事务）。
func (s *PreviewService) SaveCardEmbeddingsBatch(ctx context.Context, generation int, items []embed.Item, provider, model string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	return s.current.SaveCardEmbeddingBatch(ctx, items, provider, model)
}

// ListUnembeddedCardIDs 列出还没有向量的卡片。
func (s *PreviewService) ListUnembeddedCardIDs(ctx context.Context, generation int, limit int64) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ListUnembeddedCards(ctx, limit)
}

// ListStaleEmbeddingCardIDs 列出身份不匹配、需要重算的卡片。
func (s *PreviewService) ListStaleEmbeddingCardIDs(ctx context.Context, generation int, dim int64, provider, model string, limit int64) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ListStaleEmbeddingCards(ctx, dim, provider, model, limit)
}

// RequestEmbeddings 调用 OpenAI 兼容的 embeddings 接口。
func (s *PreviewService) RequestEmbeddings(ctx context.Context, endpoint, apiKey, model string, input []string) ([][]float32, error) {
	return httpx.RequestEmbeddings(ctx, endpoint, apiKey, model, input)
}

// LocalEmbedStatus 是本地语义模型的安装状态。
func (s *PreviewService) LocalEmbedStatus(ctx context.Context) (embed.LocalStatus, error) {
	return embed.Status(dataroot.Dir()), nil
}

// LocalEmbed 给出本地向量。Go 端没有 ONNX 运行时（与 asr 同理，避免把 C++ 构建链搬回来），
// 这里走与网页端完全一致的确定性哈希投影（128 维，identity = hash/char-ngram-128），
// 与 Rust 的 fastembed（384 维）不在同一向量空间——换引擎时旧向量按维度判过期重算。
func (s *PreviewService) LocalEmbed(ctx context.Context, texts []string, isQuery bool) ([][]float32, error) {
	vectors := make([][]float32, 0, len(texts))
	for _, text := range texts {
		values := embed.HashEmbedding(text, embed.HashDim)
		vector := make([]float32, len(values))
		for index, value := range values {
			vector[index] = float32(value)
		}
		vectors = append(vectors, vector)
	}
	return vectors, nil
}

// RebuildHashEmbeddings 给未嵌入的卡片补一组哈希向量（预览端的一键补全入口）。
func (s *PreviewService) RebuildHashEmbeddings(ctx context.Context, generation int, limit int64) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return 0, errors.New("请重新打开资料库")
	}
	return s.current.RebuildHashEmbeddings(ctx, limit)
}

// LocalEmbedWarmUp 预热本地语义模型：下载后真跑一次推理，确保「下载完成」等于
// 「能用」（与 Rust local_embed_warm_up 同语义）。Go 端没有 ONNX 运行时，
// 无法真跑 fastembed；这里按模型缓存状态给出诚实结果——权重缺失时报错并
// 指引下载途径，权重存在时报告状态。语义向量的生成由 LocalEmbed 的哈希投影承担。
func (s *PreviewService) LocalEmbedWarmUp(ctx context.Context) (embed.LocalStatus, error) {
	root := dataroot.Dir()
	status := embed.Status(root)
	if !status.Downloaded {
		return status, embed.ErrNotDownloaded
	}
	return status, nil
}

// LocalEmbedStrict 是检索路径的嵌入入口：模型没下载时明确拒绝（与 Rust
// local_embed 的 allow_download=false 同语义），由界面提示去设置里下载。
func (s *PreviewService) LocalEmbedStrict(ctx context.Context, texts []string, isQuery bool) ([][]float32, error) {
	if err := embed.RequireModel(dataroot.Dir()); err != nil {
		return nil, err
	}
	return s.LocalEmbed(ctx, texts, isQuery)
}

package main

import (
	"context"
	"errors"

	"knowflick.local/workbench-go/internal/httpx"
)

// CompleteChat 代理 OpenAI 兼容 / Anthropic 的对话请求；密钥只在内存中转发，不落盘。
func (s *PreviewService) CompleteChat(ctx context.Context, generation int, endpoint, apiKey, body string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	if len(body) > 2*1024*1024 {
		return "", errors.New("问答请求超过 2 MB 上限")
	}
	return httpx.ChatComplete(ctx, endpoint, apiKey, body)
}

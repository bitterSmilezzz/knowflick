package main

import (
	"context"
	"errors"
	"path/filepath"
	"time"

	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/mcpgrants"
)

// CreateMcpGrant 签发外部连接授权：明文令牌只在返回值里出现一次。
func (s *PreviewService) CreateMcpGrant(ctx context.Context, generation int, request mcpgrants.Request) (mcpgrants.CreatedGrant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return mcpgrants.CreatedGrant{}, errors.New("请重新打开资料库")
	}
	return s.current.CreateMcpGrant(ctx, request, time.Now().UnixMilli())
}

func (s *PreviewService) ListMcpGrants(ctx context.Context, generation int) ([]mcpgrants.Grant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	return s.current.ListMcpGrants(ctx)
}

func (s *PreviewService) RevokeMcpGrant(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	return s.current.RevokeMcpGrant(ctx, id, time.Now().UnixMilli())
}

// McpServerPaths 给外部客户端配置用的脚本与库目录绝对路径。
func (s *PreviewService) McpServerPaths(ctx context.Context, generation int) (library.McpServerPaths, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.McpServerPaths{}, errors.New("请重新打开资料库")
	}
	return library.ResolveMcpServerPaths(filepath.Dir(s.path)), nil
}

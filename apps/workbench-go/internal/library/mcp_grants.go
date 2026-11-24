package library

import (
	"context"
	"os"
	"path/filepath"

	"knowflick.local/workbench-go/internal/mcpgrants"
)

// McpServerPaths 是给外部客户端的配置入口：必须指向存在的绝对路径。
type McpServerPaths struct {
	ScriptPath   string `json:"scriptPath"`
	LibraryDir   string `json:"libraryDir"`
	ScriptExists bool   `json:"scriptExists"`
}

func (l *Library) CreateMcpGrant(ctx context.Context, request mcpgrants.Request, now int64) (mcpgrants.CreatedGrant, error) {
	if !l.writable {
		return mcpgrants.CreatedGrant{}, ErrReadOnly
	}
	return mcpgrants.Create(ctx, l.db, request, now)
}

func (l *Library) ListMcpGrants(ctx context.Context) ([]mcpgrants.Grant, error) {
	return mcpgrants.List(ctx, l.db)
}

func (l *Library) RevokeMcpGrant(ctx context.Context, id string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return mcpgrants.Revoke(ctx, l.db, id, now)
}

// McpServerPaths 给出脚本与库目录的绝对入口：入口不存在时 script_exists 为 false。
// 解析顺序与桌面端一致：可执行文件同级 → 当前目录 → 相对路径兜底。
// ResolveMcpServerPaths 解析给外部客户端用的脚本与库目录入口。
func ResolveMcpServerPaths(libraryDir string) McpServerPaths {
	paths := McpServerPaths{LibraryDir: libraryDir}
	var candidates []string
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(executable), "tools", "mcp-server.mjs"))
	}
	if working, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(working, "tools", "mcp-server.mjs"))
	}
	candidates = append(candidates, filepath.Join("tools", "mcp-server.mjs"))
	for _, candidate := range candidates {
		absolute, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		accessPath := filepath.Join(filepath.Dir(absolute), "mcp-access.mjs")
		exists, statErr := os.Stat(absolute)
		if statErr == nil && exists != nil && fileExists(accessPath) {
			paths.ScriptPath = absolute
			paths.ScriptExists = true
			return paths
		}
		if paths.ScriptPath == "" {
			paths.ScriptPath = absolute
		}
	}
	paths.ScriptExists = false
	return paths
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info != nil
}

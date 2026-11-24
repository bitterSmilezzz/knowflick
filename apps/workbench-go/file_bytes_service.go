package main

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// SaveFileBytes 把前端生成的字节写到用户选定的路径（备份包导出用）。
//
// 桌面壳里没有浏览器下载：Blob + <a download> 在 WebView 中不会落盘。
// 备份包由共享层生成（含检索历史等快照），所以由前端传字节、Go 只负责落盘。
func (s *PreviewService) SaveFileBytes(dest, dataB64 string) (string, error) {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return "", errors.New("请选择保存位置")
	}
	if !filepath.IsAbs(dest) {
		return "", errors.New("保存路径必须是绝对路径")
	}
	data, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return "", errors.New("导出内容不是有效的 base64")
	}
	if len(data) == 0 {
		return "", errors.New("导出内容为空")
	}
	parent := filepath.Dir(dest)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return "", errors.New("无法创建导出目录")
	}
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return "", errors.New("无法写入导出文件")
	}
	return dest, nil
}

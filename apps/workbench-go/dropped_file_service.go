package main

import (
	"context"
	"encoding/base64"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// maxDroppedFileBytes 是原生拖放进来的单文件上限（32 MiB，与文本导入一致）。
const maxDroppedFileBytes = 32 * 1024 * 1024

// DroppedFile 是原生拖放文件的内容与名字。
//
// 为什么需要它：macOS 原生拖放给的是**路径**，而浏览器的 File 对象在
// WebView 里拿不到真实路径（只有文件名与字节）。共享前端的导入流程要的是
// 「文件名 + 字节」，所以原生侧读出内容再交给前端，导入流程就能一条道走通。
type DroppedFile struct {
	Name string `json:"name"`
	// Text 是文本文件的 UTF-8 内容（文本类文件有值）。
	Text string `json:"text"`
	// DataB64 是二进制文件的 base64 内容（二进制类文件有值）。
	DataB64 string `json:"dataB64"`
	// Size 是文件字节数。
	Size int64 `json:"size"`
	// Mime 是按扩展名推断的 MIME（前端拿不到真实类型）。
	Mime string `json:"mime"`
}

// collectDroppedFiles 读一批拖入的文件；读不了的跳过并记录，不让一个坏文件
// 拖掉整批（用户拖了 5 个文件，1 个是无权限的目录，其余仍应导入）。
func (s *PreviewService) collectDroppedFiles(paths []string) []DroppedFile {
	out := make([]DroppedFile, 0, len(paths))
	for _, path := range paths {
		item, err := s.ReadDroppedFile(context.Background(), path)
		if err != nil {
			log.Printf("读取拖入的文件失败：%v", err)
			continue
		}
		out = append(out, item)
	}
	return out
}

// ReadDroppedFile 按路径读一个被拖进窗口的文件。
//
// 路径来自用户自己的拖放动作，不是外部输入，但仍然只接受常规文件，
// 不跟随符号链接指向的设备/管道——那类读法会挂起。
func (s *PreviewService) ReadDroppedFile(ctx context.Context, path string) (DroppedFile, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return DroppedFile{}, errors.New("没有可读取的文件")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return DroppedFile{}, errors.New("无法读取拖入的文件")
	}
	if info.Size() > maxDroppedFileBytes {
		return DroppedFile{}, errors.New("文件超过 32 MiB")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return DroppedFile{}, errors.New("无法读取拖入的文件")
	}
	out := DroppedFile{
		Name: filepath.Base(path),
		Size: int64(len(data)),
		Mime: droppedFileMime(filepath.Base(path)),
	}
	if utf8.Valid(data) && !isBinaryExtension(out.Name) {
		out.Text = string(data)
		return out, nil
	}
	out.DataB64 = base64.StdEncoding.EncodeToString(data)
	return out, nil
}

// isBinaryExtension 列出按扩展名判定为二进制的类型。
//
// 判定按扩展名而不是内容探测：UTF-8 合法但其实是二进制（.docx/.pdf 都是
// zip 容器）时，按内容判断会把乱码当文本交给前端。
func isBinaryExtension(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".docx", ".pptx", ".pdf", ".zip", ".kfbackup", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".mp3", ".mp4", ".m4a", ".webm":
		return true
	}
	return false
}

// droppedFileMime 按扩展名给一个可用的 MIME。
func droppedFileMime(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".markdown":
		return "text/markdown"
	case ".txt":
		return "text/plain"
	case ".json":
		return "application/json"
	case ".eml":
		return "message/rfc822"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case ".pdf":
		return "application/pdf"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".heic":
		return "image/heic"
	}
	return "application/octet-stream"
}

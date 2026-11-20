// Package media 管笔记附件：文件只写进 <library>/media/<kind>/，路径始终相对库目录。
package media

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	MaxAudio = 64 * 1024 * 1024
	MaxInk   = 8 * 1024 * 1024
	MaxImage = 16 * 1024 * 1024
)

// Save 新写入一个附件，返回相对库目录的路径。原子落盘并读回大小校验。
func Save(dir, kind, mime string, bytes []byte) (string, error) {
	ext, err := extension(kind, mime)
	if err != nil {
		return "", err
	}
	limit := limitOf(kind)
	if len(bytes) == 0 {
		return "", errors.New("没有内容可保存：录音或笔迹是空的")
	}
	if len(bytes) > limit {
		return "", fmt.Errorf("附件超过 %d MB 上限", limit/1024/1024)
	}
	folder := filepath.Join(dir, "media", kind)
	if err := os.MkdirAll(folder, 0755); err != nil {
		return "", errors.New("无法创建附件目录")
	}
	name, err := randomName()
	if err != nil {
		return "", err
	}
	name += "." + ext
	target := filepath.Join(folder, name)
	temp := filepath.Join(folder, "."+name+".part")
	if err := writeSynced(temp, bytes); err != nil {
		_ = os.Remove(temp)
		return "", errors.New("无法写入附件")
	}
	if err := os.Rename(temp, target); err != nil {
		_ = os.Remove(temp)
		return "", errors.New("无法写入附件")
	}
	info, err := os.Stat(target)
	if err != nil || info.Size() != int64(len(bytes)) {
		_ = os.Remove(target)
		return "", errors.New("附件没有写完整，已丢弃这次写入")
	}
	return filepath.ToSlash(filepath.Join("media", kind, name)), nil
}

// Read 读回附件；拒绝任何跑出 media 目录的路径。
func Read(dir, relative string) ([]byte, error) {
	path, err := safePath(dir, relative)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, errors.New("附件不存在")
	}
	if info.Size() > MaxAudio {
		return nil, errors.New("附件过大，无法读取")
	}
	return os.ReadFile(path)
}

// safePath 逐段校验，拒绝绝对路径、反斜杠、空段、. 与 ..；最后必须仍在 media 下。
func safePath(dir, relative string) (string, error) {
	if relative == "" || strings.HasPrefix(relative, "/") || strings.Contains(relative, "\\") {
		return "", errors.New("附件路径无效")
	}
	resolved := filepath.Clean(filepath.Join(dir, filepath.FromSlash(relative)))
	mediaRoot := filepath.Clean(filepath.Join(dir, "media"))
	rel, err := filepath.Rel(mediaRoot, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("附件路径无效")
	}
	for _, part := range strings.Split(relative, "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("附件路径无效")
		}
	}
	return resolved, nil
}

func writeSynced(path string, bytes []byte) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Write(bytes); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	return nil
}

func randomName() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:], nil
}

func limitOf(kind string) int {
	switch kind {
	case "audio":
		return MaxAudio
	case "image":
		return MaxImage
	default:
		return MaxInk
	}
}

func extension(kind, mime string) (string, error) {
	switch kind + "|" + mime {
	case "audio|audio/webm":
		return "webm", nil
	case "audio|audio/ogg":
		return "ogg", nil
	case "audio|audio/mp4":
		return "m4a", nil
	case "audio|audio/wav", "audio|audio/x-wav":
		return "wav", nil
	case "ink|application/json":
		return "json", nil
	case "image|image/png":
		return "png", nil
	case "image|image/jpeg":
		return "jpg", nil
	case "image|image/webp":
		return "webp", nil
	case "image|image/gif":
		return "gif", nil
	case "image|image/heic":
		return "heic", nil
	default:
		return "", errors.New("不支持的附件类型")
	}
}

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

// Restore 从备份恢复一个附件并**保持原相对路径**（笔记正文里的引用不能失效）。
// 与 Rust 的 restore_media 同义：路径严格校验、目录拒绝符号链接、
// 同路径已有同内容视为幂等成功、不同内容一律不覆盖，硬链接原子发布。
func Restore(dir, relative string, bytes []byte) (string, error) {
	parts := strings.Split(relative, "/")
	if len(parts) != 3 || parts[0] != "media" || !validKind(parts[1]) ||
		!validFileName(parts[2]) {
		return "", errors.New("备份附件路径无效")
	}
	ext := strings.ToLower(parts[2][strings.LastIndex(parts[2], ".")+1:])
	if !strings.Contains(parts[2], ".") || !allowedExt(parts[1], ext) {
		return "", errors.New("备份附件类型与路径不匹配")
	}
	if len(bytes) == 0 || len(bytes) > limitOf(parts[1]) {
		return "", errors.New("备份附件为空或超过大小上限")
	}
	root := filepath.Join(dir, "media")
	folder := filepath.Join(root, parts[1])
	for _, path := range []string{dir, root, folder} {
		if err := os.MkdirAll(path, 0755); err != nil {
			return "", errors.New("无法创建备份附件目录")
		}
		info, err := os.Lstat(path)
		if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", errors.New("备份附件目录无效或为符号链接")
		}
	}
	target := filepath.Join(folder, parts[2])
	same, err := existingMatches(target, bytes)
	if err != nil {
		return "", err
	}
	if same {
		return relative, nil
	}
	name, err := randomName()
	if err != nil {
		return "", err
	}
	temp := filepath.Join(folder, "."+name+".part")
	result := func() error {
		f, err := os.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if err != nil {
			return errors.New("无法暂存备份附件")
		}
		if _, err := f.Write(bytes); err != nil {
			f.Close()
			return errors.New("无法写入备份附件")
		}
		if err := f.Sync(); err != nil {
			f.Close()
			return errors.New("无法写入备份附件")
		}
		if err := f.Close(); err != nil {
			return errors.New("无法写入备份附件")
		}
		if err := os.Link(temp, target); err != nil {
			same, again := existingMatches(target, bytes)
			if again != nil || !same {
				return errors.New("无法安全放置备份附件")
			}
		}
		return nil
	}()
	_ = os.Remove(temp)
	if result != nil {
		return "", result
	}
	return relative, nil
}

func validKind(kind string) bool {
	return kind == "audio" || kind == "image" || kind == "ink"
}

func validFileName(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	for _, b := range []byte(name) {
		if !(b >= '0' && b <= '9') && !(b >= 'a' && b <= 'z') && !(b >= 'A' && b <= 'Z') &&
			b != '.' && b != '_' && b != '-' {
			return false
		}
	}
	return true
}

func allowedExt(kind, ext string) bool {
	switch kind {
	case "audio":
		return ext == "webm" || ext == "ogg" || ext == "m4a" || ext == "wav"
	case "image":
		return ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "webp" || ext == "gif" || ext == "heic" || ext == "heif"
	case "ink":
		return ext == "json"
	}
	return false
}

// existingMatches 对同路径已有文件采取保守口径：只有普通文件且字节完全相同才算成功。
func existingMatches(path string, bytes []byte) (bool, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, errors.New("无法检查已有附件，未覆盖")
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return false, errors.New("本地附件路径不是普通文件，未覆盖")
	}
	if info.Size() != int64(len(bytes)) {
		return false, errors.New("本地同路径附件内容不同，未覆盖")
	}
	existing, err := os.ReadFile(path)
	if err != nil {
		return false, errors.New("无法读取已有附件，未覆盖")
	}
	if !bytesEqual(existing, bytes) {
		return false, errors.New("本地同路径附件内容不同，未覆盖")
	}
	return true, nil
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

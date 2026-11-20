// Package libfiles 迁自 Rust store.rs 的 JSON 文件读写：卡片轮转、设置、报告。
//
// 与原实现一致的口径：
//   - 所有写入都走原子写（临时文件 + Sync + Rename），不留半截文件；
//   - 卡片保存带**三代轮转**：cards.json → cards.backup.json → cards.backup.2.json；
//     轮转让「误保存」还能翻回上一版，而不是直接覆盖；
//   - 读不到返回 nil 而不是错误：文件不存在是常态（还没写过设置）。
package libfiles

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"knowflick.local/workbench-go/internal/creds"
)

// LibraryFiles 是卡库目录里那几份 JSON 的当前内容；没有的字段是 nil。
type LibraryFiles struct {
	Cards         *string `json:"cards,omitempty"`
	Backup        *string `json:"backup,omitempty"`
	Backup2       *string `json:"backup2,omitempty"`
	Settings      *string `json:"settings,omitempty"`
	SearchHistory *string `json:"searchHistory,omitempty"`
}

// ReadOptional 读一个文件；不存在返回 nil（不是错误）。
func ReadOptional(path string) (*string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	text := string(data)
	return &text, nil
}

// Read 列出卡库目录里的全部 JSON 文件（没有的字段为 nil）。
func Read(dir string) (LibraryFiles, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return LibraryFiles{}, err
	}
	cards, err := ReadOptional(filepath.Join(dir, "cards.json"))
	if err != nil {
		return LibraryFiles{}, err
	}
	backup, err := ReadOptional(filepath.Join(dir, "cards.backup.json"))
	if err != nil {
		return LibraryFiles{}, err
	}
	backup2, err := ReadOptional(filepath.Join(dir, "cards.backup.2.json"))
	if err != nil {
		return LibraryFiles{}, err
	}
	settings, err := ReadOptional(filepath.Join(dir, "settings.json"))
	if err != nil {
		return LibraryFiles{}, err
	}
	searchHistory, err := ReadOptional(filepath.Join(dir, "search_history.json"))
	if err != nil {
		return LibraryFiles{}, err
	}
	return LibraryFiles{
		Cards: cards, Backup: backup, Backup2: backup2,
		Settings: settings, SearchHistory: searchHistory,
	}, nil
}

// SaveCards 保存卡片并做三代轮转：cards.json → backup → backup.2。
//
// 轮转的意义：误保存还能翻回上一版。先删二代、再把一代推到二代、
// 再把主文件复制成一代，最后原子写主文件——主文件在写成功前始终可用。
func SaveCards(dir, text string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	main := filepath.Join(dir, "cards.json")
	backup := filepath.Join(dir, "cards.backup.json")
	backup2 := filepath.Join(dir, "cards.backup.2.json")
	if exists(backup) {
		if exists(backup2) {
			if err := os.Remove(backup2); err != nil {
				return errors.New("清理二代备份失败")
			}
		}
		if err := os.Rename(backup, backup2); err != nil {
			return errors.New("备份轮转失败")
		}
	}
	if exists(main) {
		if err := copyFile(main, backup); err != nil {
			return errors.New("写入备份失败")
		}
	}
	return creds.AtomicWrite(main, []byte(text))
}

// SaveSettings 保存设置。
func SaveSettings(dir, text string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return creds.AtomicWrite(filepath.Join(dir, "settings.json"), []byte(text))
}

// SaveImportReport 保存最近一次导入的转换报告（JSON 文本）。
func SaveImportReport(dir, text string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return creds.AtomicWrite(filepath.Join(dir, "import_report.json"), []byte(text))
}

// SaveSearchHistory 保存搜索历史。
func SaveSearchHistory(dir, text string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return creds.AtomicWrite(filepath.Join(dir, "search_history.json"), []byte(text))
}

// ReadImportReport 读导入报告；没有报告返回 nil（调用方显示「无报告」）。
func ReadImportReport(dir string) (*string, error) {
	return ReadOptional(filepath.Join(dir, "import_report.json"))
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func copyFile(source, destination string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return os.WriteFile(destination, data, 0o644)
}

// ContentFingerprint 是文件内容指纹：SHA-256 前 8 字节大端整数（16 个十六进制字符）。
// 与桌面端 content_fingerprint 同算法——签名必须跨端一致，否则轮询会误判「没变化」。
func ContentFingerprint(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	digest := hasher.Sum(nil)
	return fmt.Sprintf("%016x", binary.BigEndian.Uint64(digest[:8])), nil
}

// LibrarySignature 串联三个关键文件的内容指纹，缺失的文件记 "-"。
// 这是内容指纹而不是 mtime+大小：inode 时间戳粒度会让两次写入共享同一个时间。
func LibrarySignature(dir string) string {
	parts := make([]string, 0, 3)
	for _, name := range []string{"knowflick.db", "cards.json", "settings.json"} {
		fingerprint, err := ContentFingerprint(filepath.Join(dir, name))
		if err != nil {
			parts = append(parts, name+":-")
			continue
		}
		parts = append(parts, name+":"+fingerprint)
	}
	return strings.Join(parts, "|")
}

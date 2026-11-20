// Package creds 迁自 Rust store.rs 的凭据文件层：路径规则、原子写、权限。
//
// 与原实现一致的口径：
// - 凭据**不进 settings.json、不进任何导出格式**——settings 里的 sync 段只存非敏感的地址与用户名；
// - 库名为 store 时凭据放在**父目录**的 credentials/ 下（库目录会被整体替换，凭据不能跟着没）；
// - 读不到返回空串而不是错误：还没配过密钥是常态，不是故障；
// - 写用临时文件 + Sync + Rename，避免留下半截凭据。
//
// 一处**刻意的偏离**（ADR-0040 记录）：Rust 的 write_api_key 会 chmod 0600，
// 而 write_named_credential 不设权限（umask 022 下是 0644）。Go 侧统一收紧到 0600——
// 凭据就是凭据，两条路径不该一个严一个松。这与 mail 包的 0600/0700 口径一致。
package creds

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// APIKeyFile 是 API 密钥文件名（与 Rust 的 credentials_file 同一规则）。
const APIKeyFile = "apiKey.credential"

// File 返回某个具名凭据的绝对路径。
//
// 库名为 store 时凭据放父目录：库目录可能被整体替换或迁移，
// 凭据跟着它一起没会导致用户「升级后所有密钥都没了」。
func File(libraryDir, name string) string {
	if filepath.Base(libraryDir) == "store" {
		parent := filepath.Dir(libraryDir)
		if parent == libraryDir {
			parent = "."
		}
		return filepath.Join(parent, "credentials", name)
	}
	return filepath.Join(libraryDir, "credentials", name)
}

// APIKey 返回 API 密钥文件路径。
func APIKey(libraryDir string) string {
	return File(libraryDir, APIKeyFile)
}

// Read 读具名凭据；文件不存在返回空串（还没配过是常态，不是故障）。
func Read(libraryDir, name string) (string, error) {
	data, err := os.ReadFile(File(libraryDir, name))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	return string(data), nil
}

// Write 写具名凭据：建目录、原子写、收紧到 0600。
func Write(libraryDir, name, value string) error {
	path := File(libraryDir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := AtomicWrite(path, []byte(value)); err != nil {
		return err
	}
	return RestrictToOwner(path)
}

// WriteAPIKey 写 API 密钥（与 Write 同一路径规则，只是固定文件名）。
func WriteAPIKey(libraryDir, value string) error {
	return Write(libraryDir, APIKeyFile, value)
}

// AtomicWrite 用临时文件 + Sync + Rename：断电或崩溃不会留下半截文件。
func AtomicWrite(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".knowflick-*.tmp")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// RestrictToOwner 把文件收紧到 0600（非 unix 平台是空操作，
// 与 Rust 的 cfg(not(unix)) 分支一致——凭据在 Windows 上靠用户配置文件 ACL）。
func RestrictToOwner(path string) error {
	return os.Chmod(path, 0o600)
}

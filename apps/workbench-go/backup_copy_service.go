package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// BackupCopyResult 是备份落盘结果（与前端 BackupCopyResult 同形）。
type BackupCopyResult struct {
	FileName string `json:"fileName"`
	SHA256   string `json:"sha256"`
	Bytes    int    `json:"bytes"`
	Sidecar  string `json:"sidecar"`
}

// CopyBackupToDirectory 把打包好的备份字节写到用户指定目录：
// 版本化文件名 knowflick-backup-YYYYMMDD-NN.kfbackup + SHA-256 sidecar。
// 明确是备份不是同步：一次性的完整快照。
func (s *PreviewService) CopyBackupToDirectory(ctx context.Context, targetDir, archiveB64 string) (BackupCopyResult, error) {
	archiveBytes, err := base64.StdEncoding.DecodeString(archiveB64)
	if err != nil {
		return BackupCopyResult{}, errors.New("备份字节无效，无法解码")
	}
	info, err := os.Stat(targetDir)
	if err != nil || !info.IsDir() {
		return BackupCopyResult{}, fmt.Errorf("目标目录不存在：%s", targetDir)
	}
	now := time.Now()
	date := now.Format("20060102")
	seq := 1
	for ; seq <= 99; seq++ {
		candidate := filepath.Join(targetDir, fmt.Sprintf("knowflick-backup-%s-%02d.kfbackup", date, seq))
		if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
			break
		}
	}
	if seq > 99 {
		return BackupCopyResult{}, errors.New("同一天已备份 99 次——请先清理目标目录")
	}
	fileName := fmt.Sprintf("knowflick-backup-%s-%02d.kfbackup", date, seq)
	out := filepath.Join(targetDir, fileName)
	if err := os.WriteFile(out, archiveBytes, 0o644); err != nil {
		return BackupCopyResult{}, fmt.Errorf("备份写入失败：%w", err)
	}
	digest := sha256.Sum256(archiveBytes)
	hexDigest := hex.EncodeToString(digest[:])
	// SHA-256 sidecar：跨设备校验用（包内 FNV 校验和保持兼容）。
	sidecar := out + ".sha256"
	if err := os.WriteFile(sidecar, []byte(hexDigest+"  "+fileName+"\n"), 0o644); err != nil {
		return BackupCopyResult{}, fmt.Errorf("备份校验文件写入失败：%w", err)
	}
	return BackupCopyResult{FileName: fileName, SHA256: hexDigest, Bytes: len(archiveBytes), Sidecar: sidecar}, nil
}

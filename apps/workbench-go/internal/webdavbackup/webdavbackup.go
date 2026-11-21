package webdavbackup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"knowflick.local/workbench-go/internal/backupname"
	"knowflick.local/workbench-go/internal/httpx"
)

// Result 是上传回执，与 Rust webdav_upload_backup 的 JSON 字段一一对应。
type Result struct {
	FileName string `json:"fileName"`
	SHA256   string `json:"sha256"`
	Bytes    int    `json:"bytes"`
}

// Upload 把备份写到 WebDAV：主对象按日期命名，409/412 时退让到 -01/-02，
// 再写 `<对象名>.sha256` sidecar。这是单向复制，不做合并或双向同步。
func Upload(ctx context.Context, baseURL, username, secret string, archive []byte, now time.Time) (Result, error) {
	var result Result
	base := strings.TrimRight(baseURL, "/")
	if base == "" {
		return result, errors.New("WebDAV 地址不能为空")
	}
	digest := sha256.Sum256(archive)
	hash := hex.EncodeToString(digest[:])
	date := backupname.DateFromMillis(now.UnixMilli())
	user, pass := username, secret
	var uploaded string
	for attempt := 0; attempt < 3; attempt++ {
		name := fmt.Sprintf("knowflick-backup-%s.kfbackup", date)
		if attempt > 0 {
			name = fmt.Sprintf("knowflick-backup-%s-%02d.kfbackup", date, attempt)
		}
		status, body, err := httpx.WebDAVPut(ctx, base+"/"+name, user, pass, archive, "application/zip")
		if err != nil {
			return result, fmt.Errorf("WebDAV 上传失败：%w", err)
		}
		if status == 200 || status == 201 || status == 204 {
			uploaded = name
			break
		}
		if status != 409 && status != 412 {
			return result, fmt.Errorf("WebDAV 上传失败：HTTP %d %s", status, string(body[:min(len(body), 200)]))
		}
		if attempt == 2 {
			return result, fmt.Errorf("WebDAV 上传失败：目标已有同名对象且退让序号用尽（HTTP %d）", status)
		}
	}
	sidecar := fmt.Sprintf("%s  %s\n", hash, uploaded)
	status, body, err := httpx.WebDAVPut(ctx, base+"/"+uploaded+".sha256", user, pass, []byte(sidecar), "text/plain")
	if err != nil {
		return result, fmt.Errorf("WebDAV 校验文件上传失败：%w", err)
	}
	if status != 200 && status != 201 && status != 204 {
		return result, fmt.Errorf("WebDAV 校验文件上传失败：HTTP %d %s", status, string(body[:min(len(body), 200)]))
	}
	return Result{FileName: uploaded, SHA256: hash, Bytes: len(archive)}, nil
}

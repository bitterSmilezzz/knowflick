package archive

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"io"
	"math"
	"path"
	"regexp"
	"slices"
	"time"
	"unicode/utf8"
)

// SystemSnapshotV4 是生成 v4 备份所需的资料库数据。JSON 使用工作台已有的线格式。
// 即使集合为空，也要提供显式的 JSON 数组。附件路径是库内相对路径。
type SystemSnapshotV4 struct {
	Cards          json.RawMessage
	Materials      json.RawMessage
	Artifacts      json.RawMessage
	Notes          json.RawMessage
	KnowledgeBases json.RawMessage
	Settings       string
	Media          map[string][]byte
}

type systemManifest struct {
	Format        string            `json:"format"`
	SchemaVersion int               `json:"schemaVersion"`
	AppName       string            `json:"appName"`
	AppVersion    string            `json:"appVersion"`
	ExportedAt    int64             `json:"exportedAt"`
	ExportedAtISO string            `json:"exportedAtIso"`
	Limitations   []string          `json:"limitations"`
	Stats         map[string]int    `json:"stats"`
	Checksums     map[string]string `json:"checksums"`
}

type systemEntry struct {
	name string
	data []byte
}

var systemMediaPath = regexp.MustCompile(`^media/(audio|image|ink)/[A-Za-z0-9._-]+$`)

const systemV4Limitation = "当前备份格式不含项目、目标、个人画像、订阅、邮箱账户及同步记录、外部连接授权、笔记历史版本、搜索历史、已删除的素材、卡片和产物"

// WriteSystemBackupV4 写入现有 TypeScript 恢复器兼容的基础 .kfbackup。
// 校验和根据实际写入的字节生成，附件按二进制条目保存。
func WriteSystemBackupV4(dst io.Writer, snapshot SystemSnapshotV4, exportedAt time.Time) error {
	exportedAt = time.UnixMilli(exportedAt.UnixMilli()).UTC()
	manifest := systemManifest{
		Format: "knowflick-backup", SchemaVersion: 4, AppName: "KnowFlick", AppVersion: "0.1.0",
		ExportedAt: exportedAt.UnixMilli(), ExportedAtISO: exportedAt.Format("2006-01-02T15:04:05.000Z"),
		Limitations: []string{systemV4Limitation},
		Stats:       map[string]int{"media": len(snapshot.Media)},
		Checksums:   make(map[string]string),
	}
	var entries []systemEntry
	for _, item := range []struct {
		key string
		raw json.RawMessage
	}{
		{"cards", snapshot.Cards},
		{"materials", snapshot.Materials},
		{"artifacts", snapshot.Artifacts},
		{"notes", snapshot.Notes},
	} {
		name := item.key + ".json"
		count, err := countJSONArray(name, item.raw)
		if err != nil {
			return err
		}
		manifest.Stats[item.key] = count
		entries = append(entries, systemEntry{name, item.raw})
	}
	var knowledgeBases map[string]json.RawMessage
	var membership map[string]int64
	if !utf8.Valid(snapshot.KnowledgeBases) || json.Unmarshal(snapshot.KnowledgeBases, &knowledgeBases) != nil ||
		json.Unmarshal(knowledgeBases["membership"], &membership) != nil || membership == nil {
		return fmt.Errorf("knowledge_bases.json 缺少有效的知识库成员关系")
	}
	count, err := countJSONArray("knowledge_bases.json", knowledgeBases["knowledgeBases"])
	if err != nil {
		return err
	}
	manifest.Stats["knowledgeBases"] = count
	entries = append(entries,
		systemEntry{"knowledge_bases.json", snapshot.KnowledgeBases},
		systemEntry{"settings.json", []byte(StripSecretSettings(snapshot.Settings))},
	)
	paths := make([]string, 0, len(snapshot.Media))
	for relative := range snapshot.Media {
		if !systemMediaPath.MatchString(relative) || path.Clean(relative) != relative {
			return fmt.Errorf("备份包含无效的附件路径")
		}
		paths = append(paths, relative)
	}
	slices.Sort(paths)
	for _, relative := range paths {
		entries = append(entries, systemEntry{relative, snapshot.Media[relative]})
	}
	for _, entry := range entries {
		digest := sha256.Sum256(entry.data)
		manifest.Checksums[entry.name] = "sha256:" + hex.EncodeToString(digest[:])
	}
	metadata, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	return writeSystemZIP(dst, append([]systemEntry{{"manifest.json", metadata}}, entries...))
}

func countJSONArray(name string, data json.RawMessage) (int, error) {
	var items []json.RawMessage
	if !utf8.Valid(data) || json.Unmarshal(data, &items) != nil || items == nil {
		return 0, fmt.Errorf("%s 必须是有效的 JSON 数组", name)
	}
	return len(items), nil
}

func writeSystemZIP(dst io.Writer, entries []systemEntry) error {
	// 现有恢复器按 32 位本地文件头寻址。写入前校验 ZIP32 大小，避免输出 ZIP64。
	size := uint64(22)
	for _, entry := range entries {
		if len(entry.name) > math.MaxUint16 {
			return fmt.Errorf("备份条目名称过长")
		}
		size += 30 + 46 + 2*uint64(len(entry.name)) + uint64(len(entry.data))
	}
	if len(entries) >= math.MaxUint16 || size >= math.MaxUint32 {
		return fmt.Errorf("备份包超过 ZIP32 容量")
	}
	writer := zip.NewWriter(dst)
	for _, entry := range entries {
		size := uint64(len(entry.data))
		// CreateRaw 将预先算好的 CRC 和长度写入本地文件头，不生成数据描述符。
		file, err := writer.CreateRaw(&zip.FileHeader{
			Name: entry.name, Method: zip.Store, CreatorVersion: 20, ReaderVersion: 20,
			CRC32: crc32.ChecksumIEEE(entry.data), CompressedSize64: size, UncompressedSize64: size,
		})
		if err != nil {
			return err
		}
		if _, err := file.Write(entry.data); err != nil {
			return err
		}
	}
	return writer.Close()
}

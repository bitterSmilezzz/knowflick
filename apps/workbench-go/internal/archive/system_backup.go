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
	NoteRevisions  json.RawMessage
	R4             json.RawMessage
	Subscriptions  json.RawMessage
	Mail           json.RawMessage
	ReviewHistory  json.RawMessage
	SearchHistory  json.RawMessage
	DeletedRecords json.RawMessage
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
	Stats         map[string]any    `json:"stats"`
	Checksums     map[string]string `json:"checksums"`
}

type systemEntry struct {
	name string
	data []byte
}

var systemR4Tables = []string{"projects", "goals", "profile_claims", "profile_denials", "project_members", "goal_evidence"}

var systemMediaPath = regexp.MustCompile(`^media/(audio|image|ink)/[A-Za-z0-9._-]+$`)

// IsSystemMediaPath 判断附件相对路径能否写入 .kfbackup。
func IsSystemMediaPath(relative string) bool {
	return systemMediaPath.MatchString(relative) && path.Clean(relative) == relative
}

const systemV4Limitation = "当前备份格式不含项目、目标、个人画像、订阅、邮箱账户及同步记录、外部连接授权、笔记历史版本、搜索历史、已删除的素材、卡片和产物"

const systemV6Limitation = "当前备份格式不含项目、目标、个人画像、订阅、邮箱账户及同步记录、外部连接授权、搜索历史、已删除的素材、卡片和产物；附件和设置与数据库不在同一事务"

const systemV6NoR4Limitation = "当前备份格式不含项目、目标、个人画像、订阅、邮箱账户及同步记录、外部连接授权、搜索历史、已删除的素材、卡片和产物；附件和设置与数据库不在同一事务"

const systemV7Limitation = "当前备份格式不含邮箱账户及同步记录、外部连接授权、搜索历史、已删除的素材、卡片和产物；附件和设置与数据库不在同一事务"

const systemV7NoR4Limitation = "当前备份格式不含项目、目标、个人画像、邮箱账户及同步记录、外部连接授权、搜索历史、已删除的素材、卡片和产物；附件和设置与数据库不在同一事务"

const systemV8Limitation = "当前备份格式不含外部连接授权、搜索历史、已删除的素材、卡片和产物；邮箱密码不随包迁移，附件和设置与数据库不在同一事务"

const systemV8NoR4Limitation = "当前备份格式不含项目、目标、个人画像、外部连接授权、搜索历史、已删除的素材、卡片和产物；邮箱密码不随包迁移，附件和设置与数据库不在同一事务"

const systemV9Limitation = "当前备份格式不含外部连接授权、搜索历史、已删除的素材、卡片和产物；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造，附件和设置与数据库不在同一事务"

const systemV9NoR4Limitation = "当前备份格式不含项目、目标、个人画像、外部连接授权、搜索历史、已删除的素材、卡片和产物；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造，附件和设置与数据库不在同一事务"

const systemV10Limitation = "当前备份格式不含外部连接授权、已删除的素材、卡片和产物；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造，附件和设置与数据库不在同一事务"

const systemV10NoR4Limitation = "当前备份格式不含项目、目标、个人画像、外部连接授权、已删除的素材、卡片和产物；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造，附件和设置与数据库不在同一事务"

const systemV11Limitation = "当前备份格式仍不含外部连接授权；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造；搜索历史、附件和设置分别从数据库之外读取，不与 SQLite 快照处于同一事务"

const systemV11NoR4Limitation = "当前备份格式仍不含项目、目标、个人画像、外部连接授权；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造；搜索历史、附件和设置分别从数据库之外读取，不与 SQLite 快照处于同一事务"

// WriteSystemBackupV4 写入现有 TypeScript 恢复器兼容的基础 .kfbackup。
// 校验和根据实际写入的字节生成，附件按二进制条目保存。
func WriteSystemBackupV4(dst io.Writer, snapshot SystemSnapshotV4, exportedAt time.Time) error {
	exportedAt = time.UnixMilli(exportedAt.UnixMilli()).UTC()
	manifest := systemManifest{
		Format: "knowflick-backup", SchemaVersion: 4, AppName: "KnowFlick", AppVersion: "0.1.0",
		ExportedAt: exportedAt.UnixMilli(), ExportedAtISO: exportedAt.Format("2006-01-02T15:04:05.000Z"),
		Limitations: []string{systemV4Limitation},
		Stats:       map[string]any{"media": len(snapshot.Media)},
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
	if len(snapshot.R4) > 0 {
		var payload struct {
			Tables map[string]json.RawMessage `json:"tables"`
		}
		if json.Unmarshal(snapshot.R4, &payload) != nil || len(payload.Tables) != len(systemR4Tables) {
			return fmt.Errorf("r4.json 的表清单无效")
		}
		counts := make(map[string]int, len(systemR4Tables))
		for _, name := range systemR4Tables {
			rows, ok := payload.Tables[name]
			if !ok {
				return fmt.Errorf("r4.json 缺少表 %s", name)
			}
			count, err := countJSONArray(name, rows)
			if err != nil {
				return err
			}
			counts[name] = count
		}
		manifest.Stats["r4"] = counts
		entries = append(entries, systemEntry{"r4.json", snapshot.R4})
	}
	if len(snapshot.NoteRevisions) > 0 {
		revisions, err := countJSONArray("note_revisions.json", snapshot.NoteRevisions)
		if err != nil {
			return err
		}
		manifest.SchemaVersion = 6
		manifest.Limitations = []string{systemV6Limitation}
		manifest.Stats["noteRevisions"] = revisions
		entries = append(entries, systemEntry{"note_revisions.json", snapshot.NoteRevisions})
	}
	if len(snapshot.Subscriptions) > 0 {
		var payload struct {
			Items         []json.RawMessage `json:"items"`
			ExcludedCount int               `json:"excludedCount"`
			Version       int               `json:"version"`
		}
		if json.Unmarshal(snapshot.Subscriptions, &payload) != nil || payload.Version != 1 || payload.Items == nil || payload.ExcludedCount < 0 {
			return fmt.Errorf("subscriptions.json 的结构无效")
		}
		manifest.SchemaVersion = 7
		manifest.Limitations = []string{systemV7NoR4Limitation}
		if len(snapshot.R4) > 0 {
			manifest.Limitations = []string{systemV7Limitation}
		}
		manifest.Stats["subscriptions"] = len(payload.Items)
		manifest.Stats["subscriptionsExcluded"] = payload.ExcludedCount
		entries = append(entries, systemEntry{"subscriptions.json", snapshot.Subscriptions})
	}
	if len(snapshot.Mail) > 0 {
		var payload struct {
			Accounts         []json.RawMessage          `json:"accounts"`
			SyncStates       []json.RawMessage          `json:"syncStates"`
			Imports          []json.RawMessage          `json:"imports"`
			Rejected         []json.RawMessage          `json:"rejected"`
			MaterialBindings map[string]json.RawMessage `json:"materialBindings"`
			Version          int                        `json:"version"`
		}
		if json.Unmarshal(snapshot.Mail, &payload) != nil || payload.Version != 1 || payload.Accounts == nil || payload.SyncStates == nil || payload.Imports == nil || payload.Rejected == nil || payload.MaterialBindings == nil {
			return fmt.Errorf("mail.json 的结构无效")
		}
		manifest.SchemaVersion = 8
		manifest.Limitations = []string{systemV8NoR4Limitation}
		if len(snapshot.R4) > 0 {
			manifest.Limitations = []string{systemV8Limitation}
		}
		manifest.Stats["mailAccounts"] = len(payload.Accounts)
		manifest.Stats["mailSyncStates"] = len(payload.SyncStates)
		manifest.Stats["mailImports"] = len(payload.Imports)
		manifest.Stats["mailRejected"] = len(payload.Rejected)
		entries = append(entries, systemEntry{"mail.json", snapshot.Mail})
	}
	if len(snapshot.ReviewHistory) > 0 {
		var payload struct {
			Events            []json.RawMessage `json:"events"`
			CoverageStartedAt *int64            `json:"coverageStartedAt"`
			Version           int               `json:"version"`
		}
		if json.Unmarshal(snapshot.ReviewHistory, &payload) != nil || payload.Version != 1 || payload.Events == nil || payload.CoverageStartedAt == nil || *payload.CoverageStartedAt < 0 {
			return fmt.Errorf("review_history.json 的结构无效")
		}
		manifest.SchemaVersion = 9
		manifest.Limitations = []string{systemV9NoR4Limitation}
		if len(snapshot.R4) > 0 {
			manifest.Limitations = []string{systemV9Limitation}
		}
		manifest.Stats["reviewEvents"] = len(payload.Events)
		entries = append(entries, systemEntry{"review_history.json", snapshot.ReviewHistory})
	}
	if len(snapshot.SearchHistory) > 0 {
		var payload []string
		if json.Unmarshal(snapshot.SearchHistory, &payload) != nil || payload == nil {
			return fmt.Errorf("search_history.json 的结构无效")
		}
		manifest.SchemaVersion = 10
		manifest.Limitations = []string{systemV10NoR4Limitation}
		if len(snapshot.R4) > 0 {
			manifest.Limitations = []string{systemV10Limitation}
		}
		manifest.Stats["searchHistory"] = len(payload)
		entries = append(entries, systemEntry{"search_history.json", snapshot.SearchHistory})
	}
	if len(snapshot.DeletedRecords) > 0 {
		var payload struct {
			Materials []json.RawMessage `json:"materials"`
			Cards     []json.RawMessage `json:"cards"`
			Artifacts []json.RawMessage `json:"artifacts"`
			Version   int               `json:"version"`
		}
		if json.Unmarshal(snapshot.DeletedRecords, &payload) != nil || payload.Version != 1 || payload.Materials == nil || payload.Cards == nil || payload.Artifacts == nil {
			return fmt.Errorf("deleted_records.json 的结构无效")
		}
		manifest.SchemaVersion = 11
		manifest.Limitations = []string{systemV11NoR4Limitation}
		if len(snapshot.R4) > 0 {
			manifest.Limitations = []string{systemV11Limitation}
		}
		manifest.Stats["deletedMaterials"] = len(payload.Materials)
		manifest.Stats["deletedCards"] = len(payload.Cards)
		manifest.Stats["deletedArtifacts"] = len(payload.Artifacts)
		entries = append(entries, systemEntry{"deleted_records.json", snapshot.DeletedRecords})
	}
	paths := make([]string, 0, len(snapshot.Media))
	for relative := range snapshot.Media {
		if !IsSystemMediaPath(relative) {
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

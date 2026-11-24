package archive

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"knowflick.local/workbench-go/internal/errtext"
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"
)

// SystemBackup 是校验通过、尚未写入数据库的 .kfbackup 内容。
type SystemBackup struct {
	SchemaVersion  int
	Manifest       json.RawMessage
	Cards          json.RawMessage
	Materials      json.RawMessage
	Artifacts      json.RawMessage
	Notes          json.RawMessage
	KnowledgeBases json.RawMessage
	Settings       json.RawMessage
	NoteRevisions  json.RawMessage
	R4             json.RawMessage
	Subscriptions  json.RawMessage
	Mail           json.RawMessage
	ReviewHistory  json.RawMessage
	SearchHistory  json.RawMessage
	DeletedRecords json.RawMessage
	Media          map[string][]byte
}

type backupManifest struct {
	Format        string            `json:"format"`
	SchemaVersion int               `json:"schemaVersion"`
	Profile       string            `json:"profile"`
	Stats         map[string]any    `json:"stats"`
	Checksums     map[string]string `json:"checksums"`
}

var systemMediaName = regexp.MustCompile(`^media/(audio|image|ink)/[A-Za-z0-9._-]+$`)

// ReadSystemBackup 校验整包后才返回内容：清单、逐文件 SHA-256、条目白名单与计数必须一致。
// 恢复写库前必须先过这一关——部分写入的备份比没有备份更糟。
func ReadSystemBackup(data []byte) (SystemBackup, error) {
	var backup SystemBackup
	if len(data) > MaxArchiveBytes {
		return backup, archiveSizeError()
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return backup, errtext.Wrap("备份包不是有效的 ZIP", err)
	}
	files := make(map[string][]byte, len(reader.File))
	for _, entry := range reader.File {
		if entry.Method != zip.Store {
			return backup, fmt.Errorf("备份包条目 %s 使用了不支持的压缩方式", entry.Name)
		}
		if _, duplicate := files[entry.Name]; duplicate {
			return backup, fmt.Errorf("备份包含重复条目 %s", entry.Name)
		}
		body, err := readEntryBytes(entry)
		if err != nil {
			return backup, err
		}
		files[entry.Name] = body
	}
	manifestRaw, ok := files["manifest.json"]
	if !ok {
		return backup, errors.New("备份包缺少 manifest.json 元数据文件，可能不是有效的 KnowFlick 备份包")
	}
	var manifest backupManifest
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
		return backup, errtext.Wrap("备份清单无法解析", err)
	}
	if manifest.Format != "knowflick-backup" {
		return backup, fmt.Errorf("未知备份格式: %s", manifest.Format)
	}
	isBrowser := manifest.Profile == "browser"
	if manifest.Profile != "" && !isBrowser {
		return backup, errors.New("备份包 profile 无效")
	}
	isBrowserV12 := manifest.SchemaVersion == 12 && isBrowser
	if manifest.SchemaVersion < 1 || (manifest.SchemaVersion > 11 && !isBrowserV12) || (isBrowser && !isBrowserV12) {
		return backup, fmt.Errorf("不支持的备份包版本 %d（本应用支持 v1 到 v11 和浏览器 v12）", manifest.SchemaVersion)
	}
	contentVersion := manifest.SchemaVersion
	if isBrowserV12 {
		contentVersion = 4
	}
	// 旧 Go 导出在从未搜索过的库中会生成 v11，但不声明或写入搜索历史。
	_, hasSearchFile := files["search_history.json"]
	_, hasSearchChecksum := manifest.Checksums["search_history.json"]
	_, hasSearchCount := manifest.Stats["searchHistory"]
	legacyMissingSearch := contentVersion == 11 && !hasSearchFile && !hasSearchChecksum && !hasSearchCount
	core := []string{"cards.json", "materials.json", "settings.json", "artifacts.json", "notes.json", "knowledge_bases.json"}
	for _, threshold := range []struct {
		version int
		name    string
	}{{5, "r4.json"}, {6, "note_revisions.json"}, {7, "subscriptions.json"}, {8, "mail.json"}, {9, "review_history.json"}, {10, "search_history.json"}, {11, "deleted_records.json"}} {
		if contentVersion >= threshold.version && !(threshold.version == 10 && legacyMissingSearch) {
			core = append(core, threshold.name)
		}
	}
	if isBrowserV12 {
		core = append(core, "browser_search_history.json")
	}
	var problems []string
	if contentVersion >= 3 {
		for _, name := range core {
			if _, present := files[name]; !present || !sha256Digest(manifest.Checksums[name]) {
				problems = append(problems, name+"：文件或 SHA-256 校验和缺失")
			}
		}
	}
	if contentVersion >= 4 {
		names := make([]string, 0, len(files))
		for name := range files {
			names = append(names, name)
		}
		slices.Sort(names)
		for _, name := range names {
			if name == "manifest.json" || slices.Contains(core, name) {
				continue
			}
			if !systemMediaName.MatchString(name) {
				problems = append(problems, name+"：备份包含不支持的条目")
			} else if !sha256Digest(manifest.Checksums[name]) {
				problems = append(problems, name+"：附件 SHA-256 校验和缺失")
			}
		}
	}
	checksumNames := make([]string, 0, len(manifest.Checksums))
	for name := range manifest.Checksums {
		checksumNames = append(checksumNames, name)
	}
	slices.Sort(checksumNames)
	for _, name := range checksumNames {
		declared := manifest.Checksums[name]
		actual, present := files[name]
		if !present {
			problems = append(problems, name+"：manifest 声明了校验和但包里没有该文件")
			continue
		}
		matches := false
		if strings.HasPrefix(declared, "sha256:") {
			digest := sha256.Sum256(actual)
			matches = "sha256:"+hex.EncodeToString(digest[:]) == declared
		} else if contentVersion < 3 {
			matches = legacyFNV(actual) == declared
		}
		if !matches {
			problems = append(problems, name+"：校验和不匹配（文件可能已被修改或损坏）")
		}
	}
	if len(problems) > 0 {
		return backup, fmt.Errorf("备份包校验失败，拒绝恢复：%s", strings.Join(problems, "；"))
	}
	backup = SystemBackup{SchemaVersion: manifest.SchemaVersion, Manifest: manifestRaw, Media: map[string][]byte{}}
	for name, body := range files {
		switch name {
		case "cards.json":
			backup.Cards = body
		case "materials.json":
			backup.Materials = body
		case "artifacts.json":
			backup.Artifacts = body
		case "notes.json":
			backup.Notes = body
		case "knowledge_bases.json":
			backup.KnowledgeBases = body
		case "settings.json":
			backup.Settings = body
		case "note_revisions.json":
			backup.NoteRevisions = body
		case "r4.json":
			backup.R4 = body
		case "subscriptions.json":
			backup.Subscriptions = body
		case "mail.json":
			backup.Mail = body
		case "review_history.json":
			backup.ReviewHistory = body
		case "search_history.json":
			backup.SearchHistory = body
		case "deleted_records.json":
			backup.DeletedRecords = body
		default:
			if systemMediaName.MatchString(name) {
				backup.Media[name] = body
			}
		}
	}
	if err := checkSystemStats(&backup, manifest.Stats); err != nil {
		return backup, err
	}
	return backup, nil
}

func readEntryBytes(entry *zip.File) ([]byte, error) {
	if entry.UncompressedSize64 > MaxArchiveBytes {
		return nil, fmt.Errorf("备份条目 %s 超过大小上限", entry.Name)
	}
	opened, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer opened.Close()
	body, err := io.ReadAll(io.LimitReader(opened, MaxArchiveBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > MaxArchiveBytes {
		return nil, fmt.Errorf("备份条目 %s 超过大小上限", entry.Name)
	}
	return body, nil
}

func sha256Digest(value string) bool {
	if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+64 {
		return false
	}
	_, err := hex.DecodeString(value[len("sha256:"):])
	return err == nil && strings.ToLower(value) == value
}

// legacyFNV 复刻 v2 包的 FNV-1a：按 UTF-16 码元累加，与前端 charCodeAt 同口径。
func legacyFNV(content []byte) string {
	text := string(content)
	var h uint32 = 0x811c9dc5
	for _, unit := range utf16Units(text) {
		h ^= uint32(unit)
		h *= 0x01000193
	}
	return fmt.Sprintf("%08x", h)
}

func utf16Units(text string) []uint16 {
	return utf16.Encode([]rune(text))
}

func checkSystemStats(backup *SystemBackup, stats map[string]any) error {
	if backup.SchemaVersion < 4 || stats == nil {
		return nil
	}
	var problems []string
	check := func(label string, declared any, actual int) {
		value, ok := declared.(float64)
		if !ok || int(value) != actual {
			problems = append(problems, fmt.Sprintf("%s 数量与包内实际不一致", label))
		}
	}
	var cards, materials, artifacts, notes []json.RawMessage
	if json.Unmarshal(backup.Cards, &cards) != nil || cards == nil {
		return errors.New("cards.json 必须是有效的 JSON 数组")
	}
	if json.Unmarshal(backup.Materials, &materials) != nil || materials == nil {
		return errors.New("materials.json 必须是有效的 JSON 数组")
	}
	if json.Unmarshal(backup.Artifacts, &artifacts) != nil || artifacts == nil {
		return errors.New("artifacts.json 必须是有效的 JSON 数组")
	}
	if json.Unmarshal(backup.Notes, &notes) != nil || notes == nil {
		return errors.New("notes.json 必须是有效的 JSON 数组")
	}
	check("cards", stats["cards"], len(cards))
	check("materials", stats["materials"], len(materials))
	check("artifacts", stats["artifacts"], len(artifacts))
	check("notes", stats["notes"], len(notes))
	check("media", stats["media"], len(backup.Media))
	if len(problems) > 0 {
		return fmt.Errorf("备份包计数对不上，拒绝恢复：%s", strings.Join(problems, "；"))
	}
	return nil
}

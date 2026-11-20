package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"

	"knowflick.local/workbench-go/internal/archive"
)

type r4Binding struct {
	Note     *string `json:"note"`
	Material *string `json:"material"`
	Card     *string `json:"card"`
}

type r4Snapshot struct {
	Version          int                         `json:"version"`
	Tables           map[string][]map[string]any `json:"tables"`
	NoteBindings     map[string]string           `json:"note_bindings"`
	EvidenceBindings map[string]*string          `json:"evidence_bindings"`
	ProfileBindings  map[string]r4Binding        `json:"profile_bindings"`
}

var r4Hash = regexp.MustCompile(`^[0-9a-f]{64}$`)

func restoreR4(ctx context.Context, tx *sql.Tx, backup archive.SystemBackup) (int, error) {
	if len(backup.R4) == 0 {
		return 0, nil
	}
	var snapshot r4Snapshot
	if err := json.Unmarshal(backup.R4, &snapshot); err != nil {
		return 0, errors.New("r4.json 结构无效")
	}
	if err := validateR4Snapshot(snapshot); err != nil {
		return 0, err
	}
	inserted := 0
	for _, name := range []string{"projects", "goals", "profile_claims", "profile_denials", "project_members", "goal_evidence"} {
		columns := r4ColumnNames(name)
		for _, row := range snapshot.Tables[name] {
			args := make([]any, len(columns))
			placeholders := make([]string, len(columns))
			for i, column := range columns {
				args[i] = row[column]
				placeholders[i] = "?"
			}
			result, err := tx.ExecContext(ctx, "INSERT INTO "+name+" ("+joinComma(columns)+") VALUES ("+joinComma(placeholders)+") ON CONFLICT DO NOTHING", args...)
			if err != nil {
				return 0, fmt.Errorf("恢复项目与画像数据失败：%w", err)
			}
			if rows, err := result.RowsAffected(); err == nil && rows > 0 {
				inserted++
			}
		}
	}
	return inserted, nil
}

func validateR4Snapshot(snapshot r4Snapshot) error {
	if snapshot.Version != 1 {
		return errors.New("不支持的项目与画像快照版本")
	}
	expected := []string{"projects", "goals", "profile_claims", "profile_denials", "project_members", "goal_evidence"}
	if len(snapshot.Tables) != len(expected) {
		return errors.New("备份表清单不完整或包含未知表")
	}
	for _, name := range expected {
		rows, ok := snapshot.Tables[name]
		if !ok {
			return errors.New("备份表清单不完整或包含未知表")
		}
		columns := r4ColumnNames(name)
		keys := map[string]bool{}
		for _, row := range rows {
			if len(row) != len(columns) {
				return fmt.Errorf("备份表 %s 字段不匹配", name)
			}
			for _, column := range columns {
				value, ok := row[column]
				if !ok {
					return fmt.Errorf("备份表 %s 字段不匹配", name)
				}
				switch value.(type) {
				case nil, string, float64:
				default:
					return fmt.Errorf("备份表 %s 字段类型无效", name)
				}
			}
			key := primaryKeyOf(name, row)
			if keys[key] {
				return fmt.Errorf("备份表 %s 包含重复标识", name)
			}
			keys[key] = true
		}
	}
	memberNotes := map[string]bool{}
	for _, row := range snapshot.Tables["project_members"] {
		note, _ := row["note_id"].(string)
		if note == "" {
			return errors.New("项目成员笔记标识无效")
		}
		memberNotes[note] = true
	}
	if !sameKeys(memberNotes, snapshot.NoteBindings) {
		return errors.New("项目成员笔记校验清单不匹配")
	}
	evidenceRefs := map[string]bool{}
	for _, row := range snapshot.Tables["goal_evidence"] {
		kind, _ := row["kind"].(string)
		id, _ := row["evidence_id"].(string)
		if kind == "" || id == "" {
			return errors.New("目标证据类型无效")
		}
		evidenceRefs[kind+"\n"+id] = true
	}
	if !sameEvidenceKeys(evidenceRefs, snapshot.EvidenceBindings) {
		return errors.New("目标证据校验清单不匹配")
	}
	profileRefs := map[string]bool{}
	for _, row := range snapshot.Tables["profile_claims"] {
		raw, _ := row["evidence_json"].(string)
		var ids []string
		if json.Unmarshal([]byte(raw), &ids) != nil {
			return errors.New("画像证据格式无效")
		}
		for _, id := range ids {
			profileRefs[id] = true
		}
	}
	if len(profileRefs) != len(snapshot.ProfileBindings) {
		return errors.New("画像证据校验清单不匹配")
	}
	for key := range snapshot.ProfileBindings {
		if !profileRefs[key] {
			return errors.New("画像证据校验清单不匹配")
		}
	}
	for _, hash := range snapshot.NoteBindings {
		if !r4Hash.MatchString(hash) {
			return errors.New("原件指纹格式无效")
		}
	}
	for _, hash := range snapshot.EvidenceBindings {
		if hash != nil && !r4Hash.MatchString(*hash) {
			return errors.New("原件指纹格式无效")
		}
	}
	for _, binding := range snapshot.ProfileBindings {
		for _, hash := range []*string{binding.Note, binding.Material, binding.Card} {
			if hash != nil && !r4Hash.MatchString(*hash) {
				return errors.New("原件指纹格式无效")
			}
		}
	}
	return nil
}

func sameKeys(values map[string]bool, bindings map[string]string) bool {
	if len(values) != len(bindings) {
		return false
	}
	for key := range bindings {
		if !values[key] {
			return false
		}
	}
	return true
}

func sameEvidenceKeys(values map[string]bool, bindings map[string]*string) bool {
	if len(values) != len(bindings) {
		return false
	}
	for key := range bindings {
		if !values[key] {
			return false
		}
	}
	return true
}

func primaryKeyOf(table string, row map[string]any) string {
	names := r4PrimaryKeys[table]
	parts := make([]string, len(names))
	for i, name := range names {
		parts[i] = formatR4Value(row[name])
	}
	return joinComma(parts)
}

func formatR4Value(value any) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case string:
		return v
	case float64:
		return strconv.FormatInt(int64(v), 10)
	}
	return fmt.Sprint(value)
}

func r4ColumnNames(table string) []string {
	names := make([]string, 0, len(r4Schemas[table]))
	for _, spec := range r4Schemas[table] {
		names = append(names, spec[0].(string))
	}
	return names
}

func joinComma(values []string) string {
	result := ""
	for i, value := range values {
		if i > 0 {
			result += ","
		}
		result += value
	}
	return result
}

var r4PrimaryKeys = map[string][]string{"projects": {"id"}, "goals": {"id"}, "profile_claims": {"id"}, "profile_denials": {"evidence_fingerprint"}, "project_members": {"project_id", "note_id"}, "goal_evidence": {"goal_id", "evidence_id"}}

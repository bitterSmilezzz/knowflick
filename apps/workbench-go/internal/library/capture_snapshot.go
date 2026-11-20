package library

import (
	"context"

	"encoding/json"
	"fmt"
	"knowflick.local/workbench-go/internal/cards"
)

// DatabaseBackupSnapshot 是 backup_capture_database 的快照：与 Rust 同名结构同形，
// JSON 键全部 camelCase，供前端逐实体恢复流程消费。
type DatabaseBackupSnapshot struct {
	Materials           []backupMaterial      `json:"materials"`
	Cards               []cards.Card          `json:"cards"`
	Notes               []backupNote          `json:"notes"`
	NoteRevisions       []backupNoteRevision  `json:"noteRevisions"`
	Subscriptions       json.RawMessage       `json:"subscriptions"`
	SubscriptionsError  *string               `json:"subscriptionsError"`
	Mail                json.RawMessage       `json:"mail"`
	MailError           *string               `json:"mailError"`
	ReviewHistory       json.RawMessage       `json:"reviewHistory"`
	ReviewHistoryError  *string               `json:"reviewHistoryError"`
	KnowledgeBases      KnowledgeBaseSnapshot `json:"knowledgeBases"`
	Membership          map[string]int64      `json:"membership"`
	Artifacts           []backupArtifact      `json:"artifacts"`
	ArtifactsError      *string               `json:"artifactsError"`
	DeletedRecords      json.RawMessage       `json:"deletedRecords"`
	DeletedRecordsError *string               `json:"deletedRecordsError"`
	R4                  json.RawMessage       `json:"r4"`
	R4Error             *string               `json:"r4Error"`
}

// CaptureDatabaseSnapshot 在只读事务里采集与 Rust capture_database 同一份数据。
func (l *Library) CaptureDatabaseSnapshot(ctx context.Context) (DatabaseBackupSnapshot, error) {
	database, err := l.captureBackupDatabase(ctx)
	if err != nil {
		return DatabaseBackupSnapshot{}, err
	}
	snapshot := DatabaseBackupSnapshot{
		Materials:      database.materials,
		Cards:          database.cards,
		Notes:          database.notes,
		NoteRevisions:  database.noteRevisions,
		KnowledgeBases: database.knowledgeBases,
		Artifacts:      database.artifacts,
		ReviewHistory:  database.reviewHistory,
		R4:             database.r4,
		Membership:     map[string]int64{},
	}
	if database.knowledgeBases.Membership != nil {
		snapshot.Membership = database.knowledgeBases.Membership
	}
	if data, err := json.Marshal(database.subscriptions); err == nil {
		snapshot.Subscriptions = json.RawMessage(data)
	} else {
		message := fmt.Sprintf("订阅快照读取失败：%v", err)
		snapshot.SubscriptionsError = &message
	}
	if data, err := json.Marshal(database.mail); err == nil {
		snapshot.Mail = json.RawMessage(data)
	} else {
		message := fmt.Sprintf("邮箱快照读取失败：%v", err)
		snapshot.MailError = &message
	}
	if len(database.reviewHistory) > 0 {
		snapshot.ReviewHistory = database.reviewHistory
	} else {
		message := "复习历史快照读取失败"
		snapshot.ReviewHistoryError = &message
	}
	if data, err := json.Marshal(database.deletedRecords); err == nil {
		snapshot.DeletedRecords = json.RawMessage(data)
	} else {
		message := fmt.Sprintf("回收站快照读取失败：%v", err)
		snapshot.DeletedRecordsError = &message
	}
	if len(database.r4) > 0 {
		snapshot.R4 = database.r4
	} else {
		message := "项目与画像快照读取失败"
		snapshot.R4Error = &message
	}
	return snapshot, nil
}

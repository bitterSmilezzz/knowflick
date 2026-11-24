package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"knowflick.local/workbench-go/internal/errtext"
	"strings"
)

// KnowledgeBase 对齐桌面端的知识库记录和备份格式。
type KnowledgeBase struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// KnowledgeBaseSnapshot 用库 ID、换行和笔记 ID 拼成成员关系键，值为加入时间。
type KnowledgeBaseSnapshot struct {
	Items      []KnowledgeBase  `json:"knowledgeBases"`
	Membership map[string]int64 `json:"membership"`
}

func (l *Library) KnowledgeBases(ctx context.Context) (KnowledgeBaseSnapshot, error) {
	tx, err := l.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return KnowledgeBaseSnapshot{}, err
	}
	defer tx.Rollback()
	return readKnowledgeBases(ctx, tx)
}

func readKnowledgeBases(ctx context.Context, tx *sql.Tx) (KnowledgeBaseSnapshot, error) {
	bases, err := readBackupRows(ctx, tx, "SELECT id,name,description,created_at,updated_at FROM knowledge_bases ORDER BY created_at,id",
		func(rows *sql.Rows, base *KnowledgeBase) error {
			return rows.Scan(&base.ID, &base.Name, &base.Description, &base.CreatedAt, &base.UpdatedAt)
		})
	if err != nil {
		return KnowledgeBaseSnapshot{}, errtext.Wrap("读取知识库失败", err)
	}
	rows, err := tx.QueryContext(ctx, "SELECT kb_id,note_id,added_at FROM kb_membership")
	if err != nil {
		return KnowledgeBaseSnapshot{}, errtext.Wrap("读取知识库成员关系失败", err)
	}
	defer rows.Close()
	membership := make(map[string]int64)
	for rows.Next() {
		var kbID, noteID string
		var addedAt int64
		if err := rows.Scan(&kbID, &noteID, &addedAt); err != nil {
			return KnowledgeBaseSnapshot{}, err
		}
		membership[kbID+"\n"+noteID] = addedAt
	}
	return KnowledgeBaseSnapshot{Items: bases, Membership: membership}, rows.Err()
}

func (l *Library) CreateKnowledgeBase(ctx context.Context, id, name, description string, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("知识库名称不能为空")
	}
	if id == "" || strings.ContainsRune(id, '\n') {
		return errors.New("知识库标识无效")
	}
	result, err := l.db.ExecContext(ctx, "INSERT INTO knowledge_bases (id,name,description,created_at,updated_at) "+
		"SELECT ?1,?2,?3,?4,?4 WHERE NOT EXISTS (SELECT 1 FROM knowledge_bases WHERE name = ?2)", id, name, description, now)
	if err != nil {
		return errtext.Wrap("创建知识库失败", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return fmt.Errorf("已有名为「%s」的知识库，请换个名字", name)
	}
	return nil
}

func (l *Library) SetKnowledgeBaseMembership(ctx context.Context, kbID, noteID string, member bool, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	if !member {
		_, err := l.db.ExecContext(ctx, "DELETE FROM kb_membership WHERE kb_id = ? AND note_id = ?", kbID, noteID)
		return err
	}
	// 用同一快照检查引用和写入，兼容未启用外键检查的连接。
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var baseExists, noteExists bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM knowledge_bases WHERE id = ?), EXISTS(SELECT 1 FROM notes WHERE id = ?)",
		kbID, noteID).Scan(&baseExists, &noteExists); err != nil {
		return err
	}
	if !baseExists {
		return errors.New("知识库不存在")
	}
	if !noteExists {
		return errors.New("笔记不存在")
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO kb_membership (kb_id,note_id,added_at) VALUES (?,?,?) ON CONFLICT(kb_id,note_id) DO NOTHING", kbID, noteID, now); err != nil {
		return err
	}
	return tx.Commit()
}

// MembershipRestoreEntry 是备份恢复时的一条知识库成员关系。
type MembershipRestoreEntry struct {
	KBID    string `json:"kbId"`
	NoteID  string `json:"noteId"`
	AddedAt int64  `json:"addedAt"`
}

// MembershipRestoreOutcome 逐条报告成员关系的处置结果，不因单条失败中断整批。
type MembershipRestoreOutcome struct {
	KBID   string `json:"kbId"`
	NoteID string `json:"noteId"`
	Action string `json:"action"`
	Error  string `json:"error,omitempty"`
}

// RestoreMembership 按备份记录的 addedAt 幂等恢复成员关系（kb_restore_membership）。
func (l *Library) RestoreMembership(ctx context.Context, entries []MembershipRestoreEntry) ([]MembershipRestoreOutcome, error) {
	if !l.writable {
		return nil, ErrReadOnly
	}
	outcomes := make([]MembershipRestoreOutcome, 0, len(entries))
	for _, entry := range entries {
		outcome := MembershipRestoreOutcome{KBID: entry.KBID, NoteID: entry.NoteID}
		var baseExists, noteExists bool
		if err := l.db.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM knowledge_bases WHERE id = ?), EXISTS(SELECT 1 FROM notes WHERE id = ?)",
			entry.KBID, entry.NoteID).Scan(&baseExists, &noteExists); err != nil {
			return nil, err
		}
		switch {
		case !baseExists:
			outcome.Error = "知识库不存在"
		case !noteExists:
			outcome.Error = "笔记不存在"
		default:
			result, err := l.db.ExecContext(ctx,
				"INSERT OR IGNORE INTO kb_membership (kb_id, note_id, added_at) VALUES (?, ?, ?)",
				entry.KBID, entry.NoteID, entry.AddedAt)
			if err != nil {
				outcome.Error = err.Error()
			} else if changed, _ := result.RowsAffected(); changed > 0 {
				outcome.Action = "added"
			} else {
				outcome.Action = "already"
			}
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes, nil
}

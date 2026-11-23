package mail

import (
	"database/sql"
	"errors"
)

// RejectedMail 是一封被隔离、等待重试的邮件（旧 UIDVALIDITY 的记录不展示）。
type RejectedMail struct {
	UID        uint32 `json:"uid"`
	Reason     string `json:"reason"`
	RejectedAt int64  `json:"rejectedAt"`
	Folder     string `json:"folder"`
}

// ImportedMail 是从某个账号导入的素材摘要；正文仍在素材表里。
type ImportedMail struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	SourceURL string `json:"sourceUrl"`
	CreatedAt int64  `json:"createdAt"`
}

// ListRejected 列出指定账号当前 UIDVALIDITY 下被拒的邮件。旧时代的 UID 不展示，
// 因为 UIDVALIDITY 变化后它们已不能安全地从服务器取回。
func ListRejected(dir, id string) ([]RejectedMail, error) {
	db, err := Open(dir)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	return ListRejectedIn(db, id)
}

func ListRejectedIn(db *sql.DB, id string) ([]RejectedMail, error) {
	var exists bool
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM mail_accounts WHERE id=?)", id).Scan(&exists); err != nil || !exists {
		return nil, errors.New("邮箱账号不存在")
	}
	rows, err := db.Query("SELECT r.uid,r.reason,r.rejected_at,r.folder FROM mail_rejected r "+
		"JOIN mail_accounts a ON a.id=r.account_id AND a.uid_validity=r.uid_validity "+
		"WHERE r.account_id=?1 ORDER BY r.rejected_at,r.uid", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]RejectedMail, 0)
	for rows.Next() {
		var item RejectedMail
		if err := rows.Scan(&item.UID, &item.Reason, &item.RejectedAt, &item.Folder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ListImported 列出某个账号导入的素材。绑定从 metadata_json 读取，避免按标题猜测。
func ListImported(dir, id string) ([]ImportedMail, error) {
	db, err := Open(dir)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	return ListImportedIn(db, id)
}

func ListImportedIn(db *sql.DB, id string) ([]ImportedMail, error) {
	rows, err := db.Query("SELECT id,title,COALESCE(source_url,''),created_at FROM materials "+
		"WHERE is_deleted=0 AND json_extract(metadata_json,'$.mailAccountId')=?1 "+
		"ORDER BY created_at DESC,id", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ImportedMail, 0)
	for rows.Next() {
		var item ImportedMail
		if err := rows.Scan(&item.ID, &item.Title, &item.SourceURL, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

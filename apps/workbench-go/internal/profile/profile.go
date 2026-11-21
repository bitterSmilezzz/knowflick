package profile

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
)

// Claim 是一条画像断言（R4/D05）：可确认、可暂停、可否认。
type Claim struct {
	ID           string  `json:"id"`
	Kind         string  `json:"kind"`
	Content      string  `json:"content"`
	EvidenceJSON string  `json:"evidenceJson"`
	Scope        string  `json:"scope"`
	CreatedAt    int64   `json:"createdAt"`
	ConfirmedAt  *int64  `json:"confirmedAt"`
	ExpiresAt    *int64  `json:"expiresAt"`
	DeniedAt     *int64  `json:"deniedAt"`
	SupersededBy *string `json:"supersededBy"`
	Status       string  `json:"status"`
}

// Denial 是一条被否认的证据源指纹。
type Denial struct {
	EvidenceFingerprint string `json:"evidenceFingerprint"`
	DeniedAt            int64  `json:"deniedAt"`
}

const columns = "id,kind,content,evidence_json,scope,created_at,confirmed_at,expires_at,denied_at,superseded_by,status"

// Fingerprint 把证据集合排序后取 SHA-256 前 8 字节：同源证据认得出。
// 与桌面端 evidence_fingerprint 一致，跨端否认记录必须互相识别。
func Fingerprint(evidenceJSON string) string {
	var ids []string
	_ = json.Unmarshal([]byte(evidenceJSON), &ids)
	if ids == nil {
		ids = []string{}
	}
	sortStrings(ids)
	canonical, err := json.Marshal(ids)
	if err != nil {
		canonical = []byte("[]")
	}
	digest := sha256.Sum256(canonical)
	return fmt.Sprintf("%016x", binary.BigEndian.Uint64(digest[:8]))
}

// Add 新增断言；被否认过的证据源不得重建。
func Add(ctx context.Context, db *sql.DB, claim Claim, now int64) error {
	fingerprint := Fingerprint(claim.EvidenceJSON)
	var denied int
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM profile_denials WHERE evidence_fingerprint = ?)", fingerprint).Scan(&denied); err != nil {
		return err
	}
	if denied != 0 {
		return errors.New("这条声明的证据源已被否认过——不自动重建。如需重新学习，请先在画像里清除该否认")
	}
	_, err := db.ExecContext(ctx, "INSERT INTO profile_claims (id,kind,content,evidence_json,scope,created_at,status)"+
		" VALUES (?,?,?,?,?,?,'active')", claim.ID, claim.Kind, claim.Content, claim.EvidenceJSON, claim.Scope, now)
	return err
}

// ListActive 只列有效声明：未否认、未过期、未暂停、未被取代。
func ListActive(ctx context.Context, db *sql.DB, now int64) ([]Claim, error) {
	return read(ctx, db, "SELECT "+columns+" FROM profile_claims"+
		" WHERE denied_at IS NULL AND status = 'active'"+
		" AND (expires_at IS NULL OR expires_at > ?)"+
		" AND superseded_by IS NULL ORDER BY created_at DESC", now)
}

// ListAll 是治理界面的全量视图：含暂停、否认、过期与被取代的记录。
func ListAll(ctx context.Context, db *sql.DB) ([]Claim, error) {
	return read(ctx, db, "SELECT "+columns+" FROM profile_claims ORDER BY created_at DESC")
}

// ListForAnswer 是全局问答可用的记忆：必须已确认、全局范围、仍生效。
// 项目范围记忆只能由带项目选择器的消费端显式筛选，不能进全局问答。
func ListForAnswer(ctx context.Context, db *sql.DB, now int64) ([]Claim, error) {
	return read(ctx, db, "SELECT "+columns+" FROM profile_claims"+
		" WHERE confirmed_at IS NOT NULL AND denied_at IS NULL AND status = 'active'"+
		" AND scope = 'global' AND (expires_at IS NULL OR expires_at > ?)"+
		" AND superseded_by IS NULL ORDER BY created_at DESC", now)
}

// ListForProjectAnswer 只列所选且仍活跃项目的记忆；项目无效或已封存时失败关闭。
func ListForProjectAnswer(ctx context.Context, db *sql.DB, now int64, projectID string) ([]Claim, error) {
	var active int
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL)", projectID).Scan(&active); err != nil {
		return nil, err
	}
	if active == 0 {
		return nil, errors.New("所选项目不存在或已封存")
	}
	return read(ctx, db, "SELECT "+columns+" FROM profile_claims"+
		" WHERE confirmed_at IS NOT NULL AND denied_at IS NULL AND status = 'active'"+
		" AND scope = ? AND (expires_at IS NULL OR expires_at > ?)"+
		" AND superseded_by IS NULL ORDER BY created_at DESC", projectID, now)
}

// Confirm 用户确认事实（fact 类从推测转正）。
func Confirm(ctx context.Context, db *sql.DB, id string, now int64) (bool, error) {
	return update(ctx, db, "UPDATE profile_claims SET confirmed_at = ?2 WHERE id = ?1 AND denied_at IS NULL", id, now)
}

// Pause 暂停学习/使用；数据保留，恢复再调 Resume。
func Pause(ctx context.Context, db *sql.DB, id string) (bool, error) {
	return update(ctx, db, "UPDATE profile_claims SET status = 'paused' WHERE id = ?1", id, nil)
}

// Resume 解除暂停。
func Resume(ctx context.Context, db *sql.DB, id string) (bool, error) {
	return update(ctx, db, "UPDATE profile_claims SET status = 'active' WHERE id = ?1", id, nil)
}

// Deny 否认断言并把证据指纹写进 profile_denials：阻止同源重建。
func Deny(ctx context.Context, db *sql.DB, id string, now int64) (bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var evidence string
	err = tx.QueryRowContext(ctx, "SELECT evidence_json FROM profile_claims WHERE id = ?", id).Scan(&evidence)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	result, err := tx.ExecContext(ctx, "UPDATE profile_claims SET denied_at = ?2 WHERE id = ?1 AND denied_at IS NULL", id, now)
	if err != nil {
		return false, err
	}
	if changed, err := result.RowsAffected(); err != nil || changed == 0 {
		return changed > 0, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT OR REPLACE INTO profile_denials (evidence_fingerprint, denied_at) VALUES (?,?)", Fingerprint(evidence), now); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// Delete 是否认加物理移除断言；否认指纹保留，防同源重建。
func Delete(ctx context.Context, db *sql.DB, id string, now int64) (bool, error) {
	denied, err := Deny(ctx, db, id, now)
	if err != nil || !denied {
		return denied, err
	}
	result, err := db.ExecContext(ctx, "DELETE FROM profile_claims WHERE id = ?", id)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	return changed > 0, err
}

// ClearDenialByEvidence 清除某证据源的否认（用户主动允许重新学习）。
func ClearDenialByEvidence(ctx context.Context, db *sql.DB, evidenceJSON string) (bool, error) {
	result, err := db.ExecContext(ctx, "DELETE FROM profile_denials WHERE evidence_fingerprint = ?", Fingerprint(evidenceJSON))
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	return changed > 0, err
}

// ListDenials 是治理界面用的否认清单（指纹与时间）。
func ListDenials(ctx context.Context, db *sql.DB) ([]Denial, error) {
	rows, err := db.QueryContext(ctx, "SELECT evidence_fingerprint, denied_at FROM profile_denials ORDER BY denied_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Denial, 0)
	for rows.Next() {
		var item Denial
		if err := rows.Scan(&item.EvidenceFingerprint, &item.DeniedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func read(ctx context.Context, db *sql.DB, query string, args ...any) ([]Claim, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Claim, 0)
	for rows.Next() {
		var claim Claim
		var confirmed, expires, denied sql.NullInt64
		var superseded sql.NullString
		if err := rows.Scan(&claim.ID, &claim.Kind, &claim.Content, &claim.EvidenceJSON, &claim.Scope,
			&claim.CreatedAt, &confirmed, &expires, &denied, &superseded, &claim.Status); err != nil {
			return nil, err
		}
		claim.ConfirmedAt = fromNull(confirmed)
		claim.ExpiresAt = fromNull(expires)
		claim.DeniedAt = fromNull(denied)
		if superseded.Valid {
			value := superseded.String
			claim.SupersededBy = &value
		}
		items = append(items, claim)
	}
	return items, rows.Err()
}

func update(ctx context.Context, db *sql.DB, query, id string, now any) (bool, error) {
	result, err := db.ExecContext(ctx, query, id, now)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	return changed > 0, err
}

func fromNull(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	result := value.Int64
	return &result
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

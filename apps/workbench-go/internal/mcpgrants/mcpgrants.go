package mcpgrants

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"knowflick.local/workbench-go/internal/errtext"
	"strings"

	"github.com/google/uuid"
)

// PolicyVersion 是当前授权策略版本，与服务端校验一致。
const PolicyVersion int64 = 1

// Request 是一次外部连接授权请求：项目只读与全库权限分开签发。
type Request struct {
	ClientLabel   string  `json:"clientLabel"`
	Scope         string  `json:"scope"`
	ProjectID     *string `json:"projectId"`
	LibraryRead   bool    `json:"libraryRead"`
	CardWrite     bool    `json:"cardWrite"`
	MaterialWrite bool    `json:"materialWrite"`
}

// Grant 是库里可见的授权记录；令牌本身不入库。
type Grant struct {
	ID            string  `json:"id"`
	ClientLabel   string  `json:"clientLabel"`
	Scope         string  `json:"scope"`
	ProjectID     *string `json:"projectId"`
	LibraryRead   bool    `json:"libraryRead"`
	CardWrite     bool    `json:"cardWrite"`
	MaterialWrite bool    `json:"materialWrite"`
	CreatedAt     int64   `json:"createdAt"`
	RevokedAt     *int64  `json:"revokedAt"`
	PolicyVersion int64   `json:"policyVersion"`
}

// CreatedGrant 只在创建时返回明文令牌；列表与数据库里都看不到它。
type CreatedGrant struct {
	Grant Grant  `json:"grant"`
	Token string `json:"token"`
}

// TokenHash 与服务端校验同一算法：SHA-256 十六进制。
func TokenHash(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

// Create 签发一枚授权：项目范围只给项目笔记只读，全库范围至少一项能力。
func Create(ctx context.Context, db *sql.DB, request Request, now int64) (CreatedGrant, error) {
	var created CreatedGrant
	label := strings.TrimSpace(request.ClientLabel)
	runes := []rune(label)
	if len(runes) == 0 || len(runes) > 100 {
		return created, errors.New("连接名称须为 1 到 100 个字符")
	}
	switch request.Scope {
	case "project":
		if request.ProjectID == nil || strings.TrimSpace(*request.ProjectID) == "" ||
			request.LibraryRead || request.CardWrite || request.MaterialWrite {
			return created, errors.New("授权范围或权限无效：项目只读与全库权限须分别授权")
		}
	case "library":
		if request.ProjectID != nil || (!request.LibraryRead && !request.CardWrite && !request.MaterialWrite) {
			return created, errors.New("授权范围或权限无效：项目只读与全库权限须分别授权")
		}
	default:
		return created, errors.New("授权范围或权限无效：项目只读与全库权限须分别授权")
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return created, errors.New("无法生成安全的授权令牌")
	}
	token := hex.EncodeToString(secret)
	id := uuid.NewString()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return created, err
	}
	defer tx.Rollback()
	if request.Scope == "project" {
		var active int
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL)", strings.TrimSpace(*request.ProjectID)).Scan(&active); err != nil {
			return created, err
		}
		if active == 0 {
			return created, errors.New("项目不存在或已封存，不能创建授权")
		}
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO mcp_grants"+
		" (id, client_label, scope, project_id, token_hash, library_read, card_write, material_write, created_at, policy_version)"+
		" VALUES (?,?,?,?,?,?,?,?,?,?)",
		id, label, request.Scope, request.ProjectID, TokenHash(token),
		request.LibraryRead, request.CardWrite, request.MaterialWrite, now, PolicyVersion); err != nil {
		return created, err
	}
	if err := tx.Commit(); err != nil {
		return created, err
	}
	projectID := request.ProjectID
	return CreatedGrant{
		Grant: Grant{
			ID: id, ClientLabel: label, Scope: request.Scope, ProjectID: projectID,
			LibraryRead: request.LibraryRead, CardWrite: request.CardWrite, MaterialWrite: request.MaterialWrite,
			CreatedAt: now, PolicyVersion: PolicyVersion,
		},
		Token: token,
	}, nil
}

// List 按创建时间倒序列出授权（含已撤销）。
func List(ctx context.Context, db *sql.DB) ([]Grant, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, client_label, scope, project_id, library_read, card_write,"+
		" material_write, created_at, revoked_at, policy_version FROM mcp_grants"+
		" ORDER BY created_at DESC, id ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Grant, 0)
	for rows.Next() {
		var item Grant
		var projectID sql.NullString
		var libraryRead, cardWrite, materialWrite int
		var revoked sql.NullInt64
		if err := rows.Scan(&item.ID, &item.ClientLabel, &item.Scope, &projectID,
			&libraryRead, &cardWrite, &materialWrite, &item.CreatedAt, &revoked, &item.PolicyVersion); err != nil {
			return nil, err
		}
		if projectID.Valid {
			value := projectID.String
			item.ProjectID = &value
		}
		item.LibraryRead = libraryRead != 0
		item.CardWrite = cardWrite != 0
		item.MaterialWrite = materialWrite != 0
		if revoked.Valid {
			value := revoked.Int64
			item.RevokedAt = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// Revoke 撤销授权：重复撤销不会重写时间；返回 true 表示记录存在（含已撤销）。
func Revoke(ctx context.Context, db *sql.DB, id string, now int64) (bool, error) {
	result, err := db.ExecContext(ctx, "UPDATE mcp_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", now, id)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	return changed > 0, err
}

// DescribeError 给数据库层错误补一句中文上下文。
func DescribeError(operation string, err error) error {
	if err == nil {
		return nil
	}
	return errtext.Wrap(fmt.Sprintf("%s失败", operation), err)
}

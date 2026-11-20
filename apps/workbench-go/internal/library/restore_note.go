package library

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
)

// RestoreOutcome 是恢复一篇笔记的结果，与 Rust NoteRestoreOutcome 同形。
type RestoreOutcome struct {
	Status   string `json:"status"`
	Revision int64  `json:"revision"`
}

const (
	RestoreCreated         = "created"
	RestoreUpdated         = "updated"
	RestoreCurrent         = "current"
	RestoreSkippedLocalNew = "skippedLocalNewer"
	RestoreSkippedDiverged = "skippedDivergent"
)

// fingerprintNoteRow 用与 fingerprintRow 相同的列拼出笔记指纹。单独实现是因为
// fingerprintRow 只收事务，而这里要核对一条还不确定存在的行。
func fingerprintNoteRow(ctx context.Context, tx *sql.Tx, id string) (string, bool, error) {
	var title, body string
	var revision int64
	var deleted int
	err := tx.QueryRowContext(ctx, "SELECT title,body_md,current_revision,is_deleted FROM notes WHERE id=?", id).Scan(&title, &body, &revision, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	digest := sha256.New()
	digest.Write([]byte(title))
	digest.Write([]byte("\x00"))
	digest.Write([]byte(body))
	var revisionBytes [8]byte
	binary.LittleEndian.PutUint64(revisionBytes[:], uint64(revision))
	digest.Write(revisionBytes[:])
	digest.Write([]byte(strconv.FormatInt(int64(deleted), 10)))
	return hex.EncodeToString(digest.Sum(nil)), true, nil
}

// RestoreNoteWithHistory 恢复一篇笔记（可带完整历史）：本地更新时跳过、
// 同修订一致幂等、分歧拒绝；protected 绑定核对本地指纹。
func (l *Library) RestoreNoteWithHistory(ctx context.Context, note Note, revision int64, binding *string, history []backupNoteRevision) (RestoreOutcome, error) {
	if !l.writable {
		return RestoreOutcome{}, ErrReadOnly
	}
	if note.ID == "" {
		return RestoreOutcome{}, errors.New("恢复的笔记缺少 id")
	}
	if revision < 1 {
		revision = 1
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return RestoreOutcome{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var existing *Note
	var localRevision int64
	row := tx.QueryRowContext(ctx, "SELECT "+noteColumns+" FROM notes n WHERE n.id = ?", note.ID)
	src, scanErr := scanBackupNoteRow(row, &localRevision)
	if scanErr == nil {
		existing = &src
	} else if !errors.Is(scanErr, sql.ErrNoRows) {
		return RestoreOutcome{}, fmt.Errorf("读取本地笔记失败：%w", scanErr)
	}
	// 历史校验：修订号有效、当前修订一致、与本地历史不冲突。
	if history != nil {
		if note.Revision != revision && revision != note.Revision {
			// revision 参数以传入为准；note.Revision 仅供快照参考。
			_ = note.Revision
		}
		incoming := map[int64]backupNoteRevision{}
		for _, item := range history {
			if item.NoteID != note.ID || item.Revision < 1 || item.Revision > revision {
				return RestoreOutcome{}, errors.New("笔记历史修订无效或重复")
			}
			if _, dup := incoming[item.Revision]; dup {
				return RestoreOutcome{}, errors.New("笔记历史修订无效或重复")
			}
			if item.Revision == revision && (item.Title != note.Title || item.BodyMD != note.Body) {
				return RestoreOutcome{}, errors.New("当前笔记与历史修订不一致")
			}
			incoming[item.Revision] = item
		}
		if existing == nil || localRevision <= revision {
			rows, err := tx.QueryContext(ctx, "SELECT note_id, revision, title, body_md, saved_at FROM note_revisions WHERE note_id=?", note.ID)
			if err != nil {
				return RestoreOutcome{}, err
			}
			for rows.Next() {
				var local backupNoteRevision
				if err := rows.Scan(&local.NoteID, &local.Revision, &local.Title, &local.BodyMD, &local.SavedAt); err != nil {
					rows.Close()
					return RestoreOutcome{}, err
				}
				if inc, ok := incoming[local.Revision]; ok && (inc.Title != local.Title || inc.BodyMD != local.BodyMD) {
					rows.Close()
					return RestoreOutcome{}, errors.New("本地笔记历史与备份不同，未覆盖")
				}
				if _, ok := incoming[local.Revision]; !ok {
					rows.Close()
					return RestoreOutcome{}, errors.New("本地笔记历史与备份不同，未覆盖")
				}
			}
			rows.Close()
			if existing != nil && localRevision < revision {
				parent, ok := incoming[localRevision]
				sameAncestor := ok && parent.Title == existing.Title && parent.BodyMD == existing.Body
				sameMetadata := existing.Notebook == nil && note.Notebook == nil && existing.SourceMaterialID == nil && note.SourceMaterialID == nil &&
					existing.Pinned == note.Pinned && existing.Favorite == note.Favorite &&
					existing.ArchivedAt == nil && note.ArchivedAt == nil && existing.Deleted == false && existing.DeletedAt == nil
				if !sameAncestor || !sameMetadata {
					return RestoreOutcome{}, errors.New("本地笔记与备份的历史或属性存在分歧，未覆盖")
				}
			}
		}
	}
	// 绑定核对：本地指纹与备份期望必须一致（Rust note_fingerprint 语义）。
	if binding != nil {
		current, exists, fpErr := fingerprintNoteRow(ctx, tx, note.ID)
		if fpErr != nil {
			return RestoreOutcome{}, fpErr
		}
		if (exists && current != *binding) || (!exists && *binding == "") {
			return RestoreOutcome{}, errors.New("本地笔记与备份的关联原件不一致，未覆盖")
		}
	}
	outcome := RestoreOutcome{Revision: revision}
	switch {
	case existing != nil && localRevision > revision:
		outcome.Status = RestoreSkippedLocalNew
	case existing != nil && localRevision == revision:
		same := existing.Title == note.Title && existing.Body == note.Body &&
			existing.Pinned == note.Pinned && existing.Favorite == note.Favorite &&
			existing.ExcludeFromProfile == note.ExcludeFromProfile
		if same {
			outcome.Status = RestoreCurrent
		} else {
			outcome.Status = RestoreSkippedDiverged
		}
	case existing != nil:
		if _, err := tx.ExecContext(ctx, "UPDATE notes SET title=?2, body_md=?3, notebook=?4, tags_json=?5, is_pinned=?6, is_favorite=?7, archived_at=?8, source_material_id=?9, current_revision=?10, created_at=?11, updated_at=?12, is_deleted=?13, deleted_at=?14, exclude_from_profile=?15 WHERE id=?1",
			note.ID, note.Title, note.Body, note.Notebook, tagsOf(note), note.Pinned, note.Favorite, note.ArchivedAt, note.SourceMaterialID, revision, note.CreatedAt, note.UpdatedAt, boolInt(note.Deleted), note.DeletedAt, note.ExcludeFromProfile); err != nil {
			return RestoreOutcome{}, err
		}
		if history == nil {
			if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES (?,?,?,?,?)", note.ID, revision, note.Title, note.Body, note.UpdatedAt); err != nil {
				return RestoreOutcome{}, err
			}
		}
		if err := rebuildNoteChunks(ctx, tx, note.ID, note.Body, revision); err != nil {
			return RestoreOutcome{}, err
		}
		if err := syncNoteFTS(ctx, tx, note.ID, note.Title, note.Body, note.Deleted); err != nil {
			return RestoreOutcome{}, err
		}
		outcome.Status = RestoreUpdated
	default:
		if _, err := tx.ExecContext(ctx, "INSERT INTO notes (id, title, body_md, notebook, tags_json, is_pinned, is_favorite, archived_at, source_material_id, current_revision, created_at, updated_at, is_deleted, deleted_at, exclude_from_profile) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
			note.ID, note.Title, note.Body, note.Notebook, tagsOf(note), note.Pinned, note.Favorite, note.ArchivedAt, note.SourceMaterialID, revision, note.CreatedAt, note.UpdatedAt, boolInt(note.Deleted), note.DeletedAt, note.ExcludeFromProfile); err != nil {
			return RestoreOutcome{}, err
		}
		if history == nil {
			if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES (?,?,?,?,?)", note.ID, revision, note.Title, note.Body, note.UpdatedAt); err != nil {
				return RestoreOutcome{}, err
			}
		}
		if err := rebuildNoteChunks(ctx, tx, note.ID, note.Body, revision); err != nil {
			return RestoreOutcome{}, err
		}
		if err := syncNoteFTS(ctx, tx, note.ID, note.Title, note.Body, note.Deleted); err != nil {
			return RestoreOutcome{}, err
		}
		outcome.Status = RestoreCreated
	}
	if history != nil && outcome.Status != RestoreSkippedLocalNew && outcome.Status != RestoreSkippedDiverged {
		for _, item := range history {
			if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES (?,?,?,?,?)", item.NoteID, item.Revision, item.Title, item.BodyMD, item.SavedAt); err != nil {
				return RestoreOutcome{}, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return RestoreOutcome{}, err
	}
	return outcome, nil
}

// scanBackupNoteRow 把一行笔记扫描成备份条目；revision 由调用方单独传入。
func scanBackupNoteRow(row *sql.Row, revision *int64) (Note, error) {
	var note Note
	var tags string
	var deleted int
	if err := row.Scan(&note.ID, &note.Title, &note.Body, &note.Notebook, &tags, &note.Pinned, &note.Favorite,
		&note.ArchivedAt, &note.SourceMaterialID, revision, &note.CreatedAt, &note.UpdatedAt,
		&deleted, &note.DeletedAt, &note.ExcludeFromProfile); err != nil {
		return Note{}, err
	}
	note.Deleted = deleted != 0
	var tagList []string
	if err := json.Unmarshal([]byte(tags), &tagList); err == nil {
		canonical, _ := json.Marshal(tagList)
		note.TagsJSON = string(canonical)
	} else {
		note.TagsJSON = tags
	}
	return note, nil
}

// BackupNoteRevisionDTO 是跨进程传输的笔记历史条目。
type BackupNoteRevisionDTO = backupNoteRevision

// RestoreNoteWithHistoryDTO 让服务层直接使用 DTO 切片。
func (l *Library) RestoreNoteWithHistoryDTO(ctx context.Context, note Note, revision int64, binding *string, history []BackupNoteRevisionDTO) (RestoreOutcome, error) {
	return l.RestoreNoteWithHistory(ctx, note, revision, binding, history)
}

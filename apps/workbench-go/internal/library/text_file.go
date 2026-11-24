package library

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ExportTextFile 把文本写到用户选定的路径（单篇笔记导出 Markdown 用）。
// 与 Rust write_text_file 同口径：空路径拒绝，父目录自动创建，内容按 UTF-8 原样写入。
func ExportTextFile(path, contents string) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("没有选择导出位置")
	}
	target := filepath.Clean(path)
	if info, err := os.Lstat(target); err == nil && info.IsDir() {
		return errors.New("导出位置是一个文件夹，请选择文件名")
	}
	if parent := filepath.Dir(target); parent != "." && parent != "" {
		if err := os.MkdirAll(parent, 0o755); err != nil {
			return errors.New("无法创建导出目录")
		}
	}
	if err := os.WriteFile(target, []byte(contents), 0o644); err != nil {
		return errors.New("写入导出文件失败")
	}
	return nil
}

// SafeExportFileName 把笔记标题变成可用的 Markdown 文件名。
func SafeExportFileName(title string) string {
	name := strings.TrimSpace(title)
	name = strings.NewReplacer("/", "／", "\\", "＼", ":", "：", "*", "＊", "?", "？", "\"", "＂", "<", "＜", ">", "＞", "|", "｜").Replace(name)
	name = strings.Trim(name, ". ")
	if name == "" {
		name = "无标题笔记"
	}
	runes := []rune(name)
	if len(runes) > 80 {
		name = string(runes[:80])
	}
	return name + ".md"
}

// NoteByID 读一篇未删除笔记；找不到返回明确错误。
func (l *Library) NoteByID(ctx context.Context, id string) (Note, error) {
	var note Note
	err := l.db.QueryRowContext(ctx, "SELECT "+noteColumns+" FROM notes n WHERE n.id = ? AND n.is_deleted = 0", id).
		Scan(&note.ID, &note.Title, &note.Body, &note.Notebook, &note.TagsJSON, &note.Pinned, &note.Favorite,
			&note.ArchivedAt, &note.SourceMaterialID, &note.Revision, &note.CreatedAt, &note.UpdatedAt,
			&note.Deleted, &note.DeletedAt, &note.ExcludeFromProfile)
	if errors.Is(err, sql.ErrNoRows) {
		return Note{}, errors.New("这篇笔记不在库里，可能已删除")
	}
	return note, err
}

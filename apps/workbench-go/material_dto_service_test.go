package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/materials"
)

// 共享工作台的录音与图片走这条入口：附件相对路径、字节数与元数据必须一起落库。
//
// 用**新建库**而不是旧库副本：旧库里 fts_materials 是普通表（能用 ON CONFLICT），
// 新建库里是 FTS5 虚表（不能 upsert）——只用旧库验证会漏掉真机上的失败。
func TestSaveMaterialDTOPersistsAttachmentFields(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "knowflick.db")
	created, err := library.Create(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if err := created.Close(); err != nil {
		t.Fatal(err)
	}
	lib, err := library.OpenForWrite(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer lib.Close()
	relative, err := lib.SaveAttachmentBytes(dir, "audio", `audio/mp4; codecs="mp4a.40.2"`, []byte("OPUS-STUB"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(relative, ".m4a") {
		t.Fatalf("attachment extension: %q", relative)
	}
	id, err := lib.UpsertMaterial(context.Background(), materials.Material{
		ID: "material-with-audio", SourceType: "audio", Title: "语音笔记",
		RawText: "（语音笔记，3 秒；音频以附件保存。）", MediaPath: &relative, MediaSizeBytes: int64(len("OPUS-STUB")),
		MetadataJSON: `{"durationMs":3000,"mime":"audio/mp4"}`, InboxStatus: "inbox",
		CreatedAt: 10, UpdatedAt: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	items, err := lib.ListMaterials(context.Background(), false, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID != id {
			continue
		}
		if item.SourceType != "audio" || item.MediaPath == nil || *item.MediaPath != relative {
			t.Fatalf("attachment not linked: %+v", item)
		}
		if item.MediaSizeBytes != int64(len("OPUS-STUB")) || !strings.Contains(item.MetadataJSON, "durationMs") {
			t.Fatalf("attachment metadata lost: %+v", item)
		}
		hits, err := lib.SearchMaterials(context.Background(), "语音笔记", 10)
		if err != nil || len(hits) == 0 {
			t.Fatalf("full text index missing: %+v %v", hits, err)
		}
		return
	}
	t.Fatalf("material %q not found", id)
}

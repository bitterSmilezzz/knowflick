package main

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestInkServiceOnRustLibrary(t *testing.T) {
	service, _ := openFixtureCopy(t)
	ctx := t.Context()
	document := `{"version":1,"width":100,"height":60,"strokes":[{"points":[{"x":0.2,"y":0.3},{"x":0.7,"y":0.8}],"width":0.004,"color":"ink"}]}`
	if _, err := service.SaveInkMaterial(ctx, 1, document); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only save: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveInkMaterial(ctx, writable.Generation-1, document); err == nil {
		t.Fatal("stale library accepted a handwriting save")
	}
	id, err := service.SaveInkMaterial(ctx, writable.Generation, document)
	if err != nil || id == "" {
		t.Fatalf("ink save: %q, %v", id, err)
	}
	materials, err := service.ListMaterials(ctx, writable.Generation, true, 10, 0)
	if err != nil || len(materials) == 0 || materials[0].ID != id || materials[0].SourceType != "ink" {
		t.Fatalf("inbox after ink save: %+v, %v", materials, err)
	}
	path := materials[0].MediaPath
	if path == nil || !strings.HasPrefix(*path, "media/ink/") || !strings.HasSuffix(*path, ".json") {
		t.Fatalf("invalid ink attachment path: %v", path)
	}
	stats, err := service.GetStats(ctx, writable.Generation)
	if err != nil || stats.TotalMaterials != 2 || stats.InboxMaterials != 2 {
		t.Fatalf("stats after ink save: %+v, %v", stats, err)
	}
	reopened, err := service.OpenInitialLibrary(ctx)
	if err != nil || reopened == nil || reopened.Writable {
		t.Fatalf("read-only reopen: %+v, %v", reopened, err)
	}
	attachments, err := service.ListMaterialAttachments(ctx, reopened.Generation)
	if err != nil || len(attachments) == 0 || attachments[0].Path != *path || attachments[0].Title != materials[0].Title {
		t.Fatalf("available note attachments: %+v, %v", attachments, err)
	}
	encoded, err := service.ReadAttachment(ctx, reopened.Generation, attachments[0].Path)
	if err != nil || encoded != base64.StdEncoding.EncodeToString([]byte(document)) {
		t.Fatalf("read ink after reopening: %v", err)
	}
}

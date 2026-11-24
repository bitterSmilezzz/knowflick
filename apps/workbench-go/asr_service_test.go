package main

import (
	"context"
	"strings"
	"testing"
)

func TestAsrStatusAndTranscribeRequireDownloadedModel(t *testing.T) {
	t.Setenv("KNOWFLICK_DEBUG_DATA_ROOT", t.TempDir())
	service := &PreviewService{}
	ctx := context.Background()
	status, err := service.AsrModelStatus(ctx, "")
	if err != nil || status.Model != "small" || status.Installed {
		t.Fatalf("status: %+v, %v", status, err)
	}
	if status.ExpectedBytes != 487_600_000 {
		t.Fatalf("expected size: %d", status.ExpectedBytes)
	}
	if _, err := service.AsrModelStatus(ctx, "bogus"); err == nil || !strings.Contains(err.Error(), "未知的语音模型") {
		t.Fatalf("unknown model: %v", err)
	}
	if _, err := service.AsrTranscribe(ctx, "", "/nonexistent.wav"); err == nil || !strings.Contains(err.Error(), "尚未下载") {
		t.Fatalf("transcribe without model: %v", err)
	}
	if _, err := service.AsrTranscribe(ctx, "bogus", "/nonexistent.wav"); err == nil {
		t.Fatal("unknown model accepted")
	}
	if err := service.StartAsrDownload(ctx, "bogus"); err == nil {
		t.Fatal("download of unknown model started")
	}
	progress, err := service.AsrDownloadProgress(ctx, "")
	if err != nil || progress.Running || progress.Done {
		t.Fatalf("progress: %+v, %v", progress, err)
	}
}

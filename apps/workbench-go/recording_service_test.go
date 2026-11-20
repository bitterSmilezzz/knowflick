package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestRecordingMaterialRoundTripOnRustLibrary(t *testing.T) {
	s, _ := openFixtureCopy(t)
	ctx := t.Context()
	// WAV 单声道、16 kHz、16 位，一帧静音样本。
	wav := []byte("RIFF\x26\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\x3e\x00\x00\x00\x7d\x00\x00\x02\x00\x10\x00data\x02\x00\x00\x00\x00\x00")
	encoded := base64.StdEncoding.EncodeToString(wav)
	if _, err := s.SaveRecordingMaterial(ctx, 1, "audio/wav", 1, encoded); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only save: %v", err)
	}
	writable, err := s.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveRecordingMaterial(ctx, writable.Generation-1, "audio/wav", 1, encoded); err == nil {
		t.Fatal("accepted stale generation")
	}
	for _, input := range []struct {
		mime     string
		duration int64
		encoded  string
	}{
		{"audio/wav", 0, encoded},
		{"audio/wav", 1, "!"},
		{"image/png", 1, encoded},
	} {
		if _, err := s.SaveRecordingMaterial(ctx, writable.Generation, input.mime, input.duration, input.encoded); err == nil {
			t.Fatalf("accepted invalid recording: %+v", input)
		}
	}
	id, err := s.SaveRecordingMaterial(ctx, writable.Generation, "audio/wav; codecs=pcm", 1250, encoded)
	if err != nil || id == "" {
		t.Fatalf("save recording: %q, %v", id, err)
	}
	items, err := s.SearchMaterials(ctx, writable.Generation, "语音笔记", 10)
	if err != nil || len(items) != 1 || items[0].ID != id {
		t.Fatalf("recording search: %+v, %v", items, err)
	}
	item := items[0]
	if item.MediaPath == nil || !strings.HasPrefix(*item.MediaPath, "media/audio/") || !strings.HasSuffix(*item.MediaPath, ".wav") || item.SourceType != "audio" || item.InboxStatus != "inbox" || item.MediaSizeBytes != int64(len(wav)) {
		t.Fatalf("recording material: %+v", item)
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(item.MetadataJSON), &metadata); err != nil || metadata["mime"] != "audio/wav" || metadata["durationMs"] != float64(1250) || metadata["transcript"] != "" || metadata["transcribed"] != false {
		t.Fatalf("recording metadata: %s, %v", item.MetadataJSON, err)
	}
	stats, err := s.GetStats(ctx, writable.Generation)
	if err != nil || stats.TotalMaterials != 2 || stats.InboxMaterials != 2 {
		t.Fatalf("recording stats: %+v, %v", stats, err)
	}
	reopened, err := s.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	read, err := s.ReadAttachment(ctx, reopened.Generation, *item.MediaPath)
	if err != nil || read != encoded {
		t.Fatalf("audio differs after reopening: %q, %v", read, err)
	}
}

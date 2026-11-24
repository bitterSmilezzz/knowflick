package main

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/asr"
	"knowflick.local/workbench-go/internal/libfiles"
	"knowflick.local/workbench-go/internal/library"
)

func TestRecordingTranscriptionPreservesSourceAndRefreshesIndex(t *testing.T) {
	s, dir := openFixtureCopy(t)
	ctx := t.Context()
	models := t.TempDir()
	t.Setenv("KNOWFLICK_DEBUG_DATA_ROOT", models)
	writable, err := s.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	generation := writable.Generation
	audio := "c2FtcGxlLWF1ZGlv"
	id, err := s.SaveRecordingMaterial(ctx, generation, "audio/webm; codecs=opus", 1700, audio)
	if err != nil {
		t.Fatal(err)
	}
	before, err := s.current.RecordingSource(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := s.TranscribeRecording(ctx, generation, id); err != nil || got != "disabled" {
		t.Fatalf("disabled: %q, %v", got, err)
	}
	if err := libfiles.SaveSettings(dir, `{"paperTheme":"paper","plugins":{"unrelated":{"enabled":true},"official-speech-asr":{"preferences":{"keep":12345678901234567890}}}}`); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveRecordingASRSettings(ctx, generation, true, "tiny"); err != nil {
		t.Fatal(err)
	}
	config, err := s.ReadRecordingASRSettings(ctx, generation)
	if err != nil || config != (RecordingASRSettings{Enabled: true, Model: "tiny"}) {
		t.Fatalf("settings: %+v, %v", config, err)
	}
	settings, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil || !strings.Contains(string(settings), "12345678901234567890") || !strings.Contains(string(settings), "unrelated") || !strings.Contains(string(settings), "paperTheme") {
		t.Fatalf("settings lost unrelated values: %s, %v", settings, err)
	}
	if got, err := s.TranscribeRecording(ctx, generation, id); err != nil || got != "missing-model" {
		t.Fatalf("missing model: %q, %v", got, err)
	}
	if err := os.MkdirAll(asr.ModelsDir(models), 0700); err != nil {
		t.Fatal(err)
	}
	model, err := asr.ModelPath(models, "tiny")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(model, []byte("test model marker"), 0600); err != nil {
		t.Fatal(err)
	}
	inferErr := errors.New("test inference failure")
	var staged string
	stub := func(_ context.Context, model, path string) (asr.Result, error) {
		staged = path
		data, err := os.ReadFile(path)
		if err != nil || base64.StdEncoding.EncodeToString(data) != audio || filepath.Ext(path) != ".webm" || model != "tiny" {
			t.Fatalf("staged audio or configured model: %q, %q, %v", path, model, err)
		}
		return asr.Result{}, inferErr
	}
	if _, err := s.transcribeRecording(ctx, generation, id, stub); !errors.Is(err, inferErr) {
		t.Fatalf("transcription failure: %v", err)
	}
	if _, err := os.Stat(staged); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary audio still exists: %v", err)
	}
	if got, err := s.transcribeRecording(ctx, generation, id, func(context.Context, string, string) (asr.Result, error) {
		return asr.Result{Text: "  \n  "}, nil
	}); err != nil || got != "empty" {
		t.Fatalf("empty transcription: %q, %v", got, err)
	}
	unchanged, err := s.current.RecordingSource(ctx, id)
	if err != nil || unchanged != before {
		t.Fatalf("failed transcription changed source: %+v, %v", unchanged, err)
	}
	transcript := "会议复盘\n离线识别正文"
	got, err := s.transcribeRecording(ctx, generation, id, func(context.Context, string, string) (asr.Result, error) {
		return asr.Result{Text: transcript}, nil
	})
	if err != nil || got != "saved" {
		t.Fatalf("successful transcription: %q, %v", got, err)
	}
	items, err := s.SearchMaterials(ctx, generation, "离线识别正文", 10)
	if err != nil || len(items) != 1 || items[0].Title != "会议复盘" || items[0].RawText != transcript || items[0].ID != id {
		t.Fatalf("indexed transcript: %+v, %v", items, err)
	}
	after, err := s.current.RecordingSource(ctx, id)
	if err != nil || after.Path != before.Path || after.Version != before.Version+1 || !after.Transcribed {
		t.Fatalf("recording revision: %+v, %v", after, err)
	}
	if data, err := s.ReadAttachment(ctx, generation, after.Path); err != nil || data != audio {
		t.Fatalf("recording bytes were modified: %q, %v", data, err)
	}
	if err := s.current.SaveRecordingTranscript(ctx, id, before, "过期转写", 2000); err == nil {
		t.Fatal("stale transcript replaced a newer revision")
	}
	if got, err := s.TranscribeRecording(ctx, generation, id); err != nil || got != "already" {
		t.Fatalf("retry overwritten existing transcript: %q, %v", got, err)
	}
	if _, err := s.TranscribeRecording(ctx, generation-1, id); err == nil {
		t.Fatal("stale generation accepted")
	}
	secondID, err := s.SaveRecordingMaterial(ctx, generation, "audio/webm", 1700, audio)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.transcribeRecording(ctx, generation, secondID, func(context.Context, string, string) (asr.Result, error) {
		if _, err := s.OpenInitialLibrary(ctx); err != nil {
			t.Fatal(err)
		}
		return asr.Result{Text: "跨库写入测试"}, nil
	})
	if err == nil || !strings.Contains(err.Error(), "资料库已切换") {
		t.Fatalf("stale completion after library switch: %v", err)
	}
	second, err := s.current.RecordingSource(ctx, secondID)
	if err != nil || second.Transcribed {
		t.Fatalf("recording changed after reopening: %+v, %v", second, err)
	}
	if _, err := s.TranscribeRecording(ctx, generation+1, id); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only transcription: %v", err)
	}
}

func TestRecordingTranscriptionWithLocalWhisper(t *testing.T) {
	path := os.Getenv("KF_GO_ASR_WEBM_FIXTURE")
	if path == "" {
		t.Skip("set KF_GO_ASR_WEBM_FIXTURE and KNOWFLICK_DEBUG_DATA_ROOT to use a real model and audio fixture")
	}
	s, _ := openFixtureCopy(t)
	ctx := t.Context()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	writable, err := s.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	generation := writable.Generation
	if err := s.SaveRecordingASRSettings(ctx, generation, true, "tiny"); err != nil {
		t.Fatal(err)
	}
	id, err := s.SaveRecordingMaterial(ctx, generation, "audio/webm", 4000, base64.StdEncoding.EncodeToString(data))
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.TranscribeRecording(ctx, generation, id)
	if err != nil || got != "saved" {
		t.Fatalf("Whisper transcription: %q, %v", got, err)
	}
	items, err := s.SearchMaterials(ctx, generation, "transcription", 10)
	if err != nil || len(items) != 1 || items[0].ID != id || !strings.Contains(strings.ToLower(items[0].RawText), "original recording") {
		t.Fatalf("Whisper output: %+v, %v", items, err)
	}
	t.Log(items[0].RawText)
}

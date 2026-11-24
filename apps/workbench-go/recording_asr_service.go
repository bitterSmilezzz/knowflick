package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"knowflick.local/workbench-go/internal/asr"
	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/media"
)

type recordingTranscription struct {
	library *library.Library
	source  library.RecordingSource
	audio   []byte
	model   string
}

// TranscribeRecording runs the configured local model against a saved recording.
// The original recording stays available regardless of the transcription outcome.
func (s *PreviewService) TranscribeRecording(ctx context.Context, generation int, id string) (string, error) {
	return s.transcribeRecording(ctx, generation, id, s.AsrTranscribe)
}

func (s *PreviewService) transcribeRecording(ctx context.Context, generation int, id string, transcribe func(context.Context, string, string) (asr.Result, error)) (string, error) {
	input, status, err := s.prepareRecordingTranscription(ctx, generation, id)
	if err != nil || status != "" {
		return status, err
	}
	file, err := os.CreateTemp("", "knowflick-recording-*"+filepath.Ext(input.source.Path))
	if err != nil {
		return "", errors.New("无法创建录音转写临时文件")
	}
	defer os.Remove(file.Name())
	size, writeErr := file.Write(input.audio)
	if size != len(input.audio) && writeErr == nil {
		writeErr = io.ErrShortWrite
	}
	if err := errors.Join(writeErr, file.Close()); err != nil {
		return "", errors.New("无法准备录音转写文件")
	}
	result, err := transcribe(ctx, input.model, file.Name())
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(result.Text)
	if text == "" {
		return "empty", nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.generation != generation || s.current != input.library {
		return "", errors.New("转写期间资料库已切换，请重新打开后重试")
	}
	if err := s.current.SaveRecordingTranscript(ctx, id, input.source, text, time.Now().UnixMilli()); err != nil {
		return "", err
	}
	return "saved", nil
}

func (s *PreviewService) prepareRecordingTranscription(ctx context.Context, generation int, id string) (recordingTranscription, string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var input recordingTranscription
	if s.current == nil || s.generation != generation {
		return input, "", errors.New("请重新打开资料库")
	}
	if !s.writable {
		return input, "", library.ErrReadOnly
	}
	dir := filepath.Dir(s.path)
	settings, err := recordingSettingsFile(dir)
	if err != nil {
		return input, "", err
	}
	config := recordingASRSettings(settings)
	if !config.Enabled {
		return input, "disabled", nil
	}
	source, err := s.current.RecordingSource(ctx, id)
	if err != nil {
		return input, "", err
	}
	if source.Transcribed {
		return input, "already", nil
	}
	model, err := s.AsrModelStatus(ctx, config.Model)
	if err != nil {
		return input, "", err
	}
	if !model.Installed {
		return input, "missing-model", nil
	}
	if !strings.HasPrefix(source.Path, "media/audio/") {
		return input, "", errors.New("录音附件路径无效")
	}
	audio, err := media.Read(dir, source.Path)
	if err != nil {
		return input, "", err
	}
	return recordingTranscription{library: s.current, source: source, audio: audio, model: config.Model}, "", nil
}

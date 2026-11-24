package main

import (
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	"time"

	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/media"
)

// SaveRecordingMaterial 将录音原件保存为收件箱素材。
func (s *PreviewService) SaveRecordingMaterial(ctx context.Context, generation int, mimeType string, durationMs int64, dataB64 string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	if !s.writable {
		return "", library.ErrReadOnly
	}
	if len(dataB64) > base64.StdEncoding.EncodedLen(media.MaxAudio) {
		return "", errors.New("录音附件超过 64 MB 上限")
	}
	data, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return "", errors.New("录音数据无效，无法解码")
	}
	return s.current.SaveRecording(ctx, filepath.Dir(s.path), mimeType, durationMs, data, time.Now())
}

// ImportAudioMaterial 导入一段本机音频文件为收件箱素材。
func (s *PreviewService) ImportAudioMaterial(ctx context.Context, generation int) (string, error) {
	s.mu.RLock()
	ready := s.current != nil && s.generation == generation && s.writable
	s.mu.RUnlock()
	if !ready {
		if s.current == nil || s.generation != generation {
			return "", errors.New("请重新打开资料库")
		}
		return "", library.ErrReadOnly
	}
	path, err := s.app.Dialog.OpenFile().AttachToWindow(s.window).SetTitle("选择要导入的音频").
		AddFilter("音频", "*.wav;*.webm;*.mp3;*.m4a;*.ogg;*.oga").PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	return s.current.SaveAudioFile(ctx, filepath.Dir(s.path), path, time.Now())
}

package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"

	"knowflick.local/workbench-go/internal/asr"
	"knowflick.local/workbench-go/internal/dataroot"
	"knowflick.local/workbench-go/internal/libfiles"
	"knowflick.local/workbench-go/internal/library"
)

const speechPluginID = "official-speech-asr"
const defaultASRModel = "small"

type RecordingASRSettings struct {
	Enabled bool   `json:"enabled"`
	Model   string `json:"model"`
}

func (s *PreviewService) ReadRecordingASRSettings(ctx context.Context, generation int) (RecordingASRSettings, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return RecordingASRSettings{}, errors.New("请重新打开资料库")
	}
	root, err := recordingSettingsFile(filepath.Dir(s.path))
	if err != nil {
		return RecordingASRSettings{}, err
	}
	return recordingASRSettings(root), nil
}

func (s *PreviewService) SaveRecordingASRSettings(ctx context.Context, generation int, enabled bool, model string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.generation != generation {
		return errors.New("请重新打开资料库")
	}
	if !s.writable {
		return library.ErrReadOnly
	}
	if _, err := asr.ModelPath(dataroot.Dir(), model); err != nil {
		return err
	}
	dir := filepath.Dir(s.path)
	root, err := recordingSettingsFile(dir)
	if err != nil {
		return err
	}
	plugins := settingsObject(root["plugins"])
	entry := settingsObject(plugins[speechPluginID])
	preferences := settingsObject(entry["preferences"])
	preferences["model"] = model
	entry["enabled"] = enabled
	entry["preferences"] = preferences
	plugins[speechPluginID] = entry
	root["plugins"] = plugins
	data, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return err
	}
	return libfiles.SaveSettings(dir, string(data)+"\n")
}

func recordingSettingsFile(dir string) (map[string]any, error) {
	text, err := libfiles.ReadOptional(filepath.Join(dir, "settings.json"))
	if err != nil {
		return nil, err
	}
	root := make(map[string]any)
	if text != nil && strings.TrimSpace(*text) != "" {
		decoder := json.NewDecoder(strings.NewReader(*text))
		decoder.UseNumber()
		if !json.Valid([]byte(*text)) || decoder.Decode(&root) != nil || root == nil {
			return nil, errors.New("资料库设置不是有效的 JSON 对象")
		}
	}
	return root, nil
}

func settingsObject(value any) map[string]any {
	if object, ok := value.(map[string]any); ok && object != nil {
		return object
	}
	return make(map[string]any)
}

func recordingASRSettings(root map[string]any) RecordingASRSettings {
	entry := settingsObject(settingsObject(root["plugins"])[speechPluginID])
	enabled, _ := entry["enabled"].(bool)
	model, _ := settingsObject(entry["preferences"])["model"].(string)
	if model == "" {
		model = defaultASRModel
	}
	return RecordingASRSettings{Enabled: enabled, Model: model}
}

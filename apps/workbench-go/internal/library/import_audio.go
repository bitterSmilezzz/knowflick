package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"knowflick.local/workbench-go/internal/asr"
	"knowflick.local/workbench-go/internal/media"
)

type recordingMetadata struct {
	DurationMs  int64  `json:"durationMs"`
	MIME        string `json:"mime"`
	Transcript  string `json:"transcript"`
	Transcribed bool   `json:"transcribed"`
}

// SaveRecording 把录音原件和可检索的素材存入收件箱。
func (l *Library) SaveRecording(ctx context.Context, dir, mimeType string, durationMs int64, data []byte, now time.Time) (string, error) {
	if !l.writable {
		return "", ErrReadOnly
	}
	if len(data) == 0 || durationMs <= 0 {
		return "", errors.New("录音没有内容，请重新录制")
	}
	return l.SaveAudioBytes(ctx, dir, mimeType, durationMs, data, now)
}

// SaveAudioBytes 建立音频素材并保存原件；durationMs 为 0 时保留附件、标记稍后补时长。
func (l *Library) SaveAudioBytes(ctx context.Context, dir, mimeType string, durationMs int64, data []byte, now time.Time) (string, error) {
	if !l.writable {
		return "", ErrReadOnly
	}
	if len(data) == 0 {
		return "", errors.New("录音没有内容，请重新录制")
	}
	// MediaRecorder 返回的类型可能带有 codecs 参数，保存扩展名仅取媒体类型。
	contentType, _, err := mime.ParseMediaType(mimeType)
	if err != nil {
		return "", errors.New("录音格式无效")
	}
	metadata, err := json.Marshal(recordingMetadata{DurationMs: durationMs, MIME: contentType})
	if err != nil {
		return "", err
	}
	material := ImportedMaterial{
		ID: uuid.NewString(), SourceType: "audio", InboxStatus: "inbox",
		Title:        fmt.Sprintf("语音笔记 · %d月%d日", int(now.Month()), now.Day()),
		RawText:      fmt.Sprintf("（语音笔记，%s；音频以附件保存。）", recordingDuration(durationMs)),
		MetadataJSON: string(metadata), CreatedAt: now.UnixMilli(), UpdatedAt: now.UnixMilli(),
	}
	return l.saveMaterialAttachment(ctx, material, dir, "audio", contentType, data)
}

// SaveAudioFile 导入本机音频文件，原件保存在库内附件中。
func (l *Library) SaveAudioFile(ctx context.Context, dir, path string, now time.Time) (string, error) {
	if !l.writable {
		return "", ErrReadOnly
	}
	name := filepath.Base(path)
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("无法读取所选音频文件")
	}
	if info.Size() > media.MaxAudio {
		return "", errors.New("音频文件超过 64 MB 上限")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", errors.New("无法打开所选音频文件")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, media.MaxAudio+1))
	if err != nil {
		return "", errors.New("无法读取所选音频文件")
	}
	if len(data) > media.MaxAudio {
		return "", errors.New("音频文件超过 64 MB 上限")
	}
	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	contentType := audioMIME(extension)
	if contentType == "" {
		return "", errors.New("请选择 WAV、WebM、MP3、M4A 或 OGG 音频文件")
	}
	duration, _ := asr.ProbeDurationMS(path)
	return l.SaveAudioBytes(ctx, dir, contentType, duration, data, now)
}

func audioMIME(extension string) string {
	switch extension {
	case "wav":
		return "audio/wav"
	case "webm":
		return "audio/webm"
	case "mp3":
		return "audio/mpeg"
	case "m4a":
		return "audio/mp4"
	case "ogg", "oga":
		return "audio/ogg"
	default:
		return ""
	}
}

func recordingDuration(ms int64) string {
	if ms <= 0 {
		return "时长待定"
	}
	seconds := ms / 1000
	if ms%1000 >= 500 {
		seconds++
	}
	if seconds >= 60 {
		return fmt.Sprintf("%d 分 %d 秒", seconds/60, seconds%60)
	}
	return fmt.Sprintf("%d 秒", seconds)
}

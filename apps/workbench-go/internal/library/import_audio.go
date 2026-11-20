package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"time"

	"github.com/google/uuid"
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

func recordingDuration(ms int64) string {
	seconds := ms / 1000
	if ms%1000 >= 500 {
		seconds++
	}
	if seconds >= 60 {
		return fmt.Sprintf("%d 分 %d 秒", seconds/60, seconds%60)
	}
	return fmt.Sprintf("%d 秒", seconds)
}

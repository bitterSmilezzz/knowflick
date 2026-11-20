package asr

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/google/uuid"
)

// ToWAV16kMono 保留已有 WAV，其他格式转换为 16 kHz 单声道 PCM。
func ToWAV16kMono(ctx context.Context, input string) (string, error) {
	if strings.EqualFold(filepath.Ext(input), ".wav") {
		return input, nil
	}
	output := filepath.Join(os.TempDir(), "knowflick-asr-"+uuid.NewString()+".wav")
	if runtime.GOOS == "darwin" {
		command := exec.CommandContext(ctx, "afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", input, output)
		if err := command.Run(); err == nil {
			return output, nil
		}
		_ = os.Remove(output)
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
	}
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", errors.New("无法转换这段音频，请安装 FFmpeg 或使用 16 kHz 单声道 WAV")
	}
	command := exec.CommandContext(ctx, ffmpeg, "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file", "-i", input, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output)
	if err := command.Run(); err != nil {
		_ = os.Remove(output)
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", errors.New("无法转换这段音频，请检查录音格式")
	}
	return output, nil
}

package asr

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/google/uuid"
)

// ToWAV16kMono 把任意音频转成 16 kHz 单声道 WAV；已是 WAV 就原样返回。
// macOS 用系统自带的 afconvert（与桌面端同一条路径），其余平台没有内置转换器。
func ToWAV16kMono(input string) (string, error) {
	extension := strings.TrimPrefix(filepath.Ext(input), ".")
	if strings.EqualFold(extension, "wav") {
		return input, nil
	}
	if !isDarwin() {
		return "", errors.New("非 WAV 音频需要先转成 16 kHz 单声道 WAV（当前平台没有内置转换器）")
	}
	output := filepath.Join(os.TempDir(), fmt.Sprintf("knowflick-asr-%s.wav", uuid.NewString()))
	command := exec.Command("afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", input, output)
	if err := command.Run(); err != nil {
		_ = os.Remove(output)
		return "", errors.New("系统无法转换这段音频（支持 WAV；macOS 上其它格式经 afconvert 转换）")
	}
	return output, nil
}

func isDarwin() bool {
	return runtime.GOOS == "darwin"
}

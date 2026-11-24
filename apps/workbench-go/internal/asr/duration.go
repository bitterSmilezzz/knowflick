package asr

import (
	"encoding/binary"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// ProbeDurationMS 读取音频时长，供导入素材时显示。没有可用探测器时返回 0、false。
func ProbeDurationMS(path string) (int64, bool) {
	if ms, ok := wavDurationMS(path); ok {
		return ms, true
	}
	if ffprobe, err := exec.LookPath("ffprobe"); err == nil {
		output, err := exec.Command(ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path).Output()
		if err == nil {
			if seconds, parseErr := strconv.ParseFloat(strings.TrimSpace(string(output)), 64); parseErr == nil && seconds > 0 {
				return int64(seconds * 1000), true
			}
		}
	}
	if afinfo, err := exec.LookPath("afinfo"); err == nil {
		output, err := exec.Command(afinfo, path).Output()
		if err == nil {
			for _, line := range strings.Split(string(output), "\n") {
				lower := strings.ToLower(line)
				if !strings.Contains(lower, "estimated duration") {
					continue
				}
				fields := strings.Fields(line)
				for index, field := range fields {
					if field == "duration:" && index+1 < len(fields) {
						if seconds, parseErr := strconv.ParseFloat(fields[index+1], 64); parseErr == nil && seconds > 0 {
							return int64(seconds * 1000), true
						}
					}
				}
			}
		}
	}
	return 0, false
}

// wavDurationMS 直接读 WAV 头：byteRate 与 data 块长度足够算出时长，不依赖外部工具。
func wavDurationMS(path string) (int64, bool) {
	file, err := os.Open(path)
	if err != nil {
		return 0, false
	}
	defer file.Close()
	header := make([]byte, 12)
	if _, err := file.Read(header); err != nil || string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return 0, false
	}
	pos := int64(12)
	var byteRate uint32
	var dataSize uint32
	buffer := make([]byte, 8)
	for {
		if _, err := file.ReadAt(buffer, pos); err != nil {
			return 0, false
		}
		id := string(buffer[0:4])
		length := binary.LittleEndian.Uint32(buffer[4:8])
		if id == "fmt " && length >= 12 {
			fmtData := make([]byte, 12)
			if _, err := file.ReadAt(fmtData, pos+8); err != nil {
				return 0, false
			}
			byteRate = binary.LittleEndian.Uint32(fmtData[8:12])
		}
		if id == "data" {
			dataSize = length
			break
		}
		pos += 8 + int64(length) + int64(length%2)
		if pos > 1<<20 {
			return 0, false
		}
	}
	if byteRate == 0 || dataSize == 0 {
		return 0, false
	}
	return int64(float64(dataSize) * 1000 / float64(byteRate)), true
}

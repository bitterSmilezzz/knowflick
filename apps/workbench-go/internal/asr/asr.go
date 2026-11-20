// Package asr 迁自 Rust 的 asr.rs：模型目录与状态、下载、WAV 解析，
// 以及**用外部 whisper-cli 进程**做转写（ADR-0008 阶段 0 已验证这条路线）。
//
// 为什么用外部进程而不是 cgo：cgo 会把 whisper.cpp 的 C++ 编译链搬回来，
// 把 ADR-0005 记的 CMAKE_ASM_COMPILER 那类问题原样带过来，还让编译变慢——
// 正好抵消迁移的收益。whisper.cpp 在 brew 里是 bottled 预编译的，
// 外部进程这条路的编译期依赖为零。
package asr

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"knowflick.local/workbench-go/internal/httpx"
)

// Model 是目录里的一档模型。
type Model struct {
	Name         string `json:"name"`
	File         string `json:"file"`
	ExpectedSize int64  `json:"expectedBytes"`
}

// Catalog 与 Rust 的 MODEL_CATALOG 逐条一致：名字、权重文件名、期望字节数。
var Catalog = []Model{
	{Name: "tiny", File: "ggml-tiny.bin", ExpectedSize: 77_700_000},
	{Name: "base", File: "ggml-base.bin", ExpectedSize: 147_900_000},
	{Name: "small", File: "ggml-small.bin", ExpectedSize: 487_600_000},
}

// Status 是一档模型的安装状态。
type Status struct {
	Model         string  `json:"model"`
	Installed     bool    `json:"installed"`
	Path          *string `json:"path"`
	SizeBytes     int64   `json:"sizeBytes"`
	ExpectedBytes int64   `json:"expectedBytes"`
}

// Result 是一次转写结果。
type Result struct {
	Text      string `json:"text"`
	AudioMS   int64  `json:"audioMs"`
	ElapsedMS int64  `json:"elapsedMs"`
	Model     string `json:"model"`
}

// ModelsDir 是权重目录（与 Rust 的 <data_root>/models 一致）。
func ModelsDir(dataRoot string) string {
	return filepath.Join(dataRoot, "models")
}

// ModelPath 返回某档模型的权重路径。
func ModelPath(dataRoot, model string) (string, error) {
	entry, err := lookup(model)
	if err != nil {
		return "", err
	}
	return filepath.Join(ModelsDir(dataRoot), entry.File), nil
}

// ModelStatus 只看文件是否非空：大小与期望值只用于展示进度，不当作安装判据。
func ModelStatus(dataRoot, model string) (Status, error) {
	entry, err := lookup(model)
	if err != nil {
		return Status{}, err
	}
	path, err := ModelPath(dataRoot, model)
	if err != nil {
		return Status{}, err
	}
	var size int64
	if info, statErr := os.Stat(path); statErr == nil {
		size = info.Size()
	}
	status := Status{Model: model, Installed: size > 0, SizeBytes: size, ExpectedBytes: entry.ExpectedSize}
	if status.Installed {
		status.Path = &path
	}
	return status, nil
}

// DownloadURL 是官方权重地址；镜像回退由调用方决定（直连会 Connection reset）。
func DownloadURL(model string) (string, error) {
	entry, err := lookup(model)
	if err != nil {
		return "", err
	}
	return "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/" + entry.File, nil
}

func lookup(model string) (Model, error) {
	for _, entry := range Catalog {
		if entry.Name == model {
			return entry, nil
		}
	}
	return Model{}, fmt.Errorf("未知的语音模型: %s", model)
}

// Download 把权重流式下到 target，先写 .part 再改名。
// 失败时删 .part，避免留下「文件存在但内容是半截」的假模型。
func Download(ctx context.Context, url, target string, onProgress func(done, total int64)) (int64, error) {
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return 0, errors.New("创建模型目录失败")
	}
	partial := target + ".part"
	_ = os.Remove(partial)
	targetURL, err := httpx.ValidateURL(url)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL.String(), nil)
	if err != nil {
		return 0, err
	}
	client := httpx.NewClient(targetURL, 600*time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("下载失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return 0, fmt.Errorf("下载失败：服务返回 %d", resp.StatusCode)
	}
	file, err := os.Create(partial)
	if err != nil {
		return 0, errors.New("无法创建模型文件")
	}
	total := resp.ContentLength
	var done int64
	buffer := make([]byte, 64*1024)
	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			if _, writeErr := file.Write(buffer[:n]); writeErr != nil {
				file.Close()
				_ = os.Remove(partial)
				return 0, errors.New("写入模型文件失败")
			}
			done += int64(n)
			if onProgress != nil {
				onProgress(done, total)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			file.Close()
			_ = os.Remove(partial)
			return 0, fmt.Errorf("下载中断: %w", readErr)
		}
	}
	if err := file.Sync(); err != nil {
		file.Close()
		_ = os.Remove(partial)
		return 0, errors.New("写入模型文件失败")
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(partial)
		return 0, errors.New("写入模型文件失败")
	}
	if err := os.Rename(partial, target); err != nil {
		_ = os.Remove(partial)
		return 0, errors.New("无法放置模型文件")
	}
	return done, nil
}

// ReadWAVMonoF32 解析 WAV 的 data 块成 f32 采样。只认 16-bit PCM：
// 别的位深直接报错，避免拿错解释的数据喂给模型得出乱码文本。
func ReadWAVMonoF32(path string) ([]float32, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取音频失败: %w", err)
	}
	if len(bytes) < 12 || string(bytes[0:4]) != "RIFF" || string(bytes[8:12]) != "WAVE" {
		return nil, errors.New("不是合法的 WAV 文件")
	}
	pos := 12
	bitsPerSample := 0
	var dataStart, dataEnd = -1, -1
	for pos+8 <= len(bytes) {
		id := string(bytes[pos : pos+4])
		length := int(uint32(bytes[pos+4]) | uint32(bytes[pos+5])<<8 | uint32(bytes[pos+6])<<16 | uint32(bytes[pos+7])<<24)
		body := pos + 8
		if id == "fmt " && body+16 <= len(bytes) {
			bitsPerSample = int(uint16(bytes[body+14]) | uint16(bytes[body+15])<<8)
		} else if id == "data" {
			end := body + length
			if end > len(bytes) {
				end = len(bytes)
			}
			dataStart, dataEnd = body, end
			break
		}
		pos = body + length + (length % 2)
	}
	if dataStart < 0 {
		return nil, errors.New("WAV 缺少 data 块")
	}
	if bitsPerSample != 16 {
		return nil, fmt.Errorf("只支持 16-bit PCM 的 WAV（当前 %d-bit）", bitsPerSample)
	}
	payload := bytes[dataStart:dataEnd]
	out := make([]float32, 0, len(payload)/2)
	for i := 0; i+1 < len(payload); i += 2 {
		sample := int16(uint16(payload[i]) | uint16(payload[i+1])<<8)
		out = append(out, float32(sample)/32768.0)
	}
	return out, nil
}

// Transcribe 用外部 whisper-cli 转写一个 WAV。
// 调用方负责确认模型已下载；这里再查一次，避免把不存在的路径交给子进程。
func Transcribe(ctx context.Context, modelPath, wavPath, modelName string) (Result, error) {
	if _, err := os.Stat(modelPath); err != nil {
		return Result{}, fmt.Errorf("语音模型不存在：%s", modelPath)
	}
	samples, err := ReadWAVMonoF32(wavPath)
	if err != nil {
		return Result{}, err
	}
	if len(samples) == 0 {
		return Result{}, errors.New("音频里没有可用采样")
	}
	bin, err := exec.LookPath("whisper-cli")
	if err != nil {
		return Result{}, errors.New("未找到 whisper-cli：请先安装 whisper.cpp（brew install whisper-cpp）")
	}
	outBase := filepath.Join(os.TempDir(), fmt.Sprintf("knowflick-asr-%d", time.Now().UnixNano()))
	defer os.Remove(outBase + ".txt")
	cmd := exec.CommandContext(ctx, bin,
		"-m", modelPath, "-f", wavPath,
		"-l", "auto", "-otxt", "-of", outBase, "--no-prints")
	var stderr strings.Builder
	cmd.Stderr = &stderr
	start := time.Now()
	if err := cmd.Run(); err != nil {
		return Result{}, fmt.Errorf("转写失败: %v（%s）", err, strings.TrimSpace(stderr.String()))
	}
	elapsed := time.Since(start)
	text, err := os.ReadFile(outBase + ".txt")
	if err != nil {
		return Result{}, errors.New("转写没有产出文本")
	}
	return Result{
		Text:      strings.TrimSpace(string(text)),
		AudioMS:   int64(len(samples)) * 1000 / 16000,
		ElapsedMS: elapsed.Milliseconds(),
		Model:     modelName,
	}, nil
}

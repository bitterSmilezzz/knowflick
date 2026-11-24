package main

import (
	"context"
	"fmt"
	"os"

	"knowflick.local/workbench-go/internal/asr"
	"knowflick.local/workbench-go/internal/dataroot"
)

// AsrDownloadState 是一次模型下载的进度快照，界面轮询读取。
type AsrDownloadState struct {
	Model      string `json:"model"`
	Running    bool   `json:"running"`
	Done       bool   `json:"done"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
	Error      string `json:"error"`
}

// AsrCatalog 列出可选模型（与桌面端目录一致）。
func (s *PreviewService) AsrCatalog(ctx context.Context) ([]asr.Model, error) {
	return asr.Catalog, nil
}

// AsrModelStatus 查一档模型是否已安装；model 为空时默认 small。
func (s *PreviewService) AsrModelStatus(ctx context.Context, model string) (asr.Status, error) {
	if model == "" {
		model = "small"
	}
	return asr.ModelStatus(dataroot.Dir(), model)
}

// StartAsrDownload 后台下载模型权重；进度通过 AsrDownloadProgress 轮询读取。
// 下载失败会留下 error 文案，且不会留下半截的假模型（.part 先写后改名）。
func (s *PreviewService) StartAsrDownload(ctx context.Context, model string) error {
	if model == "" {
		model = "small"
	}
	url, err := asr.DownloadURL(model)
	if err != nil {
		return err
	}
	target, err := asr.ModelPath(dataroot.Dir(), model)
	if err != nil {
		return err
	}
	s.asrMu.Lock()
	if s.asrDownloads == nil {
		s.asrDownloads = map[string]*AsrDownloadState{}
	}
	if existing := s.asrDownloads[model]; existing != nil && existing.Running {
		s.asrMu.Unlock()
		return fmt.Errorf("语音模型 %s 正在下载中", model)
	}
	state := &AsrDownloadState{Model: model, Running: true}
	s.asrDownloads[model] = state
	s.asrMu.Unlock()

	go func() {
		var last int64
		_, downloadErr := asr.Download(context.Background(), url, target, func(done, total int64) {
			// 每 2 MB 或每跨过一个百分位刷新一次，避免刷爆轮询。
			step := done-last >= 2*1024*1024
			percentStep := total > 0 && (done*100/total) > (last*100/maxInt64(last, 1))
			if step || percentStep || done == total {
				last = done
				s.asrMu.Lock()
				state.Downloaded = done
				state.Total = total
				s.asrMu.Unlock()
				s.emitAsrProgress(model, done, total, false)
			}
		})
		s.asrMu.Lock()
		state.Running = false
		state.Done = true
		if downloadErr != nil {
			state.Error = downloadErr.Error()
		} else {
			state.Downloaded = state.Total
		}
		s.asrMu.Unlock()
		s.emitAsrProgress(model, state.Downloaded, state.Total, true)
	}()
	return nil
}

// emitAsrProgress 把下载进度推给共享设置页；没有界面时静默。
func (s *PreviewService) emitAsrProgress(model string, downloaded, total int64, done bool) {
	if s.app == nil {
		return
	}
	s.app.Event.Emit("knowflick:asr-progress", map[string]any{
		"model":      model,
		"downloaded": downloaded,
		"total":      total,
		"done":       done,
	})
}

// AsrDownloadProgress 返回某档模型的下载进度快照。
func (s *PreviewService) AsrDownloadProgress(ctx context.Context, model string) (AsrDownloadState, error) {
	if model == "" {
		model = "small"
	}
	s.asrMu.Lock()
	defer s.asrMu.Unlock()
	if state := s.asrDownloads[model]; state != nil {
		snapshot := *state
		return snapshot, nil
	}
	return AsrDownloadState{Model: model}, nil
}

// AsrTranscribe 转写一段音频：模型未下载或文件不存在都先给中文指引。
func (s *PreviewService) AsrTranscribe(ctx context.Context, model, path string) (asr.Result, error) {
	if model == "" {
		model = "small"
	}
	root := dataroot.Dir()
	status, err := asr.ModelStatus(root, model)
	if err != nil {
		return asr.Result{}, err
	}
	if !status.Installed {
		return asr.Result{}, fmt.Errorf("语音模型 %s 尚未下载，请先在设置里下载模型", model)
	}
	if info, statErr := os.Stat(path); statErr != nil || info.IsDir() {
		return asr.Result{}, fmt.Errorf("音频文件不存在: %s", path)
	}
	modelPath, err := asr.ModelPath(root, model)
	if err != nil {
		return asr.Result{}, err
	}
	wav, err := asr.ToWAV16kMono(ctx, path)
	if err != nil {
		return asr.Result{}, err
	}
	if wav != path {
		defer func() { _ = os.Remove(wav) }()
	}
	return asr.Transcribe(ctx, modelPath, wav, model)
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

// DownloadAsrModelAndWait 同步下载一档语音模型并返回最终状态：
// 与 Rust asr_download_model 的返回契约一致（下载完成后的 model_status）。
// 预览端界面用 StartAsrDownload + AsrDownloadProgress 轮询；这个同步入口
// 供后续事件推送版界面或脚本化验证复用。
func (s *PreviewService) DownloadAsrModelAndWait(ctx context.Context, model string) (asr.Status, error) {
	if model == "" {
		model = "small"
	}
	url, err := asr.DownloadURL(model)
	if err != nil {
		return asr.Status{}, err
	}
	target, err := asr.ModelPath(dataroot.Dir(), model)
	if err != nil {
		return asr.Status{}, err
	}
	var last int64
	if _, err := asr.Download(ctx, url, target, func(done, total int64) {
		if done-last >= 2*1024*1024 || (total > 0 && done*100/total != last*100/maxInt64(total, 1)) || done == total {
			last = done
			s.emitAsrProgress(model, done, total, false)
		}
	}); err != nil {
		return asr.Status{}, err
	}
	status, err := asr.ModelStatus(dataroot.Dir(), model)
	if err == nil {
		s.emitAsrProgress(model, status.SizeBytes, status.SizeBytes, true)
	}
	return status, err
}

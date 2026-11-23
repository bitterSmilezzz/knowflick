package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/media"
)

// PreviewService 是预览窗口的后端：默认只读，用户显式启用编辑后才可写。
type PreviewService struct {
	app           *application.App
	window        application.Window
	capsuleWindow application.Window
	initialPath   string
	mu            sync.RWMutex
	current       *library.Library
	path          string
	writable      bool
	generation    int
	mailContext   context.Context
	cancelMail    context.CancelFunc
	onMailChanged func(int)

	asrMu        sync.Mutex
	asrDownloads map[string]*AsrDownloadState
}

// LibraryView 是打开资料库后的返回：名称、代号与首页。
type LibraryView struct {
	Name       string       `json:"name"`
	Path       string       `json:"path"`
	Writable   bool         `json:"writable"`
	Generation int          `json:"generation"`
	Page       library.Page `json:"page"`
}

func (s *PreviewService) OpenInitialLibrary(ctx context.Context) (*LibraryView, error) {
	if s.initialPath == "" {
		return nil, nil
	}
	return s.open(ctx, s.initialPath, false)
}

// ChooseLibrary 打开另一个库：重新选择一律回到只读，避免「顺手」继承了写权限。
func (s *PreviewService) ChooseLibrary(ctx context.Context) (*LibraryView, error) {
	path, err := s.app.Dialog.OpenFile().AttachToWindow(s.window).SetTitle("选择 KnowFlick 资料库").AddFilter("SQLite 资料库", "*.db;*.sqlite;*.sqlite3").PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	return s.open(ctx, path, false)
}

// EnableEditing 以同一路径重新打开为可写。只读打开时写方法会拒绝，
// 所以「能不能写」由这一步显式决定，不是隐式默认。
func (s *PreviewService) EnableEditing(ctx context.Context) (*LibraryView, error) {
	s.mu.RLock()
	path := s.path
	s.mu.RUnlock()
	if path == "" {
		return nil, errors.New("请先打开资料库")
	}
	return s.open(ctx, path, true)
}

func (s *PreviewService) open(ctx context.Context, path string, writable bool) (*LibraryView, error) {
	var (
		next *library.Library
		err  error
	)
	if writable {
		next, err = library.OpenForWrite(ctx, path)
	} else {
		next, err = library.Open(ctx, path)
	}
	if err != nil {
		return nil, fmt.Errorf("打开资料库失败: %w", err)
	}
	page, err := next.List(ctx, 0)
	if err != nil {
		next.Close()
		return nil, fmt.Errorf("读取笔记失败: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil {
		s.current.Close()
	}
	s.current = next
	s.path = path
	s.writable = writable
	s.generation++
	s.resetMailContext(writable)
	return &LibraryView{Name: filepath.Base(filepath.Dir(path)) + " / " + filepath.Base(path), Path: path, Writable: writable, Generation: s.generation, Page: page}, nil
}

// ListNotes 分页列笔记；代号不符说明界面拿的是旧库，直接拒绝而不是串库。
func (s *PreviewService) ListNotes(ctx context.Context, generation, offset int) (library.Page, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.Page{}, errors.New("请重新打开资料库")
	}
	if offset < 0 {
		return library.Page{}, errors.New("页码无效")
	}
	return s.current.List(ctx, offset)
}

// ListNotesScoped 按 active / deleted / all 分页；共享笔记页用同一入口读回收站。
func (s *PreviewService) ListNotesScoped(ctx context.Context, generation int, scope string, limit, offset int) (library.Page, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.Page{}, errors.New("请重新打开资料库")
	}
	if offset < 0 {
		return library.Page{}, errors.New("页码无效")
	}
	return s.current.ListScope(ctx, scope, limit, offset)
}
// SearchNotes 检索；空查询退回列表。
func (s *PreviewService) SearchNotes(ctx context.Context, generation int, query string) (library.Page, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.Page{}, errors.New("请重新打开资料库")
	}
	return s.current.Search(ctx, query)
}

// SaveNote 保存一篇笔记。冲突不是错误信息泛化，而是明确说「已被别处改动」。
func (s *PreviewService) SaveNote(ctx context.Context, generation int, note library.Note, baseRevision int64) (library.SaveOutcome, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.SaveOutcome{}, errors.New("请重新打开资料库")
	}
	if !s.writable {
		return library.SaveOutcome{}, errors.New("当前是只读模式，请先点「启用编辑」")
	}
	if note.ID == "" {
		return library.SaveOutcome{}, errors.New("笔记缺少标识")
	}
	now := time.Now().UnixMilli()
	outcome, err := s.current.Upsert(ctx, note, baseRevision, now)
	var conflict *library.ConflictError
	if errors.As(err, &conflict) {
		return library.SaveOutcome{}, fmt.Errorf("这篇笔记已被别处改动（当前修订 %d），已刷新列表，请重试", conflict.CurrentRevision)
	}
	return outcome, err
}

// DeleteNote 把笔记移进回收站；索引同步移除。
func (s *PreviewService) DeleteNote(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	if !s.writable {
		return false, errors.New("当前是只读模式，请先点「启用编辑」")
	}
	return s.current.Delete(ctx, id, time.Now().UnixMilli())
}

// resetMailContext 使旧资料库的后台同步失效。调用方持有 s.mu。
func (s *PreviewService) resetMailContext(writable bool) {
	if s.cancelMail != nil {
		s.cancelMail()
	}
	s.mailContext, s.cancelMail = nil, nil
	if writable {
		s.mailContext, s.cancelMail = context.WithCancel(context.Background())
	}
}

func (s *PreviewService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resetMailContext(false)
	s.writable = false
	if s.current == nil {
		return nil
	}
	current := s.current
	s.current = nil
	return current.Close()
}

// ListDeletedNotes 列出回收站；代号不符直接拒绝。
func (s *PreviewService) ListDeletedNotes(ctx context.Context, generation, offset int) (library.Page, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return library.Page{}, errors.New("请重新打开资料库")
	}
	return s.current.ListDeleted(ctx, offset)
}

// RestoreNote 恢复一篇回收站笔记；恢复后索引立即回来。
func (s *PreviewService) RestoreNote(ctx context.Context, generation int, id string) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return false, errors.New("请重新打开资料库")
	}
	if !s.writable {
		return false, errors.New("当前是只读模式，请先点「启用编辑」")
	}
	return s.current.Restore(ctx, id)
}

// SearchChunkHits 检索分块；返回原文偏移，供界面跳回原笔记的具体位置。
func (s *PreviewService) SearchChunkHits(ctx context.Context, generation int, query string, limit int) ([]library.ChunkHit, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return nil, errors.New("请重新打开资料库")
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return s.current.SearchChunks(ctx, query, limit)
}

// SaveAttachment 把 IPC 送来的 base64 附件落到库目录旁的 media/ 下，返回相对路径。
func (s *PreviewService) SaveAttachment(ctx context.Context, generation int, kind, mime, dataB64 string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	if !s.writable {
		return "", errors.New("当前是只读模式，请先点「启用编辑」")
	}
	bytes, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return "", errors.New("附件数据无效，无法解码")
	}
	return media.Save(filepath.Dir(s.path), kind, mime, bytes)
}

// ReadAttachment 读回附件；返回 base64，避免 Vec/u8[] 被 JSON 展开成数字数组。
func (s *PreviewService) ReadAttachment(ctx context.Context, generation int, relative string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	bytes, err := media.Read(filepath.Dir(s.path), relative)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(bytes), nil
}

// RestoreAttachment 按备份里的原相对路径恢复附件；同路径已有不同内容时拒绝覆盖。
func (s *PreviewService) RestoreAttachment(ctx context.Context, generation int, relative, dataB64 string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	if !s.writable {
		return "", errors.New("当前是只读模式，请先点「启用编辑」")
	}
	bytes, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return "", errors.New("附件数据无效，无法解码")
	}
	return media.Restore(filepath.Dir(s.path), relative, bytes)
}

// SaveMediaCapture 把一段媒体字节存到资料库 media/<kind>/ 下（save_media）。
// 录音/手写/图片导入各自有专用服务（写库+附件事务）；这里是底层入口，
// 供桌面端通用保存路径（如粘贴截图）复用。
func (s *PreviewService) SaveMediaCapture(ctx context.Context, generation int, kind, mime, dataB64 string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	data, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return "", errors.New("媒体数据无效，无法解码")
	}
	return media.Save(filepath.Dir(s.path), kind, mime, data)
}

// ReadMediaBytes 读回一段媒体（read_media）：返回 base64，避免 JSON 数组放大。
func (s *PreviewService) ReadMediaBytes(ctx context.Context, generation int, relative string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	data, err := media.Read(filepath.Dir(s.path), relative)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

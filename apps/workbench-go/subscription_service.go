package main

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"time"

	"knowflick.local/workbench-go/internal/library"
)

// SubscriptionService 把订阅源管理挂到预览后端：列出、新增/更新、删除、记录抓取时间。
//
// 列表只要求库已打开（读操作）；写操作要求可写——和邮箱一样，明确拒绝而不是静默失败。
type SubscriptionService struct {
	preview *PreviewService

	mu  sync.Mutex
	db  *sql.DB
	dir string
}

// ListSubscriptions 按创建时间列出订阅。
func (s *SubscriptionService) ListSubscriptions(ctx context.Context) ([]library.Subscription, error) {
	dir, err := s.requireOpen()
	if err != nil {
		return nil, err
	}
	db, err := s.connection(dir)
	if err != nil {
		return nil, err
	}
	return library.ListSubscriptions(ctx, db)
}

// SaveSubscription 新增或更新一条订阅；间隔与地址按校验规则拒绝不合法输入。
func (s *SubscriptionService) SaveSubscription(ctx context.Context, item library.Subscription) error {
	dir, err := s.requireWritable()
	if err != nil {
		return err
	}
	db, err := s.connection(dir)
	if err != nil {
		return err
	}
	return library.SaveSubscription(ctx, db, item)
}

// DeleteSubscription 删除订阅（硬删除；抓来的素材保留）。
func (s *SubscriptionService) DeleteSubscription(ctx context.Context, id string) error {
	dir, err := s.requireWritable()
	if err != nil {
		return err
	}
	db, err := s.connection(dir)
	if err != nil {
		return err
	}
	return library.DeleteSubscription(ctx, db, id)
}

// MarkSubscriptionPolled 只更新抓取时间，不碰类型、标题与间隔。
func (s *SubscriptionService) MarkSubscriptionPolled(ctx context.Context, id string, polledAt int64) error {
	dir, err := s.requireWritable()
	if err != nil {
		return err
	}
	db, err := s.connection(dir)
	if err != nil {
		return err
	}
	return library.MarkSubscriptionPolled(ctx, db, id, polledAt)
}

// NowMillis 是「刚刚抓过」的时间戳来源；抽出来便于测试固定。
func NowMillis() int64 { return time.Now().UnixMilli() }

func (s *SubscriptionService) requireOpen() (string, error) {
	s.preview.mu.RLock()
	defer s.preview.mu.RUnlock()
	if s.preview.path == "" {
		return "", errors.New("请先打开资料库")
	}
	return filepath.Dir(s.preview.path), nil
}

func (s *SubscriptionService) requireWritable() (string, error) {
	s.preview.mu.RLock()
	defer s.preview.mu.RUnlock()
	if s.preview.path == "" {
		return "", errors.New("请先打开资料库")
	}
	if !s.preview.writable {
		return "", errors.New("订阅源保存在资料库里，请先启用编辑")
	}
	return filepath.Dir(s.preview.path), nil
}

// connection 复用同一个连接：写操作串行，一个连接足够。
func (s *SubscriptionService) connection(dir string) (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil && s.dir == dir {
		return s.db, nil
	}
	if s.db != nil {
		_ = s.db.Close()
		s.db = nil
	}
	uri := "file:" + filepath.Join(dir, "knowflick.db") + "?mode=rwc&_pragma=busy_timeout(10000)"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		return nil, errors.New("无法打开资料库")
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(library.SubscriptionSchema); err != nil {
		_ = db.Close()
		return nil, errors.New("订阅数据表结构初始化失败")
	}
	s.db, s.dir = db, dir
	return db, nil
}

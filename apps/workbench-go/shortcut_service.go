package main

import (
	"context"
	"errors"
)

// ShortcutStatus 是全局快捷键的注册状态（与 Rust ShortcutStatus 同形）。
type ShortcutStatus struct {
	Shortcut   string  `json:"shortcut"`
	Registered bool    `json:"registered"`
	Error      *string `json:"error"`
}

const capsuleAccelerator = "Alt+Space"

// GetShortcutStatus 返回当前快捷键注册状态。
// 快捷键在启动时注册；这里只读状态，不重复注册。
func (s *PreviewService) GetShortcutStatus(ctx context.Context) (ShortcutStatus, error) {
	if s.app == nil {
		return ShortcutStatus{Shortcut: capsuleAccelerator, Registered: false, Error: strPtr("应用尚未启动")}, nil
	}
	if s.app.GlobalShortcut.IsRegistered(capsuleAccelerator) {
		return ShortcutStatus{Shortcut: capsuleAccelerator, Registered: true}, nil
	}
	return ShortcutStatus{Shortcut: capsuleAccelerator, Registered: false, Error: strPtr("快捷键可能被其他应用占用。请从应用菜单打开胶囊。")}, nil
}

// HideCapsule 隐藏快捷捕捉窗口（hide_capsule）。
func (s *PreviewService) HideCapsule(ctx context.Context) error {
	if s.capsuleWindow == nil {
		return errors.New("捕捉窗口尚未创建")
	}
	s.capsuleWindow.Hide()
	return nil
}

// ToggleCapsule 显示/隐藏快捷捕捉窗口（toggle_capsule）。
func (s *PreviewService) ToggleCapsule(ctx context.Context) error {
	if s.capsuleWindow == nil {
		return errors.New("捕捉窗口尚未创建")
	}
	if s.capsuleWindow.IsVisible() {
		s.capsuleWindow.Hide()
	} else {
		s.capsuleWindow.Show()
	}
	return nil
}

func strPtr(value string) *string { return &value }

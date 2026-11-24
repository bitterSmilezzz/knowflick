package main

import (
	"context"
	"errors"
	"os/exec"
	"strings"
)

// SendSystemNotification 通过 macOS 通知中心提醒主动回顾；标题与正文由共享提醒调度传入。
func (s *PreviewService) SendSystemNotification(ctx context.Context, title, body string) error {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	if title == "" {
		return errors.New("通知标题不能为空")
	}
	if body == "" {
		body = "该回顾一下了"
	}
	// 参数走 argv，不拼进 AppleScript 源码，避免引号或换行被当成脚本。
	cmd := exec.CommandContext(ctx, "osascript",
		"-e", "on run argv",
		"-e", "display notification (item 2 of argv) with title (item 1 of argv)",
		"-e", "end run",
		"--", title, body)
	if err := cmd.Run(); err != nil {
		return errors.New("系统通知发送失败")
	}
	return nil
}

// Package errtext 把底层错误翻成「原因 + 下一步」，供面向用户的错误消息使用。
//
// 背景：Rust 壳时代用户可见的错误里混着底层英文（「下载模型失败: error sending request for url ...」），
// 用户看懂了前半句却不知道为什么、也不知道下一步。Go 侧对应写法是 fmt.Errorf("前缀：%w", err)——
// 中文前缀后面直接拼英文。这里提供 Explain 与 Wrap：消息保持中文可读，原始英文放在括号里
// 供开发者定位（与 Rust 的 error_text 同一口径）。
package errtext

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
)

// Explain 按错误特征给出中文的「原因 + 下一步」；识别不了时给通用建议，原始错误由调用方保留。
func Explain(err error) string {
	if err == nil {
		return "操作失败"
	}
	switch {
	case errors.Is(err, context.Canceled):
		return "操作已取消"
	case errors.Is(err, context.DeadlineExceeded):
		return "操作超时：网络或服务响应太慢，稍后重试"
	case errors.Is(err, io.EOF):
		return "数据提前结束，内容可能不完整"
	case errors.Is(err, os.ErrNotExist):
		return "文件不存在：检查路径是否正确"
	case errors.Is(err, os.ErrPermission):
		return "权限不足：检查文件所属与系统权限设置"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "网络超时：检查网络或服务是否可用"
	}
	var pathErr *os.PathError
	if errors.As(err, &pathErr) {
		return explainText(pathErr.Op + " " + pathErr.Path + ": " + pathErr.Err.Error())
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		addr := ""
		if opErr.Addr != nil {
			addr = opErr.Addr.String()
		}
		return explainText(opErr.Op + " " + opErr.Net + " " + addr + ": " + opErr.Err.Error())
	}
	return explainText(err.Error())
}

func explainText(msg string) string {
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "connection refused"):
		return "连接被拒绝：目标服务可能没在运行，先启动它或检查地址"
	case strings.Contains(lower, "no such host"),
		strings.Contains(lower, "server misbehaving"),
		strings.Contains(lower, "temporary failure in name resolution"):
		return "域名解析失败：检查网络与地址拼写"
	case strings.Contains(lower, "certificate"), strings.Contains(lower, "x509"):
		return "证书校验失败：检查系统时间或换用可信证书"
	case strings.Contains(lower, "no space left"):
		return "磁盘空间不足：清理后重试"
	case strings.Contains(lower, "read-only file system"):
		return "目标位置是只读的：换一个可写目录"
	case strings.Contains(lower, "permission denied"):
		return "权限不足：检查文件所属与系统权限设置"
	case strings.Contains(lower, "i/o error"), strings.Contains(lower, "input/output error"):
		return "磁盘读写失败：检查磁盘健康与路径"
	case strings.Contains(lower, "database is locked"), strings.Contains(lower, "sqlite_busy"):
		return "资料库正被占用：稍后重试或关闭其它窗口"
	case strings.Contains(lower, "unique constraint"):
		return "数据已存在（唯一约束冲突）"
	case strings.Contains(lower, "constraint failed"):
		return "数据不符合约束：检查必填字段与格式"
	case strings.Contains(lower, "unexpected eof"):
		return "数据提前结束，内容可能不完整"
	case strings.Contains(lower, "invalid utf-8"), strings.Contains(lower, "not utf-8"):
		return "文本编码不是 UTF-8：换用 UTF-8 编码后重试"
	default:
		return "操作失败，请重试；若持续出现请带上原始错误反馈"
	}
}

// Wrap 生成面向用户的错误：中文前缀 + 原因/下一步，原始错误留在括号里并保留 Unwrap 链。
func Wrap(prefix string, err error) error {
	if err == nil {
		return nil
	}
	return wrapped{message: prefix + "：" + Explain(err) + "（原始错误：" + err.Error() + "）", err: err}
}

type wrapped struct {
	message string
	err     error
}

func (w wrapped) Error() string { return w.message }
func (w wrapped) Unwrap() error { return w.err }

var _ = fmt.Sprintf

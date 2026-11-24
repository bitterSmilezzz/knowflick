package errtext

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestExplainMapsCommonCauses(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{context.DeadlineExceeded, "超时"},
		{os.ErrNotExist, "不存在"},
		{os.ErrPermission, "权限不足"},
		{errors.New("dial tcp 127.0.0.1:11434: connect: connection refused"), "连接被拒绝"},
		{errors.New("x509: certificate signed by unknown authority"), "证书"},
		{errors.New("database is locked"), "占用"},
	}
	for _, c := range cases {
		if got := Explain(c.err); !strings.Contains(got, c.want) {
			t.Fatalf("Explain(%v) = %q, want contains %q", c.err, got, c.want)
		}
	}
}

func TestExplainUnknownGivesActionableFallback(t *testing.T) {
	if got := Explain(errors.New("something odd")); !strings.Contains(got, "重试") {
		t.Fatalf("fallback should tell the user what to do, got %q", got)
	}
}

func TestWrapKeepsPrefixAndChain(t *testing.T) {
	base := os.ErrNotExist
	err := Wrap("打开资料库失败", base)
	msg := err.Error()
	if !strings.HasPrefix(msg, "打开资料库失败：") || !strings.Contains(msg, "原始错误") {
		t.Fatalf("unexpected message: %q", msg)
	}
	if !errors.Is(err, base) {
		t.Fatal("Wrap must keep the errors.Is chain")
	}
}

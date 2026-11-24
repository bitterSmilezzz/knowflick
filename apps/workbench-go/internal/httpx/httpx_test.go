package httpx

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateURLRules(t *testing.T) {
	ok := []string{"https://example.com/a", "http://localhost:11434/v1", "http://127.0.0.1:8080", "http://[::1]:9000"}
	for _, raw := range ok {
		if _, err := ValidateURL(raw); err != nil {
			t.Fatalf("rejected valid url %q: %v", raw, err)
		}
	}
	bad := []string{
		"http://example.com",
		"ftp://example.com",
		"https://user:pass@example.com",
		"not a url",
		"",
	}
	for _, raw := range bad {
		if _, err := ValidateURL(raw); err == nil {
			t.Fatalf("accepted unsafe url %q", raw)
		}
	}
}

// TestPrintsLoopbackVerdictsForCrossPlatformParity 不 assert，只打印判定。
// tools/check_loopback_parity.mjs 用它把 Go 与 TypeScript 两套实现逐条对照；
// 地址批次必须与那个脚本、Android 的 LoopbackHostTest.kt 三处相同。
func TestPrintsLoopbackVerdictsForCrossPlatformParity(t *testing.T) {
	hosts := []string{
		"127.0.0.1",
		"localhost",
		"::1",
		"[::1]",
		"0:0:0:0:0:0:0:1",
		"[0:0:0:0:0:0:0:1]",
		"::",
		"[::]",
		"::ffff:127.0.0.1",
		"[::ffff:7f00:1]",
		"[2001:db8::1]",
		"192.168.1.10",
		"10.0.0.1",
		"example.com",
		"",
		"not a host",
	}
	for _, host := range hosts {
		fmt.Printf("PARITY\t%s\t%t\n", host, IsLoopbackHost(host))
	}
}

func TestLoopbackBypassesProxyAndOthersDoNot(t *testing.T) {
	for _, host := range []string{"localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"} {
		if !IsLoopbackHost(host) {
			t.Fatalf("%q should be loopback", host)
		}
	}
	for _, host := range []string{"example.com", "192.168.1.1", "10.0.0.1"} {
		if IsLoopbackHost(host) {
			t.Fatalf("%q should not be loopback", host)
		}
	}
}

func TestFetchClipDecodesAndCaps(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != userAgent {
			t.Errorf("unexpected user agent %q", r.Header.Get("User-Agent"))
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("剪藏正文"))
	}))
	defer server.Close()
	page, err := FetchClip(context.Background(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if page.Text != "剪藏正文" || page.FinalURL != server.URL {
		t.Fatalf("clip page: %+v", page)
	}
}

func TestFetchClipRejectsNonLoopbackHTTP(t *testing.T) {
	if _, err := FetchClip(context.Background(), "http://example.com"); err == nil {
		t.Fatal("non-loopback http accepted")
	}
}

func TestRedactSecrets(t *testing.T) {
	text := "failed with sk-abcdefghijklmnop and token AKIAIOSFODNN7EXAMPLE"
	redacted := RedactSecrets(text)
	if strings.Contains(redacted, "sk-abcdefghijklmnop") || strings.Contains(redacted, "AKIAIOSFODNN7EXAMPLE") {
		t.Fatalf("secret leaked: %s", redacted)
	}
	if !strings.Contains(redacted, "[已隐藏]") {
		t.Fatalf("no redaction marker: %s", redacted)
	}
	if RedactSecrets("普通错误信息") != "普通错误信息" {
		t.Fatal("plain text was modified")
	}
}

func TestWebDAVPutSendsBasicAuthAndBody(t *testing.T) {
	var gotAuth, gotBody, gotType string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method %s", r.Method)
		}
		gotAuth = r.Header.Get("Authorization")
		gotType = r.Header.Get("Content-Type")
		buf := new(strings.Builder)
		_, _ = io.Copy(buf, r.Body)
		gotBody = buf.String()
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()
	status, _, err := WebDAVPut(context.Background(), server.URL, "user", "pass", []byte("payload"), "application/json")
	if err != nil || status != http.StatusCreated {
		t.Fatalf("status %d err %v", status, err)
	}
	if gotBody != "payload" || gotType != "application/json" {
		t.Fatalf("body %q type %q", gotBody, gotType)
	}
	if !strings.HasPrefix(gotAuth, "Basic ") {
		t.Fatalf("missing basic auth: %q", gotAuth)
	}
}

func TestDecodeBodyHandlesGBK(t *testing.T) {
	// 「中文」的 GBK 编码：D6 D0 CE C4。只按 UTF-8 读会得到乱码。
	gbk := []byte{0xD6, 0xD0, 0xCE, 0xC4}
	if got := decodeBody(gbk, "text/html; charset=gbk"); got != "中文" {
		t.Fatalf("header charset gbk: %q", got)
	}
	// 没有 charset 声明、也没有 meta 标签时按 UTF-8 处理（与 Rust 同）：原始 GBK 字节不猜。
	if got := decodeBody(gbk, "text/html"); got != string(gbk) {
		t.Fatalf("no charset should pass through: %q", got)
	}
	meta := append([]byte("<html><head><meta charset='gbk'></head><body>"), gbk...)
	if got := decodeBody(meta, "text/html"); !strings.Contains(got, "中文") {
		t.Fatalf("meta tag charset not applied: %q", got)
	}
	if got := decodeBody([]byte("普通 UTF-8"), "text/html; charset=utf-8"); got != "普通 UTF-8" {
		t.Fatalf("utf-8 passthrough: %q", got)
	}
	if got := decodeBody([]byte("未知编码保持原样"), "text/html; charset=x-unknown"); got != "未知编码保持原样" {
		t.Fatalf("unknown charset should pass through: %q", got)
	}
}

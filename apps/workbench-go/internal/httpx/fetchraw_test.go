package httpx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFetchRawReturnsFeedText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Error("missing user agent")
		}
		w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
		_, _ = w.Write([]byte("<rss><channel><item><title>条目一</title></item></channel></rss>"))
	}))
	defer server.Close()
	text, err := FetchRaw(context.Background(), server.URL+"/feed.xml")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "条目一") {
		t.Fatalf("feed text: %q", text)
	}
	if _, err := FetchRaw(context.Background(), "https://127.0.0.1/feed.xml"); err == nil {
		t.Fatal("https 回环地址应被地址校验拒绝（只允许回环 http）")
	}
}

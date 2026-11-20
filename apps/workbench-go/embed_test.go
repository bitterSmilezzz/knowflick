package main

import (
	"io/fs"
	"strings"
	"testing"
)

// TestEmbeddedBundleIsCurrent 防止 go:embed 命中旧产物：界面改了但二进制没带上是静默故障。
func TestEmbeddedBundleIsCurrent(t *testing.T) {
	b, err := fs.ReadFile(assets, "assets/dist/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "index-BRiIyQz9.js") {
		t.Fatalf("embedded index.html is stale: %s", string(b))
	}
}

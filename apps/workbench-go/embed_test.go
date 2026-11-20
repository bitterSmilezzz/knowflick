package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestEmbeddedBundleIsCurrent 防止「只跑了 Vite、没重新 go build」导致嵌入旧前端。
//
// 早期版本把 bundle 哈希写死成常量，每次 UI 改动都要手动改测试；
// 现在改成从磁盘上的实际产物读取文件名，断言嵌入的 index.html 引用的是同一个。
// 这样既能自动跟随 UI 变化，又仍能抓住「忘了一起重新嵌入」。
func TestEmbeddedBundleIsCurrent(t *testing.T) {
	embedded, err := fs.ReadFile(assets, "assets/dist/index.html")
	if err != nil {
		t.Fatal(err)
	}
	onDisk, err := os.ReadFile(filepath.Join("assets", "dist", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if string(embedded) != string(onDisk) {
		t.Fatal("嵌入的 index.html 与磁盘产物不一致：请重新运行 tools/build_workbench_go.sh")
	}
	matches, err := filepath.Glob(filepath.Join("assets", "dist", "assets", "index-*.js"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("期望恰好一个当前 bundle，实际 %v (%v)", matches, err)
	}
	bundle := filepath.Base(matches[0])
	if !strings.Contains(string(embedded), bundle) {
		t.Fatalf("嵌入的 index.html 没有引用当前 bundle %s", bundle)
	}
}

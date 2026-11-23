package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"knowflick.local/workbench-go/internal/dataroot"
	"knowflick.local/workbench-go/internal/library"
)

//go:embed all:assets
var assets embed.FS

func main() {
	path := flag.String("library", "", "open a KnowFlick SQLite library in read-only mode")
	flag.Parse()
	// 首次启动与 Rust 时代同语义：默认库在 <data_root>/store/knowflick.db，
	// 不存在就先建库再只读打开。Rust 移除后 Go 是唯一建库方（ADR-0042）。
	initialPath := *path
	if initialPath == "" {
		initialPath = filepath.Join(dataroot.Dir(), "store", "knowflick.db")
		if _, err := os.Stat(initialPath); errors.Is(err, os.ErrNotExist) {
			created, err := library.Create(context.Background(), initialPath)
			if err != nil {
				log.Fatalf("首次启动创建资料库失败：%v", err)
			}
			if err := created.Close(); err != nil {
				log.Printf("创建资料库后关闭失败：%v", err)
			}
			log.Printf("已创建资料库：%s", initialPath)
		}
	}
	frontend, err := fs.Sub(assets, "assets/dist")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := fs.Stat(frontend, "index.html"); err != nil {
		log.Fatal("请先运行 tools/build_workbench_go.sh")
	}
	service := &PreviewService{initialPath: initialPath}
	// 邮箱服务单独一个：它要写库，只读预览时自己会拒绝。
	mailService := &MailService{preview: service}
	// 订阅服务单独一个：列表只要求库已打开，写操作自己检查可写。
	subscriptionService := &SubscriptionService{preview: service}
	app := application.New(application.Options{
		Name:     "KnowFlick Go Preview",
		Services: []application.Service{application.NewService(service), application.NewService(mailService), application.NewService(subscriptionService)},
		Assets:   application.AssetOptions{Handler: application.BundledAssetFileServer(frontend)},
		Mac:      application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		OnShutdown: func() {
			if err := service.ServiceShutdown(); err != nil {
				log.Printf("关闭资料库失败：%v", err)
			}
			mailService.StopMailAutoSync()
		},
	})
	service.onMailChanged = func(generation int) {
		_ = app.Event.Emit("knowflick:library-changed", generation)
	}
	// 自动同步按账号间隔在后台检查；库未打开时为空转，不报错。
	mailService.StartBackgroundSync()

	service.app = app
	service.window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "KnowFlick · Go 版只读预览", Width: 1080, Height: 720, MinWidth: 380, MinHeight: 440, URL: "/",
	})
	// 与旧桌面端使用同一快捷键，避免占用输入法的 Control+Space。
	if err := app.GlobalShortcut.Register(capsuleAccelerator, func() {
		if err := service.toggleCapsule(); err != nil {
			log.Printf("无法切换捕捉窗口：%v", err)
		}
	}); err != nil {
		log.Printf("全局快捷键未注册：%v（可从设置打开捕捉窗口）", err)
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

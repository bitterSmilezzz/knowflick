package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:assets
var assets embed.FS

func main() {
	path := flag.String("library", "", "open a KnowFlick SQLite library in read-only mode")
	flag.Parse()
	frontend, err := fs.Sub(assets, "assets/dist")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := fs.Stat(frontend, "index.html"); err != nil {
		log.Fatal("请先运行 tools/build_workbench_go.sh")
	}
	service := &PreviewService{initialPath: *path}
	// 邮箱服务单独一个：它要写库，只读预览时自己会拒绝。
	mailService := &MailService{preview: service}
	// 订阅服务单独一个：列表只要求库已打开，写操作自己检查可写。
	subscriptionService := &SubscriptionService{preview: service}
	app := application.New(application.Options{
		Name:     "KnowFlick Go Preview",
		Services: []application.Service{application.NewService(service), application.NewService(mailService), application.NewService(subscriptionService)},
		Assets:   application.AssetOptions{Handler: application.BundledAssetFileServer(frontend)},
		Mac:      application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	service.app = app
	service.window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "KnowFlick · Go 版只读预览", Width: 1080, Height: 720, MinWidth: 380, MinHeight: 440, URL: "/",
	})
	// 快捷捕捉窗口：全局快捷键切换。与 Rust 同一快捷键 Alt+Space，
	// 不静默回退到 Control+Space，避免抢占输入法切换。
	service.capsuleWindow = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "快速捕捉", Width: 480, Height: 220, URL: "/?window=capsule", Hidden: true,
	})
	if err := app.GlobalShortcut.Register("Alt+Space", func() {
		if service.capsuleWindow.IsVisible() {
			service.capsuleWindow.Hide()
		} else {
			service.capsuleWindow.Show()
		}
	}); err != nil {
		log.Printf("全局快捷键未注册：%v（可从应用菜单打开捕捉窗口）", err)
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

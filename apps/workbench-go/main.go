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
	app := application.New(application.Options{
		Name:     "KnowFlick Go Preview",
		Services: []application.Service{application.NewService(service)},
		Assets:   application.AssetOptions{Handler: application.BundledAssetFileServer(frontend)},
		Mac:      application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	service.app = app
	service.window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "KnowFlick · Go 版只读预览", Width: 1080, Height: 720, MinWidth: 380, MinHeight: 440, URL: "/",
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

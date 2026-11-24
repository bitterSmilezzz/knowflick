package main

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// menuEvent 是原生菜单点击后发给前端的事件名。
//
// 共享前端已监听同名 DOM 事件 "knowflick:menu"（Rust 时代留下的协议），
// 这里的 detail 取值必须与 Workspace.tsx 里的分支一一对应。
const menuEvent = "knowflick:menu"

// droppedFilesEvent 是原生拖放文件发给前端的事件名。
const droppedFilesEvent = "knowflick:dropped-files"

// menuCommand 是菜单项与前端动作的对应表。
type menuCommand struct {
	// Label 是菜单上显示的中文文本。
	Label string
	// Action 是发给前端的动作标识（knowflick:menu 的 detail）。
	Action string
	// Accelerator 是快捷键（CmdOrCtrl 表示 macOS 的 ⌘、其它平台为 Ctrl）。
	Accelerator string
	// Role 是 macOS 系统角色（About/Quit 等），为空表示自定义项。
	Role application.Role
}

// buildMacMenu 构造 macOS 的应用菜单栏。
//
// 为什么要自己建：Wails 的默认菜单是英文的（File/Edit/View…），
// 而且没有 KnowFlick 自己的命令——用户找不到「记一条」「测验」「导出备份」，
// 只能回到界面里找。macOS 用户对菜单栏有明确预期，这里给一份中文的应用菜单。
//
// 非 macOS 平台返回 nil：不装系统菜单，Windows/Linux 仍走窗口内界面。
func buildMacMenu(app *application.App, emit func(action string)) *application.Menu {
	if runtime.GOOS != "darwin" {
		return nil
	}
	menu := application.NewMenu()

	// 应用菜单（第一个是应用自身的名字，macOS 约定）。
	appMenu := menu.AddSubmenu("KnowFlick")
	appMenu.AddRole(application.About)
	appMenu.AddSeparator()
	appMenu.Add("设置…").SetAccelerator("CmdOrCtrl+,").OnClick(func(*application.Context) {
		emit("settings")
	})
	appMenu.AddSeparator()
	appMenu.AddRole(application.ServicesMenu)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Hide)
	appMenu.AddRole(application.HideOthers)
	appMenu.AddRole(application.UnHide)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Quit)

	// 文件菜单：导入、导出备份。
	fileMenu := menu.AddSubmenu("文件")
	fileMenu.Add("导入文件…").SetAccelerator("CmdOrCtrl+o").OnClick(func(*application.Context) {
		emit("import")
	})
	fileMenu.Add("导出备份…").SetAccelerator("CmdOrCtrl+Shift+e").OnClick(func(*application.Context) {
		emit("export")
	})

	// 编辑菜单：系统标准项（撤销/剪切/复制/粘贴/全选）+ 查找。
	editMenu := menu.AddSubmenu("编辑")
	editMenu.AddRole(application.Undo)
	editMenu.AddRole(application.Redo)
	editMenu.AddSeparator()
	editMenu.AddRole(application.Cut)
	editMenu.AddRole(application.Copy)
	editMenu.AddRole(application.Paste)
	editMenu.AddRole(application.Delete)
	editMenu.AddRole(application.SelectAll)
	editMenu.AddSeparator()
	editMenu.Add("查找…").SetAccelerator("CmdOrCtrl+f").OnClick(func(*application.Context) {
		emit("find")
	})

	// 视图菜单：搜索、收件箱、知识库、测验。
	viewMenu := menu.AddSubmenu("视图")
	viewMenu.Add("搜索…").SetAccelerator("CmdOrCtrl+k").OnClick(func(*application.Context) {
		emit("find")
	})
	viewMenu.Add("收件箱").SetAccelerator("CmdOrCtrl+1").OnClick(func(*application.Context) {
		emit("inbox")
	})
	viewMenu.Add("全部知识").SetAccelerator("CmdOrCtrl+2").OnClick(func(*application.Context) {
		emit("library")
	})
	viewMenu.AddSeparator()
	viewMenu.Add("知识测验").SetAccelerator("CmdOrCtrl+3").OnClick(func(*application.Context) {
		emit("quiz")
	})
	viewMenu.Add("显示/隐藏侧栏").SetAccelerator("CmdOrCtrl+Shift+s").OnClick(func(*application.Context) {
		emit("toggle-nav")
	})

	// 窗口菜单：最小化、缩放、前置。
	windowMenu := menu.AddSubmenu("窗口")
	windowMenu.AddRole(application.Minimise)
	windowMenu.AddRole(application.Zoom)
	windowMenu.AddSeparator()
	windowMenu.AddRole(application.Front)

	// 帮助菜单：打开隐私与许可文档。
	helpMenu := menu.AddSubmenu("帮助")
	helpMenu.Add("隐私与数据说明").OnClick(func(*application.Context) {
		emit("privacy")
	})
	helpMenu.Add("第三方组件与许可").OnClick(func(*application.Context) {
		emit("licenses")
	})
	helpMenu.AddSeparator()
	helpMenu.Add("关于 KnowFlick").OnClick(func(*application.Context) {
		emit("about")
	})
	return menu
}

package dataroot

import (
	"os"
	"path/filepath"
	"runtime"
)

// Dir 是应用数据根目录（模型、缓存等），与桌面端 store::data_root 同规则：
// 环境变量 KNOWFLICK_DEBUG_DATA_ROOT 可隔离，其余按平台取标准位置。
func Dir() string {
	if override := os.Getenv("KNOWFLICK_DEBUG_DATA_ROOT"); override != "" {
		return override
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Join(".", "KnowFlick")
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "KnowFlick")
	case "windows":
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "KnowFlick")
		}
		return filepath.Join(home, "AppData", "Roaming", "KnowFlick")
	default:
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "KnowFlick")
		}
		return filepath.Join(home, ".local", "share", "KnowFlick")
	}
}

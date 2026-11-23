package main

import (
	"errors"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// PickSavePath opens the native save dialog and returns the chosen path.
func (s *PreviewService) PickSavePath(defaultName, title string) (string, error) {
	if s.app == nil {
		return "", errors.New("对话框尚不可用")
	}
	dialog := s.app.Dialog.SaveFile()
	if defaultName != "" {
		dialog.SetFilename(defaultName)
	}
	return dialog.PromptForSingleSelection()
}

// PickOpenPath opens the native file picker. Extensions are semicolon separated.
func (s *PreviewService) PickOpenPath(title, extensions string) (string, error) {
	if s.app == nil {
		return "", errors.New("对话框尚不可用")
	}
	dialog := s.app.Dialog.OpenFile()
	dialog.CanChooseFiles(true)
	if title != "" {
		dialog.SetTitle(title)
	}
	addDialogFilters(dialog, extensions)
	return dialog.PromptForSingleSelection()
}

// PickDirectory opens the native directory picker.
func (s *PreviewService) PickDirectory(title string) (string, error) {
	if s.app == nil {
		return "", errors.New("对话框尚不可用")
	}
	dialog := s.app.Dialog.OpenFile()
	dialog.CanChooseFiles(false)
	dialog.CanChooseDirectories(true)
	if title != "" {
		dialog.SetTitle(title)
	}
	return dialog.PromptForSingleSelection()
}

func addDialogFilters(dialog *application.OpenFileDialogStruct, extensions string) {
	for _, extension := range strings.Split(extensions, ";") {
		extension = strings.TrimSpace(extension)
		if extension == "" {
			continue
		}
		if !strings.HasPrefix(extension, ".") {
			extension = "." + extension
		}
		dialog.AddFilter(extension, "*"+extension)
	}
}

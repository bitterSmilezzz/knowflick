// Package archive 迁自 Rust store.rs 的归档读写：`.kfbackup`/卡片归档的 ZIP 容器。
//
// 与原实现一致的口径：
// - 归档上限 50 MiB，超了直接报错，不让一个坏文件把内存吃满；
// - ZIP 里按小写文件名匹配 cards.json / settings.json，允许带一层目录前缀；
// - cards.json 缺失或为空都报「未检测到有效的卡片数据」，不静默导入空卡库；
// - settings.json 在导出前必须剥掉密钥字段——导出包是**用户会分享的文件**。
package archive

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"knowflick.local/workbench-go/internal/errtext"
	"strings"
	"unicode/utf8"

	"knowflick.local/workbench-go/internal/e2ee"
)

// MaxArchiveBytes 是归档大小上限（与 Rust 一致）。
const MaxArchiveBytes = 50 * 1024 * 1024

// Payload 是读出的归档内容：卡片正文必有，设置可选。
type Payload struct {
	Cards    string
	Settings *string
}

var (
	// ErrNoCards 表示归档里没有可用的卡片数据。
	ErrNoCards = errors.New("所选文件中未检测到有效的 KnowFlick 卡片数据")
)

// IsZIP 按 PK 魔数判断（与 Rust 的 is_zip 一致）。
func IsZIP(data []byte) bool {
	return len(data) >= 4 && data[0] == 0x50 && data[1] == 0x4b
}

// Read 读归档：ZIP 走容器解析，否则当作纯文本卡片正文。
func Read(data []byte) (Payload, error) {
	if len(data) > MaxArchiveBytes {
		return Payload{}, archiveSizeError()
	}
	if IsZIP(data) {
		return readZIP(data)
	}
	text, err := decodeUTF8(data)
	if err != nil {
		return Payload{}, errors.New("归档不是有效的 UTF-8 文本")
	}
	if strings.TrimSpace(text) == "" {
		return Payload{}, ErrNoCards
	}
	return Payload{Cards: text}, nil
}

func readZIP(data []byte) (Payload, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Payload{}, errtext.Wrap("ZIP 解析失败", err)
	}
	var cards *string
	var settings *string
	for _, entry := range reader.File {
		name := strings.ToLower(entry.Name)
		body, readErr := readEntry(entry)
		if readErr != nil {
			return Payload{}, readErr
		}
		switch {
		case name == "cards.json" || strings.HasSuffix(name, "/cards.json"):
			value := body
			cards = &value
		case name == "settings.json" || strings.HasSuffix(name, "/settings.json"):
			value := body
			settings = &value
		}
	}
	if cards == nil {
		return Payload{}, errors.New("ZIP 中未找到 cards.json")
	}
	if strings.TrimSpace(*cards) == "" {
		return Payload{}, ErrNoCards
	}
	return Payload{Cards: *cards, Settings: settings}, nil
}

func readEntry(entry *zip.File) (string, error) {
	opened, err := entry.Open()
	if err != nil {
		return "", err
	}
	defer opened.Close()
	body, err := io.ReadAll(io.LimitReader(opened, MaxArchiveBytes))
	if err != nil {
		return "", err
	}
	text, err := decodeUTF8(body)
	if err != nil {
		return "", fmt.Errorf("%s 不是 UTF-8", entry.Name)
	}
	return text, nil
}

func decodeUTF8(data []byte) (string, error) {
	if !utf8Valid(data) {
		return "", errors.New("not utf-8")
	}
	return string(data), nil
}

func utf8Valid(data []byte) bool {
	return utf8.Valid(data)
}

// StripSecretSettings 清理设置对象及其子对象里的凭据字段。
// 无法解析为完整 JSON 对象的设置使用空对象，避免将原文写入可分享的归档。
func StripSecretSettings(settings string) string {
	decoder := json.NewDecoder(strings.NewReader(settings))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil || object == nil {
		return "{}"
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return "{}"
	}
	stripSecretFields(object)
	encoded, err := json.Marshal(object)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func stripSecretFields(value any) {
	switch value := value.(type) {
	case map[string]any:
		for key, child := range value {
			if isSecretKey(key) {
				delete(value, key)
			} else {
				stripSecretFields(child)
			}
		}
	case []any:
		for _, child := range value {
			stripSecretFields(child)
		}
	}
}

func isSecretKey(key string) bool {
	key = strings.ToLower(key)
	for _, fragment := range []string{"apikey", "api_key", "api-key", "token", "secret", "password", "passwd", "credential", "auth"} {
		if strings.Contains(key, fragment) {
			return true
		}
	}
	return false
}

// Write 打包成 ZIP（存储方式，与 Rust 的 zip_store 同为不压缩）。
//
// 用标准库而不是手写 ZIP 字节：容器格式不是我们的契约，**能被对方读开才是**。
// 手写一遍只会多一处会漂移的实现。
func Write(cards, settings string) ([]byte, error) {
	if strings.TrimSpace(cards) == "" {
		return nil, ErrNoCards
	}
	if len(cards) > MaxArchiveBytes || len(settings) > MaxArchiveBytes {
		return nil, archiveSizeError()
	}
	settings = StripSecretSettings(settings)
	if len(cards)+len(settings) > MaxArchiveBytes {
		return nil, archiveSizeError()
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range []struct {
		name string
		body string
	}{
		{"cards.json", cards},
		{"settings.json", settings},
	} {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Store}
		created, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err := io.WriteString(created, entry.body); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	if buffer.Len() > MaxArchiveBytes {
		return nil, archiveSizeError()
	}
	return buffer.Bytes(), nil
}

func archiveSizeError() error {
	return fmt.Errorf("归档文件大小超过 %d MiB 限制", MaxArchiveBytes/1024/1024)
}

// WriteEncrypted 打包后加密：容器在内、密文在外。
//
// 顺序与前端契约一致——先打包成 ZIP 再加密，所以解密方拿到的永远是完整容器，
// 不会出现「解密成功但 ZIP 半截」这种中间态。
func WriteEncrypted(passphrase, cards, settings string) ([]byte, error) {
	plain, err := Write(cards, settings)
	if err != nil {
		return nil, err
	}
	return e2ee.Encrypt(passphrase, plain)
}

// ReadEncrypted 解密后读容器。
//
// 两种失败必须分开：口令不对/被改（e2ee 的错）与容器不合法（archive 的错）。
// 混成一条会让「密码错了」看起来像「文件坏了」，两者的修法完全不同。
func ReadEncrypted(passphrase string, data []byte) (Payload, error) {
	plain, err := e2ee.Decrypt(passphrase, data)
	if err != nil {
		return Payload{}, err
	}
	return Read(plain)
}

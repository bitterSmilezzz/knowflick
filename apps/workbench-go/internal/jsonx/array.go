package jsonx

import (
	"encoding/json"
	"errors"
	"unicode/utf8"
)

// DecodeArray 读取数据库的 JSON 数组字段，拒绝无效 UTF-8 和 null。
func DecodeArray[T any](text string) ([]T, error) {
	var items []*T
	if !utf8.ValidString(text) || json.Unmarshal([]byte(text), &items) != nil || items == nil {
		return nil, errors.New("字段必须为有效的 JSON 数组")
	}
	result := make([]T, len(items))
	for i, item := range items {
		if item == nil {
			return nil, errors.New("数组包含空值")
		}
		result[i] = *item
	}
	return result, nil
}

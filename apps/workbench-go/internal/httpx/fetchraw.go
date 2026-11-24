package httpx

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"
)

// FetchRaw 取回原文（feed XML、GitHub JSON 等），不做正文提取。
// 与 FetchClip 共用地址校验：只接受 http(s)，回环直连、外部跟随系统代理。
// 上限 8 MiB——订阅源偶尔很大，但没必要为异常响应吃满内存。
func FetchRaw(ctx context.Context, raw string) (string, error) {
	target, err := ValidateURL(raw)
	if err != nil {
		return "", err
	}
	client := NewClient(target, 30*time.Second)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return "", errors.New("订阅地址无效")
	}
	request.Header.Set("User-Agent", "KnowFlick/1.0 (+subscription)")
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", errors.New("订阅源返回 HTTP " + itoaStatus(response.StatusCode))
	}
	body, err := readCapped(response.Body, 8<<20)
	if err != nil {
		return "", err
	}
	return decodeBody(body, response.Header.Get("Content-Type")), nil
}

func itoaStatus(code int) string {
	if code == 0 {
		return "0"
	}
	digits := make([]byte, 0, 3)
	for code > 0 {
		digits = append([]byte{byte('0' + code%10)}, digits...)
		code /= 10
	}
	return string(digits)
}

var _ = io.Discard

package httpx

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatCompleteExtractsOpenAIContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer test-key" || request.Header.Get("User-Agent") != "KnowFlick/0.1" {
			t.Errorf("headers: %v", request.Header)
		}
		body, _ := io.ReadAll(request.Body)
		if !strings.Contains(string(body), "你好") {
			t.Errorf("request body: %s", body)
		}
		_, _ = writer.Write([]byte("{\"choices\":[{\"message\":{\"content\":\"这是回答\"}}]}"))
	}))
	defer server.Close()
	content, err := ChatComplete(context.Background(), server.URL, "test-key", "{\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}")
	if err != nil || content != "这是回答" {
		t.Fatalf("chat content: %q, %v", content, err)
	}
}

func TestChatAuthHeadersChooseProviderStyle(t *testing.T) {
	anthropic := chatAuthHeaders("https://api.anthropic.com/v1/messages", "k")
	if anthropic["x-api-key"] != "k" || anthropic["anthropic-version"] != "2023-06-01" || anthropic["Authorization"] != "" {
		t.Fatalf("anthropic headers: %v", anthropic)
	}
	openai := chatAuthHeaders("https://api.deepseek.com/chat/completions", "k")
	if openai["Authorization"] != "Bearer k" {
		t.Fatalf("openai headers: %v", openai)
	}
	if chatAuthHeaders("https://example.org", "") != nil {
		t.Fatal("empty key should not add auth headers")
	}
}

func TestChatCompleteExtractsAnthropicContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("{\"content\":[{\"text\":\"合成回答\"}]}"))
	}))
	defer server.Close()
	content, err := ChatComplete(context.Background(), server.URL, "anthropic-key", "{}")
	if err != nil || content != "合成回答" {
		t.Fatalf("fallback content: %q, %v", content, err)
	}
}

func TestChatCompleteRedactsServerErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
		_, _ = writer.Write([]byte(`{"error":"bad key sk-live-abcdefghijklmnopqrstuvwxyz012345"}`))
	}))
	defer server.Close()
	_, err := ChatComplete(context.Background(), server.URL, "sk-live-abcdefghijklmnopqrstuvwxyz012345", "{}")
	if err == nil || strings.Contains(err.Error(), "sk-live-abcdefghijklmnopqrstuvwxyz012345") || !strings.Contains(err.Error(), "已隐藏") {
		t.Fatalf("redacted error: %v", err)
	}
}
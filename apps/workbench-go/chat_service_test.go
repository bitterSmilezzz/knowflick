package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompleteChatServiceProxiesAndGuards(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		if string(body) != "{\"messages\":[]}" {
			t.Errorf("body: %s", body)
		}
		_, _ = writer.Write([]byte("{\"choices\":[{\"message\":{\"content\":\"从资料库回答\"}}]}"))
	}))
	defer server.Close()
	service, _ := openFixtureCopy(t)
	ctx := context.Background()
	answer, err := service.CompleteChat(ctx, 1, server.URL, "", "{\"messages\":[]}")
	if err != nil || answer != "从资料库回答" {
		t.Fatalf("chat answer: %q, %v", answer, err)
	}
	if _, err := service.CompleteChat(ctx, 99, server.URL, "", "{}"); err == nil {
		t.Fatal("stale generation accepted")
	}
	if _, err := service.CompleteChat(ctx, 1, server.URL, "", strings.Repeat("x", 2*1024*1024+1)); err == nil {
		t.Fatal("oversized body accepted")
	}
}

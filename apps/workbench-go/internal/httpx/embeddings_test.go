package httpx

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestEmbeddingsSuccessAndRedactedErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/embeddings" {
			t.Errorf("path: %s", request.URL.Path)
		}
		if got := request.Header.Get("User-Agent"); got != "KnowFlick/0.1" {
			t.Errorf("user agent: %q", got)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer sk-test-key" {
			t.Errorf("auth: %q", got)
		}
		body, _ := io.ReadAll(request.Body)
		if !strings.Contains(string(body), "text-embedding-3-small") {
			t.Error("model missing from body")
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Write([]byte(`{"data":[{"embedding":[0.5,1.25]},{"embedding":[2]}]}`))
	}))
	defer server.Close()

	vectors, err := RequestEmbeddings(context.Background(), server.URL+"/v1/embeddings", "sk-test-key", "text-embedding-3-small", []string{"甲", "乙"})
	if err != nil {
		t.Fatal(err)
	}
	if len(vectors) != 2 || len(vectors[0]) != 2 || vectors[0][0] != 0.5 || vectors[0][1] != 1.25 || vectors[1][0] != 2 {
		t.Fatalf("vectors: %+v", vectors)
	}

	failing := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(500)
		writer.Write([]byte(`{"error":"bad key sk-abcdefghijklmnop"}`))
	}))
	defer failing.Close()
	if _, err := RequestEmbeddings(context.Background(), failing.URL+"/v1/embeddings", "sk-abcdefghijklmnop", "m", []string{"x"}); err == nil {
		t.Fatal("error status accepted")
	} else if strings.Contains(err.Error(), "sk-abcdefghijklmnop") || !strings.Contains(err.Error(), "[已隐藏]") {
		t.Fatalf("secret not redacted: %v", err)
	} else if !strings.Contains(err.Error(), "500") {
		t.Fatalf("status missing: %v", err)
	}

	malformed := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Write([]byte(`{"foo":1}`))
	}))
	defer malformed.Close()
	if _, err := RequestEmbeddings(context.Background(), malformed.URL+"/v1/embeddings", "", "m", []string{"x"}); err == nil || !strings.Contains(err.Error(), "data") {
		t.Fatalf("missing data array: %v", err)
	}
}

package webdavbackup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestUploadFallsBackAndWritesSidecar(t *testing.T) {
	archive := []byte("kfbackup payload")
	digest := sha256.Sum256(archive)
	hash := hex.EncodeToString(digest[:])
	var paths []string
	bodies := map[string]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method: %s", r.Method)
		}
		user, pass, ok := r.BasicAuth()
		if !ok || user != "demo" || pass != "fixture" {
			w.WriteHeader(401)
			return
		}
		body := make([]byte, r.ContentLength)
		if _, err := r.Body.Read(body); err != nil && err.Error() != "EOF" {
			t.Fatal(err)
		}
		paths = append(paths, r.URL.Path)
		bodies[r.URL.Path] = string(body)
		if strings.HasSuffix(r.URL.Path, ".kfbackup") && len(paths) == 1 {
			w.WriteHeader(412)
			return
		}
		if r.Header.Get("Content-Type") == "" {
			t.Errorf("missing content type")
		}
		w.WriteHeader(201)
	}))
	defer server.Close()
	result, err := Upload(context.Background(), server.URL+"/", "demo", "fixture", archive, time.UnixMilli(1700000000000))
	if err != nil {
		t.Fatal(err)
	}
	if result.Bytes != len(archive) || result.SHA256 != hash {
		t.Fatalf("receipt: %+v", result)
	}
	if !strings.HasSuffix(result.FileName, "-01.kfbackup") || len(paths) != 3 {
		t.Fatalf("fallback failed: %v %s", paths, result.FileName)
	}
	sidecar := bodies["/"+result.FileName+".sha256"]
	if sidecar != hash+"  "+result.FileName+"\n" {
		t.Fatalf("sidecar: %q", sidecar)
	}
	if bodies["/"+result.FileName] != string(archive) {
		t.Fatal("archive bytes changed")
	}
	encoded, err := json.Marshal(result)
	if err != nil || !strings.Contains(string(encoded), "fileName") {
		t.Fatalf("receipt json: %s %v", encoded, err)
	}
}

func TestUploadRejectsOtherStatuses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500); fmt.Fprint(w, "boom") }))
	defer server.Close()
	if _, err := Upload(context.Background(), server.URL, "", "", []byte("x"), time.Now()); err == nil || !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("unexpected result: %v", err)
	}
}

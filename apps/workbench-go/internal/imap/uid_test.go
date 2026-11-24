package imap

import (
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestSearchRangeKeepsAscendingAndRespectsBounds(t *testing.T) {
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"* SEARCH 12 11 13 200\r\nK0001 OK SEARCH completed\r\n",
	})
	defer stop()
	uids, err := session.SearchRange(10, nil, 100, false, nowFixed)
	if err != nil {
		t.Fatal(err)
	}
	want := []uint32{11, 12, 13, 200}
	if len(uids) != len(want) {
		t.Fatalf("uids: %v", uids)
	}
	for i := range want {
		if uids[i] != want[i] {
			t.Fatalf("not ascending: %v", uids)
		}
	}
}

func TestSearchRangeDropsUidNotNewerThanCursor(t *testing.T) {
	// `100:*` 在 100 超过邮箱末号时会返回末号本身；那个 UID 不更新，必须丢掉。
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"* SEARCH 5 9\r\nK0001 OK SEARCH completed\r\n",
	})
	defer stop()
	uids, err := session.SearchRange(9, nil, 100, false, nowFixed)
	if err != nil {
		t.Fatal(err)
	}
	if len(uids) != 0 {
		t.Fatalf("stale uid kept: %v", uids)
	}
}

func TestSearchRangeLimitKeepsNewestWhenAsked(t *testing.T) {
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"* SEARCH 1 2 3 4 5\r\nK0001 OK SEARCH completed\r\n",
	})
	defer stop()
	uids, err := session.SearchRange(0, nil, 2, true, nowFixed)
	if err != nil {
		t.Fatal(err)
	}
	if len(uids) != 2 || uids[0] != 4 || uids[1] != 5 {
		t.Fatalf("newest two: %v", uids)
	}
}

func TestSearchRangeRespectsThroughAndMissingResultField(t *testing.T) {
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"* 3 EXISTS\r\nK0001 OK SEARCH completed\r\n",
	})
	defer stop()
	if _, err := session.SearchRange(0, nil, 10, false, nowFixed); err == nil || !strings.Contains(err.Error(), "没有结果字段") {
		t.Fatalf("missing SEARCH field accepted: %v", err)
	}
	last := uint32(5)
	if uids, err := session.SearchRange(9, &last, 10, false, nowFixed); err != nil || len(uids) != 0 {
		t.Fatalf("through <= after should short-circuit: %v %v", uids, err)
	}
}

func TestFetchSkipsOversizedMessage(t *testing.T) {
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"* 1 FETCH (UID 7 RFC822.SIZE 999999999)\r\nK0001 OK FETCH completed\r\n",
	})
	defer stop()
	body, ok, err := session.Fetch(7, nowFixed)
	if err != nil {
		t.Fatal(err)
	}
	if ok || body != nil {
		t.Fatalf("oversized message should be skipped, got ok=%v", ok)
	}
}

func TestFetchReturnsBodyAndAcceptsBodyWithoutPeekEcho(t *testing.T) {
	// 真实服务器回显的是 BODY[]，不是请求里写的 BODY.PEEK[]。
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"* 1 FETCH (UID 7 RFC822.SIZE 5)\r\nK0001 OK FETCH completed\r\n",
		"* 1 FETCH (UID 7 BODY[] {5}\r\nhello)\r\nK0002 OK FETCH completed\r\n",
	})
	defer stop()
	body, ok, err := session.Fetch(7, nowFixed)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || string(body) != "hello" {
		t.Fatalf("body: %q ok=%v", body, ok)
	}
}

func TestFetchRejectsUnexpectedUid(t *testing.T) {
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"* 1 FETCH (UID 8 RFC822.SIZE 5)\r\nK0001 OK FETCH completed\r\n",
	})
	defer stop()
	if _, _, err := session.Fetch(7, nowFixed); err == nil || !strings.Contains(err.Error(), "没有返回邮件大小或编号") {
		t.Fatalf("mismatched uid accepted: %v", err)
	}
}

func TestTokenNumber(t *testing.T) {
	tokens := []string{"1", "FETCH", "UID", "42", "RFC822.SIZE", "100"}
	if tokenNumber(tokens, "UID") != 42 || tokenNumber(tokens, "RFC822.SIZE") != 100 {
		t.Fatalf("token parse failed: %v", tokens)
	}
	if tokenNumber(tokens, "MISSING") != 0 {
		t.Fatal("missing key should be 0")
	}
}

// TestExportUIDFixture 导出 Go 的 UID 搜索与取信结论，供 Rust 对拍同一组响应。
func TestExportUIDFixture(t *testing.T) {
	target := os.Getenv("KF_GO_UID_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_UID_FIXTURE to export the UID fixture")
	}
	session, stop := serverFor(t, greetingLine(), []string{
		"* SEARCH 12 11 13 200\r\nK0001 OK SEARCH completed\r\n",
		"* SEARCH 1 2 3 4 5\r\nK0002 OK SEARCH completed\r\n",
		"* 1 FETCH (UID 7 RFC822.SIZE 5)\r\nK0003 OK FETCH completed\r\n",
		"* 1 FETCH (UID 7 BODY[] {5}\r\nhello)\r\nK0004 OK FETCH completed\r\n",
	})
	defer stop()
	all, err := session.SearchRange(10, nil, 100, false, nowFixed)
	if err != nil {
		t.Fatal(err)
	}
	newest, err := session.SearchRange(0, nil, 2, true, nowFixed)
	if err != nil {
		t.Fatal(err)
	}
	body, ok, err := session.Fetch(7, nowFixed)
	if err != nil || !ok {
		t.Fatalf("fetch: %v %v", ok, err)
	}
	lines := []string{
		"search_all=" + joinUIDs(all),
		"search_newest2=" + joinUIDs(newest),
		"fetch_body=" + string(body),
	}
	if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
}

func joinUIDs(uids []uint32) string {
	parts := make([]string, 0, len(uids))
	for _, uid := range uids {
		parts = append(parts, strconv.FormatUint(uint64(uid), 10))
	}
	return strings.Join(parts, ",")
}

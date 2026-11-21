package mailsync

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

// fakeFetch 模拟服务器：记录搜索调用，按脚本返回 UID 与正文。
type fakeFetch struct {
	validity  uint32
	searches  []string
	scripts   [][]uint32
	bodies    map[uint32][]byte
	oversized map[uint32]bool
	searchErr error
}

func (f *fakeFetch) UIDValidity() uint32 { return f.validity }

func (f *fakeFetch) SearchRange(after uint32, through *uint32, limit int, newestFirst bool) ([]uint32, error) {
	key := "after=" + itoa(int(after))
	if through != nil {
		key += " through=" + itoa(int(*through))
	}
	f.searches = append(f.searches, key)
	if f.searchErr != nil {
		return nil, f.searchErr
	}
	if len(f.scripts) == 0 {
		return []uint32{}, nil
	}
	next := f.scripts[0]
	f.scripts = f.scripts[1:]
	return next, nil
}

func (f *fakeFetch) Fetch(uid uint32) ([]byte, bool, error) {
	if f.oversized[uid] {
		return nil, false, nil
	}
	return f.bodies[uid], true, nil
}

type fakeStore struct {
	cursor    Cursor
	known     map[uint32]bool
	rejected  []uint32
	imported  []uint32
	advanced  []string
	finishAt  int64
	complete  bool
	failed    string
	attempted bool
}

func (s *fakeStore) LoadCursor(context.Context, string) (Cursor, error) { return s.cursor, nil }

func (s *fakeStore) AlignBootstrap(_ context.Context, _ string, validity, boundary uint32, complete bool) error {
	s.cursor.UIDValidity = &validity
	s.cursor.LastUID = boundary - 1
	s.cursor.HistoryBefore = &boundary
	s.cursor.HistoryComplete = complete
	return nil
}

func (s *fakeStore) RejectedUIDs(context.Context, string, string, uint32, int) ([]uint32, error) {
	return s.rejected, nil
}

func (s *fakeStore) KnownUID(_ context.Context, _ string, _ string, _ uint32, uid uint32, _ Mode) (bool, error) {
	return s.known[uid], nil
}

func (s *fakeStore) RecordRejected(context.Context, string, string, uint32, uint32, string, int64) error {
	return nil
}

func (s *fakeStore) RecordImported(_ context.Context, _ string, _ string, _ uint32, uid uint32, _, _ string) error {
	s.imported = append(s.imported, uid)
	return nil
}

func (s *fakeStore) AdvanceCursor(_ context.Context, _ string, mode Mode, uid uint32) error {
	s.advanced = append(s.advanced, string(mode)+":"+itoa(int(uid)))
	return nil
}

func (s *fakeStore) LoadHistoryBefore(context.Context, string) (uint32, error) {
	if s.cursor.HistoryBefore == nil {
		return 1, nil
	}
	return *s.cursor.HistoryBefore, nil
}

func (s *fakeStore) Finish(_ context.Context, _ string, complete bool, now int64) error {
	s.complete = complete
	s.finishAt = now
	return nil
}

func (s *fakeStore) Fail(_ context.Context, _ string, reason string) error {
	s.failed = reason
	return nil
}

func (s *fakeStore) MarkAttempt(context.Context, string, int64) error {
	s.attempted = true
	return nil
}

type fakeImporter struct{ fail map[uint32]bool }

func (i *fakeImporter) Import(_ context.Context, _ string, _, uid uint32, _ []byte) (string, string, error) {
	if i.fail[uid] {
		return "", "", errors.New("MIME 坏了")
	}
	return "mail-" + itoa(int(uid)), "<m" + itoa(int(uid)) + "@x>", nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	negative := n < 0
	if negative {
		n = -n
	}
	out := ""
	for n > 0 {
		out = string(rune('0'+n%10)) + out
		n /= 10
	}
	if negative {
		return "-" + out
	}
	return out
}

func baseOptions(fetch *fakeFetch, store *fakeStore, importer *fakeImporter) Options {
	return Options{
		AccountID: "acct-1", Folder: "INBOX", Limit: 50, Mode: ModeNew,
		Fetch: fetch, Store: store, Import: importer,
		Now: func() int64 { return 1000 },
	}
}

func TestBootstrapAlignsCursorAndProcessesNewest(t *testing.T) {
	fetch := &fakeFetch{validity: 7, scripts: [][]uint32{{5, 6, 7}}, bodies: map[uint32][]byte{5: []byte("a"), 6: []byte("b"), 7: []byte("c")}}
	store := &fakeStore{known: map[uint32]bool{}}
	importer := &fakeImporter{}
	result, err := Run(context.Background(), baseOptions(fetch, store, importer))
	if err != nil {
		t.Fatal(err)
	}
	if store.cursor.UIDValidity == nil || *store.cursor.UIDValidity != 7 {
		t.Fatalf("validity not aligned: %+v", store.cursor)
	}
	if store.cursor.LastUID != 4 {
		t.Fatalf("last_uid should be boundary-1: %d", store.cursor.LastUID)
	}
	if len(store.imported) != 3 || result.Imported != 3 {
		t.Fatalf("imported: %v result=%+v", store.imported, result)
	}
	if !store.attempted || store.finishAt != 1000 {
		t.Fatalf("attempt/finish: %+v", store)
	}
}

func TestHistoryProcessesInDescendingOrder(t *testing.T) {
	boundary := uint32(20)
	validity := uint32(7)
	fetch := &fakeFetch{validity: 7, scripts: [][]uint32{{10, 11, 12}, {}}, bodies: map[uint32][]byte{10: []byte("a"), 11: []byte("b"), 12: []byte("c")}}
	store := &fakeStore{cursor: Cursor{UIDValidity: &validity, LastUID: 30, HistoryBefore: &boundary}, known: map[uint32]bool{}}
	options := baseOptions(fetch, store, &fakeImporter{})
	options.Mode = ModeHistory
	if _, err := Run(context.Background(), options); err != nil {
		t.Fatal(err)
	}
	want := []string{"history:12", "history:11", "history:10"}
	if len(store.advanced) != len(want) {
		t.Fatalf("advanced: %v", store.advanced)
	}
	for i := range want {
		if store.advanced[i] != want[i] {
			t.Fatalf("history must descend: %v", store.advanced)
		}
	}
}

func TestHistoryAtBoundaryShortCircuits(t *testing.T) {
	boundary := uint32(1)
	validity := uint32(7)
	fetch := &fakeFetch{validity: 7}
	store := &fakeStore{cursor: Cursor{UIDValidity: &validity, HistoryBefore: &boundary}, known: map[uint32]bool{}}
	options := baseOptions(fetch, store, &fakeImporter{})
	options.Mode = ModeHistory
	result, err := Run(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	if len(fetch.searches) != 0 {
		t.Fatalf("boundary<=1 should not search: %v", fetch.searches)
	}
	if !result.HistoryComplete {
		t.Fatal("boundary<=1 means history complete")
	}
}

func TestOversizedAndBrokenMessagesAreRejectedNotFatal(t *testing.T) {
	validity := uint32(7)
	boundary := uint32(1)
	fetch := &fakeFetch{validity: 7, scripts: [][]uint32{{3, 4, 5}}, oversized: map[uint32]bool{3: true}, bodies: map[uint32][]byte{4: []byte("bad"), 5: []byte("ok")}}
	store := &fakeStore{cursor: Cursor{UIDValidity: &validity, HistoryBefore: &boundary}, known: map[uint32]bool{}}
	importer := &fakeImporter{fail: map[uint32]bool{4: true}}
	options := baseOptions(fetch, store, importer)
	options.Mode = ModeNew
	result, err := Run(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	if result.Rejected != 2 || result.Imported != 1 {
		t.Fatalf("counts: %+v", result)
	}
	if len(store.imported) != 1 || store.imported[0] != 5 {
		t.Fatalf("imported: %v", store.imported)
	}
}

func TestFailureRecordsLastError(t *testing.T) {
	validity := uint32(7)
	boundary := uint32(1)
	fetch := &fakeFetch{validity: 7, searchErr: errors.New("连接断了")}
	store := &fakeStore{cursor: Cursor{UIDValidity: &validity, HistoryBefore: &boundary}, known: map[uint32]bool{}}
	if _, err := Run(context.Background(), baseOptions(fetch, store, &fakeImporter{})); err == nil {
		t.Fatal("expected failure")
	}
	if store.failed != "连接断了" {
		t.Fatalf("last_error not recorded: %q", store.failed)
	}
}

func TestRetryUsesRejectedList(t *testing.T) {
	validity := uint32(7)
	boundary := uint32(1)
	fetch := &fakeFetch{validity: 7, bodies: map[uint32][]byte{9: []byte("ok")}}
	store := &fakeStore{cursor: Cursor{UIDValidity: &validity, HistoryBefore: &boundary}, known: map[uint32]bool{}, rejected: []uint32{9}}
	options := baseOptions(fetch, store, &fakeImporter{})
	options.Mode = ModeRetry
	if _, err := Run(context.Background(), options); err != nil {
		t.Fatal(err)
	}
	if len(store.imported) != 1 || store.imported[0] != 9 {
		t.Fatalf("retry should import the rejected uid: %v", store.imported)
	}
}

func TestKnownUIDIsSkipped(t *testing.T) {
	validity := uint32(7)
	boundary := uint32(1)
	fetch := &fakeFetch{validity: 7, scripts: [][]uint32{{8}}}
	store := &fakeStore{cursor: Cursor{UIDValidity: &validity, HistoryBefore: &boundary}, known: map[uint32]bool{8: true}}
	result, err := Run(context.Background(), baseOptions(fetch, store, &fakeImporter{}))
	if err != nil {
		t.Fatal(err)
	}
	if result.Skipped != 1 || result.Imported != 0 {
		t.Fatalf("counts: %+v", result)
	}
}

// TestExportSyncFixture 导出 Go 的同步编排结论，供 Rust 对拍同一组服务器响应。
func TestExportSyncFixture(t *testing.T) {
	target := os.Getenv("KF_GO_SYNC_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_SYNC_FIXTURE to export the sync fixture")
	}
	validity := uint32(7)
	boundary := uint32(20)
	fetch := &fakeFetch{validity: 7, scripts: [][]uint32{{10, 11, 12}, {}}, bodies: map[uint32][]byte{10: []byte("a"), 11: []byte("b"), 12: []byte("c")}}
	store := &fakeStore{cursor: Cursor{UIDValidity: &validity, LastUID: 30, HistoryBefore: &boundary}, known: map[uint32]bool{}}
	options := baseOptions(fetch, store, &fakeImporter{})
	options.Mode = ModeHistory
	result, err := Run(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	lines := []string{
		"history_order=" + strings.Join(store.advanced, ","),
		"imported=" + itoa(result.Imported),
		"skipped=" + itoa(result.Skipped),
		"rejected=" + itoa(result.Rejected),
	}
	if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
}

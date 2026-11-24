package backupname

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestCivilFromDaysKnownDates(t *testing.T) {
	cases := []struct {
		days  int64
		year  int64
		month uint32
		day   uint32
	}{
		{0, 1970, 1, 1},
		{1, 1970, 1, 2},
		{-1, 1969, 12, 31},
	}
	for _, tc := range cases {
		year, month, day := CivilFromDays(tc.days)
		if year != tc.year || month != tc.month || day != tc.day {
			t.Fatalf("days %d: got %04d-%02d-%02d, want %04d-%02d-%02d",
				tc.days, year, month, day, tc.year, tc.month, tc.day)
		}
	}
}

func TestDateFromMillis(t *testing.T) {
	// 2026-07-01T00:00:00Z = 1782864000000
	if got := DateFromMillis(1782864000000); got != "20260701" {
		t.Fatalf("date: %s", got)
	}
	// 同一秒内多次备份必须落在同一天，文件名才可能递增。
	if DateFromMillis(1782864000000) != DateFromMillis(1782864099999) {
		t.Fatal("same second must map to the same date")
	}
	// 毫秒级回绕到前一天：这是「跨午夜备份」的边界。
	if got := DateFromMillis(1782863999999); got != "20260630" {
		t.Fatalf("day before: %s", got)
	}
}

func TestNextLocalNameFindsFreeSlot(t *testing.T) {
	date := "20260701"
	// 空目录：从 -01 开始。
	name, err := NextLocalName(date, ExistingNames())
	if err != nil {
		t.Fatal(err)
	}
	if name != "knowflick-backup-20260701-01.kfbackup" {
		t.Fatalf("first name: %s", name)
	}
	// 已有 -01、-03：跳过空位到 -04，而不是撞 -03。
	name, err = NextLocalName(date, ExistingNames(
		"knowflick-backup-20260701-01.kfbackup",
		"knowflick-backup-20260701-03.kfbackup",
	))
	if err != nil {
		t.Fatal(err)
	}
	if name != "knowflick-backup-20260701-02.kfbackup" {
		t.Fatalf("should take the first free slot: %s", name)
	}
	// 另一天的文件不该影响今天的选择。
	name, err = NextLocalName(date, ExistingNames("knowflick-backup-20260702-01.kfbackup"))
	if err != nil {
		t.Fatal(err)
	}
	if name != "knowflick-backup-20260701-01.kfbackup" {
		t.Fatalf("other day leaked: %s", name)
	}
}

func TestNextLocalNameRefusesToOverwrite(t *testing.T) {
	date := "20260701"
	occupied := func(string) bool { return true } // 99 个序号全被占
	if _, err := NextLocalName(date, occupied); !errors.Is(err, ErrTooManyBackups) {
		t.Fatalf("expected ErrTooManyBackups, got %v", err)
	}
	if !strings.Contains(ErrTooManyBackups.Error(), "清理目标目录") {
		t.Fatalf("message should tell the user what to do: %v", ErrTooManyBackups)
	}
}

func TestSortedNamesIsStable(t *testing.T) {
	got := SortedNames([]string{"b", "a", "c"})
	for index, want := range []string{"a", "b", "c"} {
		if got[index] != want {
			t.Fatalf("sort: %v", got)
		}
	}
}

// daysForParity 覆盖 epoch、跨年、闰年、1970 之前与 2262 年附近的大数。
var daysForParity = []int64{-1000000, -719468, -1, 0, 1, 365, 730, 19000, 730122, 10957, 1782864000000 / 1000 / 86400, 100000000}

// TestExportCivilFixture 导出 Go 的日期换算结果，供 Rust 逐条核对。
func TestExportCivilFixture(t *testing.T) {
	target := os.Getenv("KF_GO_CIVIL_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_CIVIL_FIXTURE to export the civil-days fixture")
	}
	var lines []string
	for _, days := range daysForParity {
		year, month, day := CivilFromDays(days)
		lines = append(lines, fmt.Sprintf("%d,%d,%d,%d", days, year, month, day))
	}
	if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
}

// TestExportBackupNameFixture 导出命名结论，供 Rust 用同一条规则复算。
func TestExportBackupNameFixture(t *testing.T) {
	target := os.Getenv("KF_GO_BACKUP_NAME_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_BACKUP_NAME_FIXTURE to export the naming fixture")
	}
	cases := []struct {
		date     string
		existing []string
	}{
		{"20260701", nil},
		{"20260701", []string{"knowflick-backup-20260701-01.kfbackup"}},
		{"20260701", []string{"knowflick-backup-20260701-01.kfbackup", "knowflick-backup-20260701-03.kfbackup"}},
		{"20260701", []string{"knowflick-backup-20260702-01.kfbackup"}},
		{"20261231", []string{"knowflick-backup-20261231-07.kfbackup", "knowflick-backup-20261231-08.kfbackup"}},
	}
	var lines []string
	for _, tc := range cases {
		name, err := NextLocalName(tc.date, ExistingNames(tc.existing...))
		if err != nil {
			t.Fatalf("date=%s: %v", tc.date, err)
		}
		lines = append(lines, tc.date+"|"+strings.Join(tc.existing, ",")+"|"+name)
	}
	if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
}

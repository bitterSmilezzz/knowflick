// Package backupname 迁自 Rust lib.rs 的备份命名逻辑：日期换算与「下一个可用文件名」。
//
// 与原实现一致的口径：
//   - 日期由 Unix 毫秒换算成民用日期，走 civil_from_days（Howard Hinnant 的算法），
//     不引时区库——文件名只需要「哪一天」，不需要时区。这是刻意的简化，不是遗漏。
//   - 本地备份从 `-01` 开始找下一个不存在的序号，同一天最多 99 次；
//   - 找不到就**报错而不是覆盖**：备份文件被覆盖等于备份不存在。
package backupname

import (
	"errors"
	"fmt"
	"sort"
)

// CivilFromDays 把「自 1970-01-01 起的天数」换算成民用日期。
//
// 算法与 Rust 的 civil_from_days 逐字一致（Howard Hinnant 的 days_to_civil）。
// 负数天数（1970 之前）也必须正确：Go 与 Rust 的整数除法都向零截断，
// 所以负数分支同样要先减 146096 再除。
func CivilFromDays(days int64) (year int64, month, day uint32) {
	z := days + 719468
	era := z / 146097
	if z < 0 {
		era = (z - 146096) / 146097
	}
	doe := uint64(z - era*146097)
	yoe := (doe - doe/1460 + doe/36524 - doe/146096) / 365
	y := int64(yoe) + era*400
	doy := doe - (365*yoe + yoe/4 - yoe/100)
	mp := (5*doy + 2) / 153
	d := uint32(doy - (153*mp+2)/5 + 1)
	m := uint32(mp + 3)
	if mp >= 10 {
		m = uint32(mp - 9)
	}
	if m <= 2 {
		y++
	}
	return y, m, d
}

// FormatDate 把民用日期格式化成 YYYYMMDD（文件名用的紧凑日期）。
func FormatDate(year int64, month, day uint32) string {
	return fmt.Sprintf("%04d%02d%02d", year, month, day)
}

// DateFromMillis 从 Unix 毫秒换算出文件名日期。
//
// 与 Rust 相同：先除 1000 再除 86400（整数除法向零截断），
// 不做时区换算——文件名只需要「哪一天」，不需要本地时区。
func DateFromMillis(millis int64) string {
	year, month, day := CivilFromDays(millis / 1000 / 86400)
	return FormatDate(year, month, day)
}

// ErrTooManyBackups 表示同一天已经备份了 99 次。
var ErrTooManyBackups = errors.New("同一天已备份 99 次——请先清理目标目录")

// NextLocalName 找出本地备份目录里下一个可用的文件名。
//
// exists 判定某个名字是否已被占用；调用方用它把目录内容传进来，
// 这样这条规则本身可以脱离文件系统测试。
func NextLocalName(date string, exists func(string) bool) (string, error) {
	for sequence := 1; sequence <= 99; sequence++ {
		name := fmt.Sprintf("knowflick-backup-%s-%02d.kfbackup", date, sequence)
		if !exists(name) {
			return name, nil
		}
	}
	return "", ErrTooManyBackups
}

// ExistingNames 把一组已存在的文件名包成 exists 判定（测试与调用方共用）。
func ExistingNames(names ...string) func(string) bool {
	set := make(map[string]struct{}, len(names))
	for _, name := range names {
		set[name] = struct{}{}
	}
	return func(candidate string) bool {
		_, found := set[candidate]
		return found
	}
}

// SortedNames 是调试与测试用的排序输出（保持稳定顺序）。
func SortedNames(names []string) []string {
	copyNames := append([]string(nil), names...)
	sort.Strings(copyNames)
	return copyNames
}

// Package mailsync 迁自 Rust mail.rs 的同步编排：一轮同步怎么走。
//
// 三条与 Rust 一致的语义（改这里先改 Rust）：
//   - bootstrap：库里没有 UIDVALIDITY 或没有 history_before 时，先把游标对齐到本次的
//     「最近 N 封」边界，并按 New 模式处理——首次同步不该把历史全部拉下来。
//   - 方向：New 升序推进 last_uid，History 降序推进 history_before。
//     升序保证每次提交都安全抬高水位；降序保证每次提交都安全下移边界。
//   - 单封失败不阻断整轮：失败的那封记进 mail_rejected，其余继续。
package mailsync

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Mode 是一轮同步的模式。
type Mode string

const (
	// ModeNew 拉取游标之后的新邮件。
	ModeNew Mode = "new"
	// ModeHistory 往回补历史。
	ModeHistory Mode = "history"
	// ModeRetry 重试之前被拒的邮件。
	ModeRetry Mode = "retry"
)

// Counts 是一轮同步的计数。
type Counts struct {
	Imported int
	Skipped  int
	Rejected int
}

// Result 是一轮同步的结果。
type Result struct {
	Imported        int    `json:"imported"`
	Skipped         int    `json:"skipped"`
	Rejected        int    `json:"rejected"`
	AccountID       string `json:"accountId"`
	LastSyncAt      int64  `json:"lastSyncAt"`
	HistoryComplete bool   `json:"historyComplete"`
}

// Cursor 是同步游标的快照。
type Cursor struct {
	UIDValidity     *uint32
	LastUID         uint32
	HistoryBefore   *uint32
	HistoryComplete bool
}

// Plan 描述一轮同步该取哪些 UID。
type Plan struct {
	Mode      Mode
	UIDs      []uint32
	Bootstrap bool
}

// Fetcher 是同步需要的邮件服务器能力（便于测试替身）。
type Fetcher interface {
	SearchRange(after uint32, through *uint32, limit int, newestFirst bool) ([]uint32, error)
	Fetch(uid uint32) ([]byte, bool, error)
}

// PlanSync 决定这一轮取哪些 UID。
//
// bootstrap 时只取「最近 N 封」并把边界对齐到最旧的那封，随后按 New 处理。
// History 边界 <= 1 表示已经没有更早的邮件，直接返回空列表（不白跑一次搜索）。
func PlanSync(cursor Cursor, currentValidity uint32, mode Mode, limit int, fetch Fetcher, rejected []uint32) (Plan, error) {
	bootstrap := cursor.UIDValidity == nil || *cursor.UIDValidity != currentValidity || cursor.HistoryBefore == nil
	if bootstrap {
		uids, err := fetch.SearchRange(0, nil, limit, true)
		if err != nil {
			return Plan{}, err
		}
		return Plan{Mode: ModeNew, UIDs: uids, Bootstrap: true}, nil
	}
	switch mode {
	case ModeNew:
		uids, err := fetch.SearchRange(cursor.LastUID, nil, limit, false)
		if err != nil {
			return Plan{}, err
		}
		return Plan{Mode: ModeNew, UIDs: uids}, nil
	case ModeHistory:
		boundary := *cursor.HistoryBefore
		if boundary <= 1 {
			return Plan{Mode: ModeHistory, UIDs: []uint32{}}, nil
		}
		through := boundary - 1
		uids, err := fetch.SearchRange(0, &through, limit, true)
		if err != nil {
			return Plan{}, err
		}
		return Plan{Mode: ModeHistory, UIDs: uids}, nil
	case ModeRetry:
		return Plan{Mode: ModeRetry, UIDs: rejected}, nil
	default:
		return Plan{}, fmt.Errorf("未知的同步模式: %s", mode)
	}
}

// OrderForProcessing 给出处理顺序：History 反转为降序，其余保持原样。
// 升序保证每次提交都安全抬高 last_uid；降序保证每次提交都安全下移 history_before。
func OrderForProcessing(plan Plan) []uint32 {
	if plan.Mode != ModeHistory {
		return plan.UIDs
	}
	reversed := make([]uint32, len(plan.UIDs))
	for i, uid := range plan.UIDs {
		reversed[len(plan.UIDs)-1-i] = uid
	}
	return reversed
}

// Store 是同步需要的持久化能力。
type Store interface {
	// LoadCursor 读账号的 UIDVALIDITY、last_uid 与 history_before。
	LoadCursor(ctx context.Context, accountID string) (Cursor, error)
	// AlignBootstrap 把游标对齐到 bootstrap 边界。
	AlignBootstrap(ctx context.Context, accountID string, validity uint32, boundary uint32, complete bool) error
	// RejectedUIDs 按拒收时间列出待重试的 UID。
	RejectedUIDs(ctx context.Context, accountID, folder string, validity uint32, limit int) ([]uint32, error)
	// KnownUID 判断这封是否已经处理过；mode 影响是否把拒收记录当作「已处理」。
	KnownUID(ctx context.Context, accountID, folder string, validity, uid uint32, mode Mode) (bool, error)
	// RecordRejected 记一封被拒的邮件。
	RecordRejected(ctx context.Context, accountID, folder string, validity, uid uint32, reason string, now int64) error
	// RecordImported 记一封已导入的邮件并返回是否新建了素材。
	RecordImported(ctx context.Context, accountID, folder string, validity, uid uint32, messageID, materialID string) error
	// AdvanceCursor 推进游标（New 抬 last_uid，History 降 history_before）。
	AdvanceCursor(ctx context.Context, accountID string, mode Mode, uid uint32) error
	// LoadHistoryBefore 读当前历史边界。
	LoadHistoryBefore(ctx context.Context, accountID string) (uint32, error)
	// Finish 写入 complete、last_sync_at 并清空 last_error。
	Finish(ctx context.Context, accountID string, complete bool, now int64) error
	// Fail 记下本轮错误。
	Fail(ctx context.Context, accountID, reason string) error
	// MarkAttempt 记下本轮尝试时间。
	MarkAttempt(ctx context.Context, accountID string, now int64) error
}

// Importer 把一封原始邮件变成素材并写库。
type Importer interface {
	Import(ctx context.Context, accountID string, validity, uid uint32, raw []byte) (materialID string, messageID string, err error)
}

// Options 是一轮同步的输入。
type Options struct {
	AccountID string
	Folder    string
	Limit     int
	Mode      Mode

	// Fetch 与 Store 由调用方注入，测试用替身。
	Fetch  Fetcher
	Store  Store
	Import Importer

	// Now 返回毫秒时间戳。
	Now func() int64
}

// Run 跑一轮同步。
//
// 失败时记下 last_error 再返回——下次界面上能看到「上次为什么没成」。
func Run(ctx context.Context, options Options) (Result, error) {
	if err := options.Store.MarkAttempt(ctx, options.AccountID, options.Now()); err != nil {
		return Result{}, err
	}
	result, err := runInner(ctx, options)
	if err != nil {
		_ = options.Store.Fail(ctx, options.AccountID, err.Error())
		return Result{}, err
	}
	return result, nil
}

func runInner(ctx context.Context, options Options) (Result, error) {
	cursor, err := options.Store.LoadCursor(ctx, options.AccountID)
	if err != nil {
		return Result{}, err
	}
	validity, err := CurrentValidity(options.Fetch)
	if err != nil {
		return Result{}, err
	}
	var rejected []uint32
	if cursor.UIDValidity != nil && *cursor.UIDValidity == validity && cursor.HistoryBefore != nil && options.Mode == ModeRetry {
		rejected, err = options.Store.RejectedUIDs(ctx, options.AccountID, options.Folder, validity, options.Limit)
		if err != nil {
			return Result{}, err
		}
	}
	plan, err := PlanSync(cursor, validity, options.Mode, options.Limit, options.Fetch, rejected)
	if err != nil {
		return Result{}, err
	}
	if plan.Bootstrap {
		boundary := uint32(1)
		if len(plan.UIDs) > 0 {
			boundary = plan.UIDs[0]
		}
		if err := options.Store.AlignBootstrap(ctx, options.AccountID, validity, boundary, len(plan.UIDs) == 0); err != nil {
			return Result{}, err
		}
	}
	counts := Counts{}
	for _, uid := range OrderForProcessing(plan) {
		if err := processUID(ctx, options, plan.Mode, validity, uid, &counts); err != nil {
			return Result{}, err
		}
	}
	boundary, err := options.Store.LoadHistoryBefore(ctx, options.AccountID)
	if err != nil {
		return Result{}, err
	}
	// 再搜一次（只取 1 封）：既识别空洞/被删的 UID，也让空批次能判定完成。
	complete := true
	if boundary > 1 {
		through := boundary - 1
		remaining, searchErr := options.Fetch.SearchRange(0, &through, 1, true)
		if searchErr != nil {
			return Result{}, searchErr
		}
		complete = len(remaining) == 0
	}
	time := options.Now()
	if err := options.Store.Finish(ctx, options.AccountID, complete, time); err != nil {
		return Result{}, err
	}
	return Result{
		Imported:        counts.Imported,
		Skipped:         counts.Skipped,
		Rejected:        counts.Rejected,
		AccountID:       options.AccountID,
		LastSyncAt:      time,
		HistoryComplete: complete,
	}, nil
}

// processUID 处理一封邮件。已处理过的直接跳过；拒收的在 Retry 模式下重试。
func processUID(ctx context.Context, options Options, mode Mode, validity, uid uint32, counts *Counts) error {
	known, err := options.Store.KnownUID(ctx, options.AccountID, options.Folder, validity, uid, mode)
	if err != nil {
		return err
	}
	if !known {
		raw, ok, fetchErr := options.Fetch.Fetch(uid)
		if fetchErr != nil {
			return fetchErr
		}
		if !ok {
			if err := options.Store.RecordRejected(ctx, options.AccountID, options.Folder, validity, uid, "邮件大小超过导入上限", options.Now()); err != nil {
				return err
			}
			counts.Rejected++
			if err := options.Store.AdvanceCursor(ctx, options.AccountID, mode, uid); err != nil {
				return err
			}
			return nil
		}
		materialID, messageID, importErr := options.Import.Import(ctx, options.AccountID, validity, uid, raw)
		if importErr != nil {
			if err := options.Store.RecordRejected(ctx, options.AccountID, options.Folder, validity, uid, "无法读取邮件正文或 MIME 结构", options.Now()); err != nil {
				return err
			}
			counts.Rejected++
			if err := options.Store.AdvanceCursor(ctx, options.AccountID, mode, uid); err != nil {
				return err
			}
			return nil
		}
		if err := options.Store.RecordImported(ctx, options.AccountID, options.Folder, validity, uid, messageID, materialID); err != nil {
			return err
		}
		counts.Imported++
	} else {
		counts.Skipped++
	}
	return options.Store.AdvanceCursor(ctx, options.AccountID, mode, uid)
}

// CurrentValidity 从服务器读当前 UIDVALIDITY。
func CurrentValidity(fetch Fetcher) (uint32, error) {
	reader, ok := fetch.(interface{ UIDValidity() uint32 })
	if !ok {
		return 0, errors.New("同步需要先登录并只读打开文件夹")
	}
	value := reader.UIDValidity()
	if value == 0 {
		return 0, errors.New("邮件服务器没有返回 UIDVALIDITY，无法安全同步")
	}
	return value, nil
}

var _ = sql.ErrNoRows

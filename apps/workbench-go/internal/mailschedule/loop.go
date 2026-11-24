package mailschedule

import (
	"context"
	"errors"
	"time"
)

// Loop 按固定间隔反复调用 step，直到 ctx 取消。
//
// 立即跑第一次：刚启动时用户的账号可能已经到期，等一个间隔再跑没有道理。
// step 返回错误不让循环停下——一次失败（网络断了）不该终止自动同步，
// 下一轮照常尝试；错误交给 onError 记录。
func Loop(ctx context.Context, interval time.Duration, step func(context.Context) error, onError func(error)) error {
	if interval <= 0 {
		return errors.New("自动同步间隔必须大于 0")
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := step(ctx); err != nil && ctx.Err() == nil && onError != nil {
			onError(err)
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

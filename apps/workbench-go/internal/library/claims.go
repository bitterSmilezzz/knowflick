package library

import (
	"context"

	"knowflick.local/workbench-go/internal/profile"
)

// Claims 是回答与建议可用的个人记忆。
func (l *Library) Claims(ctx context.Context, now int64) ([]profile.Claim, error) {
	return profile.ListActive(ctx, l.db, now)
}

// AllClaims 是治理界面的全量视图。
func (l *Library) AllClaims(ctx context.Context) ([]profile.Claim, error) {
	return profile.ListAll(ctx, l.db)
}

// ClaimAnswers 是全局问答可用的记忆。
func (l *Library) ClaimAnswers(ctx context.Context, now int64) ([]profile.Claim, error) {
	return profile.ListForAnswer(ctx, l.db, now)
}

// ClaimProjectAnswers 是所选项目范围的记忆；项目无效或已封存时失败关闭。
func (l *Library) ClaimProjectAnswers(ctx context.Context, now int64, projectID string) ([]profile.Claim, error) {
	return profile.ListForProjectAnswer(ctx, l.db, now, projectID)
}

func (l *Library) AddClaim(ctx context.Context, claim profile.Claim, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return profile.Add(ctx, l.db, claim, now)
}

func (l *Library) ConfirmClaim(ctx context.Context, id string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return profile.Confirm(ctx, l.db, id, now)
}

func (l *Library) PauseClaim(ctx context.Context, id string) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return profile.Pause(ctx, l.db, id)
}

func (l *Library) ResumeClaim(ctx context.Context, id string) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return profile.Resume(ctx, l.db, id)
}

func (l *Library) DenyClaim(ctx context.Context, id string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return profile.Deny(ctx, l.db, id, now)
}

func (l *Library) DeleteClaim(ctx context.Context, id string, now int64) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return profile.Delete(ctx, l.db, id, now)
}

func (l *Library) ClaimDenials(ctx context.Context) ([]profile.Denial, error) {
	return profile.ListDenials(ctx, l.db)
}

// ClearClaimDenial 允许某证据源重新被学习。
func (l *Library) ClearClaimDenial(ctx context.Context, evidenceJSON string) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	return profile.ClearDenialByEvidence(ctx, l.db, evidenceJSON)
}

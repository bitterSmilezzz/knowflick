import { useCallback, useEffect, useState } from "react";
import {
  profileClaimConfirm,
  profileClaimDeny,
  profileClaimDelete,
  profileClaimPause,
  profileClaimResume,
  profileClaimsActive,
  type ProfileClaim,
} from "../../shell/store";
import { useDeleteConfirm } from "./useDeleteConfirm";

/** 画像治理视图（R4/D05）：只治理、不生成。
 *
 * 三类声明分开展示（fact = 用户确认的事实 / statistic = 行为统计 /
 * inference = AI 推测待确认）；每条带证据数量与治理动作。
 * **没有生成入口**——学习管线（从素材自动提出推测）属消费端后续批次；
 * 这里管的是「已经存在的记忆」：确认、否认、暂停、删除、恢复使用。
 *
 * 「恢复使用」列出被否认/暂停的声明并给出放行出口（denial_clear_by_evidence
 * 是用户主动允许重新学习的唯一途径——路线图口径）。
 */

const KIND_LABEL: Record<ProfileClaim["kind"], string> = {
  fact: "已确认事实",
  statistic: "行为统计",
  inference: "AI 推测",
};

export function ProfileGovernanceView({ dir }: { dir: string }) {
  const [claims, setClaims] = useState<ProfileClaim[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"active" | "paused" | "denied">("active");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setClaims(await profileClaimsActive(dir));
      setError("");
    } catch (e) {
      setError(`读取画像失败：${String(e)}`);
    } finally {
      setLoaded(true);
    }
  }, [dir]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refresh]);

  const del = useDeleteConfirm(async (target: string) => {
    try { await profileClaimDelete(target, dir); await refresh(); }
    catch (e) { setError(`删除失败：${String(e)}`); }
  });

  const visible = claims.filter((c) =>
    view === "active" ? c.status === "active" && c.deniedAt == null
      : view === "paused" ? c.status === "paused"
      : c.deniedAt != null,
  );
  // 被否认的声明仍在 claims 里（denied_at 有值）——「恢复使用」需要它们的 id
  const deniedCount = claims.filter((c) => c.deniedAt != null).length;
  const pausedCount = claims.filter((c) => c.status === "paused").length;

  const evidenceCount = (c: ProfileClaim) => {
    try { return (JSON.parse(c.evidenceJson) as string[]).length; } catch { return 0; }
  };

  return (
    <div className="pg-root" aria-label="画像治理">
      <div className="pg-head">
        <h1>我的记忆</h1>
        <p className="ws-hint" style={{ margin: 0 }}>
          这些是从你的记录里提炼的记忆。你可以确认、否认、暂停或删除任何一条；
          被否认或删除的证据不会再次自动提出。没有记录不是问题——这里永远从空白开始。
        </p>
      </div>

      <div className="pg-tabs" role="group" aria-label="记忆视图">
        {([["active", `生效中（${claims.filter((c) => c.deniedAt == null && c.status === "active").length}）`],
          ["paused", `已暂停（${pausedCount}）`],
          ["denied", `已否认（${deniedCount}）`]] as const).map(([v, label]) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>
        ))}
      </div>

      {error ? <p className="nv-error" role="alert">{error}</p> : null}

      {!loaded ? (
        <p className="ws-hint">正在读取…</p>
      ) : visible.length === 0 ? (
        <div className="ws-list-empty">
          <h2>{view === "denied" ? "没有已否认的记忆" : view === "paused" ? "没有已暂停的记忆" : "还没有记忆"}</h2>
          <p>记忆由应用在学习管线开启后从你的记录中提炼；这里负责治理它们。</p>
        </div>
      ) : (
        <ul className="pg-list">
          {visible.map((c) => (
            <li key={c.id} className="pg-item" data-kind={c.kind} data-status={c.status}>
              <div className="pg-item-main">
                <span className="pg-kind-badge">{KIND_LABEL[c.kind] ?? c.kind}</span>
                <span className="pg-content">{c.content}</span>
                <span className="pg-meta">
                  证据 {evidenceCount(c)} 条
                  {c.confirmedAt != null ? " · 已确认" : c.kind === "inference" ? " · 待确认" : ""}
                  {c.expiresAt != null ? ` · 有效期至 ${new Date(c.expiresAt).toLocaleDateString("zh-CN")}` : ""}
                </span>
              </div>
              <div className="pg-item-actions">
                {view === "active" && c.confirmedAt == null && c.kind === "inference" ? (
                  <button type="button" className="ws-bordered" onClick={() => void act(() => profileClaimConfirm(c.id, dir))}>
                    确认
                  </button>
                ) : null}
                {view === "active" ? (
                  <>
                    <button type="button" className="ws-bordered" onClick={() => void act(() => profileClaimPause(c.id, dir))}>
                      暂停
                    </button>
                    <button type="button" className="ws-bordered" onClick={() => void act(() => profileClaimDeny(c.id, dir))}>
                      否认
                    </button>
                  </>
                ) : null}
                {view === "paused" ? (
                  <button type="button" className="ws-bordered" onClick={() => void act(() => profileClaimResume(c.id, dir))}>
                    恢复使用
                  </button>
                ) : null}
                {view === "denied" ? (
                  <button type="button" className="ws-bordered" onClick={() => void act(async () => {
                    // 恢复使用 = 清除该证据指纹的否认（用户主动放行的唯一出口）
                    const { profileDenialClearByEvidence } = await import("../../shell/store");
                    await profileDenialClearByEvidence(c.evidenceJson, dir);
                  })}
                >
                  允许重新学习
                </button>
              ) : null}
                {view !== "denied" ? (
                  <button
                    type="button"
                    className={`ws-bordered${del.isArmed(c.id) ? " pg-confirm" : ""}`}
                    onClick={() => del.request(c.id)}
                  >
                    {del.isArmed(c.id) ? "再点一次删除（不自动重建）" : "删除"}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

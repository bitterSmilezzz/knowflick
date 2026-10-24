import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import type { DbStats } from "../../shell/store";

/**
 * 统计视图：把库的状态摆在明处。
 *
 * ADR-0002 把「统计」列进第一版交付物，Rust 侧的统计命令也早就实现好了，
 * 但界面一直没有入口——命令在、统计不在。现在补上：
 *   卡片 / 素材 / 待整理 / 收藏 / 已复习 / 到期待复习
 *
 * 数据来自 db_get_stats（桌面端走 SQLite）；浏览器体验模式没有这层表，
 * 退回到前端已有的内存数据算同样的指标。
 */
export function StatsView({
  stats,
  onBack,
}: {
  stats: DbStats | null;
  onBack: () => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [stats]);

  const rows: Array<{ key: string; label: string; value: number; hint: string }> = [
    { key: "cards", label: "知识卡", value: stats?.totalCards ?? 0, hint: "已沉淀为知识卡的内容" },
    { key: "materials", label: "素材", value: stats?.totalMaterials ?? 0, hint: "库里的全部素材" },
    { key: "inbox", label: "待整理", value: stats?.inboxMaterials ?? 0, hint: "在收件箱里等你处理" },
    { key: "favorites", label: "收藏", value: stats?.favoriteCards ?? 0, hint: "留着的、值得再看" },
    { key: "seen", label: "已复习", value: stats?.seenCards ?? 0, hint: "至少看过一次的知识卡" },
    { key: "due", label: "到期待复习", value: stats?.dueCards ?? 0, hint: "按记忆算法该看了" },
  ];

  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return <div className="ws-stats" data-page="stats">
    <header className="ws-stats-head">
      <div>
        <h1>统计</h1>
        <p className="ws-hint">这个库现在长什么样。数字来自本机数据库，不外发。</p>
      </div>
      <button type="button" className="ws-bordered" onClick={onBack}>返回</button>
    </header>

    {failed ? (
      <div className="ws-feedback" role="alert"><span>读取统计失败，下面的数字可能是空值。</span></div>
    ) : null}

    <div className="ws-stats-grid">
      {rows.map((row) => (
        <div key={row.key} className="ws-stat" data-stat={row.key}>
          <span className="ws-stat-value">{row.value.toLocaleString()}</span>
          <strong className="ws-stat-label">{row.label}</strong>
          <span className="ws-hint">{row.hint}</span>
        </div>
      ))}
    </div>

    <p className="ws-hint ws-stats-foot">
      <Icon name="layers" size={13} />
      共 {total.toLocaleString()} 项内容。要减少待整理，可以到「收件箱」批量归档；要看偏好来源，去设置里的「你的来源贡献」。
    </p>
  </div>;
}

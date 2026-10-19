import { useState } from "react";
import { Icon } from "./Icon";
import {
  DEFAULT_INTERVAL_MINUTES,
  SUBSCRIPTION_TARGET_HINTS,
  SUBSCRIPTION_TYPE_LABELS,
  isDue,
  makeSubscription,
  nextPollAt,
  type Subscription,
  type SubscriptionType,
} from "../../domain/subscription";

interface Props {
  subscriptions: Subscription[];
  busy: boolean;
  /** 桌面端才有 subscriptions 表；浏览器体验模式只能看，不能加也不能抓。 */
  available: boolean;
  onAdd: (sub: Subscription) => Promise<void>;
  onToggle: (sub: Subscription, active: boolean) => Promise<void>;
  onDelete: (sub: Subscription) => Promise<void>;
  onPoll: (sub: Subscription) => Promise<void>;
}

const TYPE_ORDER: SubscriptionType[] = ["rss", "github_release", "github_trending", "tech_board"];

function formatTime(ms: number | null): string {
  if (!ms) return "从未";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

export function SubscriptionsView({ subscriptions, busy, available, onAdd, onToggle, onDelete, onPoll }: Props) {
  const [type, setType] = useState<SubscriptionType>("rss");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [interval, setIntervalMinutes] = useState(String(DEFAULT_INTERVAL_MINUTES));
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const sub = makeSubscription({
        type,
        title,
        target,
        intervalMinutes: Number(interval) || DEFAULT_INTERVAL_MINUTES,
      });
      await onAdd(sub);
      setTitle("");
      setTarget("");
      setIntervalMinutes(String(DEFAULT_INTERVAL_MINUTES));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const dueCount = subscriptions.filter((s) => isDue(s)).length;

  return (
    <>
      <div className="ws-reader-scroll">
        <div className="ws-reader-inner" data-page="subscriptions" style={{ maxWidth: 720 }}>
          <header className="ws-settings-header">
            <div>
              <h1>订阅源</h1>
              <p className="ws-hint">
                主动收集：按间隔拉取 RSS / GitHub Release / 趋势仓库，新条目落进收件箱等你提炼。
                {available
                  ? "抓取走桌面端原生网络栈，条目按来源链接去重。"
                  : "订阅源存在桌面端的 SQLite 里，浏览器体验模式不能添加或抓取。"}
              </p>
            </div>
          </header>

          {error ? (
            <div className="ws-feedback" role="alert" style={{ border: 0, padding: "8px 0" }}>
              {error}
            </div>
          ) : null}

          <section className="ws-settings-card" data-group="subscription-add">
            <div className="ws-settings-card-head">
              <Icon name="plus" size={15} />
              <div>
                <h2>新增订阅</h2>
                <p className="ws-hint">
                  {dueCount > 0 ? `当前有 ${dueCount} 个订阅到期待抓取` : "当前没有到期的订阅"}
                </p>
              </div>
            </div>
            <form className="ws-settings-body" onSubmit={(e) => void submit(e)}>
              <div className="ws-field-grid">
                <label className="ws-field">
                  类型
                  <select
                    value={type}
                    aria-label="订阅类型"
                    disabled={!available}
                    onChange={(e) => setType(e.target.value as SubscriptionType)}
                  >
                    {TYPE_ORDER.map((t) => (
                      <option key={t} value={t}>
                        {SUBSCRIPTION_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ws-field">
                  名称
                  <input
                    value={title}
                    aria-label="订阅名称"
                    disabled={!available}
                    placeholder="例如：Rust 官方发布"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              </div>
              <label className="ws-field">
                订阅目标
                <input
                  value={target}
                  aria-label="订阅目标"
                  disabled={!available}
                  placeholder={SUBSCRIPTION_TARGET_HINTS[type]}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              <label className="ws-field">
                轮询间隔（分钟）
                <input
                  value={interval}
                  aria-label="轮询间隔"
                  disabled={!available}
                  inputMode="numeric"
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                />
              </label>
              <div>
                <button className="ws-primary" type="submit" disabled={busy || !available}>
                  添加订阅
                </button>
              </div>
            </form>
          </section>

          <section className="ws-settings-card" data-group="subscription-list">
            <div className="ws-settings-card-head">
              <Icon name="inbox" size={15} />
              <div>
                <h2>已添加的订阅</h2>
                <p className="ws-hint">{subscriptions.length} 个订阅源</p>
              </div>
            </div>
            <div className="ws-settings-body">
              {subscriptions.length === 0 ? (
                <p className="ws-hint" style={{ margin: 0 }}>
                  还没有订阅源。添加上面任意一种，抓到的内容会作为素材进入收件箱。
                </p>
              ) : (
                subscriptions.map((sub) => {
                  const due = isDue(sub);
                  const next = nextPollAt(sub);
                  return (
                    <div className="ws-subscription-row" key={sub.id} data-subscription={sub.id}>
                      <div className="ws-settings-label">
                        <strong>
                          {sub.title}
                          <em className="ws-plugin-badge">{SUBSCRIPTION_TYPE_LABELS[sub.type]}</em>
                          {due && sub.isActive ? <em className="ws-plugin-badge">待抓取</em> : null}
                        </strong>
                        <span className="ws-subscription-target">{sub.targetUrl}</span>
                        <span className="ws-plugin-note">
                          每 {sub.intervalMinutes} 分钟 · 上次抓取 {formatTime(sub.lastPolledAt)}
                          {sub.isActive && next ? ` · 下次约 ${formatTime(next)}` : ""}
                        </span>
                      </div>
                      <div className="ws-subscription-actions">
                        <label className="ws-switch-label" aria-label={`启用${sub.title}`}>
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`启用${sub.title}`}
                            aria-checked={sub.isActive}
                            className="ws-switch-input"
                            data-subscription-toggle={sub.id}
                            checked={sub.isActive}
                            disabled={busy}
                            onChange={(e) => void onToggle(sub, e.target.checked)}
                          />
                          <span className="ws-switch-slider" />
                        </label>
                        <button
                          type="button"
                          className="ws-bordered"
                          data-subscription-poll={sub.id}
                          disabled={busy}
                          onClick={() => void onPoll(sub)}
                        >
                          立即抓取
                        </button>
                        <button
                          type="button"
                          className="ws-icon-button"
                          aria-label={`删除${sub.title}`}
                          title="删除订阅"
                          disabled={busy}
                          onClick={() => void onDelete(sub)}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

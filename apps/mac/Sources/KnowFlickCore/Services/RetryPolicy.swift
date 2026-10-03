import Foundation

/// 流式 AI 请求的重试策略值类型（Wave C2）。
///
/// 生成路径（`generateCards` / `transformNoteToCards`）与追问路径（`streamCardChat`）此前
/// 各写一遍「429/5xx 重试 3 次、退避 1s/2s」的循环条件——参数只能靠肉眼对齐，改一处忘另一处
/// 不会有任何测试报警。收敛成一个值类型后，判定（哪些错误可重试、还能不能再试）与退避
/// 序列只有一份事实来源，两条路径用同一类型的两个预设实例化。
///
/// 两条路径唯一的行为差异：生成路径重试时还没有任何产出；追问路径一旦 yield 过内容就不能
/// 重来——用户已经看到半截回答，重放会把已显示的内容吞掉。这一差异由
/// `allowsRetryAfterOutput` 表达，而不是散落在两个 catch 子句里。
public struct RetryPolicy: Sendable, Equatable {
    /// 最大尝试次数（含首次；3 = 首次 + 最多 2 次重试）
    public let maxAttempts: Int
    /// 每次重试前的等待秒数（下标 = 失败的那次尝试序号；不足时取最后一档）
    public let backoff: [TimeInterval]
    /// 已产出内容后是否仍允许重试
    public let allowsRetryAfterOutput: Bool

    init(maxAttempts: Int, backoff: [TimeInterval], allowsRetryAfterOutput: Bool) {
        self.maxAttempts = maxAttempts
        self.backoff = backoff
        self.allowsRetryAfterOutput = allowsRetryAfterOutput
    }

    /// 生成路径：429/5xx 重试，退避 1s、2s（`retryBaseDelay` 为测试可注入的基础退避）
    public static func cardGeneration(retryBaseDelay: TimeInterval) -> RetryPolicy {
        RetryPolicy(maxAttempts: 3, backoff: [retryBaseDelay, retryBaseDelay * 2], allowsRetryAfterOutput: true)
    }

    /// 追问路径：与生成同参数，但已 yield 过内容就不再重试
    public static func cardChat(retryBaseDelay: TimeInterval) -> RetryPolicy {
        RetryPolicy(maxAttempts: 3, backoff: [retryBaseDelay, retryBaseDelay * 2], allowsRetryAfterOutput: false)
    }

    /// 这次失败之后是否还值得重试（`attempt` 从 0 起）
    func shouldRetry(after error: AIError, attempt: Int, hasYielded: Bool = false) -> Bool {
        guard attempt + 1 < maxAttempts else { return false }
        if hasYielded && !allowsRetryAfterOutput { return false }
        guard case let .httpStatus(code, _) = error else { return false }
        return code == 429 || (500...599).contains(code)
    }

    /// 第 `attempt` 次尝试失败后的退避时长
    func delayBeforeRetry(attempt: Int) -> TimeInterval {
        backoff[min(attempt, backoff.count - 1)]
    }
}

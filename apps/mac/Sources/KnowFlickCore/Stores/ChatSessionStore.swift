import Foundation
import Observation

/// 追问会话编排：会话状态、流式任务、落盘顺序、「刚清除」墓碑、进程内缓存。
///
/// 为什么单独成类型（拆分方案 B Step 3）：追问面板横跨三件事——UI 状态、网络流、磁盘读写，
/// 原先全部挤在 AppStore 里，靠一条 `persistenceQueue` 维持「清除/保存」的先后顺序。
/// 抽出来之后，顺序语义（写与清除都排队、读也排在同一条队列上）与墓碑规则集中在一处，
/// 不再需要读者在 878 行里拼装。
///
/// 线程纪律：本类型 @MainActor；磁盘读写一律经 `persistenceQueue`（串行，与卡片写入同一条），
/// 完成后跳回主线程提交，保证「刚清除的卡不会被迟到的读盘复活」。
@MainActor
@Observable
public final class ChatSessionStore {
    public var activeChatCard: KnowledgeCard?
    public var currentChatSession: CardChatSession?
    public var isChatStreaming = false
    public var chatErrorMessage: String?

    private let storage: Storage
    private let aiService: AIService
    private let persistenceQueue: DispatchQueue
    private var chatStreamTask: Task<Void, Never>?

    /// 刚被清除（清除尚在后台队列执行）的会话卡 ID：读盘/重开时以此为准，防止旧会话复活
    private var clearedChatCardIds: Set<UUID> = []
    /// 进程内会话缓存：同一张卡第二次打开不再读盘（首次打开也不再阻塞主线程）
    private var sessionCache: [UUID: CardChatSession] = [:]
    /// 异步读盘代号：切卡/重开时递增，晚到的读取结果直接丢弃
    private var loadGeneration = 0

    public init(storage: Storage, aiService: AIService, persistenceQueue: DispatchQueue) {
        self.storage = storage
        self.aiService = aiService
        self.persistenceQueue = persistenceQueue
    }

    // MARK: - 打开 / 关闭

    /// 打开某张卡片的追问面板。
    ///
    /// 读取不再同步阻塞主线程（旧实现每次打开都要在 MainActor 上读整个 `chat_sessions.json` 并全量解码，
    /// 长会话下会出现可感知的卡顿）：命中进程内缓存直接给结果，未命中先给一个空会话，
    /// 再把读盘排到串行持久化队列上；结果回来时校验「还是这张卡 + 会话仍未被用户改动」才采用。
    /// 刚被清除的卡以内存墓碑为准，即使磁盘上还残留旧会话也不会复活。
    public func openChat(for card: KnowledgeCard) {
        cancelStreaming()
        activeChatCard = card
        chatErrorMessage = nil

        loadGeneration &+= 1
        if clearedChatCardIds.contains(card.id) {
            currentChatSession = CardChatSession(cardId: card.id, cardHeadline: card.headline)
            sessionCache[card.id] = nil
            return
        }
        if let cached = sessionCache[card.id], cached.cardId == card.id {
            currentChatSession = cached
            return
        }

        let generation = loadGeneration
        currentChatSession = CardChatSession(cardId: card.id, cardHeadline: card.headline)
        loadFromDisk(cardId: card.id, headline: card.headline, generation: generation)
    }

    /// 关闭追问面板
    public func closeChat() {
        cancelStreaming()
        activeChatCard = nil
    }

    /// 读盘排在持久化队列上：与「清除/保存」同一条串行队列，天然保证不会读到已被清除的旧内容
    private func loadFromDisk(cardId: UUID, headline: String, generation: Int) {
        let storage = self.storage
        persistenceQueue.async { [weak self] in
            let loaded = storage.loadChatSession(for: cardId)
            Task { @MainActor [weak self] in
                guard let self, self.loadGeneration == generation, self.activeChatCard?.id == cardId else { return }
                // 期间用户已经动过这次会话（发了消息）→ 磁盘内容会让位，绝不覆盖用户输入
                guard self.currentChatSession?.messages.isEmpty ?? true else { return }
                let session = loaded ?? CardChatSession(cardId: cardId, cardHeadline: headline)
                self.sessionCache[cardId] = session
                self.currentChatSession = session
            }
        }
    }

    // MARK: - 发送与流式

    /// 发送追问消息（幂等入口：流式中/空内容/无激活卡直接返回）
    public func sendChatMessage(prompt: String, settings: AISettings) {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isChatStreaming, !trimmed.isEmpty, let card = activeChatCard else { return }

        if currentChatSession == nil {
            currentChatSession = CardChatSession(cardId: card.id, cardHeadline: card.headline)
        }

        // 添加用户消息
        let userMsg = CardChatMessage(sender: .user, content: trimmed)
        currentChatSession?.messages.append(userMsg)
        currentChatSession?.updatedAt = Date()

        // 准备助手消息占位
        let assistantMsgId = UUID()
        let assistantMsg = CardChatMessage(id: assistantMsgId, sender: .assistant, content: "", isStreaming: true)
        currentChatSession?.messages.append(assistantMsg)

        isChatStreaming = true
        chatErrorMessage = nil

        let historySnapshot = currentChatSession?.messages.dropLast(2) ?? []
        let aiService = self.aiService

        chatStreamTask?.cancel()
        chatStreamTask = Task { @MainActor in
            guard !Task.isCancelled else { return }
            do {
                let stream = aiService.streamCardChat(
                    card: card,
                    history: Array(historySnapshot),
                    userPrompt: trimmed,
                    settings: settings
                )

                for try await delta in stream {
                    guard !Task.isCancelled else { break }
                    if let index = self.currentChatSession?.messages.firstIndex(where: { $0.id == assistantMsgId }) {
                        self.currentChatSession?.messages[index].content += delta
                    }
                }

                guard !Task.isCancelled else { return }
                if let index = self.currentChatSession?.messages.firstIndex(where: { $0.id == assistantMsgId }) {
                    self.currentChatSession?.messages[index].isStreaming = false
                }
                self.isChatStreaming = false
                if let session = self.currentChatSession {
                    self.persist(session)
                }
            } catch {
                if !Task.isCancelled {
                    self.isChatStreaming = false
                    self.chatErrorMessage = error.localizedDescription
                    if let index = self.currentChatSession?.messages.firstIndex(where: { $0.id == assistantMsgId }) {
                        if self.currentChatSession?.messages[index].content.isEmpty == true {
                            self.currentChatSession?.messages.remove(at: index)
                        } else {
                            self.currentChatSession?.messages[index].isStreaming = false
                        }
                    }
                    if let session = self.currentChatSession {
                        self.persist(session)
                    }
                }
            }
        }
    }

    /// 终止当前流式生成（保留已生成的部分回复）
    public func cancelStreaming() {
        chatStreamTask?.cancel()
        chatStreamTask = nil
        isChatStreaming = false
        if var session = currentChatSession {
            session.messages.removeAll { $0.isStreaming && $0.content.isEmpty }
            for i in session.messages.indices { session.messages[i].isStreaming = false }
            session.updatedAt = Date()
            currentChatSession = session
            persist(session)
        }
    }

    /// 清空当前卡片的追问历史
    public func clearCurrentSession() {
        cancelStreaming()
        guard let card = activeChatCard else { return }
        clearOnDisk(for: card.id)
        currentChatSession = CardChatSession(cardId: card.id, cardHeadline: card.headline)
    }

    // MARK: - 落盘（全部经串行队列，保证与清除的先后顺序）

    private func persist(_ session: CardChatSession) {
        // 空会话不落盘（P3-2）：打开面板就走一次落盘会让 chat_sessions.json 随「开过面板的卡片数」增长，
        // 而空会话既没有内容要保存、也不是「清除」语义（清除走 clearOnDisk）。
        // 另一重更重要的原因：打开面板时磁盘内容尚未读回（异步），此时若把「刚创建的空会话」写下去，
        // 会覆盖掉磁盘上真正的历史会话——空写一律跳过，这条数据丢失路径就不存在。
        guard !session.messages.isEmpty else { return }
        clearedChatCardIds.remove(session.cardId)
        sessionCache[session.cardId] = session
        let storage = self.storage
        persistenceQueue.async { [weak self] in
            do { try storage.saveChatSessionThrowing(session) }
            catch {
                Task { @MainActor [weak self] in
                    self?.chatErrorMessage = "聊天记录保存失败：\(error.localizedDescription)"
                }
            }
        }
    }

    /// 清除会话同样走后台队列，保证与保存操作的先后顺序
    private func clearOnDisk(for cardId: UUID) {
        clearedChatCardIds.insert(cardId)
        sessionCache.removeValue(forKey: cardId)
        let storage = self.storage
        persistenceQueue.async { [weak self] in
            do { try storage.clearChatSessionThrowing(for: cardId) }
            catch {
                Task { @MainActor [weak self] in
                    self?.chatErrorMessage = "聊天记录清除失败：\(error.localizedDescription)"
                }
            }
        }
    }
}

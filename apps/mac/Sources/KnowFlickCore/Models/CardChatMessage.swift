import Foundation

/// 追问对话发送者角色
public enum MessageSender: String, Codable, Sendable {
    case user
    case assistant
    case system
}

/// 单条追问对话消息
public struct CardChatMessage: Identifiable, Codable, Sendable, Equatable {
    public let id: UUID
    public let sender: MessageSender
    public var content: String
    public let timestamp: Date
    public var isStreaming: Bool

    public init(
        id: UUID = UUID(),
        sender: MessageSender,
        content: String,
        timestamp: Date = Date(),
        isStreaming: Bool = false
    ) {
        self.id = id
        self.sender = sender
        self.content = content
        self.timestamp = timestamp
        self.isStreaming = isStreaming
    }

    private enum CodingKeys: String, CodingKey {
        case id, sender, content, timestamp
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(UUID.self, forKey: .id)
        self.sender = try container.decode(MessageSender.self, forKey: .sender)
        self.content = try container.decode(String.self, forKey: .content)
        self.timestamp = try container.decodeIfPresent(Date.self, forKey: .timestamp) ?? Date()
        self.isStreaming = false
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(sender, forKey: .sender)
        try container.encode(content, forKey: .content)
        try container.encode(timestamp, forKey: .timestamp)
    }
}

/// 卡片专属会话载体
public struct CardChatSession: Identifiable, Codable, Sendable, Equatable {
    public let id: UUID
    public let cardId: UUID
    public let cardHeadline: String
    public var messages: [CardChatMessage]
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        cardId: UUID,
        cardHeadline: String,
        messages: [CardChatMessage] = [],
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.cardId = cardId
        self.cardHeadline = cardHeadline
        self.messages = messages
        self.updatedAt = updatedAt
    }
}

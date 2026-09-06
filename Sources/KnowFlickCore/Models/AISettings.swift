import Foundation

/// AI 服务设置（base_url / model 存 UserDefaults，API key 存 Keychain）
public struct AISettings: Codable, Equatable {
    public var baseURL: String
    public var model: String
    public var apiKey: String
    public var autoGenerate: Bool      // 卡片不足时自动生成
    public var categoryFilter: String  // 偏好分类（空 = 全部）

    public init(
        baseURL: String,
        model: String,
        apiKey: String,
        autoGenerate: Bool,
        categoryFilter: String
    ) {
        self.baseURL = baseURL
        self.model = model
        self.apiKey = apiKey
        self.autoGenerate = autoGenerate
        self.categoryFilter = categoryFilter
    }

    public static let `default` = AISettings(
        baseURL: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "",
        autoGenerate: true,
        categoryFilter: ""
    )
}

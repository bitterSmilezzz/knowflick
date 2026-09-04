import Foundation

/// AI 服务设置（base_url / model 存 UserDefaults，API key 存 Keychain）
struct AISettings: Codable, Equatable {
    var baseURL: String
    var model: String
    var apiKey: String
    var autoGenerate: Bool   // 卡片不足时自动生成
    var categoryFilter: String // 偏好分类（空 = 全部）

    static let `default` = AISettings(
        baseURL: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "",
        autoGenerate: true,
        categoryFilter: ""
    )
}

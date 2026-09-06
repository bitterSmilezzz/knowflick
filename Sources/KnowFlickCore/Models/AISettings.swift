import Foundation

/// AI 服务设置（base_url / model 存 UserDefaults，API key 存 Keychain）
public struct AISettings: Codable, Equatable {
    public var baseURL: String
    public var model: String
    public var apiKey: String
    public var autoGenerate: Bool      // 卡片不足时自动生成
    public var categoryFilter: String  // 偏好分类（空 = 全部）
    public var enableSeed: Bool        // 信息来源：预置精选库
    public var enableAI: Bool          // 信息来源：AI 生成内容
    public var aiSources: String       // AI 引用站点偏好（逗号分隔）
    public var showAIMark: Bool        // 显示 AI 内容标记

    public init(
        baseURL: String,
        model: String,
        apiKey: String,
        autoGenerate: Bool,
        categoryFilter: String,
        enableSeed: Bool = true,
        enableAI: Bool = true,
        aiSources: String = "维基百科, 国家地理, NASA",
        showAIMark: Bool = true
    ) {
        self.baseURL = baseURL
        self.model = model
        self.apiKey = apiKey
        self.autoGenerate = autoGenerate
        self.categoryFilter = categoryFilter
        self.enableSeed = enableSeed
        self.enableAI = enableAI
        self.aiSources = aiSources
        self.showAIMark = showAIMark
    }

    public static let `default` = AISettings(
        baseURL: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "",
        autoGenerate: true,
        categoryFilter: ""
    )

    /// 偏好分类解析：逗号分隔 → 白名单归一化后的分类数组（去重；无法识别的输入剔除，不兜底）
    public var preferredCategories: [String] {
        var seen = Set<String>()
        return categoryFilter
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .compactMap { CategoryRegistry.resolve($0) }
            .filter { seen.insert($0).inserted }
    }

    /// 用偏好分类数组回写 categoryFilter（保持字符串存储格式兼容）
    public mutating func setPreferredCategories(_ categories: [String]) {
        categoryFilter = Array(Set(categories)).sorted().joined(separator: ", ")
    }

    /// AI 引用站点偏好解析（去空、去重）
    public var preferredSources: [String] {
        var seen = Set<String>()
        return aiSources
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .filter { seen.insert($0).inserted }
    }

    // 旧版 settings.json 无新字段（enableSeed/enableAI/aiSources/showAIMark）——解码时给默认值，避免旧用户设置被整体重置
    private enum CodingKeys: String, CodingKey {
        case baseURL, model, apiKey, autoGenerate, categoryFilter
        case enableSeed, enableAI, aiSources, showAIMark
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        baseURL = try c.decodeIfPresent(String.self, forKey: .baseURL) ?? ""
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        apiKey = try c.decodeIfPresent(String.self, forKey: .apiKey) ?? ""
        autoGenerate = try c.decodeIfPresent(Bool.self, forKey: .autoGenerate) ?? true
        categoryFilter = try c.decodeIfPresent(String.self, forKey: .categoryFilter) ?? ""
        enableSeed = try c.decodeIfPresent(Bool.self, forKey: .enableSeed) ?? true
        enableAI = try c.decodeIfPresent(Bool.self, forKey: .enableAI) ?? true
        aiSources = try c.decodeIfPresent(String.self, forKey: .aiSources) ?? "维基百科, 国家地理, NASA"
        showAIMark = try c.decodeIfPresent(Bool.self, forKey: .showAIMark) ?? true
    }
}

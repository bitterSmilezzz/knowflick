import Foundation

/// 一个用户自定义分类：名字 + 内容描述（描述用于 AI 生成时定制该分类的卡片方向）
public struct CategoryConfig: Codable, Equatable, Hashable, Identifiable {
    public var name: String
    public var description: String

    public var id: String { name }

    public init(name: String, description: String) {
        self.name = name
        self.description = description
    }
}

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
    public var customCategories: [CategoryConfig]   // 用户自定义分类（可增删改）

    public init(
        baseURL: String,
        model: String,
        apiKey: String,
        autoGenerate: Bool,
        categoryFilter: String,
        enableSeed: Bool = true,
        enableAI: Bool = true,
        aiSources: String = "维基百科, 国家地理, NASA",
        showAIMark: Bool = true,
        customCategories: [CategoryConfig] = AISettings.defaultCustomCategories
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
        self.customCategories = customCategories
    }

    public static let `default` = AISettings(
        baseURL: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "",
        autoGenerate: true,
        categoryFilter: ""
    )

    /// 默认预置的自定义分类（用户当前聚焦方向）
    public static let defaultCustomCategories: [CategoryConfig] = [
        CategoryConfig(name: "AI", description: "人工智能基础：机器学习、神经网络、模型原理、应用与趋势"),
        CategoryConfig(name: "AI 开发", description: "用代码落地 AI：提示工程、RAG、微调、向量数据库、Agent 开发"),
        CategoryConfig(name: "AI Agent", description: "智能体原理与实践：工具调用、记忆、规划、多智能体协作"),
        CategoryConfig(name: "中级会计", description: "会计实务与考试：借贷记账、报表编制、存货/固定资产/收入准则"),
        CategoryConfig(name: "投资理财", description: "个人理财与投资：复利、基金定投、资产配置、风险控制"),
    ]

    // MARK: - 分类体系

    public var customCategoryNames: [String] {
        customCategories.map(\.name)
    }

    /// 全部分类名（内置「冷知识」+ 自定义）
    public var allCategoryNames: [String] {
        CategoryRegistry.allNames(custom: customCategoryNames)
    }

    /// 偏好分类解析：逗号分隔 → 有效分类名（内置或自定义；去重；无法识别的剔除）
    public var preferredCategories: [String] {
        var seen = Set<String>()
        return categoryFilter
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .compactMap { CategoryRegistry.resolve($0, custom: customCategoryNames) }
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

    // 旧版 settings.json 无新字段——解码时给默认值，避免旧用户设置被整体重置
    private enum CodingKeys: String, CodingKey {
        case baseURL, model, apiKey, autoGenerate, categoryFilter
        case enableSeed, enableAI, aiSources, showAIMark, customCategories
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
        customCategories = try c.decodeIfPresent([CategoryConfig].self, forKey: .customCategories) ?? AISettings.defaultCustomCategories
    }
}

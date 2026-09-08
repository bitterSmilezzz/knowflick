import Foundation

/// 一个用户自定义分类：名字 + 内容描述（描述用于 AI 生成时定制该分类的卡片方向）
public struct CategoryConfig: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var name: String
    public var description: String

    public var id: String { name }

    public init(name: String, description: String) {
        self.name = name
        self.description = description
    }
}

/// 应用外观显示模式
public enum AppearanceMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case system = "system"
    case dark = "dark"
    case light = "light"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .system: return "跟随系统"
        case .dark: return "深色模式"
        case .light: return "浅色模式"
        }
    }

    public var icon: String {
        switch self {
        case .system: return "circle.righthalf.filled"
        case .dark: return "moon.fill"
        case .light: return "sun.max.fill"
        }
    }
}

/// AI 服务设置（base_url / model 存 settings.json，API key 存 Keychain）
public struct AISettings: Codable, Equatable, Sendable {
    public var baseURL: String
    public var model: String
    public var apiKey: String
    public var autoGenerate: Bool      // 卡片不足时自动生成
    public var categoryFilter: String  // 偏好分类（空 = 全部）
    public var enableSeed: Bool        // 信息来源：预置精选库
    public var enableAI: Bool          // 信息来源：AI 生成内容
    public var aiSources: String       // AI 引用站点偏好（逗号分隔）
    public var showAIMark: Bool        // 显示 AI 内容标记
    public var appearance: AppearanceMode // 外观模式（跟随系统/深色/浅色）
    public var customCategories: [CategoryConfig]   // 用户自定义分类（可增删改）
    public var speechRate: Float = 1.0              // 默认朗读语速倍率 (0.75x ~ 1.5x)
    public var speechVoiceIdentifier: String = "auto" // 默认朗读声音标识符 ("auto" 自动探测)
    public var ambientGapSeconds: Double = 1.5      // 磨耳朵切换下一张缓冲秒数
    public var autoSpeakOnDetailOpen: Bool = false  // 打开详情页是否自动朗读

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
        appearance: AppearanceMode = .system,
        customCategories: [CategoryConfig] = AISettings.defaultCustomCategories,
        speechRate: Float = 1.0,
        speechVoiceIdentifier: String = "auto",
        ambientGapSeconds: Double = 1.5,
        autoSpeakOnDetailOpen: Bool = false
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
        self.appearance = appearance
        self.customCategories = customCategories
        self.speechRate = speechRate
        self.speechVoiceIdentifier = speechVoiceIdentifier
        self.ambientGapSeconds = ambientGapSeconds
        self.autoSpeakOnDetailOpen = autoSpeakOnDetailOpen
    }

    public static let `default` = AISettings(
        baseURL: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "",
        autoGenerate: true,
        categoryFilter: "",
        appearance: .system
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

    /// 本机兼容服务可以不提供密钥；远程服务必须显式配置。
    public var requiresAPIKey: Bool {
        let host = URL(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines))?.host?.lowercased()
        return !["localhost", "127.0.0.1", "::1", "[::1]"].contains(host ?? "")
    }

    public var isAIConfigured: Bool {
        !baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (!requiresAPIKey || !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    /// 密钥仅供运行期使用，任何 JSON 编码都不能包含它。
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(baseURL, forKey: .baseURL)
        try c.encode(model, forKey: .model)
        try c.encode(autoGenerate, forKey: .autoGenerate)
        try c.encode(categoryFilter, forKey: .categoryFilter)
        try c.encode(enableSeed, forKey: .enableSeed)
        try c.encode(enableAI, forKey: .enableAI)
        try c.encode(aiSources, forKey: .aiSources)
        try c.encode(showAIMark, forKey: .showAIMark)
        try c.encode(appearance, forKey: .appearance)
        try c.encode(customCategories, forKey: .customCategories)
        try c.encode(speechRate, forKey: .speechRate)
        try c.encode(speechVoiceIdentifier, forKey: .speechVoiceIdentifier)
        try c.encode(ambientGapSeconds, forKey: .ambientGapSeconds)
        try c.encode(autoSpeakOnDetailOpen, forKey: .autoSpeakOnDetailOpen)
    }

    // 旧版 settings.json 无新字段——解码时给默认值，避免旧用户设置被整体重置
    private enum CodingKeys: String, CodingKey {
        case baseURL, model, apiKey, autoGenerate, categoryFilter
        case enableSeed, enableAI, aiSources, showAIMark, appearance, customCategories
        case speechRate, speechVoiceIdentifier, ambientGapSeconds, autoSpeakOnDetailOpen
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
        appearance = try c.decodeIfPresent(AppearanceMode.self, forKey: .appearance) ?? .system
        customCategories = try c.decodeIfPresent([CategoryConfig].self, forKey: .customCategories) ?? AISettings.defaultCustomCategories
        speechRate = try c.decodeIfPresent(Float.self, forKey: .speechRate) ?? 1.0
        speechVoiceIdentifier = try c.decodeIfPresent(String.self, forKey: .speechVoiceIdentifier) ?? "auto"
        ambientGapSeconds = try c.decodeIfPresent(Double.self, forKey: .ambientGapSeconds) ?? 1.5
        autoSpeakOnDetailOpen = try c.decodeIfPresent(Bool.self, forKey: .autoSpeakOnDetailOpen) ?? false
    }
}

/// 主流与本机 Agent AI 服务商预设
public struct AIProviderPreset: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let group: String
    public let icon: String
    public let defaultBaseURL: String
    public let models: [String]
    public let defaultModel: String
    public let helpText: String
    public let apiKeyPlaceholder: String
    public let requiresKey: Bool

    public init(
        id: String,
        name: String,
        group: String,
        icon: String,
        defaultBaseURL: String,
        models: [String],
        defaultModel: String,
        helpText: String,
        apiKeyPlaceholder: String,
        requiresKey: Bool
    ) {
        self.id = id
        self.name = name
        self.group = group
        self.icon = icon
        self.defaultBaseURL = defaultBaseURL
        self.models = models
        self.defaultModel = defaultModel
        self.helpText = helpText
        self.apiKeyPlaceholder = apiKeyPlaceholder
        self.requiresKey = requiresKey
    }

    public static let presets: [AIProviderPreset] = [
        // MARK: - 在线 API 服务
        .init(
            id: "deepseek",
            name: "DeepSeek (官方)",
            group: "在线 API 服务",
            icon: "sparkles",
            defaultBaseURL: "https://api.deepseek.com",
            models: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro", "deepseek-v4-flash"],
            defaultModel: "deepseek-chat",
            helpText: "官方高性价比模型，推荐用于生成常识与各领域知识卡片",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "siliconflow",
            name: "硅基流动 (SiliconFlow)",
            group: "在线 API 服务",
            icon: "bolt.fill",
            defaultBaseURL: "https://api.siliconflow.cn/v1",
            models: [
                "deepseek-ai/DeepSeek-V3",
                "deepseek-ai/DeepSeek-R1",
                "Qwen/Qwen2.5-7B-Instruct",
                "THUDM/glm-4-9b-chat"
            ],
            defaultModel: "deepseek-ai/DeepSeek-V3",
            helpText: "国内高可用云服务，提供 DeepSeek-V3/R1 与 Qwen 等海量满血模型",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "kimi",
            name: "Kimi (月之暗面)",
            group: "在线 API 服务",
            icon: "moon.stars.fill",
            defaultBaseURL: "https://api.moonshot.cn/v1",
            models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-auto"],
            defaultModel: "moonshot-v1-8k",
            helpText: "Moonshot 开放平台，擅长长文本与知识综合总结",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "zhipu",
            name: "智谱 GLM / BigModel",
            group: "在线 API 服务",
            icon: "brain.head.profile",
            defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
            models: ["glm-4-flash", "glm-4-plus", "glm-4-air", "glm-5.2"],
            defaultModel: "glm-4-flash",
            helpText: "清华智谱大模型，其中 glm-4-flash 免费且极速",
            apiKeyPlaceholder: "API Key (如 id.secret)",
            requiresKey: true
        ),
        .init(
            id: "dashscope",
            name: "阿里云百炼 (通义千问)",
            group: "在线 API 服务",
            icon: "cloud.sun.fill",
            defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            models: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen-long", "qwen2.5-72b-instruct"],
            defaultModel: "qwen-plus",
            helpText: "阿里云 DashScope OpenAI 兼容端点，通义千问官方服务",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "opencode",
            name: "OpenCode Go",
            group: "在线 API 服务",
            icon: "chevron.left.forwardslash.chevron.right",
            defaultBaseURL: "https://opencode.ai/zen/go/v1",
            models: ["deepseek-v4-flash", "deepseek-v4-pro", "glm-5.2", "qwen3.7-max", "kimi-k3", "minimax-m3", "mimo-v2.5"],
            defaultModel: "deepseek-v4-flash",
            helpText: "OpenCode 开发者中转服务，汇聚 DeepSeek、GLM、Qwen、Kimi 等多模型",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "tokenrhythm",
            name: "基元律动 (TokenRhythm)",
            group: "在线 API 服务",
            icon: "waveform.path.ecg",
            defaultBaseURL: "https://tokenrhythm.studio/v1",
            models: ["deepseek-v4-flash", "deepseek-v4-pro", "glm-5.2", "qwen3.8-max", "minimax-m2.7", "kimi-k2.6"],
            defaultModel: "deepseek-v4-flash",
            helpText: "TokenRhythm 聚合平台，提供高并发满血模型端点",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "xiaomi_mimo",
            name: "小米 MiMo (Xiaomi)",
            group: "在线 API 服务",
            icon: "bolt.ring.closed",
            defaultBaseURL: "https://api.xiaomimimo.com/v1",
            models: ["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2-flash", "mimo-v2-pro"],
            defaultModel: "mimo-v2.5",
            helpText: "小米大模型开放平台，提供高性价比 MiMo 系列模型",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "longcat",
            name: "LongCat (长猫科技)",
            group: "在线 API 服务",
            icon: "cat.fill",
            defaultBaseURL: "https://api.longcat.chat/openai",
            models: ["LongCat-2.0"],
            defaultModel: "LongCat-2.0",
            helpText: "长猫科技大模型服务平台端点",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "antdigital",
            name: "蚂蚁百灵 (AntDigital)",
            group: "在线 API 服务",
            icon: "ant.fill",
            defaultBaseURL: "https://maas-api.antdigital.com/v1",
            models: ["ling-3.0-flash-fin", "deepseek-v4-flash", "deepseek-v4-pro"],
            defaultModel: "ling-3.0-flash-fin",
            helpText: "蚂蚁数科百灵大模型平台，支持金融特化与通用大模型",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "nvidia_nim",
            name: "NVIDIA NIM",
            group: "在线 API 服务",
            icon: "cpu.fill",
            defaultBaseURL: "https://integrate.api.nvidia.com/v1",
            models: ["deepseek-ai/deepseek-v4-flash-0731", "moonshotai/kimi-k3", "nvidia/nemotron-3-ultra-550b-a55b"],
            defaultModel: "deepseek-ai/deepseek-v4-flash-0731",
            helpText: "NVIDIA API Catalog 开发者微服务，提供企业级推理加速",
            apiKeyPlaceholder: "nvapi-...",
            requiresKey: true
        ),
        .init(
            id: "amd_factory",
            name: "AMD 开发者平台 (Token Factory)",
            group: "在线 API 服务",
            icon: "square.stack.3d.forward.dottedline.fill",
            defaultBaseURL: "https://developer.amd.com.cn/radeon/api/v1",
            models: ["DeepSeek-V4-Flash", "Qwen3.8-Flash-Next", "MiniCPM5-1B"],
            defaultModel: "DeepSeek-V4-Flash",
            helpText: "AMD 开发者中心开源大模型端点",
            apiKeyPlaceholder: "sk-...",
            requiresKey: true
        ),
        .init(
            id: "openai",
            name: "OpenAI (官方)",
            group: "在线 API 服务",
            icon: "globe",
            defaultBaseURL: "https://api.openai.com/v1",
            models: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
            defaultModel: "gpt-4o-mini",
            helpText: "OpenAI 官方 API，支持 GPT-4o 等系列模型",
            apiKeyPlaceholder: "sk-proj-...",
            requiresKey: true
        ),

        // MARK: - 本地部署运行
        .init(
            id: "ollama",
            name: "Ollama (本地私有)",
            group: "本地部署运行",
            icon: "desktopcomputer",
            defaultBaseURL: "http://localhost:11434/v1",
            models: ["qwen2.5:7b", "deepseek-r1:7b", "llama3.1:8b"],
            defaultModel: "qwen2.5:7b",
            helpText: "本地离线大模型，无需消耗 Token 与联网，无需填 Key",
            apiKeyPlaceholder: "本地运行无需填 Key",
            requiresKey: false
        ),
        .init(
            id: "local_freellm",
            name: "本地代理网关 (:31415)",
            group: "本地部署运行",
            icon: "network",
            defaultBaseURL: "http://127.0.0.1:31415/v1",
            models: ["auto", "fusion", "gemini-3.6-flash", "kimi-k3"],
            defaultModel: "auto",
            helpText: "本机部署的聚合中转端口，无需消耗公网配额",
            apiKeyPlaceholder: "本地运行无需填 Key",
            requiresKey: false
        ),

        // MARK: - 自定义
        .init(
            id: "custom",
            name: "自定义服务商",
            group: "自定义",
            icon: "slider.horizontal.3",
            defaultBaseURL: "",
            models: [],
            defaultModel: "",
            helpText: "支持任意兼容 OpenAI 接口规范的第三方中转或网关服务",
            apiKeyPlaceholder: "输入对应平台的 API Key",
            requiresKey: true
        )
    ]

    public static var groups: [String] {
        var seen: [String] = []
        for p in presets {
            if !seen.contains(p.group) {
                seen.append(p.group)
            }
        }
        return seen
    }

    public static func match(baseURL: String) -> AIProviderPreset {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if trimmed.isEmpty {
            return presets.first(where: { $0.id == "deepseek" }) ?? presets[0]
        }
        if trimmed.contains("api.deepseek.com") {
            return presets.first(where: { $0.id == "deepseek" })!
        } else if trimmed.contains("opencode.ai") {
            return presets.first(where: { $0.id == "opencode" })!
        } else if trimmed.contains("tokenrhythm.studio") {
            return presets.first(where: { $0.id == "tokenrhythm" })!
        } else if trimmed.contains("xiaomimimo.com") {
            return presets.first(where: { $0.id == "xiaomi_mimo" })!
        } else if trimmed.contains("dashscope.aliyuncs.com") {
            return presets.first(where: { $0.id == "dashscope" })!
        } else if trimmed.contains("longcat.chat") {
            return presets.first(where: { $0.id == "longcat" })!
        } else if trimmed.contains("antdigital.com") {
            return presets.first(where: { $0.id == "antdigital" })!
        } else if trimmed.contains("nvidia.com") {
            return presets.first(where: { $0.id == "nvidia_nim" })!
        } else if trimmed.contains("amd.com.cn") {
            return presets.first(where: { $0.id == "amd_factory" })!
        } else if trimmed.contains("31415") {
            return presets.first(where: { $0.id == "local_freellm" })!
        } else if trimmed.contains("siliconflow.cn") {
            return presets.first(where: { $0.id == "siliconflow" })!
        } else if trimmed.contains("moonshot.cn") {
            return presets.first(where: { $0.id == "kimi" })!
        } else if trimmed.contains("bigmodel.cn") || trimmed.contains("z.ai") {
            return presets.first(where: { $0.id == "zhipu" })!
        } else if trimmed.contains("api.openai.com") {
            return presets.first(where: { $0.id == "openai" })!
        } else if trimmed.contains("11434") || trimmed.contains("localhost") {
            return presets.first(where: { $0.id == "ollama" })!
        } else {
            return presets.first(where: { $0.id == "custom" })!
        }
    }
}

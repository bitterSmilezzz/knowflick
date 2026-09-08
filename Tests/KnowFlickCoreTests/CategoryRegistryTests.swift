import Foundation
import Testing
@testable import KnowFlickCore

final class CategoryRegistryTests {
    private let custom = AISettings.defaultCustomCategories.map(\.name)

    @Test func testBuiltinPassesThrough() {
        #expect(CategoryRegistry.resolve("冷知识", custom: custom) == "冷知识")
        #expect(CategoryRegistry.normalize(" 冷知识 ", custom: custom) == "冷知识")
    }

    @Test func testCustomPassesThrough() {
        #expect(CategoryRegistry.resolve("AI 开发", custom: custom) == "AI 开发")
        #expect(CategoryRegistry.normalize("中级会计", custom: custom) == "中级会计")
        #expect(CategoryRegistry.normalize("投资理财", custom: custom) == "投资理财")
    }

    @Test func testExactAliases() {
        #expect(CategoryRegistry.normalize("人工智能", custom: custom) == "AI")
        #expect(CategoryRegistry.normalize("机器学习", custom: custom) == "AI")
        #expect(CategoryRegistry.normalize("会计学", custom: custom) == "中级会计")
        #expect(CategoryRegistry.normalize("智能体", custom: custom) == "AI Agent")
    }

    @Test func testInclusiveMatching() {
        #expect(CategoryRegistry.normalize("股票投资", custom: custom) == "投资理财")
        #expect(CategoryRegistry.normalize("基金定投", custom: custom) == "投资理财")
    }

    @Test func testUnknownFallsBackToBuiltinOrFirstCustom() {
        // 有自定义分类时兜底到第一个（用户更关注自定义内容）
        #expect(CategoryRegistry.normalize("完全随机的分类", custom: custom) == "AI")
        #expect(CategoryRegistry.normalize("完全随机的分类", custom: []) == "冷知识")   // 无自定义时兜底内置
        #expect(CategoryRegistry.fallback(custom: ["AI 开发"]) == "AI 开发")
    }

    @Test func testAliasOnlyResolvesWhenTargetExists() {
        // 自定义分类里没有「会计」时，别名「会计」不应解析成不存在分类
        #expect(CategoryRegistry.resolve("会计", custom: ["AI", "投资理财"]) == nil)
    }
}

final class AISettingsPreferredTests {
    @Test func testPreferredCategoriesParsingAndNormalization() {
        var settings = AISettings.default
        settings.categoryFilter = "冷知识, 人工智能, 不存在的分类, AI 开发"
        #expect(settings.preferredCategories == ["冷知识", "AI", "AI 开发"])   // 归一化 + 去重 + 未知剔除
    }

    @Test func testSetPreferredCategoriesRoundTrip() {
        var settings = AISettings.default
        settings.setPreferredCategories(["AI 开发", "冷知识"])
        #expect(settings.preferredCategories == ["AI 开发", "冷知识"])   // sorted() 字典序
    }

    @Test func testEmptyPrefersMeansAll() {
        #expect(AISettings.default.preferredCategories == [])
    }

    @Test func testAllCategoryNamesIncludesBuiltinAndCustom() {
        let settings = AISettings.default
        #expect(settings.allCategoryNames.first == "冷知识")
        #expect(settings.customCategoryNames == ["AI", "AI 开发", "AI Agent", "中级会计", "投资理财"])
        #expect(settings.allCategoryNames.contains("AI Agent"))
    }
}

final class AISettingsSourcesTests {
    @Test func testPreferredSourcesParsing() {
        var settings = AISettings.default
        settings.aiSources = "维基百科, 国家地理, 维基百科, "
        #expect(settings.preferredSources == ["维基百科", "国家地理"])   // 去空去重
    }

    @Test func testEmptySourcesFallsBackToDefault() {
        var settings = AISettings.default
        settings.aiSources = ""
        #expect(settings.preferredSources == [])
    }

    // MARK: - 旧版 settings.json 兼容（无新字段）

    @Test func testDecodeLegacySettingsWithoutNewFields() throws {
        // 旧版 settings.json 没有 enableSeed/enableAI/aiSources/showAIMark/customCategories
        let legacyJSON = """
        {"baseURL":"https://api.deepseek.com","model":"deepseek-chat","apiKey":"","autoGenerate":true,"categoryFilter":"物理"}
        """
        let settings = try JSONDecoder().decode(AISettings.self, from: Data(legacyJSON.utf8))
        #expect(settings.baseURL == "https://api.deepseek.com")
        #expect(settings.enableSeed)
        #expect(settings.enableAI)
        #expect(!(settings.aiSources.isEmpty))
        #expect(settings.showAIMark)
        #expect(settings.customCategories == AISettings.defaultCustomCategories)   // 默认预置 5 类
    }

    @Test func testDecodeFullSettingsRoundTrip() throws {
        var settings = AISettings.default
        settings.enableSeed = false
        settings.aiSources = "NASA"
        settings.showAIMark = false
        settings.customCategories = [CategoryConfig(name: "前端开发", description: "HTML/CSS/JS")]
        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(AISettings.self, from: data)
        #expect(decoded == settings)
        #expect(decoded.customCategories.first?.name == "前端开发")
    }

    @Test func testCategoryConfigIdentity() {
        let a = CategoryConfig(name: "AI", description: "d")
        let b = CategoryConfig(name: "AI", description: "different")
        #expect(a.id == b.id)   // id 以名字为准
    }
}

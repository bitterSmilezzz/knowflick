import XCTest
@testable import KnowFlickCore

final class CategoryRegistryTests: XCTestCase {
    private let custom = AISettings.defaultCustomCategories.map(\.name)

    func testBuiltinPassesThrough() {
        XCTAssertEqual(CategoryRegistry.resolve("冷知识", custom: custom), "冷知识")
        XCTAssertEqual(CategoryRegistry.normalize(" 冷知识 ", custom: custom), "冷知识")
    }

    func testCustomPassesThrough() {
        XCTAssertEqual(CategoryRegistry.resolve("AI 开发", custom: custom), "AI 开发")
        XCTAssertEqual(CategoryRegistry.normalize("中级会计", custom: custom), "中级会计")
        XCTAssertEqual(CategoryRegistry.normalize("投资理财", custom: custom), "投资理财")
    }

    func testExactAliases() {
        XCTAssertEqual(CategoryRegistry.normalize("人工智能", custom: custom), "AI")
        XCTAssertEqual(CategoryRegistry.normalize("机器学习", custom: custom), "AI")
        XCTAssertEqual(CategoryRegistry.normalize("会计学", custom: custom), "中级会计")
        XCTAssertEqual(CategoryRegistry.normalize("智能体", custom: custom), "AI Agent")
    }

    func testInclusiveMatching() {
        XCTAssertEqual(CategoryRegistry.normalize("股票投资", custom: custom), "投资理财")
        XCTAssertEqual(CategoryRegistry.normalize("基金定投", custom: custom), "投资理财")
    }

    func testUnknownFallsBackToBuiltinOrFirstCustom() {
        // 有自定义分类时兜底到第一个（用户更关注自定义内容）
        XCTAssertEqual(CategoryRegistry.normalize("完全随机的分类", custom: custom), "AI")
        XCTAssertEqual(CategoryRegistry.normalize("完全随机的分类", custom: []), "冷知识")   // 无自定义时兜底内置
        XCTAssertEqual(CategoryRegistry.fallback(custom: ["AI 开发"]), "AI 开发")
    }

    func testAliasOnlyResolvesWhenTargetExists() {
        // 自定义分类里没有「会计」时，别名「会计」不应解析成不存在分类
        XCTAssertNil(CategoryRegistry.resolve("会计", custom: ["AI", "投资理财"]))
    }
}

final class AISettingsPreferredTests: XCTestCase {
    func testPreferredCategoriesParsingAndNormalization() {
        var settings = AISettings.default
        settings.categoryFilter = "冷知识, 人工智能, 不存在的分类, AI 开发"
        XCTAssertEqual(settings.preferredCategories, ["冷知识", "AI", "AI 开发"])   // 归一化 + 去重 + 未知剔除
    }

    func testSetPreferredCategoriesRoundTrip() {
        var settings = AISettings.default
        settings.setPreferredCategories(["AI 开发", "冷知识"])
        XCTAssertEqual(settings.preferredCategories, ["AI 开发", "冷知识"])   // sorted() 字典序
    }

    func testEmptyPrefersMeansAll() {
        XCTAssertEqual(AISettings.default.preferredCategories, [])
    }

    func testAllCategoryNamesIncludesBuiltinAndCustom() {
        let settings = AISettings.default
        XCTAssertEqual(settings.allCategoryNames.first, "冷知识")
        XCTAssertEqual(settings.customCategoryNames, ["AI", "AI 开发", "AI Agent", "中级会计", "投资理财"])
        XCTAssertTrue(settings.allCategoryNames.contains("AI Agent"))
    }
}

final class AISettingsSourcesTests: XCTestCase {
    func testPreferredSourcesParsing() {
        var settings = AISettings.default
        settings.aiSources = "维基百科, 国家地理, 维基百科, "
        XCTAssertEqual(settings.preferredSources, ["维基百科", "国家地理"])   // 去空去重
    }

    func testEmptySourcesFallsBackToDefault() {
        var settings = AISettings.default
        settings.aiSources = ""
        XCTAssertEqual(settings.preferredSources, [])
    }

    // MARK: - 旧版 settings.json 兼容（无新字段）

    func testDecodeLegacySettingsWithoutNewFields() throws {
        // 旧版 settings.json 没有 enableSeed/enableAI/aiSources/showAIMark/customCategories
        let legacyJSON = """
        {"baseURL":"https://api.deepseek.com","model":"deepseek-chat","apiKey":"","autoGenerate":true,"categoryFilter":"物理"}
        """
        let settings = try JSONDecoder().decode(AISettings.self, from: Data(legacyJSON.utf8))
        XCTAssertEqual(settings.baseURL, "https://api.deepseek.com")
        XCTAssertTrue(settings.enableSeed)
        XCTAssertTrue(settings.enableAI)
        XCTAssertFalse(settings.aiSources.isEmpty)
        XCTAssertTrue(settings.showAIMark)
        XCTAssertEqual(settings.customCategories, AISettings.defaultCustomCategories)   // 默认预置 5 类
    }

    func testDecodeFullSettingsRoundTrip() throws {
        var settings = AISettings.default
        settings.enableSeed = false
        settings.aiSources = "NASA"
        settings.showAIMark = false
        settings.customCategories = [CategoryConfig(name: "前端开发", description: "HTML/CSS/JS")]
        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(AISettings.self, from: data)
        XCTAssertEqual(decoded, settings)
        XCTAssertEqual(decoded.customCategories.first?.name, "前端开发")
    }

    func testCategoryConfigIdentity() {
        let a = CategoryConfig(name: "AI", description: "d")
        let b = CategoryConfig(name: "AI", description: "different")
        XCTAssertEqual(a.id, b.id)   // id 以名字为准
    }
}

import XCTest
@testable import KnowFlickCore

final class CategoryRegistryTests: XCTestCase {
    func testCanonicalPassesThrough() {
        XCTAssertEqual(CategoryRegistry.normalize("物理"), "物理")
        XCTAssertEqual(CategoryRegistry.normalize(" 生物 "), "生物")   // 去空白
        XCTAssertEqual(CategoryRegistry.normalize("学习方法"), "学习方法")
    }

    func testExactAliases() {
        XCTAssertEqual(CategoryRegistry.normalize("人工智能"), "AI")
        XCTAssertEqual(CategoryRegistry.normalize("机器学习"), "AI")
        XCTAssertEqual(CategoryRegistry.normalize("神经科学"), "脑科学")
        XCTAssertEqual(CategoryRegistry.normalize("计算机科学"), "科技")
        XCTAssertEqual(CategoryRegistry.normalize("统计学"), "数学")
        XCTAssertEqual(CategoryRegistry.normalize("英语"), "语言")
        XCTAssertEqual(CategoryRegistry.normalize("会计学"), "会计")
    }

    func testInclusiveMatching() {
        XCTAssertEqual(CategoryRegistry.normalize("AI 算法应用"), "算法")   // 包含别名「算法」优先
        XCTAssertEqual(CategoryRegistry.normalize("物理与化学"), "物理")
        XCTAssertEqual(CategoryRegistry.normalize("Python 编程技巧"), "编程")   // 包含别名「编程」
    }

    func testUnknownFallsBack() {
        XCTAssertEqual(CategoryRegistry.normalize("完全随机的分类"), "科技")
        XCTAssertEqual(CategoryRegistry.normalize(""), "科技")
    }
}

final class AISettingsPreferredTests: XCTestCase {
    func testPreferredCategoriesParsingAndNormalization() {
        var settings = AISettings.default
        settings.categoryFilter = "物理, 人工智能, 不存在的分类, 物理"
        XCTAssertEqual(settings.preferredCategories, ["物理", "AI"])   // 归一化 + 去重 + 未知剔除
    }

    func testSetPreferredCategoriesRoundTrip() {
        var settings = AISettings.default
        settings.setPreferredCategories(["天文", "物理"])
        XCTAssertEqual(settings.preferredCategories, ["天文", "物理"])   // sorted() 字典序
    }

    func testEmptyPrefersMeansAll() {
        XCTAssertEqual(AISettings.default.preferredCategories, [])
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
        // v1.4.0 及更早版本的 settings.json 没有 enableSeed/enableAI/aiSources/showAIMark
        let legacyJSON = """
        {"baseURL":"https://api.deepseek.com","model":"deepseek-chat","apiKey":"","autoGenerate":true,"categoryFilter":"物理"}
        """
        let settings = try JSONDecoder().decode(AISettings.self, from: Data(legacyJSON.utf8))
        XCTAssertEqual(settings.baseURL, "https://api.deepseek.com")
        XCTAssertEqual(settings.categoryFilter, "物理")
        XCTAssertTrue(settings.enableSeed)     // 默认开启
        XCTAssertTrue(settings.enableAI)       // 默认开启
        XCTAssertFalse(settings.aiSources.isEmpty)   // 默认站点偏好
        XCTAssertTrue(settings.showAIMark)     // 默认显示标记
    }

    func testDecodeFullSettingsRoundTrip() throws {
        var settings = AISettings.default
        settings.enableSeed = false
        settings.enableAI = true
        settings.aiSources = "NASA"
        settings.showAIMark = false
        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(AISettings.self, from: data)
        XCTAssertEqual(decoded, settings)
        XCTAssertFalse(decoded.enableSeed)
        XCTAssertTrue(decoded.enableAI)
        XCTAssertEqual(decoded.aiSources, "NASA")
        XCTAssertFalse(decoded.showAIMark)
    }
}

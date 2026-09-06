import XCTest
@testable import KnowFlickCore

final class AIServiceTests: XCTestCase {
    // MARK: - 标题归一化

    func testNormalizeHeadlineRemovesWhitespaceAndPunctuation() {
        XCTAssertEqual(
            AIService.normalizeHeadline("香蕉是浆果，草莓不是！"),
            AIService.normalizeHeadline("香蕉是浆果 草莓不是")
        )
        XCTAssertEqual(AIService.normalizeHeadline("  Hello World  "), "helloworld")
    }

    // MARK: - 响应解析

    func testParseArray() throws {
        let json = """
        [
          {"category":"物理","headline":"标题一","summary":"摘要","details":"详情详情详情","searchKeywords":["a","b"]},
          {"category":"生物","headline":"标题二","summary":"摘要","details":"详情详情详情","searchKeywords":["c"]}
        ]
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        XCTAssertEqual(payloads.count, 2)
        XCTAssertEqual(payloads[0].headline, "标题一")
        XCTAssertEqual(payloads[1].category, "生物")
    }

    func testParseSingleObject() throws {
        let json = """
        {"category":"历史","headline":"单条","summary":"摘要","details":"详情详情详情","searchKeywords":[]}
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        XCTAssertEqual(payloads.count, 1)
        XCTAssertEqual(payloads[0].headline, "单条")
    }

    func testParseMixedArraySalvagesValidObjects() throws {
        // AI 常见坏输出：数组里混入非法对象/尾逗号
        let json = """
        [
          {"category":"物理","headline":"合法一","summary":"摘要","details":"详情详情详情","searchKeywords":["a"]},
          {"category":"物理","headline":123,"summary":"非法"},
          {"category":"天文","headline":"合法二","summary":"摘要","details":"详情详情详情","searchKeywords":["b"]},
        ]
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        XCTAssertEqual(payloads.map(\.headline), ["合法一", "合法二"])
    }

    func testParseGarbageThrows() {
        XCTAssertThrowsError(try AIService.parsePayloads(Data("完全不是 JSON".utf8)))
    }

    func testParseEmptyArrayThrows() {
        XCTAssertThrowsError(try AIService.parsePayloads(Data("[]".utf8)))
    }

    // MARK: - sources 字段兼容

    func testParseWithSources() throws {
        let json = """
        [{"category":"物理","headline":"标题","summary":"摘要","details":"详情详情详情","searchKeywords":["a"],"sources":["维基百科","NASA"]}]
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        XCTAssertEqual(payloads[0].sources, ["维基百科", "NASA"])
    }

    func testParseWithoutSourcesDefaultsEmpty() throws {
        let json = """
        [{"category":"物理","headline":"标题","summary":"摘要","details":"详情详情详情","searchKeywords":["a"]}]
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        XCTAssertEqual(payloads[0].sources, [])   // 旧格式兼容
    }

    // MARK: - 增量扫描（流式）

    func testScanObjectsExtractsCompleteObjectsFromPartial() {
        // 数组未闭合（流式中途），前两个完整对象可提取
        let partial = """
        [
          {"category":"物理","headline":"一","summary":"s","details":"d","searchKeywords":["a"],"sources":[]},
          {"category":"生物","headline":"二","summary":"s","details":"d","searchKeywords":["b"],"sources":[]},
          {"category":"历
        """
        let found = AIService.scanObjects(in: partial)
        XCTAssertEqual(found.map(\.headline), ["一", "二"])
    }

    func testScanObjectsIgnoresIncompleteObject() {
        let partial = """
        [
          {"category":"物理","headline":"一","summary":"s","details":"d","searchKeywords":["a"]},
          {"category":"生物","headline":"二","summary":"s","details":"d"
        """
        let found = AIService.scanObjects(in: partial)
        XCTAssertEqual(found.map(\.headline), ["一"])
    }

    // MARK: - SSE 行解析

    func testSSEContentDeltaStreaming() {
        XCTAssertEqual(AIService.sseContentDelta(#"data: {"choices":[{"delta":{"content":"香蕉"}}]}"#), "香蕉")
        XCTAssertEqual(AIService.sseContentDelta(#"data: {"choices":[{"delta":{"content":""}}]}"#), "")
        XCTAssertNil(AIService.sseContentDelta("data: [DONE]"))
        XCTAssertNil(AIService.sseContentDelta(": comment"))
        XCTAssertNil(AIService.sseContentDelta("event: message"))
        // 非流式字段兼容
        XCTAssertEqual(AIService.sseContentDelta(#"data: {"choices":[{"message":{"content":"兼容"}}]}"#), "兼容")
    }

    // MARK: - 近重复抑制

    func testJaccardSimilarity() {
        let a = AIService.bigramSet("香蕉是浆果，草莓不是")
        let b = AIService.bigramSet("香蕉是浆果，草莓不是！")
        XCTAssertEqual(AIService.jaccard(a, b), 1.0)   // 仅标点差异 → 完全相似

        let c = AIService.bigramSet("香蕉是浆果")   // 同知识点强改写（0.5）
        XCTAssertGreaterThan(AIService.jaccard(a, c), AIService.nearDuplicateThreshold, "强改写应判为近重复")

        let d = AIService.bigramSet("鲸鱼不是鱼是哺乳动物")
        XCTAssertLessThan(AIService.jaccard(a, d), AIService.nearDuplicateThreshold, "不同知识点不应误判")
    }

    func testBigramSetEdgeCases() {
        XCTAssertEqual(AIService.bigramSet("香蕉是浆果").count, 4)   // 香蕉/蕉是/是浆/浆果
        XCTAssertEqual(AIService.bigramSet("a"), ["a"])
        XCTAssertEqual(AIService.bigramSet(""), [])
    }

    // MARK: - 搜索链接

    func testBuildSearchLinksEncodesKeywords() {
        let links = AIService.buildSearchLinks(keywords: ["香蕉 浆果", "草莓"])
        XCTAssertEqual(links.count, 2)
        XCTAssertTrue(links[0].url.hasPrefix("https://www.bing.com/search?q="))
    }

    func testBuildSearchLinksCapsAtThree() {
        let links = AIService.buildSearchLinks(keywords: ["a", "b", "c", "d"])
        XCTAssertEqual(links.count, 3)
    }

    func testBuildSearchLinksAppendsSource() {
        let links = AIService.buildSearchLinks(keywords: ["香蕉", "浆果"], sources: ["维基百科"])
        XCTAssertTrue(links[0].url.contains("维基百科") || links[0].url.contains("%E7%BB%B4"))
        XCTAssertTrue(links[0].title.contains("维基百科"))
        // 无 sources 时保持旧行为
        let plain = AIService.buildSearchLinks(keywords: ["香蕉"])
        XCTAssertEqual(plain[0].title, "搜索：香蕉")
    }
}

import Foundation
import Testing
@testable import KnowFlickCore

final class AIServiceTests {
    // MARK: - 标题归一化

    @Test func testNormalizeHeadlineRemovesWhitespaceAndPunctuation() {
        #expect(AIService.normalizeHeadline("香蕉是浆果，草莓不是！") == AIService.normalizeHeadline("香蕉是浆果 草莓不是"))
        #expect(AIService.normalizeHeadline("  Hello World  ") == "helloworld")
    }

    // MARK: - 响应解析

    @Test func testParseArray() throws {
        let json = """
        [
          {"category":"物理","headline":"标题一","summary":"摘要","details":"详情详情详情","searchKeywords":["a","b"]},
          {"category":"生物","headline":"标题二","summary":"摘要","details":"详情详情详情","searchKeywords":["c"]}
        ]
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        #expect(payloads.count == 2)
        #expect(payloads[0].headline == "标题一")
        #expect(payloads[1].category == "生物")
    }

    @Test func testParseSingleObject() throws {
        let json = """
        {"category":"历史","headline":"单条","summary":"摘要","details":"详情详情详情","searchKeywords":[]}
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        #expect(payloads.count == 1)
        #expect(payloads[0].headline == "单条")
    }

    @Test func testParseMixedArraySalvagesValidObjects() throws {
        // AI 常见坏输出：数组里混入非法对象/尾逗号
        let json = """
        [
          {"category":"物理","headline":"合法一","summary":"摘要","details":"详情详情详情","searchKeywords":["a"]},
          {"category":"物理","headline":123,"summary":"非法"},
          {"category":"天文","headline":"合法二","summary":"摘要","details":"详情详情详情","searchKeywords":["b"]},
        ]
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        #expect(payloads.map(\.headline) == ["合法一", "合法二"])
    }

    @Test func testParseGarbageThrows() {
        #expect(throws: (any Error).self) { try AIService.parsePayloads(Data("完全不是 JSON".utf8)) }
    }

    @Test func testParseEmptyArrayThrows() {
        #expect(throws: (any Error).self) { try AIService.parsePayloads(Data("[]".utf8)) }
    }

    // MARK: - sources 字段兼容

    @Test func testParseWithSources() throws {
        let json = """
        [{"category":"物理","headline":"标题","summary":"摘要","details":"详情详情详情","searchKeywords":["a"],"sources":["维基百科","NASA"]}]
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        #expect(payloads[0].sources == ["维基百科", "NASA"])
    }

    @Test func testParseWithoutSourcesDefaultsEmpty() throws {
        let json = """
        [{"category":"物理","headline":"标题","summary":"摘要","details":"详情详情详情","searchKeywords":["a"]}]
        """
        let payloads = try AIService.parsePayloads(Data(json.utf8))
        #expect(payloads[0].sources == [])   // 旧格式兼容
    }

    // MARK: - 增量扫描（流式）

    @Test func testScanObjectsExtractsCompleteObjectsFromPartial() {
        // 数组未闭合（流式中途），前两个完整对象可提取
        let partial = """
        [
          {"category":"物理","headline":"一","summary":"s","details":"d","searchKeywords":["a"],"sources":[]},
          {"category":"生物","headline":"二","summary":"s","details":"d","searchKeywords":["b"],"sources":[]},
          {"category":"历
        """
        let found = AIService.scanObjects(in: partial)
        #expect(found.map(\.headline) == ["一", "二"])
    }

    @Test func testScanObjectsIgnoresIncompleteObject() {
        let partial = """
        [
          {"category":"物理","headline":"一","summary":"s","details":"d","searchKeywords":["a"]},
          {"category":"生物","headline":"二","summary":"s","details":"d"
        """
        let found = AIService.scanObjects(in: partial)
        #expect(found.map(\.headline) == ["一"])
    }

    /// P2-1 回归：正文里出现**游离的 `}`** 后，后续合法卡片必须仍能扫出来。
    /// 修复前实现在 depth == 0 时也照常 `depth -= 1`，depth 变负后真正的 `{` 不再被记为起点，
    /// 对象内部的嵌套 `{` 反被当作顶层起点 → `scanObjects` 返回 0（用户侧「AI 返回格式无法解析」）。
    @Test func testScanObjectsRecoversAfterStrayClosingBraceInProse() {
        let text = """
        这是说明文字，例如 } 这样的花括号，忽略它。
        [
          {"category":"物理","headline":"一","summary":"s","details":"d","searchKeywords":["a"]},
          {"category":"生物","headline":"二","summary":"s","details":"d","searchKeywords":["b"]}
        ]
        """
        #expect(AIService.scanObjects(in: text).map(\.headline) == ["一", "二"])
    }

    /// 游离 `}` 出现在卡片之间、以及一段文本里连续多个游离 `}`，都不得影响后续扫描。
    @Test func testScanObjectsToleratesMultipleStrayBracesAroundCards() {
        let text = """
        }}
        {"category":"物理","headline":"一","summary":"s","details":"d","searchKeywords":["a"]}
        中间还有 } 与 } 这样的噪声
        {"category":"生物","headline":"二","summary":"s","details":"d","searchKeywords":["b"]}
        }]
        """
        #expect(AIService.scanObjects(in: text).map(\.headline) == ["一", "二"])
    }

    /// 游离引号（未配对的 `"`）同样会把 inString 卡在 true，让后面所有花括号都被当成字符串内容。
    @Test func testScanObjectsRecoversAfterUnpairedQuoteInProse() {
        let text = """
        注意 " 这样的引号只是说明。
        {"category":"物理","headline":"一","summary":"s","details":"d","searchKeywords":["a"]}
        """
        #expect(AIService.scanObjects(in: text).map(\.headline) == ["一"])
    }

    /// 增量（逐 delta 送入）与整段扫描必须给出相同结果——SSE 流式路径走的是增量入口。
    /// 噪声里混入：成对的 `{...}` 示例（会被当对象但解不出卡片，静默跳过）与游离的 `}`。
    @Test func testIncrementalScannerToleratesStrayBraceAcrossSplits() {
        let text = """
        说明：例如 } 与 {"a":1} 这样的花括号示例，然后是正文。
        [{"category":"物理","headline":"一","summary":"s","details":"d","searchKeywords":["a"]},
        {"category":"生物","headline":"二","summary":"s","details":"dd","searchKeywords":["b"]}]
        """
        let whole = AIService.scanObjects(in: text)
        #expect(whole.map(\.headline) == ["一", "二"])

        let scanner = AIService.IncrementalObjectScanner()
        var index = text.startIndex
        while index < text.endIndex {
            let end = text.index(index, offsetBy: 3, limitedBy: text.endIndex) ?? text.endIndex
            scanner.append(String(text[index..<end]))
            index = end
        }
        #expect(scanner.objects.map(\.headline) == whole.map(\.headline))
    }

    /// 转义引号与嵌套对象（历史行为）在修复后必须保持不变。
    @Test func testScanObjectsStillHandlesEscapedQuotesAndNestedObjects() {
        let text = """
        [{"category":"物理","headline":"带 \\" 引号的标题","summary":"s","details":"d \\" 转义","searchKeywords":["a"]},
         {"category":"生物","headline":"含嵌套字段","summary":"s","details":"d","searchKeywords":["b"],"meta":{"x":1}}]
        """
        #expect(AIService.scanObjects(in: text).map(\.headline) == ["带 \" 引号的标题", "含嵌套字段"])
    }

    // MARK: - SSE 行解析

    @Test func testSSEContentDeltaStreaming() {
        #expect(AIService.sseContentDelta(#"data: {"choices":[{"delta":{"content":"香蕉"}}]}"#) == "香蕉")
        #expect(AIService.sseContentDelta(#"data: {"choices":[{"delta":{"content":""}}]}"#) == "")
        #expect(AIService.sseContentDelta("data: [DONE]") == nil)
        #expect(AIService.sseContentDelta(": comment") == nil)
        #expect(AIService.sseContentDelta("event: message") == nil)
        // 非流式字段兼容
        #expect(AIService.sseContentDelta(#"data: {"choices":[{"message":{"content":"兼容"}}]}"#) == "兼容")
    }

    // MARK: - 近重复抑制

    @Test func testJaccardSimilarity() {
        let a = AIService.bigramSet("香蕉是浆果，草莓不是")
        let b = AIService.bigramSet("香蕉是浆果，草莓不是！")
        #expect(AIService.jaccard(a, b) == 1.0)   // 仅标点差异 → 完全相似

        let c = AIService.bigramSet("香蕉是浆果")   // 同知识点强改写（0.5）
        #expect(AIService.jaccard(a, c) > AIService.nearDuplicateThreshold, "强改写应判为近重复")

        let d = AIService.bigramSet("鲸鱼不是鱼是哺乳动物")
        #expect(AIService.jaccard(a, d) < AIService.nearDuplicateThreshold, "不同知识点不应误判")
    }

    @Test func testBigramSetEdgeCases() {
        #expect(AIService.bigramSet("香蕉是浆果").count == 4)   // 香蕉/蕉是/是浆/浆果
        #expect(AIService.bigramSet("a") == ["a"])
        #expect(AIService.bigramSet("") == [])
    }

    // MARK: - 搜索链接

    @Test func testBuildSearchLinksEncodesKeywords() {
        let links = AIService.buildSearchLinks(keywords: ["香蕉 浆果", "草莓"])
        #expect(links.count == 2)
        #expect(links[0].url.hasPrefix("https://www.bing.com/search?q="))
    }

    @Test func testBuildSearchLinksCapsAtThree() {
        let links = AIService.buildSearchLinks(keywords: ["a", "b", "c", "d"])
        #expect(links.count == 3)
    }

    @Test func testBuildSearchLinksAppendsSource() {
        let links = AIService.buildSearchLinks(keywords: ["香蕉", "浆果"], sources: ["维基百科"])
        #expect(links[0].url.contains("维基百科") || links[0].url.contains("%E7%BB%B4"))
        #expect(links[0].title.contains("维基百科"))
        // 无 sources 时保持旧行为
        let plain = AIService.buildSearchLinks(keywords: ["香蕉"])
        #expect(plain[0].title == "搜索：香蕉")
    }
}

extension AIServiceTests {
    @Test func endpointPreservesCustomProviderPrefixes() throws {
        let cases = [
            ("https://api.example.com", "/v1/chat/completions"),
            (" https://api.example.com/v1/ ", "/v1/chat/completions"),
            ("https://api.example.com/api/paas/v4", "/api/paas/v4/chat/completions"),
            ("https://api.example.com/openai", "/openai/chat/completions"),
            ("https://api.example.com/v1/chat/completions", "/v1/chat/completions")
        ]
        for (base, path) in cases {
            #expect(try AIService.completionURL(baseURL: base).path == path)
        }
        for invalid in ["", "example.com", "file:///tmp/api", "https://api.example.com?key=value"] {
            #expect(throws: (any Error).self) { try AIService.completionURL(baseURL: invalid) }
        }
    }

    @Test func localEndpointsWorkWithoutKeysButLookalikeHostsDoNot() {
        var settings = AISettings.default
        for url in ["http://localhost:11434/v1", "http://127.0.0.1:31415/v1", "http://[::1]:11434/v1"] {
            settings.baseURL = url
            #expect(settings.isAIConfigured)
        }
        for url in ["https://localhost.example.com/v1", "https://example.com/localhost"] {
            settings.baseURL = url
            #expect(!settings.isAIConfigured)
        }
    }

    @Test func searchKeywordsCannotBecomeExtraQueryParameters() throws {
        let query = "C++ & R&D #标题? x=1"
        let link = try #require(AIService.buildSearchLinks(keywords: [query]).first)
        let components = try #require(URLComponents(string: link.url))
        #expect(components.queryItems == [URLQueryItem(name: "q", value: query)])
        #expect(components.fragment == nil)
    }
}

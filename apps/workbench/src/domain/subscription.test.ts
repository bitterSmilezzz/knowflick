import { describe, expect, it } from "vitest";
import {
  itemsToMaterials,
  isDue,
  makeSubscription,
  nextPollAt,
  normalizeTarget,
  parseFeed,
  parseGithubReleases,
  parseGithubTrending,
  parseSubscriptionPayload,
  requestUrlFor,
  type Subscription,
} from "./subscription";

const base: Subscription = {
  id: "sub-1",
  type: "rss",
  title: "示例订阅",
  targetUrl: "https://example.com/feed.xml",
  intervalMinutes: 360,
  lastPolledAt: null,
  isActive: true,
  createdAt: 1700000000000,
};

describe("订阅源（主动收集）", () => {
  describe("目标串归一化与校验", () => {
    it("RSS 地址要求完整 http/https 且不带凭据", () => {
      expect(normalizeTarget("rss", "  https://example.com/feed.xml  ")).toBe("https://example.com/feed.xml");
      expect(() => normalizeTarget("rss", "example.com/feed")).toThrow("完整的 http/https");
      expect(() => normalizeTarget("rss", "ftp://example.com/f")).toThrow("只支持 http/https");
      expect(() => normalizeTarget("rss", "https://u:p@example.com/f")).toThrow("账号密码");
      expect(() => normalizeTarget("rss", "   ")).toThrow("请填写订阅目标");
    });

    it("GitHub 仓库接受 owner/repo 与整条仓库链接", () => {
      expect(normalizeTarget("github_release", "rust-lang/rust")).toBe("rust-lang/rust");
      expect(normalizeTarget("github_release", "https://github.com/rust-lang/rust/")).toBe("rust-lang/rust");
      expect(() => normalizeTarget("github_release", "rust-lang")).toThrow("owner/repo");
      expect(() => normalizeTarget("github_release", "a/b/c")).toThrow("owner/repo");
    });

    it("趋势订阅的语言名做小写化与字符校验", () => {
      expect(normalizeTarget("github_trending", " Rust ")).toBe("rust");
      expect(normalizeTarget("github_trending", "c++")).toBe("c++");
      expect(() => normalizeTarget("github_trending", "rust lang")).toThrow("语言名");
    });
  });

  describe("到期判定", () => {
    it("从未抓取且激活时随时可抓", () => {
      expect(isDue(base)).toBe(true);
      expect(nextPollAt(base)).toBeNull();
    });

    it("按间隔判断是否到期", () => {
      const sub = { ...base, lastPolledAt: 1000 };
      expect(isDue(sub, 1000 + 359 * 60_000)).toBe(false);
      expect(isDue(sub, 1000 + 360 * 60_000)).toBe(true);
      expect(nextPollAt(sub)).toBe(1000 + 360 * 60_000);
    });

    it("停用的订阅永不到期", () => {
      const sub = { ...base, isActive: false };
      expect(isDue(sub)).toBe(false);
      expect(nextPollAt(sub)).toBeNull();
    });
  });

  describe("RSS / Atom 解析", () => {
    const rss = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>技术周刊</title>
          <item>
            <title>第一期：本地优先架构</title>
            <link>https://example.com/1</link>
            <guid>post-1</guid>
            <pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate>
            <content:encoded><![CDATA[<p>正文 <b>含标签</b></p>]]></content:encoded>
          </item>
          <item>
            <title>第二期：向量检索</title>
            <link>https://example.com/2</link>
            <description>纯文本摘要 &amp; 实体</description>
          </item>
          <item>
            <title>缺少链接的坏条目</title>
          </item>
        </channel>
      </rss>`;

    it("解析 RSS 条目并丢掉缺链接的坏条目", () => {
      const items = parseFeed(rss);
      expect(items).toHaveLength(2);
      expect(items[0].key).toBe("post-1");
      expect(items[0].title).toBe("第一期：本地优先架构");
      expect(items[0].text).toContain("正文");
      expect(items[0].text).not.toContain("<b>");
      expect(items[0].publishedAt).toBe(Date.parse("Mon, 19 Oct 2026 10:00:00 GMT"));
      expect(items[1].key).toBe("https://example.com/2");
      expect(items[1].text).toContain("&");
    });

    it("解析 Atom 条目", () => {
      const atom = `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>Atom 条目</title>
            <id>urn:uuid:1</id>
            <link rel="alternate" href="https://example.com/atom-1"/>
            <updated>2026-10-19T12:00:00Z</updated>
            <summary>摘要文本</summary>
          </entry>
        </feed>`;
      const items = parseFeed(atom);
      expect(items).toHaveLength(1);
      expect(items[0].key).toBe("urn:uuid:1");
      expect(items[0].url).toBe("https://example.com/atom-1");
      expect(items[0].publishedAt).toBe(Date.parse("2026-10-19T12:00:00Z"));
    });

    it("非 feed 内容返回空数组而不是抛错", () => {
      expect(parseFeed("<html><body>nope</body></html>")).toEqual([]);
    });
  });

  describe("GitHub 解析", () => {
    it("真实 RSS：CDATA、实体、各种日期格式、坏条目跳过", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com/</link>
    <description><![CDATA[A blog about & things <b>like</b> this]]></description>
    <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>Tue, 21 Oct 2026 08:30:00 +0800</lastBuildDate>
    <item>
      <title>Post with CDATA &amp; entities</title>
      <link>https://example.com/posts/1?utm_source=rss</link>
      <guid isPermaLink="false">tag:example.com,2026:post-1</guid>
      <description><![CDATA[<p>Body with <a href="https://example.com">a link</a> &amp; entities</p>]]></description>
      <content:encoded><![CDATA[<p>Full content here</p><ul><li>one</li><li>two</li></ul>]]></content:encoded>
      <pubDate>Tue, 21 Oct 2026 08:00:00 +0800</pubDate>
      <dc:creator>Alice</dc:creator>
      <category>tech</category>
    </item>
    <item>
      <title>Post with relative-ish link and no guid</title>
      <link>/posts/2</link>
      <description>Plain description with &lt;escaped&gt; markup</description>
      <pubDate>Mon, 20 Oct 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>ISO date post</title>
      <link>https://example.com/posts/3</link>
      <description>Third post</description>
      <pubDate>2026-10-19T12:00:00Z</pubDate>
    </item>
    <item>
      <title>Broken item without link</title>
      <description>Should be skipped</description>
    </item>
  </channel>
</rss>
`;
    const items = parseFeed(xml, "https://example.com/feed.xml");
    // 缺链接的坏条目要跳过，而不是让整次抓取作废
    expect(items.length).toBe(3);
    const first = items[0];
    expect(first.title).toContain("CDATA");
    expect(first.key).toBe("tag:example.com,2026:post-1");
    // content:encoded 优先于 description
    expect(first.text).toContain("Full content here");
    // RFC822 与 ISO 两种日期都要能解析
    expect(first.publishedAt).toBeTypeOf("number");
    expect(items[2].publishedAt).toBe(Date.parse("2026-10-19T12:00:00Z"));
  });

  it("真实 feed 里的相对链接要补成绝对地址", () => {
    // 直接存成素材的「原文链接」的话，相对路径点开是无效地址。
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com/</link>
    <description><![CDATA[A blog about & things <b>like</b> this]]></description>
    <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>Tue, 21 Oct 2026 08:30:00 +0800</lastBuildDate>
    <item>
      <title>Post with CDATA &amp; entities</title>
      <link>https://example.com/posts/1?utm_source=rss</link>
      <guid isPermaLink="false">tag:example.com,2026:post-1</guid>
      <description><![CDATA[<p>Body with <a href="https://example.com">a link</a> &amp; entities</p>]]></description>
      <content:encoded><![CDATA[<p>Full content here</p><ul><li>one</li><li>two</li></ul>]]></content:encoded>
      <pubDate>Tue, 21 Oct 2026 08:00:00 +0800</pubDate>
      <dc:creator>Alice</dc:creator>
      <category>tech</category>
    </item>
    <item>
      <title>Post with relative-ish link and no guid</title>
      <link>/posts/2</link>
      <description>Plain description with &lt;escaped&gt; markup</description>
      <pubDate>Mon, 20 Oct 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>ISO date post</title>
      <link>https://example.com/posts/3</link>
      <description>Third post</description>
      <pubDate>2026-10-19T12:00:00Z</pubDate>
    </item>
    <item>
      <title>Broken item without link</title>
      <description>Should be skipped</description>
    </item>
  </channel>
</rss>
`;
    const items = parseFeed(xml, "https://example.com/feed.xml");
    const relative = items.find((i) => i.title.includes("relative-ish"));
    expect(relative?.url).toBe("https://example.com/posts/2");
  });

  it("没有 base 时不乱补，相对链接原样保留", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com/</link>
    <description><![CDATA[A blog about & things <b>like</b> this]]></description>
    <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>Tue, 21 Oct 2026 08:30:00 +0800</lastBuildDate>
    <item>
      <title>Post with CDATA &amp; entities</title>
      <link>https://example.com/posts/1?utm_source=rss</link>
      <guid isPermaLink="false">tag:example.com,2026:post-1</guid>
      <description><![CDATA[<p>Body with <a href="https://example.com">a link</a> &amp; entities</p>]]></description>
      <content:encoded><![CDATA[<p>Full content here</p><ul><li>one</li><li>two</li></ul>]]></content:encoded>
      <pubDate>Tue, 21 Oct 2026 08:00:00 +0800</pubDate>
      <dc:creator>Alice</dc:creator>
      <category>tech</category>
    </item>
    <item>
      <title>Post with relative-ish link and no guid</title>
      <link>/posts/2</link>
      <description>Plain description with &lt;escaped&gt; markup</description>
      <pubDate>Mon, 20 Oct 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>ISO date post</title>
      <link>https://example.com/posts/3</link>
      <description>Third post</description>
      <pubDate>2026-10-19T12:00:00Z</pubDate>
    </item>
    <item>
      <title>Broken item without link</title>
      <description>Should be skipped</description>
    </item>
  </channel>
</rss>
`;
    const items = parseFeed(xml);
    const relative = items.find((i) => i.title.includes("relative-ish"));
    expect(relative?.url).toBe("/posts/2");
  });

  it("真实 Atom：entry、CDATA 实体、type=html 的 summary", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Feed</title>
  <link href="https://example.org/"/>
  <updated>2026-10-21T09:00:00Z</updated>
  <id>urn:uuid:60a76c80-d399-11d9-b93C-0003939e0af6</id>
  <entry>
    <title>Atom entry one</title>
    <link href="https://example.org/entries/1"/>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <updated>2026-10-21T08:00:00Z</updated>
    <published>2026-10-20T08:00:00Z</published>
    <summary type="html">&lt;p&gt;Summary with &amp;amp; entity&lt;/p&gt;</summary>
    <content type="html">&lt;div&gt;Full content&lt;/div&gt;</content>
  </entry>
  <entry>
    <title>Atom entry with &lt;escaped&gt; title</title>
    <link href="https://example.org/entries/2" rel="alternate"/>
    <id>urn:uuid:2225c695-cfb8-4ebb-bbbb-80da344efa6a</id>
    <updated>2026-10-20T08:00:00Z</updated>
    <summary>Plain summary</summary>
  </entry>
</feed>
`;
    const items = parseFeed(xml, "https://example.org/feed.xml");
    expect(items.length).toBe(2);
    expect(items[0].title).toBe("Atom entry one");
    expect(items[0].url).toBe("https://example.org/entries/1");
    expect(items[0].key).toContain("urn:uuid:");
    expect(items[1].title).toContain("escaped");
  });

  it("解析 Release 数组", () => {
      const json = JSON.stringify([
        {
          tag_name: "v1.2.0",
          name: "1.2.0",
          body: "修复若干问题",
          html_url: "https://github.com/a/b/releases/tag/v1.2.0",
          published_at: "2026-10-18T00:00:00Z",
        },
        { tag_name: "", name: "无 tag" },
      ]);
      const items = parseGithubReleases(json, "a/b");
      expect(items).toHaveLength(1);
      expect(items[0].key).toBe("a/b@v1.2.0");
      expect(items[0].title).toBe("a/b 1.2.0");
      expect(items[0].text).toBe("修复若干问题");
    });

    it("解析趋势仓库（数组与 search 包裹两种形状）", () => {
      const repo = { full_name: "x/y", html_url: "https://github.com/x/y", description: "描述", stargazers_count: 1234, language: "Rust" };
      const direct = parseGithubTrending(JSON.stringify([repo]));
      expect(direct[0].key).toBe("x/y");
      expect(direct[0].text).toContain("Rust");
      expect(direct[0].text).toContain("1234 stars");

      const wrapped = parseGithubTrending(JSON.stringify({ items: [repo] }));
      expect(wrapped).toHaveLength(1);
    });

    it("坏 JSON 给出明确错误", () => {
      expect(() => parseGithubReleases("not json", "a/b")).toThrow("合法 JSON");
      expect(() => parseGithubTrending("not json")).toThrow("合法 JSON");
    });
  });

  describe("请求 URL 与分发", () => {
    it("按类型生成请求地址", () => {
      expect(requestUrlFor({ type: "rss", targetUrl: "https://e.com/f" })).toBe("https://e.com/f");
      expect(requestUrlFor({ type: "github_release", targetUrl: "a/b" })).toContain(
        "api.github.com/repos/a/b/releases"
      );
      expect(requestUrlFor({ type: "github_trending", targetUrl: "rust" })).toContain("language:rust");
      expect(requestUrlFor({ type: "github_trending", targetUrl: "" })).toContain("stars");
    });

    it("parseSubscriptionPayload 按类型选解析器", () => {
      const rss = "<rss><channel><item><title>T</title><link>https://e.com/1</link></item></channel></rss>";
      expect(parseSubscriptionPayload({ type: "rss", targetUrl: "https://e.com/f" }, rss)).toHaveLength(1);
      const rel = JSON.stringify([{ tag_name: "v1", html_url: "https://g/1" }]);
      expect(parseSubscriptionPayload({ type: "github_release", targetUrl: "a/b" }, rel)).toHaveLength(1);
    });
  });

  describe("条目转素材与去重", () => {
    const sub = { id: "sub-1", title: "技术周刊", type: "rss" as const };
    const items = [
      { key: "k1", title: "第一篇", url: "https://e.com/1", text: "正文一", publishedAt: 1 },
      { key: "k2", title: "第二篇", url: "https://e.com/2", text: "", publishedAt: 2 },
      { key: "k3", title: "第一篇的重复", url: "https://e.com/1", text: "重复", publishedAt: 3 },
      { key: "k4", title: "没有链接", url: "", text: "x", publishedAt: 4 },
    ];

    it("按来源链接去重，并统计跳过条数", () => {
      const { materials, skipped } = itemsToMaterials(items, [], sub, 1700000000000);
      expect(materials).toHaveLength(2);
      expect(materials.map((m) => m.url)).toEqual(["https://e.com/1", "https://e.com/2"]);
      expect(skipped).toBe(2);
    });

    it("已在库里的链接不会再进来", () => {
      const { materials, skipped } = itemsToMaterials(items, ["https://e.com/1"], sub);
      expect(materials).toHaveLength(1);
      expect(materials[0].url).toBe("https://e.com/2");
      expect(skipped).toBe(3);
    });

    it("正文为空时回落标题，并写入订阅来源元数据", () => {
      const { materials } = itemsToMaterials([items[1]], [], sub, 1700000000000);
      expect(materials[0].text).toBe("第二篇");
      const meta = JSON.parse(materials[0].metadataJson) as Record<string, unknown>;
      expect(meta.subscriptionId).toBe("sub-1");
      expect(meta.subscriptionType).toBe("rss");
      expect(meta.fetchedAt).toBe(1700000000000);
    });

    it("现有链接里的空串与空格不参与去重", () => {
      const { materials } = itemsToMaterials([items[0]], ["", "   "], sub);
      expect(materials).toHaveLength(1);
    });
  });

  describe("创建订阅", () => {
    it("拒绝空名称与过短间隔", () => {
      expect(() => makeSubscription({ type: "rss", title: " ", target: "https://e.com/f" })).toThrow("订阅名称");
      expect(() =>
        makeSubscription({ type: "rss", title: "T", target: "https://e.com/f", intervalMinutes: 5 })
      ).toThrow("15 分钟");
    });

    it("生成可用的订阅对象", () => {
      const sub = makeSubscription({ type: "github_release", title: "Rust", target: "rust-lang/rust" });
      expect(sub.targetUrl).toBe("rust-lang/rust");
      expect(sub.intervalMinutes).toBe(360);
      expect(sub.isActive).toBe(true);
      expect(sub.lastPolledAt).toBeNull();
      expect(sub.id).toBeTruthy();
    });
  });
});

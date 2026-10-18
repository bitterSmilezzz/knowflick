import { describe, expect, it } from "vitest";
import { cardFromJson } from "./card";
import {
  attributeImportedCards,
  charsetFromContentType,
  charsetFromHead,
  decodeEntities,
  decodeHTML,
  digest,
  firstURL,
  singleLine,
  validatedLink,
  ClipError,
} from "./clipEngine";

const articleHTML = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <title>复利的第七十天 &amp; 一个反直觉的结论</title>
  <meta name="description" content="为什么 1% 的日增长在 70 天后会翻倍">
  <meta property="og:site_name" content="科普示例站">
  <link rel="canonical" href="/finance/compound-70">
  <style>.nav{color:red}</style>
  <script>var hidden = "脚本里的文字不该出现";</script>
</head>
<body>
  <header class="site-header">
    <nav><a href="/">首页</a><a href="/about">关于本站</a></nav>
  </header>
  <div id="sidebar" class="sidebar related-content">
    <p>侧栏推荐：这篇文章讲的是一个完全不同的话题，它足够长以便在按长度挑选正文容器时胜出，然而它是推荐位而不是正文内容区域。</p>
  </div>
  <article class="post-content">
    <h1>复利的第七十天</h1>
    <p>每天进步 1%，七十天后总量翻倍——这是金融里最常用的粗略估算，它的名字叫「72 法则」。</p>
    <p>法则的分母取 72 而不是 70，是因为 72 有十二个因子，能被 2、3、4、6、8、9 整除，口算时更顺手。</p>
    <p>但真实的复利要扣通胀与手续费，名义翻倍不等于购买力翻倍。</p>
    <form><input type="text" placeholder="订阅"></form>
    <p>表单之后的这一段仍然属于文章正文，它验证自闭合标签不会把后续文字一起丢掉。</p>
  </article>
  <section id="comments">
    <p>评论区评论：楼主说得对我完全同意，这条评论也很长，用来验证 comment 容器会被否决而不会当成正文容器。</p>
  </section>
  <footer>© 2026 科普示例站 版权所有 未经授权禁止转载</footer>
</body>
</html>`;

function failureOf(raw: string): ClipError | null {
  try {
    validatedLink(raw);
    return null;
  } catch (error) {
    return error instanceof ClipError ? error : null;
  }
}

describe("clip engine", () => {
  it("validates links like the shared engine", () => {
    expect(validatedLink("example.com/post").scheme).toBe("https");
    expect(validatedLink("http://example.com").scheme).toBe("http");
    expect(validatedLink("  https://a.test/x  ").absolute).toBe("https://a.test/x");
    expect(validatedLink("example.com:8080/x").port).toBe("8080");
    expect(validatedLink("localhost:8080/x").host).toBe("localhost");
    expect(failureOf("ftp://example.com/file")?.detail).toBe("ftp");
    expect(failureOf("javascript:alert(1)")?.detail).toBe("javascript");
    expect(failureOf("   ")?.code).toBe("链接为空");
    expect(failureOf("https://")?.code).toBe("链接缺少域名");
    expect(failureOf("https://user:pw@example.com/x")?.code).toBe("链接里带有账号密码，已拒绝");
    expect(failureOf("mailto:someone@example.com")?.code).toContain("http");
    expect(failureOf("mailto:someone@example.com")?.detail).toBe("mailto");
    expect(failureOf("tel:12345")?.detail).toBe("tel");
    expect(firstURL("强烈推荐这篇 https://example.com/a。")).toBe("https://example.com/a");
    expect(firstURL("看这个 http://a.test/1 和 http://b.test/2")).toBe("http://a.test/1");
    expect(firstURL("<https://c.test/x>")).toBe("https://c.test/x");
    expect(firstURL("没有链接")).toBeNull();
  });

  it("extracts article metadata and clean body", () => {
    const result = digest(articleHTML, "https://example.com/anything");
    expect(result).not.toBeNull();
    expect(result?.title).toBe("复利的第七十天 & 一个反直觉的结论");
    expect(result?.siteName).toBe("科普示例站");
    expect(result?.description).toBe("为什么 1% 的日增长在 70 天后会翻倍");
    expect(result?.pageURL).toBe("https://example.com/finance/compound-70");
    expect(result?.sourceURL).toBe("https://example.com/anything");
    expect(result?.text).toContain("七十天后总量翻倍");
    expect(result?.text).toContain("72 有十二个因子");
    expect(result?.text).toContain("表单之后的这一段");
    expect(result?.text).not.toMatch(/脚本|关于本站|侧栏推荐|评论区|版权所有|订阅/);
    expect(result?.text).not.toContain("\n\n");
    expect(result?.text).not.toContain("  ");
    for (const line of result?.text.split("\n") ?? []) {
      expect(line.length).toBeGreaterThanOrEqual(4);
    }
    expect(result?.aiNote).toContain("标题：复利的第七十天");
    expect(result?.aiNote).toContain("来源：https://example.com/finance/compound-70");
    expect(result?.sourceLink.url).toBe("https://example.com/finance/compound-70");
    expect(result?.sourceLink.title).toBe("科普示例站");
    expect(result?.text).not.toContain("color:red");
    expect(result?.text).not.toContain("脚本里的文字不该出现");
  });

  it("attribution with distinct source and page URLs", () => {
    const sourceURL = "https://example.test/article?from=share";
    const pageURL = "https://example.test/canonical";
    const [attributed] = attributeImportedCards(sourceURL, pageURL, "Example", [
      cardFromJson({
        id: "clip-test",
        headline: "A useful idea",
        links: [
          { title: "Original address", url: sourceURL },
          { title: "Canonical address", url: pageURL },
          { title: "Research paper", url: "https://papers.test/1" },
        ],
      }),
    ]);
    expect(attributed?.source).toBe("imported");
    expect(attributed?.links).toEqual([
      { title: "Example", url: pageURL },
      { title: "Research paper", url: "https://papers.test/1" },
    ]);
  });

  it("attribution keeps canonical source first", () => {
    const result = digest(articleHTML, "https://example.com/anything");
    const card = cardFromJson({
      id: "clip-test",
      headline: "A useful idea",
      links: [
        { title: "Original", url: "https://example.com/anything" },
        { title: "Canonical", url: "https://example.com/finance/compound-70" },
        { title: "Paper", url: "https://papers.test/1" },
      ],
    });
    const [attributed] = result?.attributing([card]) ?? [];
    expect(attributed?.source).toBe("imported");
    expect(attributed?.links).toEqual([
      result?.sourceLink,
      { title: "Paper", url: "https://papers.test/1" },
    ]);
  });

  it("handles plain pages, boilerplate rejection, and truncation", () => {
    const plain = digest("<html><head><title>随便一页</title></head><body><div><p>这里没有语义容器，但有足够长的一段正文，用来验证退化路径。</p></div><div><p>第二段同样是正文，它也应该出现。</p></div></body></html>", "https://a.test/p");
    expect(plain?.siteName).toBe("a.test");
    expect(digest("<html><body><nav><a href=\"/\">首页</a></nav><div>请登录后继续浏览，本站内容受版权保护</div><footer>版权所有 2026</footer></body></html>", "https://b.test/")).toBeNull();
    const paragraph = "复利是把双刃剑，它在前期几乎看不见效果。".repeat(40);
    const longHtml = `<html><body><article>${Array.from({ length: 10 }, () => `<p>${paragraph}</p>`).join("")}</article></body></html>`;
    const truncated = digest(longHtml, "https://c.test/long");
    expect(truncated?.truncated).toBe(true);
    expect(truncated?.text.length).toBeLessThanOrEqual(4000);
    expect(truncated?.text.length).toBeGreaterThan(3000);
  });

  it("decodes entities charset and messy html", () => {
    expect(decodeEntities("a&amp;b")).toBe("a&b");
    expect(decodeEntities("&#20320;&#x597D;")).toBe("你好");
    expect(decodeEntities("A&nbsp;B")).toBe("A B");
    expect(decodeEntities("R&B 保持原样")).toBe("R&B 保持原样");
    expect(decodeEntities("&unknownthing;")).toBe("&unknownthing;");
    expect(decodeEntities("软连字符&#173;消失")).toBe("软连字符消失");
    expect(charsetFromContentType("text/html; charset=GBK")).toBe("gbk");
    expect(charsetFromContentType('text/html;Charset="utf-8"')).toBe("utf-8");
    expect(charsetFromHead('<meta http-equiv=Content-Type content="text/html; charset=Big5">')).toBe("big5");
    expect(charsetFromHead('<html><head><meta charset="gbk">')).toBe("gbk");
    expect(charsetFromHead("<html><body>没有声明")).toBeNull();
    const gbkText = "复利的第七十天与中文正文";
    const gbkBytes = new Uint8Array([
      0xb8, 0xb4, 0xc0, 0xfb, 0xb5, 0xc4, 0xb5, 0xda, 0xc6, 0xdf, 0xca, 0xae, 0xcc, 0xec, 0xd3, 0xeb,
      0xd6, 0xd0, 0xce, 0xc4, 0xd5, 0xfd, 0xce, 0xc4,
    ]);
    expect(decodeHTML(gbkBytes, "text/html; charset=gbk")).toBe(gbkText);
    const utf8 = new TextEncoder().encode("纯 UTF-8 页面");
    expect(decodeHTML(utf8, "text/html; charset=不存在的编码")).toBe("纯 UTF-8 页面");
    const messy = digest(`<HTML><BODY><ARTICLE CLASS=post>
<P TITLE=带>号的标题>第一段：这一段要能抽出来，它足够长以通过短行过滤。</P>
<P>第二段：这一句也要在。</P>
</ARTICLE></BODY></HTML>`, "https://d.test/");
    expect(messy?.text).toContain("第一段");
    expect(messy?.text).toContain("第二段");
    const unclosed = digest(`<html><body><div id="content"><p>第一段没有闭合标签，但它后面还有内容需要被抽出来。
<p>第二段也正常闭合。</p></div></body></html>`, "https://e.test/");
    expect(unclosed?.text).toContain("第一段没有闭合标签");
    expect(unclosed?.text).toContain("第二段也正常闭合");
    const commented = digest(`<html><body><article><p>可见的正文段落，它需要足够长以通过短行过滤规则的检查。</p><!-- 这段注释里的文字不该出现，因为它被包在注释中，长度也够长。 --></article></body></html>`, "https://f.test/");
    expect(commented?.text).not.toContain("不该出现");
    expect(digest("<html><head><script>var x = 1;</script></head><body><p>这一段的文字必须被正常抽取出来。</p></body></html>", "https://g.test/")?.text).toContain("这一段的文字");
    expect(singleLine(`a\n  ${"长".repeat(300)}`).length).toBe(160);
    expect(singleLine("  多  行\n 文本  ")).toBe("多 行 文本");
  });
});

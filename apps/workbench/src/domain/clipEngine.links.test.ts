import { describe, expect, it } from "vitest";
import { firstURL, parseLink, resolveHref, validatedLink } from "./clipEngine";

/**
 * 链接解析：把页面里形态各异的地址解析成可用的绝对地址。
 *
 * `resolveHref` 此前没有任何测试覆盖——而它正是「订阅源里的相对链接点开是
 * 无效地址」那条缺陷的同类逻辑（那次的缺陷在订阅源侧，这里是剪藏侧，
 * 两条路径都靠同一套规则）。规则错了，用户点开就是 404。
 */

const base = (url: string) => {
  const link = validatedLink(url);
  if (!link) throw new Error(`测试用的基准地址不合法：${url}`);
  return link;
};

describe("parseLink：认得出链接", () => {
  it("普通 https 链接", () => {
    const link = parseLink("https://example.test/a/b");
    expect(link?.host).toBe("example.test");
    expect(link?.rest).toBe("/a/b");
  });

  it("带端口", () => {
    expect(parseLink("http://example.test:8080/x")?.port).toBe("8080");
  });

  it("没有协议不是链接", () => {
    expect(parseLink("example.test/a")).toBeNull();
    expect(parseLink("://example.test")).toBeNull();
  });

  it("协议名不能以数字开头", () => {
    expect(parseLink("1http://example.test")).toBeNull();
  });
});

describe("firstURL：从一段文字里找出第一个链接", () => {
  it("找得到时返回原样地址", () => {
    expect(firstURL("看这个 https://example.test/a 很好")).toBe("https://example.test/a");
  });

  it("没有链接时返回 null", () => {
    expect(firstURL("这里没有链接")).toBeNull();
  });
});

describe("resolveHref：把相对地址补成绝对地址", () => {
  const b = base("https://example.test/blog/post.html");

  it("绝对地址原样保留", () => {
    expect(resolveHref("https://other.test/x", b)).toBe("https://other.test/x");
    expect(resolveHref("http://other.test/x", b)).toBe("http://other.test/x");
  });

  it("协议相对地址补上原协议", () => {
    expect(resolveHref("//cdn.test/x.png", b)).toBe("https://cdn.test/x.png");
  });

  it("根相对地址补上域名", () => {
    expect(resolveHref("/posts/2", b)).toBe("https://example.test/posts/2");
  });

  it("同目录相对地址补上目录", () => {
    expect(resolveHref("other.html", b)).toBe("https://example.test/blog/other.html");
  });

  it("相对地址带查询串与片段时一并保留", () => {
    expect(resolveHref("other.html?a=1#x", b)).toBe(
      "https://example.test/blog/other.html?a=1#x",
    );
  });

  it("上跳一级用 ../", () => {
    expect(resolveHref("../top.html", b)).toBe("https://example.test/blog/../top.html");
  });

  it("空地址回落到基准地址本身", () => {
    expect(resolveHref("   ", b)).toBe(b.absolute);
  });

  it("基准地址在根目录时，相对地址不该多出一层斜杠", () => {
    const root = base("https://example.test/");
    expect(resolveHref("a.html", root)).toBe("https://example.test/a.html");
  });
});

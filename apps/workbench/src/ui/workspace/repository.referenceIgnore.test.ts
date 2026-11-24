import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readIgnoredRefs, writeIgnoredRefs } from "./repository";
import { IGNORED_REF_LIMIT } from "../../domain/referenceIgnore";

const data = new Map<string, string>();
beforeEach(() => {
  data.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("引用体检的本机偏好", () => {
  it("按资料库隔离，撤销一库的忽略不影响另一库", () => {
    writeIgnoredRefs(["问题甲"], "库甲");
    writeIgnoredRefs(["问题乙"], "库乙");
    writeIgnoredRefs([], "库甲");
    expect(readIgnoredRefs("库甲")).toEqual([]);
    expect(readIgnoredRefs("库乙")).toEqual(["问题乙"]);
    expect(data.has("knowflick.notes.v1")).toBe(false);
  });

  it("无效 JSON 与错误结构返回空表，读取时保留原始值", () => {
    writeIgnoredRefs([], "库");
    const key = [...data.keys()][0];
    data.set(key, "{broken");
    expect(readIgnoredRefs("库")).toEqual([]);
    expect(data.get(key)).toBe("{broken");
    data.set(key, JSON.stringify({ keys: ["x"] }));
    expect(readIgnoredRefs("库")).toEqual([]);
  });

  it("过滤非字符串、去重并限制读取数量", () => {
    writeIgnoredRefs([], "库");
    const values = Array.from({ length: IGNORED_REF_LIMIT + 5 }, (_, i) => String(i));
    data.set([...data.keys()][0], JSON.stringify([null, 9, ...values, values.at(-1)]));
    const read = readIgnoredRefs("库");
    expect(read).toHaveLength(IGNORED_REF_LIMIT);
    expect(read[0]).toBe("5");
    expect(new Set(read).size).toBe(IGNORED_REF_LIMIT);
  });

  it("存储拒绝访问时读为空表，写入如实返回失败", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("不可用"); },
      setItem: () => { throw new Error("配额满"); },
    });
    expect(readIgnoredRefs("库")).toEqual([]);
    expect(writeIgnoredRefs(["x"], "库")).toBe(false);
  });
});

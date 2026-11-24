import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChat } from "../shell/store";
import { defaultSettings } from "./settings";
import { generateProfileLearningProposals, parseProfileLearningProposals, profileLearningPrompt, profileNotesInScope } from "./profileLearning";

vi.mock("../shell/store", () => ({ completeChat: vi.fn() }));

afterEach(() => vi.clearAllMocks());

const note = { id: "note-1", title: "工作方式", bodyMd: "我更喜欢先写清验收条件，再开始拆分开发任务。", currentRevision: 3, updatedAt: 120, isDeleted: false, excludeFromProfile: false };

describe("画像学习提案", () => {
  it("只把调用方传入的笔记正文放进本次请求", () => {
    const prompt = profileLearningPrompt([note]);
    expect(prompt).toContain("note-1");
    expect(prompt).toContain(note.bodyMd);
    expect(prompt).not.toContain("其他笔记");
  });

  it("全局只纳入未归属项目的笔记，项目只纳入本项目成员，索引失效时返回空集", () => {
    const notes = [
      note,
      { ...note, id: "global-note" },
      { ...note, id: "project-b-note" },
      { ...note, id: "excluded-note", excludeFromProfile: true },
      { ...note, id: "deleted-note", isDeleted: true },
    ];
    const index = new Map<string, string[]>([["note-1", ["project-a"]], ["project-b-note", ["project-b"]], ["excluded-note", []]]);
    expect(profileNotesInScope(notes, "global", index, true).map(({ id }) => id)).toEqual(["global-note"]);
    expect(profileNotesInScope(notes, "project-a", index, true).map(({ id }) => id)).toEqual(["note-1"]);
    expect(profileNotesInScope(notes, "project-a", index, false)).toEqual([]);
  });

  it("限制本次选择的笔记数量与正文大小", () => {
    expect(() => profileLearningPrompt([])).toThrow("请先选择笔记");
    expect(() => profileLearningPrompt([{ ...note, excludeFromProfile: true }])).toThrow("已排除个人画像");
    expect(() => profileLearningPrompt(Array(13).fill(note))).toThrow("最多选择 12");
    expect(() => profileLearningPrompt([{ ...note, bodyMd: "正文".repeat(15_100) }])).toThrow("30,000 字符");
  });

  it("解析 JSON 与 JSON 围栏，并保留被引用的选中证据", () => {
    const proposals = parseProfileLearningProposals(
      '```json\n[{"content":"偏好先明确验收条件","evidenceIds":["note-1"]}]\n```',
      ["note-1"],
    );
    expect(proposals).toEqual([{ content: "偏好先明确验收条件", evidenceIds: ["note-1"] }]);
  });

  it("拒绝引用未选笔记、没有证据或格式异常的结果", () => {
    expect(() => parseProfileLearningProposals("not json", ["note-1"])).toThrow("格式无法读取");
    expect(() => parseProfileLearningProposals('[{"content":"工作偏好","evidenceIds":["other"]}]', ["note-1"]))
      .toThrow("未选择的笔记");
    expect(() => parseProfileLearningProposals('[{"content":"工作偏好","evidenceIds":[]}]', ["note-1"]))
      .toThrow("未选择的笔记");
    expect(() => parseProfileLearningProposals('[{"content":"偏好","evidenceIds":["note-1"]}]', ["note-1"]))
      .toThrow("长度无效");
  });

  it("无证据时得到空列表，重复建议只保留一条", () => {
    expect(parseProfileLearningProposals("[]", ["note-1"])).toEqual([]);
    const result = parseProfileLearningProposals(JSON.stringify([
      { content: "偏好先明确验收条件", evidenceIds: ["note-1"] },
      { content: "偏好先明确验收条件", evidenceIds: ["note-1"] },
    ]), ["note-1"]);
    expect(result).toHaveLength(1);
  });

  it("远程模型未配置密钥时在发出请求前拒绝", async () => {
    await expect(generateProfileLearningProposals([note], defaultSettings, "")).rejects.toThrow("API 密钥");
    expect(completeChat).not.toHaveBeenCalled();
  });

  it("把选择的笔记和模型配置交给一次非流式请求", async () => {
    vi.mocked(completeChat).mockResolvedValue(JSON.stringify([
      { content: "偏好先明确验收条件", evidenceIds: ["note-1"] },
    ]));
    const settings = { ...defaultSettings, baseURL: "http://127.0.0.1:11434/v1", model: "local-test" };
    const result = await generateProfileLearningProposals([note], settings, "");
    expect(result).toEqual([{ content: "偏好先明确验收条件", evidenceIds: ["note-1"] }]);
    expect(completeChat).toHaveBeenCalledTimes(1);
    const body = JSON.parse(vi.mocked(completeChat).mock.calls[0][2]);
    expect(body).toMatchObject({ model: "local-test", stream: false, max_tokens: 1800 });
    expect(body.messages[1].content).toContain(note.bodyMd);
  });
});

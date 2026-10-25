import { describe, expect, it } from "vitest";
import { buildProjectSkillPackage, type ProjectSkillSnapshot } from "./projectSkill";
import { createNoteDraft } from "./note";
import { unpackZipStore } from "./systemBackup";
import { sha256Hex } from "./sha256";

const snapshot = (): ProjectSkillSnapshot => ({
  project: { id: "p1", name: "项目中文", description: "背景", archivedAt: null },
  members: [{ ...createNoteDraft(100), id: "n1", title: "决策", bodyMd: "正文", currentRevision: 9, sourceMaterialId: "m1" }],
});
const options = { now: 1710000000000, appVersion: "0.1.0" };

describe("项目技能包", () => {
  it("ZIP 采用技能目录/SKILL.md 布局，来源与正文一起带走", () => {
    const pkg = buildProjectSkillPackage(snapshot(), options);
    const files = unpackZipStore(pkg.archive);
    expect([...files.keys()]).toEqual(pkg.files.map((f) => f.path));
    expect(files.get(`${pkg.skillName}/SKILL.md`)).toBe(pkg.content);
    expect(files.get(`${pkg.skillName}/context.md`)).toContain("正文");
    const manifest = JSON.parse(files.get(`${pkg.skillName}/sources.json`)!);
    expect(manifest.sources[0]).toMatchObject({ noteId: "n1", revision: 9, updatedAt: 100, sourceMaterialId: "m1", bodySha256: sha256Hex("正文") });
    expect(files.get(`${pkg.skillName}/README.md`)).toContain(`.claude/skills/${pkg.skillName}/SKILL.md`);
  });

  it("中文、标点与长名称生成合法且稳定的 ASCII 名称，项目 id 防碰撞", () => {
    const a = snapshot();
    a.project.name = "中文！ / ../ ___".repeat(50);
    const first = buildProjectSkillPackage(a, options);
    expect(first.skillName).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(first.skillName.length).toBeLessThanOrEqual(64);
    expect(buildProjectSkillPackage(a, options).skillName).toBe(first.skillName);
    a.project.id = "p2";
    expect(buildProjectSkillPackage(a, options).skillName).not.toBe(first.skillName);
  });

  it("动态 YAML 标量均为 JSON 字符串，换行和分隔符不能注入新键", () => {
    const a = snapshot();
    a.project.name = '冒号: # 引号" \\ 换行\n---\nname: forged';
    a.project.id = 'id"\n---';
    const pkg = buildProjectSkillPackage(a, { ...options, appVersion: 'v"\\\n---' });
    const header = pkg.content.split("\n---\n")[0].slice(4);
    const scalars = header.split("\n").filter((l) => l !== "metadata:");
    expect(scalars.length, "必须存在 frontmatter 标量字段").toBeGreaterThan(0);
    for (const line of scalars) {
      const value = line.slice(line.indexOf(":") + 1).trim();
      expect(() => JSON.parse(value)).not.toThrow();
    }
    expect(JSON.parse(header.split("\n").find((l) => l.startsWith("description:"))!.slice(13).trim())).toContain(a.project.name);
    expect(pkg.content).toContain("静态项目上下文");
    expect(pkg.content).toContain("无法召回已导出的副本");
  });

  it("已删成员不进入正文或来源清单，非成员链接不触发展开", () => {
    const a = snapshot();
    a.members[0].bodyMd = "[其它项目](knowflick://note/other)";
    a.members.push({ ...createNoteDraft(), id: "deleted", bodyMd: "秘密正文", isDeleted: true });
    const pkg = buildProjectSkillPackage(a, options);
    expect(pkg.memberCount).toBe(1);
    expect(pkg.files.map((f) => f.data).join("\n")).not.toContain("秘密正文");
    const sources = JSON.parse(pkg.files.find((f) => f.path.endsWith("sources.json"))!.data);
    expect(sources.sources.map((n: { noteId: string }) => n.noteId)).toEqual(["n1"]);
  });

  it("封存项目拒绝导出，空项目明确零条来源", () => {
    const a = snapshot();
    a.project.archivedAt = 12;
    expect(() => buildProjectSkillPackage(a, options)).toThrow(/已封存/);
    a.project.archivedAt = null;
    a.members = [];
    const pkg = buildProjectSkillPackage(a, options);
    expect(pkg.memberCount).toBe(0);
    expect(pkg.files.find((f) => f.path.endsWith("context.md"))!.data).toContain("有效成员笔记 0 篇");
  });
});

import { describe, expect, it } from "vitest";
import type { McpGrant, Project } from "../../shell/store";
import { grantStatus } from "./McpGrantPanel";

const grant: McpGrant = {
  id: "g1", clientLabel: "客户端", scope: "project", projectId: "p1", libraryRead: false,
  cardWrite: false, materialWrite: false, createdAt: 1, revokedAt: null, policyVersion: 1,
};
const project: Project = { id: "p1", name: "项目", description: "", createdAt: 1, updatedAt: 1, archivedAt: null };

describe("MCP 授权状态", () => {
  it("项目不再可用时不显示为已授权", () => {
    expect(grantStatus(grant, [project])).toBe("已授权");
    expect(grantStatus(grant, [])).toContain("当前不可用");
  });
  it("撤销优先于项目状态，全库授权不依赖项目", () => {
    expect(grantStatus({ ...grant, revokedAt: 0 }, [])).toBe("已撤销");
    expect(grantStatus({ ...grant, scope: "library", projectId: null, libraryRead: true }, [])).toBe("已授权");
  });
});

import { describe, expect, it } from "vitest";
import { createKfBackupArchive, stripSecrets } from "./systemBackup";
import { exportAnkiTsv, generateMarkdownVault } from "./markdownExport";
import { cardFromJson } from "./card";
import { parseSettings } from "./settings";
import type { RawMaterial } from "../shell/store";

/**
 * 数据出口的可执行契约（对应 docs/DATA_EGRESS.md）。
 *
 * 三轮里在**不同出口**发现同一类缺陷（服务端原文带着 API key 流出去），
 * 每次都是「发现一处修一处」。这份测试把清单变成**一条会失败的契约**：
 * 给设置里塞一个哨兵密钥，跑所有导出路径，断言没有一个把它带出去。
 *
 * 注意边界：**用户自己写在正文里的内容不该被抹**（那是他的数据）。
 * 这里防的是「应用自己管理的凭据」离开本机。
 */
const SENTINEL = "{{API_KEY_1uv3bev0}}";

const settingsWithSecrets = parseSettings(JSON.stringify({
  providerId: "openai",
  baseURL: "https://api.openai.com/v1",
  model: "gpt-4",
  apiKey: SENTINEL,
  api_key: SENTINEL,
  token: SENTINEL,
  password: SENTINEL,
}));

const material: RawMaterial = {
  id: "m1", sourceType: "web", title: "素材", sourceUrl: "https://example.test/a",
  rawText: "正文内容", contentHash: "", mediaPath: null, mediaSizeBytes: 0,
  metadataJson: "{}", inboxStatus: "inbox", createdAt: 1, updatedAt: 1,
};
const card = cardFromJson({ id: "c1", headline: "标题", summary: "摘要", details: "正文", createdAt: 1 });

describe("数据出口：应用管理的凭据一个都不出去", () => {
  it("完整备份包（.kfbackup）不带", () => {
    const archive = createKfBackupArchive([material], [card], settingsWithSecrets, []);
    const text = new TextDecoder("latin1").decode(new Uint8Array(archive));
    expect(text).not.toContain(SENTINEL);
  });

  it("Markdown 导出不带", () => {
    const vault = generateMarkdownVault([material], [card]);
    for (const item of vault) expect(item.content).not.toContain(SENTINEL);
  });

  it("Anki 词表不带", () => {
    expect(exportAnkiTsv([card])).not.toContain(SENTINEL);
  });

  it("stripSecrets 对四种密钥键名都生效", () => {
    const out = stripSecrets(JSON.stringify({ apiKey: SENTINEL, api_key: SENTINEL, token: SENTINEL, password: SENTINEL }));
    expect(out).not.toContain(SENTINEL);
  });

  it("边界：用户自己写在正文里的内容不该被抹掉", () => {
    // 那是他的数据，不是应用管理的凭据——导出必须原样带走。
    const withSecretInBody: RawMaterial = { ...material, rawText: `我的笔记里提到了 ${SENTINEL}` };
    const archive = createKfBackupArchive([withSecretInBody], [], settingsWithSecrets, []);
    const text = new TextDecoder("latin1").decode(new Uint8Array(archive));
    expect(text, "用户正文里的内容属于他自己，不该被脱敏").toContain(SENTINEL);
  });
});

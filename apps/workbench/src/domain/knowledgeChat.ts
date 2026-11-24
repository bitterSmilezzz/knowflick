export interface KnowledgeChatSource {
  id: string;
  title: string;
  body: string;
  deleted?: boolean;
  updatedAt?: number;
}

export interface KnowledgeChatNote {
  id: string;
  title: string;
  excerpt: string;
}

/** 把问题拆成用于匹配的片段：英文按词、中文按二字片段，忽略大小写与标点。 */
export function questionTokens(question: string): string[] {
  const tokens = new Set<string>();
  const cleaned = question.toLowerCase();
  for (const word of cleaned.match(/[a-z0-9]{2,}/g) ?? []) tokens.add(word);
  const cjk = cleaned.replace(/[^一-鿿]/g, "");
  for (let index = 0; index + 1 < cjk.length; index++) tokens.add(cjk.slice(index, index + 2));
  return [...tokens];
}

/** 按问题关键词挑选相关笔记；没有命中返回空数组（不拿无关资料凑数）。 */
export function selectKnowledgeNotes(notes: KnowledgeChatSource[], question: string, limit = 6): KnowledgeChatNote[] {
  const tokens = questionTokens(question);
  if (tokens.length === 0) return [];
  const scored = notes
    .filter((note) => !note.deleted)
    .map((note) => {
      const text = (note.title + "\n" + note.body).toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
      return { note, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || (right.note.updatedAt ?? 0) - (left.note.updatedAt ?? 0))
    .slice(0, limit);
  return scored.map(({ note }) => ({
    id: note.id,
    title: note.title || "无标题笔记",
    excerpt: note.body.slice(0, 1200),
  }));
}

/** 向量检索追加的参考资料：卡片或笔记分块片段。 */
export interface KnowledgeChatExtra {
  kind: "card" | "chunk";
  title: string;
  body: string;
}

/** 用户明确允许携带的画像记忆（范围 + 内容），与桌面端 consent 口径一致。 */
export interface KnowledgeChatProfileMemory {
  scopeLabel: string;
  contents: string[];
}

/** 与桌面端知识问答同形的请求体：系统提示 + 命中的笔记段落 + 用户问题。 */
export function buildKnowledgeChatBody(
  model: string,
  notes: KnowledgeChatNote[],
  question: string,
  history: { role: "user" | "assistant"; content: string; includedProfileMemory?: boolean }[] = [],
  extras: KnowledgeChatExtra[] = [],
  profileMemory?: KnowledgeChatProfileMemory | null,
): string {
  const notesContext = notes
    .map((note, index) => "[笔记 " + (index + 1) + "] 标题: " + note.title + "\n内容: " + note.excerpt)
    .join("\n---\n");
  const cardNumbering = extras.filter((extra) => extra.kind === "card");
  const chunkNumbering = extras.filter((extra) => extra.kind === "chunk");
  const extrasContext = extras
    .map((extra) => extra.kind === "card"
      ? "[卡片 " + (cardNumbering.indexOf(extra) + 1) + "] 标题: " + extra.title + "\n内容: " + extra.body
      : "[笔记片段 " + (chunkNumbering.indexOf(extra) + 1) + "] 来源: " + extra.title + "\n内容: " + extra.body)
    .join("\n---\n");
  const context = [notesContext, extrasContext].filter((part) => part.trim()).join("\n---\n");
  const memoryContext = profileMemory && profileMemory.contents.length > 0
    ? "【本次用户明确允许提供给当前模型的已确认个人记忆】\n记忆范围：" + JSON.stringify(profileMemory.scopeLabel) +
      "\n记忆内容：" + JSON.stringify(profileMemory.contents) + "\n\n"
    : "";
  const systemPrompt = "你是一个个人知识库第二大脑问答助理。你的职责是根据用户提供的知识库参考资料回答问题。\n" +
    "要求：\n1. 优先使用参考资料中的事实进行回答。\n2. 回答中如引用了某篇笔记、卡片或笔记片段，请明确指出【笔记 1】、【卡片 1】、【笔记片段 1】等来源。\n3. 语言精炼、重点突出。\n4. 参考资料不足时直说没有依据，不要编造。";
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: memoryContext + "参考资料：\n" + context + "\n\n问题：" + question },
    ...history
      .filter((message) => !message.includedProfileMemory)
      .slice(-4)
      .map(({ role, content }) => ({ role, content })),
  ];
  return JSON.stringify({ model, temperature: 0.4, max_tokens: 1200, stream: false, messages });
}
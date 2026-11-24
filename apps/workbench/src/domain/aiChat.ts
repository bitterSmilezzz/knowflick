import type { AiSettings } from "./settings";
import { cardsFromModelText, completionURL, requiresKey, TRANSFORM_SYSTEM, transformPrompt } from "./ingest";
import type { KnowledgeCard } from "./card";
import { completeChat } from "../shell/store";

export async function askModel(note: string, settings: AiSettings, apiKey: string): Promise<KnowledgeCard[]> {
  if (!note.trim()) throw new Error("内容是空的");
  if (requiresKey(settings.baseURL) && !apiKey.trim()) throw new Error("未配置 API Key，请到设置里填写");
  const content = await completeChat(completionURL(settings.baseURL), apiKey.trim(), chatBody(settings.model, [
    { role: "system", content: TRANSFORM_SYSTEM },
    { role: "user", content: transformPrompt(note) },
  ]));
  return cardsFromModelText(content);
}

export async function probeConnection(settings: AiSettings, apiKey: string): Promise<void> {
  if (requiresKey(settings.baseURL) && !apiKey.trim()) throw new Error("未配置 API Key");
  await completeChat(completionURL(settings.baseURL), apiKey.trim(), chatBody(settings.model, [
    { role: "user", content: "回复 OK" },
  ], 16));
}

function chatBody(model: string, messages: Array<{ role: string; content: string }>, maxTokens = 3200): string {
  return JSON.stringify({ model, temperature: 0.7, max_tokens: maxTokens, stream: false, messages });
}

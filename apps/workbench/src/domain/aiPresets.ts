export interface AiProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  defaultModel: string;
  availableModels: string[];
  docUrl: string;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek (深度求索)",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    availableModels: ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
    docUrl: "https://platform.deepseek.com",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    availableModels: ["glm-4-flash", "glm-4-plus", "glm-4-air"],
    docUrl: "https://open.bigmodel.cn",
  },
  {
    id: "moonshot",
    name: "Kimi (Moonshot AI)",
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    availableModels: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    docUrl: "https://platform.moonshot.cn",
  },
  {
    id: "qwen",
    name: "阿里通义千问 (百炼)",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    availableModels: ["qwen-plus", "qwen-turbo", "qwen-max"],
    docUrl: "https://bailian.console.aliyun.com",
  },
  {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow)",
    baseURL: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V2.5",
    availableModels: [
      "deepseek-ai/DeepSeek-V2.5",
      "Qwen/Qwen2.5-7B-Instruct",
      "THUDM/glm-4-9b-chat",
    ],
    docUrl: "https://cloud.siliconflow.cn",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    availableModels: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"],
    docUrl: "https://platform.openai.com",
  },
  {
    id: "ollama",
    name: "本地 Ollama",
    baseURL: "http://localhost:11434/v1",
    defaultModel: "qwen2.5",
    availableModels: ["qwen2.5", "llama3.2", "deepseek-r1"],
    docUrl: "https://ollama.com",
  },
  {
    id: "custom",
    name: "自定义端点 (OpenAI 兼容)",
    baseURL: "",
    defaultModel: "",
    availableModels: [],
    docUrl: "",
  },
];

export function findPresetById(id: string): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id);
}

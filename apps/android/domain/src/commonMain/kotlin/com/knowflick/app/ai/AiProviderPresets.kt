package com.knowflick.app.ai

/**
 * 主流与本机 Agent AI 服务商预设：移植自 macOS `AIProviderPreset`（16 档，三分组）。
 * 口径与 macOS 一致：id 唯一、defaultModel ∈ models、免密约定（Ollama/本地网关）、
 * baseURL 为 HTTPS 或本地回环（custom 例外）。
 */
data class AiProviderPreset(
    val id: String,
    val name: String,
    val group: String,
    val defaultBaseURL: String,
    val models: List<String>,
    val defaultModel: String,
    val requiresKey: Boolean,
)

object AiProviderPresets {
    const val GROUP_ONLINE = "在线 API 服务"
    const val GROUP_LOCAL = "本地部署运行"
    const val GROUP_CUSTOM = "自定义"

    val presets: List<AiProviderPreset> = listOf(
        AiProviderPreset("deepseek", "DeepSeek (官方)", GROUP_ONLINE,
            "https://api.deepseek.com",
            listOf("deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro", "deepseek-v4-flash"),
            "deepseek-chat", requiresKey = true),
        AiProviderPreset("siliconflow", "硅基流动 (SiliconFlow)", GROUP_ONLINE,
            "https://api.siliconflow.cn/v1",
            listOf("deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-7B-Instruct", "THUDM/glm-4-9b-chat"),
            "deepseek-ai/DeepSeek-V3", requiresKey = true),
        AiProviderPreset("kimi", "Kimi (月之暗面)", GROUP_ONLINE,
            "https://api.moonshot.cn/v1",
            listOf("moonshot-v1-8k", "moonshot-v1-32k", "kimi-latest"),
            "moonshot-v1-8k", requiresKey = true),
        AiProviderPreset("zhipu", "智谱 GLM / BigModel", GROUP_ONLINE,
            "https://open.bigmodel.cn/api/paas/v4",
            listOf("glm-4-flash", "glm-4-plus", "glm-4.5-flash"),
            "glm-4-flash", requiresKey = true),
        AiProviderPreset("dashscope", "阿里云百炼 (通义千问)", GROUP_ONLINE,
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            listOf("qwen-plus", "qwen-max", "qwen-turbo"),
            "qwen-plus", requiresKey = true),
        AiProviderPreset("opencode", "OpenCode Go", GROUP_ONLINE,
            "https://opencode.ai/zen/go/v1",
            listOf("deepseek-v4-flash", "deepseek-v4-pro", "glm-5"),
            "deepseek-v4-flash", requiresKey = true),
        AiProviderPreset("tokenrhythm", "基元律动 (TokenRhythm)", GROUP_ONLINE,
            "https://tokenrhythm.studio/v1",
            listOf("deepseek-v4-flash", "deepseek-v4-pro"),
            "deepseek-v4-flash", requiresKey = true),
        AiProviderPreset("xiaomi_mimo", "小米 MiMo (Xiaomi)", GROUP_ONLINE,
            "https://api.xiaomimimo.com/v1",
            listOf("mimo-v2.5", "mimo-v2.5-pro"),
            "mimo-v2.5", requiresKey = true),
        AiProviderPreset("longcat", "LongCat (长猫科技)", GROUP_ONLINE,
            "https://api.longcat.chat/openai",
            listOf("LongCat-2.0", "LongCat-2.0-flash"),
            "LongCat-2.0", requiresKey = true),
        AiProviderPreset("antdigital", "蚂蚁百灵 (AntDigital)", GROUP_ONLINE,
            "https://maas-api.antdigital.com/v1",
            listOf("ling-3.0-flash-fin", "ling-3.0-plus"),
            "ling-3.0-flash-fin", requiresKey = true),
        AiProviderPreset("nvidia_nim", "NVIDIA NIM", GROUP_ONLINE,
            "https://integrate.api.nvidia.com/v1",
            listOf("deepseek-ai/deepseek-v4-flash-0731", "meta/llama-3.3-70b-instruct"),
            "deepseek-ai/deepseek-v4-flash-0731", requiresKey = true),
        AiProviderPreset("amd_factory", "AMD 开发者平台 (Token Factory)", GROUP_ONLINE,
            "https://developer.amd.com.cn/radeon/api/v1",
            listOf("DeepSeek-V4-Flash", "Qwen3-32B"),
            "DeepSeek-V4-Flash", requiresKey = true),
        AiProviderPreset("openai", "OpenAI (官方)", GROUP_ONLINE,
            "https://api.openai.com/v1",
            listOf("gpt-4o-mini", "gpt-4o", "o4-mini"),
            "gpt-4o-mini", requiresKey = true),
        AiProviderPreset("ollama", "Ollama (本地私有)", GROUP_LOCAL,
            "http://localhost:11434/v1",
            listOf("qwen2.5:7b", "llama3.1:8b", "deepseek-r1:7b"),
            "qwen2.5:7b", requiresKey = false),
        AiProviderPreset("local_freellm", "本地代理网关 (:31415)", GROUP_LOCAL,
            "http://127.0.0.1:31415/v1",
            listOf("auto", "fusion", "gemini-3.6-flash"),
            "auto", requiresKey = false),
        AiProviderPreset("custom", "自定义服务商", GROUP_CUSTOM,
            "", emptyList(), "", requiresKey = true),
    )

    /** 空白/默认兜底：与 macOS 一致返回 DeepSeek 预设 */
    fun fallback(): AiProviderPreset = presets.first { it.id == "deepseek" }

    /** 表驱动域名匹配；只检查解析后的主机名，路径和查询参数不参与服务商识别。 */
    private val matchRules: List<Pair<String, String>> = listOf(
        "api.deepseek.com" to "deepseek",
        "opencode.ai" to "opencode",
        "tokenrhythm.studio" to "tokenrhythm",
        "xiaomimimo.com" to "xiaomi_mimo",
        "dashscope.aliyuncs.com" to "dashscope",
        "longcat.chat" to "longcat",
        "antdigital.com" to "antdigital",
        "nvidia.com" to "nvidia_nim",
        "amd.com.cn" to "amd_factory",
        "siliconflow.cn" to "siliconflow",
        "moonshot.cn" to "kimi",
        "bigmodel.cn" to "zhipu",
        "z.ai" to "zhipu",
        "api.openai.com" to "openai",
    )

    fun match(baseURL: String): AiProviderPreset {
        val trimmed = baseURL.trim().lowercase()
        if (trimmed.isEmpty()) return fallback()
        val uri = runCatching { java.net.URI(trimmed) }.getOrNull()
            ?: return presets.first { it.id == "custom" }
        val host = uri.host?.lowercase()?.trim('[', ']')
            ?: return presets.first { it.id == "custom" }
        matchRules.firstOrNull { (domain, _) -> host == domain || host.endsWith(".$domain") }?.let { rule ->
            return presets.first { it.id == rule.second }
        }
        val isLoopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        return when {
            isLoopback && uri.port == 31415 -> presets.first { it.id == "local_freellm" }
            isLoopback -> presets.first { it.id == "ollama" }
            else -> presets.first { it.id == "custom" }
        }
    }

    private val KEYLESS_IDS = setOf("ollama", "local_freellm")

    /** 免密预设集合（供一致性测试与设置页提示复用） */
    val keylessIds: Set<String> = KEYLESS_IDS
}

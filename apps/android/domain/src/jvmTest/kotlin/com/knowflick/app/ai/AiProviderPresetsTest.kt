package com.knowflick.app.ai

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 服务商预设一致性：README 16 档大表的代码护栏（与 macOS 同语义） */
class AiProviderPresetsTest {

    @Test
    fun presetsHaveConsistentIdentity() {
        assertEquals(16, AiProviderPresets.presets.size)
        assertEquals(16, AiProviderPresets.presets.map { it.id }.toSet().size)
        for (preset in AiProviderPresets.presets) {
            assertTrue(preset.name.isNotBlank())
            assertTrue(preset.group in listOf(
                AiProviderPresets.GROUP_ONLINE, AiProviderPresets.GROUP_LOCAL, AiProviderPresets.GROUP_CUSTOM))
            if (preset.id == "custom") {
                assertTrue(preset.defaultBaseURL.isEmpty() && preset.models.isEmpty())
                continue
            }
            assertTrue(preset.defaultBaseURL.isNotEmpty())
            assertTrue(preset.models.contains(preset.defaultModel), "${preset.id} 的 defaultModel 不在 models 内")
            assertEquals(preset.requiresKey, preset.id !in AiProviderPresets.keylessIds, "${preset.id} 的 requiresKey 与免密约定不符")
            assertTrue(
                preset.defaultBaseURL.startsWith("https://") ||
                    preset.defaultBaseURL.contains("127.0.0.1") ||
                    preset.defaultBaseURL.contains("localhost"),
                "${preset.id} 的 baseURL 应为 HTTPS 或本地回环",
            )
        }
    }

    @Test
    fun matchResolvesEveryPresetBaseURLToItself() {
        for (preset in AiProviderPresets.presets) {
            if (preset.id == "custom") continue
            assertEquals(preset.id, AiProviderPresets.match(preset.defaultBaseURL).id,
                "${preset.defaultBaseURL} 应反查回 ${preset.id}")
        }
    }

    @Test
    fun matchDoesNotMisreadRemoteUrlsContainingLocalPortNumbers() {
        assertEquals("custom", AiProviderPresets.match("https://api.gateway.example.com/tokens/31415").id)
        assertEquals("custom", AiProviderPresets.match("https://mirror.example.com/11434/proxy").id)
        assertEquals("local_freellm", AiProviderPresets.match("http://127.0.0.1:31415/v1").id)
        assertEquals("ollama", AiProviderPresets.match("http://localhost:11434/v1").id)
        assertEquals("deepseek", AiProviderPresets.match("   ").id)
    }

    @Test
    fun defaultSettingsContainTheSelectedProvidersRealDefaults() {
        val preset = AiProviderPresets.fallback()
        val settings = AiSettings()

        assertEquals(preset.id, settings.providerId)
        assertEquals(preset.defaultBaseURL, settings.baseURL)
        assertEquals(preset.defaultModel, settings.model)
    }

    @Test
    fun customRemoteProviderRequiresItsApiKey() {
        val custom = AiProviderPresets.presets.first { it.id == "custom" }

        assertTrue(custom.requiresKey)
        assertTrue(custom.id !in AiProviderPresets.keylessIds)
        assertTrue(AiService.requiresKey("https://private.example.com/v1"))
    }

    @Test
    fun providerMatchingUsesTheUrlHostInsteadOfPathOrQueryText() {
        assertEquals("custom", AiProviderPresets.match("https://gateway.example.com/proxy/api.deepseek.com").id)
        assertEquals("custom", AiProviderPresets.match("https://gateway.example.com/?target=localhost:11434").id)
        assertEquals("custom", AiProviderPresets.match("https://localhost.attacker.example/v1").id)
    }

    @Test
    fun legacyBlankPresetSettingsAreMigratedToUsableDefaults() {
        val migrated = AiSettings(providerId = "deepseek", baseURL = "", model = "")
            .withMissingPresetDefaults()

        assertEquals("https://api.deepseek.com", migrated.baseURL)
        assertEquals("deepseek-chat", migrated.model)
    }
}

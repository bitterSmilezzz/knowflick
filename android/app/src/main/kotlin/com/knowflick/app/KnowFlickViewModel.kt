package com.knowflick.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.knowflick.app.ai.AiError
import com.knowflick.app.ai.AiService
import com.knowflick.app.ai.AiSettings
import com.knowflick.app.data.AppModel
import com.knowflick.app.data.CardStorage
import com.knowflick.app.data.CredentialStore
import com.knowflick.app.data.InMemoryCredentialStore
import com.knowflick.app.data.SeedLoader
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * 应用级状态持有者：卡库持久化 + 卡堆状态机 + AI 服务。
 * version 自增驱动 Compose 重组；落盘经 IO 调度器 350ms 节流合并；onPause flush。
 */
class KnowFlickViewModel(application: Application) : AndroidViewModel(application) {
    val model: AppModel = AppModel(
        storage = CardStorage(File(application.filesDir, "store")),
        seedCards = SeedLoader(application).load(),
    )

    private val credentials: CredentialStore = InMemoryCredentialStore()   // 进程内凭据（Keystore 版在 M5 接入）
    private val aiService = AiService()

    /** 重组触发器 */
    var version by mutableIntStateOf(0)
        private set

    /** 生成状态 */
    var isGenerating by mutableStateOf(false)
        private set
    var generateNotice by mutableStateOf<String?>(null)
        private set

    /** 已保存的设置与密钥 */
    var settings: AiSettings by mutableStateOf(AiSettings())
        private set

    private var persistScheduled = false

    init {
        model.bootstrap()
        settings = loadSettings()
    }

    private fun loadSettings(): AiSettings {
        val loaded = AiSettings.fromJson(model.storage.loadSettingsJson() ?: "") ?: AiSettings()
        // 卡堆口径：来源开关与偏好分类与设置联动
        model.store.enableSeed = loaded.enableSeed
        model.store.enableAI = loaded.enableAI
        model.store.preferredCategories = loaded.preferredCategories.toSet()
        model.store.recompute()
        return loaded
    }

    fun currentApiKey(): String = credentials.read("apiKey").orEmpty()

    fun saveSettings(updated: AiSettings, apiKey: String) {
        model.storage.saveSettingsJson(updated.toJson())
        if (updated.baseURL.isNotBlank()) credentials.save(apiKey, "apiKey")
        else credentials.delete("apiKey")
        settings = loadSettings()
        version++
        schedulePersist()
    }

    /** 连通性测试：返回用户可读状态 */
    suspend fun testConnection(temp: AiSettings, apiKey: String): String {
        return try {
            aiService.ping(temp, apiKey)
            "连接成功，AI 服务可用"
        } catch (e: AiError) {
            e.message ?: "连接失败"
        } catch (e: Exception) {
            "网络错误：${e.message}"
        }
    }

    /** 从 JSON 文本导入卡片（逐卡挽救 + 归一化去重，置顶插入） */
    fun importFromJson(text: String) {
        val imported = com.knowflick.app.data.CardFileIO.decodeListSalvaging(text)
        if (imported.isEmpty()) {
            generateNotice = "无法解析该文件，格式与 KnowFlick 卡片结构不匹配"
            return
        }
        val incoming = imported.map { card ->
            // 导入卡强制 imported 来源，清空浏览状态（导入不覆盖学习历史语义与 macOS 一致）
            card.copy(
                id = java.util.UUID.randomUUID().toString().uppercase(),
                source = com.knowflick.app.domain.CardSource.IMPORTED,
                seenAt = null,
                swiped = null,
                lastReviewedAt = null,
            )
        }
        val added = model.store.addCards(incoming, insertAtTop = true)
        generateNotice = "已导入 $added 张卡片 ✓"
        version++
    }

    /** AI 生成 count 张新卡并置顶插入（AI 不可用/未配置时静默返回提示） */
    fun generateNewCards(count: Int = 3, topic: String? = null) {
        if (isGenerating) return
        val current = settings
        if (!current.isConfigured) {
            generateNotice = "请先在设置里配置 AI 服务"
            return
        }
        isGenerating = true
        generateNotice = null
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val cards = aiService.generateCards(
                    settings = current,
                    apiKey = currentApiKey(),
                    count = count,
                    excludeHeadlines = model.store.cards.map { it.headline },
                    topic = topic,
                )
                mutate { model.store.addCards(cards, insertAtTop = true) }
                generateNotice = "已生成 ${cards.size} 张新知识 ✓"
            } catch (e: AiError) {
                generateNotice = e.message
            } catch (e: Exception) {
                generateNotice = "网络错误：${e.message}"
            } finally {
                isGenerating = false
            }
        }
    }

    /** 意图操作统一入口：执行动作 + 重组 + 节流落盘 */
    fun mutate(action: () -> Unit) {
        action()
        version++
        schedulePersist()
    }

    private fun schedulePersist() {
        if (persistScheduled) return
        persistScheduled = true
        viewModelScope.launch(Dispatchers.IO) {
            Thread.sleep(350)   // 与 macOS 端 350ms 节流合并口径一致
            persistScheduled = false
            model.persistNow()
        }
    }

    fun flushNow() {
        model.persistNow()
    }
}

package com.knowflick.app.ai

import java.util.UUID
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

/** 追问对话发送者角色 */
@Serializable
enum class MessageSender {
    @SerialName("user")
    USER,

    @SerialName("assistant")
    ASSISTANT,

    @SerialName("system")
    SYSTEM,
}

/** 单条追问对话消息 */
@Serializable
data class CardChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val sender: MessageSender,
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
    @Transient
    val isStreaming: Boolean = false,
)

/** 卡片专属会话载体 */
@Serializable
data class CardChatSession(
    val id: String = UUID.randomUUID().toString(),
    val cardId: String,
    val cardHeadline: String,
    val messages: List<CardChatMessage> = emptyList(),
    val updatedAt: Long = System.currentTimeMillis(),
)

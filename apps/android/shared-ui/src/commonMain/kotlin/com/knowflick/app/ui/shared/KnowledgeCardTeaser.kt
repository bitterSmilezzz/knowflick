package com.knowflick.app.ui.shared

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.knowflick.app.domain.KnowledgeCard

/**
 * 第一块真正跨端的界面组件：卡片摘要（分类 / 标题 / 提要）。
 *
 * 只用 Compose Multiplatform 的公共 API 与共享主题令牌，所以**同一份代码**在 Android 与
 * 桌面（Windows / macOS / Linux）上渲染。它是共享 UI 管线的端到端证明，不是最终视觉稿——
 * 刷卡页的完整卡片（底图、排布、手势）涉及平台资源读取，属后续波次，
 * 范围见 docs/windows-route/CMP-FEASIBILITY.md §4.1。
 */
@Composable
fun KnowledgeCardTeaser(card: KnowledgeCard, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = card.category,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                text = card.headline,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            if (card.summary.isNotBlank()) {
                Text(
                    text = card.summary,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

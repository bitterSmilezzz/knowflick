package com.knowflick.desktop

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.PaperTheme
import com.knowflick.app.ui.shared.KnowledgeCardTeaser

fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "KnowFlick 桌面（骨架）") {
        // 产品主题来自 :shared-ui——与 Android 端是同一份 Theme.kt
        KnowFlickTheme(paperTheme = PaperTheme.SYSTEM) { SkeletonScreen() }
    }
}

/**
 * 骨架界面：只陈述现状，不假装已有功能。
 * 卡片由 :shared-ui 的共享组件渲染（Android 端用同一份代码），真实界面
 * （刷卡 / 详情 / 收藏 / 统计）属「UI 抽取」波次，见 docs/windows-route/CMP-FEASIBILITY.md §4.1。
 */
@Composable
fun SkeletonScreen() {
    Column(
        modifier = Modifier
            .padding(28.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("KnowFlick 桌面（骨架）", style = MaterialTheme.typography.headlineSmall)
        Text(DomainBridge.smokeLine(), style = MaterialTheme.typography.bodyMedium)
        Text(
            "下面两张卡由 :shared-ui 的共享组件渲染——Android 端跑的是同一份 Compose 代码。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        DomainBridge.sampleCards().forEach { card -> KnowledgeCardTeaser(card) }
        Text(
            "尚未实现：卡库持久化、真实界面（刷卡/详情/统计）、打包分发。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

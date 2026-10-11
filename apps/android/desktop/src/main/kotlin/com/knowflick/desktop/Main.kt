package com.knowflick.desktop

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application

fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "KnowFlick 桌面（骨架）") {
        MaterialTheme { SkeletonScreen() }
    }
}

/**
 * 骨架界面：只陈述现状，不假装已有功能。
 * 真实界面（卡堆 / 详情 / 收藏 / 统计）属于「UI 抽取」波次，见
 * docs/windows-route/CMP-FEASIBILITY.md §4.1。
 */
@Composable
fun SkeletonScreen() {
    Column(
        modifier = Modifier.padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("KnowFlick 桌面（骨架）", style = MaterialTheme.typography.headlineSmall)
        Text(DomainBridge.smokeLine(), style = MaterialTheme.typography.bodyLarge)
        Text(
            "共享领域层来自 :domain（Kotlin Multiplatform）——同一份代码，Android 端在生产路径上用它。",
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            "尚未实现：卡库持久化、真实界面、打包分发。",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

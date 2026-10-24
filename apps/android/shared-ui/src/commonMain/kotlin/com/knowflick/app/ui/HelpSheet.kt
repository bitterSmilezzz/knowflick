package com.knowflick.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.ui.common.PlatformBackHandler

/** 帮助页：快捷键文案按 mac 端 `HelpView` 原样搬。桌面菜单尚未逐条绑键，文案仍列出原有动作。 */
@Composable
fun HelpSheet(onClose: () -> Unit, modifier: Modifier = Modifier) {
    PlatformBackHandler(onBack = onClose)
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("快捷键", fontSize = 20.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Serif, modifier = Modifier.weight(1f))
            IconButton(onClick = onClose) { Icon(Icons.Default.Close, contentDescription = "关闭") }
        }
        Column(Modifier.verticalScroll(rememberScrollState())) {
            HelpSections.forEach { (title, rows) ->
                Spacer(Modifier.height(16.dp))
                Text(title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Spacer(Modifier.height(6.dp))
                rows.forEach { (keys, action) ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Text(keys, modifier = Modifier.weight(0.45f), fontWeight = FontWeight.Medium, fontSize = 13.sp)
                        Text(action, modifier = Modifier.weight(0.55f), fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

private val HelpSections = listOf(
    "全局" to listOf(
        "⌘ F" to "全局智能搜索与全文检索（支持拼音）",
        "⌘ J" to "向卡片追问（AI 伴学导师深入探讨）",
        "⌘ P" to "语音朗读 / 暂停（当前卡片）",
        "⇧⌘ P" to "开启 / 退出磨耳朵连续播报",
        "⌥⌘ P" to "打开语音听书控制台（进度定位、听书档位、语速音调与睡眠定时）",
        "⌘ K" to "开启沉浸式知识测验",
        "⌘ G" to "探索全景知识星图与引力链",
        "⌘ B" to "打开知识收藏阁（沉淀笔记）",
        "⇧⌘ I" to "导入笔记为卡片…",
        "⇧⌘ E" to "导出知识卡片…",
        "⌘ S" to "生成并导出分享海报",
        "⌘ N" to "AI 生成 3 张新知识",
        "⌘ R" to "换一批新知识（当前卡堆记为已跳过）",
        "⌘ ?" to "打开此快捷键面板",
        "⌘ ," to "打开偏好设置",
    ),
    "刷卡" to listOf(
        "←" to "不喜欢（划走）",
        "→" to "感兴趣（划走）",
        "⏎ 回车" to "展开卡片详情与来源链接",
        "⌘ Z" to "撤销上一张卡片",
    ),
    "面板" to listOf("Esc" to "关闭当前弹出的面板"),
    "测验" to listOf(
        "␣ 空格 / ⏎" to "翻转卡片（查看背面答案与解析）",
        "⌘ 1" to "自评：没想起来（完全遗忘）",
        "⌘ 2" to "自评：犹豫想起（模糊记忆）",
        "⌘ 3" to "自评：熟练掌握（清晰再认）",
        "Esc" to "退出当前测验",
    ),
    "详情" to listOf(
        "⌘ D" to "收藏 / 取消收藏当前卡片",
        "⏎ 或 Esc" to "关闭详情",
        "←" to "切换到上一张历史卡片（刷卡区进入时）",
        "→" to "切换到下一张待刷卡片（刷卡区进入时）",
    ),
)

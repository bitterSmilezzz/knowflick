package com.knowflick.app.ui.stats

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.EditorialColor
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * 学习活跃度打卡热力图（GitHub-style Heatmap）：
 * 1. 过去 35 天（5 周）学习与复习分布；
 * 2. 5 阶扁平微彩阶梯（0~4 级）；
 * 3. 统计并展示当前连续打卡天数与近 35 天总复习频次；
 * 4. 适配温润纸质浅色基底与曜黑深色双模。
 */
@Composable
fun LearningHeatmap(
    cards: List<KnowledgeCard>,
    modifier: Modifier = Modifier,
    today: LocalDate = LocalDate.now(),
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.35f

    // 统计过去 35 天每天的活动次数（seenAt 或 lastReviewedAt）
    val daysCount = 35
    val (dailyMap, totalActivity, streak) = remember(cards, today) {
        val zone = ZoneId.systemDefault()
        val counts = mutableMapOf<LocalDate, Int>()
        for (i in 0 until daysCount) {
            counts[today.minusDays(i.toLong())] = 0
        }

        cards.forEach { card ->
            card.seenAt?.let { epoch ->
                val date = Instant.ofEpochMilli(epoch).atZone(zone).toLocalDate()
                if (counts.containsKey(date)) counts[date] = (counts[date] ?: 0) + 1
            }
            card.lastReviewedAt?.let { epoch ->
                val date = Instant.ofEpochMilli(epoch).atZone(zone).toLocalDate()
                if (counts.containsKey(date)) counts[date] = (counts[date] ?: 0) + 1
            }
        }

        // 计算连续打卡天数
        var currentStreak = 0
        var checkDate = today
        while ((counts[checkDate] ?: 0) > 0) {
            currentStreak++
            checkDate = checkDate.minusDays(1)
        }

        val sum = counts.values.sum()
        Triple(counts, sum, currentStreak)
    }

    // 划分 5 周（每周 7 天，周一到周日）
    // 从 35 天前的那周一至今天
    val weeks = remember(today, dailyMap) {
        val list = mutableListOf<List<LocalDate>>()
        var cursor = today.minusDays(34L)
        // 对齐到最近的一个周一
        while (cursor.dayOfWeek.value != 1) {
            cursor = cursor.minusDays(1L)
        }
        while (!cursor.isAfter(today)) {
            val weekDays = (0 until 7).map { cursor.plusDays(it.toLong()) }
            list.add(weekDays)
            cursor = cursor.plusDays(7L)
        }
        list
    }

    val blockColorLevel0 = if (isDark) Color(0xFF222227) else Color(0xFFECEAE4)
    val blockColorLevel1 = if (isDark) Color(0xFF1E3A2F) else Color(0xFFD4E8DC)
    val blockColorLevel2 = if (isDark) Color(0xFF2E634F) else Color(0xFFA3D4BC)
    val blockColorLevel3 = if (isDark) Color(0xFF388E6C) else Color(0xFF67B594)
    val blockColorLevel4 = if (isDark) Color(0xFF48B688) else Color(0xFF3B9B73)

    fun colorForCount(count: Int): Color = when {
        count <= 0 -> blockColorLevel0
        count in 1..2 -> blockColorLevel1
        count in 3..5 -> blockColorLevel2
        count in 6..9 -> blockColorLevel3
        else -> blockColorLevel4
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.35f), RoundedCornerShape(16.dp))
            .padding(16.dp),
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "学习活跃度",
                        color = MaterialTheme.colorScheme.onSurface,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Serif,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "近 35 天 $totalActivity 次",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.5.sp,
                    )
                }

                if (streak > 0) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(EditorialColor.aiAmber.copy(alpha = 0.16f))
                            .border(1.dp, EditorialColor.aiAmber.copy(alpha = 0.35f), RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                    ) {
                        Text(
                            "🔥 连击 $streak 天",
                            color = EditorialColor.aiAmber,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }

            Spacer(Modifier.height(14.dp))

            // 热力方块网格
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                weeks.forEach { week ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        week.forEach { date ->
                            val count = dailyMap[date] ?: 0
                            val isFuture = date.isAfter(today)
                            Box(
                                modifier = Modifier
                                    .size(17.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(if (isFuture) Color.Transparent else colorForCount(count)),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // 底部图例
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("少", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp)
                Spacer(Modifier.width(4.dp))
                listOf(blockColorLevel0, blockColorLevel1, blockColorLevel2, blockColorLevel3, blockColorLevel4).forEach { color ->
                    Box(
                        Modifier
                            .size(10.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(color),
                    )
                    Spacer(Modifier.width(2.5.dp))
                }
                Spacer(Modifier.width(2.dp))
                Text("多", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp)
            }
        }
    }
}

package com.knowflick.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.LearningStats
import com.knowflick.app.domain.StatsCalculator
import java.time.LocalDate
import java.time.ZoneId

/** 学习统计：已刷/感兴趣率/连续天数 + 分类双轨 + 近 7 天趋势柱 */
@Composable
fun StatsScreen(
    cards: List<com.knowflick.app.domain.KnowledgeCard>,
    onBack: () -> Unit,
) {
    // 系统返回键与顶栏返回一致
    androidx.activity.compose.BackHandler { onBack() }
    val today = LocalDate.now()
    val stats = StatsCalculator.compute(cards, today)
    val daily = StatsCalculator.dailyCounts(cards, today, days = 7)
    val maxDaily = maxOf(1, daily.maxOf { it.count })

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState()),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "返回", tint = MaterialTheme.colorScheme.onBackground)
            }
            Text(
                "学习统计",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 19.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
            )
        }

        Column(Modifier.padding(horizontal = 26.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                StatCell(value = "${stats.seenCount}", label = "已刷")
                StatCell(value = "${(stats.likeRate * 100).toInt()}%", label = "感兴趣率")
                StatCell(value = "${stats.streakDays}", label = "连续天数")
                StatCell(value = "${cards.count { it.masteryLevel >= 2 }}", label = "已掌握")
            }

            Spacer(Modifier.height(28.dp))
            Text("近 7 天趋势", color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f), fontSize = 13.sp)
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(110.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                daily.forEach { day ->
                    val fraction = day.count.toFloat() / maxDaily
                    Box(
                        Modifier
                            .weight(1f)
                            .height((14 + 96 * fraction).dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (day.day == today) EditorialColor.aiAmber
                                else EditorialColor.aiAmber.copy(alpha = 0.35f),
                            ),
                    )
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                daily.forEach { day ->
                    Text(
                        "${day.day.monthValue}/${day.day.dayOfMonth}",
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.4f),
                        fontSize = 9.sp,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            Spacer(Modifier.height(30.dp))
            Text("分类分布", color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f), fontSize = 13.sp)
            Spacer(Modifier.height(12.dp))
            val maxSeen = maxOf(1, stats.categories.maxOfOrNull { it.seen } ?: 1)
            stats.categories.forEach { row ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        row.category,
                        color = MaterialTheme.colorScheme.onBackground,
                        fontSize = 13.sp,
                        modifier = Modifier.width(92.dp),
                        maxLines = 1,
                    )
                    Box(
                        Modifier
                            .weight(1f)
                            .height(14.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(MaterialTheme.colorScheme.surface),
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(fraction = row.seen.toFloat() / maxSeen)
                                .fillMaxSize()
                                .clip(RoundedCornerShape(4.dp))
                                .background(EditorialColor.aiAmber.copy(alpha = 0.8f)),
                        )
                    }
                    Text(
                        "${row.seen} · ♥${row.liked}",
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                        fontSize = 11.sp,
                        modifier = Modifier.padding(start = 10.dp),
                    )
                }
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun StatCell(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            value,
            color = EditorialColor.aiAmber,
            fontSize = 30.sp,
            fontWeight = FontWeight.Black,
            fontFamily = FontFamily.Monospace,
        )
        Spacer(Modifier.height(4.dp))
        Text(label, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f), fontSize = 12.sp)
    }
}

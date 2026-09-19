package com.knowflick.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.data.CategoryStampColor
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.LearningPlan
import com.knowflick.app.domain.MasteryDistribution
import com.knowflick.app.domain.StatsCalculator
import com.knowflick.app.domain.UpcomingDayStat
import java.time.LocalDate

/**
 * 学习与记忆统计中心：
 * 1. 总览：已刷 / 感兴趣率 / 连续天数 / 熟练掌握
 * 2. 艾宾浩斯间隔复习概览卡（今日到期/今日已完成/一键到期复习）
 * 3. 掌握度三档分布可视化（熟练 7天 / 学习中 3天 / 需强化 1天 堆叠胶囊条与记忆留存率）
 * 4. 未来 7 天到期预测时间线（前瞻排程柱状图）
 * 5. 近期待复习知识卡速览（点击直达详情）
 * 6. 过去 7 天学习趋势与分类分布
 */
@Composable
fun StatsScreen(
    cards: List<KnowledgeCard>,
    onBack: () -> Unit,
    onStartDueReview: () -> Unit = {},
    onOpenCardDetail: (String) -> Unit = {},
) {
    androidx.activity.compose.BackHandler { onBack() }

    val today = LocalDate.now()
    val stats = StatsCalculator.compute(cards, today)
    val plan = LearningPlan(cards, today)
    val masteryDist = plan.masteryDistribution
    val upcomingSchedule = plan.upcomingSchedule(7)
    val upcomingCards = plan.upcomingCards(5)
    val daily = StatsCalculator.dailyCounts(cards, today, days = 7)
    val maxDaily = maxOf(1, daily.maxOfOrNull { it.count } ?: 1)
    val maxUpcoming = maxOf(1, upcomingSchedule.maxOfOrNull { it.count } ?: 1)

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState()),
    ) {
        // 顶栏
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "返回",
                    tint = MaterialTheme.colorScheme.onBackground,
                )
            }
            Text(
                "学习与记忆统计",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
            )
        }

        Column(Modifier.padding(horizontal = 20.dp)) {
            // 核心 4 项大指标
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                StatCell(value = "${stats.seenCount}", label = "已刷卡片")
                StatCell(value = "${(stats.likeRate * 100).toInt()}%", label = "感兴趣率")
                StatCell(value = "${stats.streakDays}", label = "连续天数")
                StatCell(value = "${masteryDist.masteredCount}", label = "熟练掌握")
            }

            Spacer(Modifier.height(24.dp))

            // 1. 艾宾浩斯间隔复习概览卡
            SpacedRepetitionDueCard(
                plan = plan,
                onStartDueReview = onStartDueReview,
            )

            Spacer(Modifier.height(24.dp))

            // 2. 掌握度三档分布可视化
            MasteryDistributionCard(
                distribution = masteryDist,
            )

            Spacer(Modifier.height(24.dp))

            // 3. 未来 7 天到期预测时间线
            UpcomingScheduleCard(
                schedule = upcomingSchedule,
                maxCount = maxUpcoming,
            )

            // 4. 近期到期卡片清单
            if (upcomingCards.isNotEmpty()) {
                Spacer(Modifier.height(24.dp))
                UpcomingCardsList(
                    upcomingCards = upcomingCards,
                    today = today,
                    onOpenCardDetail = onOpenCardDetail,
                )
            }

            Spacer(Modifier.height(28.dp))

            // 5. 过去 7 天学习趋势
            Text(
                "近 7 天学习趋势",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(96.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                daily.forEach { day ->
                    val fraction = day.count.toFloat() / maxDaily
                    Box(
                        Modifier
                            .weight(1f)
                            .height((12 + 84 * fraction).dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (day.day == today) EditorialColor.aiAmber
                                else EditorialColor.aiAmber.copy(alpha = 0.35f),
                            ),
                    )
                }
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                daily.forEach { day ->
                    Text(
                        "${day.day.monthValue}/${day.day.dayOfMonth}",
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.4f),
                        fontSize = 8.5.sp,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            Spacer(Modifier.height(30.dp))

            // 6. 分类分布
            Text(
                "分类分布",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
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
                        fontSize = 12.sp,
                        modifier = Modifier.width(88.dp),
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
                        fontSize = 10.sp,
                        modifier = Modifier.padding(start = 10.dp),
                    )
                }
            }

            Spacer(Modifier.height(48.dp))
        }
    }
}

/** 核心指标格单元 */
@Composable
private fun StatCell(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            value,
            color = EditorialColor.aiAmber,
            fontSize = 24.sp,
            fontWeight = FontWeight.Black,
            fontFamily = FontFamily.Monospace,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            label,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
            fontSize = 10.5.sp,
        )
    }
}

/** 1. 艾宾浩斯间隔复习概览卡片 */
@Composable
private fun SpacedRepetitionDueCard(
    plan: LearningPlan,
    onStartDueReview: () -> Unit,
) {
    val dueCount = plan.due.size
    val completedCount = plan.completedToday

    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(16.dp))
            .padding(18.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    AppIcons.Sparkles,
                    contentDescription = null,
                    tint = EditorialColor.aiAmber,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "艾宾浩斯间隔复习",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Serif,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "间隔法则 1/3/7天",
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                    fontSize = 10.sp,
                )
            }

            Spacer(Modifier.height(12.dp))

            Text(
                "科学抗遗忘：首次浏览次日复习；遗忘、犹豫、熟练分别间隔 1、3、7 天。",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.65f),
                fontSize = 11.5.sp,
                lineHeight = 17.sp,
            )

            Spacer(Modifier.height(16.dp))

            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                        .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), RoundedCornerShape(10.dp))
                        .padding(12.dp),
                ) {
                    Column {
                        Text(
                            "$dueCount",
                            color = if (dueCount > 0) EditorialColor.aiAmber else EditorialColor.likeGreen,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Black,
                            fontFamily = FontFamily.Monospace,
                        )
                        Text(
                            "今日到期待复习",
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                            fontSize = 10.5.sp,
                        )
                    }
                }
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                        .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), RoundedCornerShape(10.dp))
                        .padding(12.dp),
                ) {
                    Column {
                        Text(
                            "$completedCount",
                            color = MaterialTheme.colorScheme.onBackground,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Black,
                            fontFamily = FontFamily.Monospace,
                        )
                        Text(
                            "今日已学/已复习",
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                            fontSize = 10.5.sp,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            if (dueCount > 0) {
                Button(
                    onClick = onStartDueReview,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = EditorialColor.aiAmber),
                ) {
                    Text(
                        "开始到期复习 · ${minOf(10, dueCount)} 张",
                        color = Color(0xFF1B1B1F),
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(EditorialColor.likeGreen.copy(alpha = 0.12f))
                        .border(1.dp, EditorialColor.likeGreen.copy(alpha = 0.28f), RoundedCornerShape(10.dp))
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "今日到期卡片已全部复习完毕 ✓",
                        color = EditorialColor.likeGreen,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

/** 2. 掌握度三档分布可视化卡片 */
@Composable
private fun MasteryDistributionCard(
    distribution: MasteryDistribution,
) {
    val total = distribution.totalCards
    val masteredPct = if (total > 0) distribution.masteredCount * 100 / total else 0
    val hesitantPct = if (total > 0) distribution.hesitantCount * 100 / total else 0
    val needsPct = if (total > 0) distribution.needsReviewCount * 100 / total else 0

    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(16.dp))
            .padding(18.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "知识掌握度分布",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Serif,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "留存指数 ${distribution.retentionRate}%",
                    color = EditorialColor.likeGreen,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                )
            }

            Spacer(Modifier.height(14.dp))

            // 三色堆叠胶囊条
            if (total > 0) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(10.dp)
                        .clip(RoundedCornerShape(5.dp))
                        .background(MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f)),
                ) {
                    if (distribution.masteredCount > 0) {
                        Box(
                            Modifier
                                .weight(distribution.masteredCount.toFloat())
                                .fillMaxSize()
                                .background(EditorialColor.likeGreen),
                        )
                    }
                    if (distribution.hesitantCount > 0) {
                        Box(
                            Modifier
                                .weight(distribution.hesitantCount.toFloat())
                                .fillMaxSize()
                                .background(EditorialColor.aiAmber),
                        )
                    }
                    if (distribution.needsReviewCount > 0) {
                        Box(
                            Modifier
                                .weight(distribution.needsReviewCount.toFloat())
                                .fillMaxSize()
                                .background(EditorialColor.dislikeRed.copy(alpha = 0.65f)),
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // 三分项指标卡
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MasteryTierPill(
                    label = "熟练掌握 ★★",
                    rule = "7 天间隔",
                    count = distribution.masteredCount,
                    percent = masteredPct,
                    tint = EditorialColor.likeGreen,
                    modifier = Modifier.weight(1f),
                )
                MasteryTierPill(
                    label = "学习中 ★☆",
                    rule = "3 天间隔",
                    count = distribution.hesitantCount,
                    percent = hesitantPct,
                    tint = EditorialColor.aiAmber,
                    modifier = Modifier.weight(1f),
                )
                MasteryTierPill(
                    label = "需强化 ☆☆",
                    rule = "1 天间隔",
                    count = distribution.needsReviewCount,
                    percent = needsPct,
                    tint = EditorialColor.dislikeRed,
                    modifier = Modifier.weight(1f),
                )
            }

            Spacer(Modifier.height(12.dp))

            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "测验覆盖: ${distribution.testedCards}/$total 张",
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                    fontSize = 10.5.sp,
                )
                Text(
                    "累计测验: ${distribution.totalReviews} 卡次",
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                    fontSize = 10.5.sp,
                )
            }
        }
    }
}

@Composable
private fun MasteryTierPill(
    label: String,
    rule: String,
    count: Int,
    percent: Int,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(tint.copy(alpha = 0.08f))
            .border(1.dp, tint.copy(alpha = 0.28f), RoundedCornerShape(10.dp))
            .padding(10.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(6.dp)
                        .background(tint, CircleShape),
                )
                Spacer(Modifier.width(5.dp))
                Text(
                    label,
                    color = tint,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                )
            }
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    "$count",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Black,
                    fontFamily = FontFamily.Monospace,
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    "$percent%",
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                    fontSize = 10.sp,
                )
            }
            Text(
                rule,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.40f),
                fontSize = 9.sp,
            )
        }
    }
}

/** 3. 未来 7 天到期预测时间线卡片 */
@Composable
private fun UpcomingScheduleCard(
    schedule: List<UpcomingDayStat>,
    maxCount: Int,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(16.dp))
            .padding(18.dp),
    ) {
        Column {
            Text(
                "未来 7 天待复习排程预测",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 14.5.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "基于已定复习日历推导，助你合理安排每日记忆负荷",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                fontSize = 10.5.sp,
            )

            Spacer(Modifier.height(18.dp))

            Row(
                Modifier
                    .fillMaxWidth()
                    .height(84.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                schedule.forEach { day ->
                    val fraction = if (maxCount > 0) day.count.toFloat() / maxCount else 0f
                    Column(
                        Modifier.weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        if (day.count > 0) {
                            Text(
                                "${day.count}",
                                color = if (day.isToday) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f),
                                fontSize = 10.sp,
                                fontFamily = FontFamily.Monospace,
                            )
                            Spacer(Modifier.height(4.dp))
                        }
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height((8 + 60 * fraction).dp)
                                .clip(RoundedCornerShape(5.dp))
                                .background(
                                    if (day.isToday) EditorialColor.aiAmber
                                    else if (day.count > 0) EditorialColor.aiAmber.copy(alpha = 0.40f)
                                    else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f),
                                ),
                        )
                    }
                }
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                schedule.forEach { day ->
                    Text(
                        if (day.isToday) "今天" else "${day.date.monthValue}/${day.date.dayOfMonth}",
                        color = if (day.isToday) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                        fontSize = 9.sp,
                        fontWeight = if (day.isToday) FontWeight.Bold else FontWeight.Normal,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

/** 4. 近期待复习知识卡速览清单 */
@Composable
private fun UpcomingCardsList(
    upcomingCards: List<Pair<KnowledgeCard, LocalDate>>,
    today: LocalDate,
    onOpenCardDetail: (String) -> Unit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(16.dp))
            .padding(18.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "近期待复习卡片速览",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Serif,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "点击可查看详情",
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                    fontSize = 10.5.sp,
                )
            }

            Spacer(Modifier.height(14.dp))

            upcomingCards.forEachIndexed { index, (card, date) ->
                if (index > 0) Spacer(Modifier.height(8.dp))
                val isDueToday = !date.isAfter(today)
                val dateLabel = if (isDueToday) "今天到期" else if (date == today.plusDays(1)) "明天" else "${date.monthValue}/${date.dayOfMonth}"

                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
                        .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f), RoundedCornerShape(10.dp))
                        .clickable { onOpenCardDetail(card.id) }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // 日期胶囊
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (isDueToday) EditorialColor.aiAmber.copy(alpha = 0.16f)
                                else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f),
                            )
                            .border(
                                1.dp,
                                if (isDueToday) EditorialColor.aiAmber.copy(alpha = 0.35f)
                                else Color.Transparent,
                                RoundedCornerShape(6.dp),
                            )
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        Text(
                            dateLabel,
                            color = if (isDueToday) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.65f),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }

                    Spacer(Modifier.width(10.dp))

                    // 分类小胶囊
                    val catColor = CategoryStampColor.forCategory(card.category)
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(catColor.copy(alpha = 0.12f))
                            .border(0.8.dp, catColor.copy(alpha = 0.25f), RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    ) {
                        Text(
                            card.category.ifBlank { "未分类" },
                            color = catColor,
                            fontSize = 9.5.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }

                    Spacer(Modifier.width(10.dp))

                    // 标题
                    Text(
                        card.headline,
                        color = MaterialTheme.colorScheme.onBackground,
                        fontSize = 12.5.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontFamily = FontFamily.Serif,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

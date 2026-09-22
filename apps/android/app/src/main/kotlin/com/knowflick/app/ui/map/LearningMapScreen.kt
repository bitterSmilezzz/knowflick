package com.knowflick.app.ui.map

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.BranchProgress
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.StudyMap
import com.knowflick.app.domain.StudyScope
import com.knowflick.app.domain.SubjectRegistry
import com.knowflick.app.ui.EditorialColor
import com.knowflick.app.ui.common.HapticFeedbackHelper

/**
 * 学习地图：学科 → 分支 → 难度 三级选择器，回答「我现在学什么」。
 *
 * 两种用法都支持（用户明确要求）：
 * - **专学**：只刷这一条支线，按导入顺序一级一级往前推（`sequential = true`）；
 * - **混合**：把多个分支/难度加进同一个卡堆混着刷（`sequential = false`）。
 *
 * 范围只在本次会话内生效，重启自动回到全景。
 */
@Composable
fun LearningMapScreen(
    cards: List<KnowledgeCard>,
    scope: StudyScope,
    onBack: () -> Unit,
    onApplyScope: (StudyScope) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var openedSubject by rememberSaveable { mutableStateOf<String?>(null) }

    BackHandler {
        if (openedSubject != null) openedSubject = null else onBack()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = {
                if (openedSubject != null) openedSubject = null else onBack()
            }) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = if (openedSubject != null) "返回学科列表" else "返回卡堆",
                    tint = MaterialTheme.colorScheme.onBackground,
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "学习地图",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Serif,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    if (scope.isActive) "当前范围：${scope.describe()} · 还剩 ${StudyMap.remaining(cards, scope)} 张"
                    else "${cards.size} 张卡 · 未限定范围",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                )
            }
            if (scope.isActive) {
                TextMapButton("退出范围") {
                    HapticFeedbackHelper.click(context)
                    onApplyScope(StudyScope.None)
                    onBack()
                }
            }
            Spacer(Modifier.width(4.dp))
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val subjectProgress = StudyMap.subjectProgress(cards)
            val opened = openedSubject

            if (opened == null) {
                ScopeSummaryBar(scope = scope, onExit = { onApplyScope(StudyScope.None) })

                subjectProgress.forEach { progress ->
                    MapRow(
                        title = progress.name,
                        subtitle = "${progress.total} 张 · 已看 ${progress.seen} · 已掌握 ${progress.mastered} · ${progress.branchCount} 条支线",
                        ratio = if (progress.total > 0) progress.seen.toFloat() / progress.total else 0f,
                        onClick = {
                            HapticFeedbackHelper.tick(context)
                            openedSubject = progress.slug
                        },
                    )
                }
            } else {
                val branches = StudyMap.branchProgress(cards, opened)
                Text(
                    SubjectRegistry.displayName(opened),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f),
                    modifier = Modifier.padding(top = 4.dp),
                )

                branches.forEach { branch ->
                    BranchCard(
                        branch = branch,
                        selected = branch.key in scope.branches,
                        onStudyOnly = {
                            HapticFeedbackHelper.click(context)
                            onApplyScope(
                                StudyScope(
                                    subjects = setOfNotNull(opened),
                                    branches = setOf(branch.key),
                                    sequential = true,
                                )
                            )
                            onBack()
                        },
                        onToggleMix = {
                            HapticFeedbackHelper.tick(context)
                            onApplyScope(
                                scope.copy(
                                    subjects = if (scope.subjects.isEmpty()) scope.subjects else scope.subjects + opened,
                                    branches = scope.branches + branch.key,
                                    sequential = false,
                                )
                            )
                        },
                    )
                }

                LevelLadder(
                    branches = branches,
                    selectedLevels = scope.levels,
                    onPickLevel = { level ->
                        HapticFeedbackHelper.click(context)
                        val next = if (level in scope.levels) scope.levels - level else scope.levels + level
                        onApplyScope(
                            scope.copy(
                                subjects = if (scope.subjects.isEmpty()) setOfNotNull(opened) else scope.subjects,
                                levels = next,
                                sequential = next.isNotEmpty() && scope.branches.isEmpty(),
                            )
                        )
                    },
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** 当前范围摘要条：只在有范围时出现，给一个显式的"回到全景"出口 */
@Composable
private fun ScopeSummaryBar(scope: StudyScope, onExit: () -> Unit) {
    if (!scope.isActive) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(EditorialColor.aiAmber.copy(alpha = 0.12f))
            .border(1.dp, EditorialColor.aiAmber.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text("正在限定范围学习", fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = EditorialColor.aiAmber)
            Text(scope.describe(), fontSize = 11.5.sp, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f))
        }
        TextMapButton("退出") { onExit() }
    }
}

/** 学科行 */
@Composable
private fun MapRow(title: String, subtitle: String, ratio: Float, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f), RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(14.dp)
            .semantics { contentDescription = "$title，$subtitle" },
    ) {
        Text(
            title,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Serif,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(3.dp))
        Text(subtitle, fontSize = 11.5.sp, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f))
        Spacer(Modifier.height(8.dp))
        ProgressBar(ratio = ratio)
    }
}

/** 分支卡：一条支线一行，给「专学」与「混合加入」两个动作 */
@Composable
private fun BranchCard(
    branch: BranchProgress,
    selected: Boolean,
    onStudyOnly: () -> Unit,
    onToggleMix: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(
                1.dp,
                if (selected) EditorialColor.aiAmber.copy(alpha = 0.5f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.25f),
                RoundedCornerShape(14.dp),
            )
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    branch.name,
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    "${branch.total} 张 · 已看 ${branch.seen} · 已掌握 ${branch.mastered}" +
                        (branch.nextLevel?.let { " · 下一步 ${SubjectRegistry.levelName(it)}" } ?: ""),
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                )
            }
            if (selected) {
                Text(
                    "已在范围",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = EditorialColor.aiAmber,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        ProgressBar(ratio = if (branch.total > 0) branch.seen.toFloat() / branch.total else 0f)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextMapButton("专学这条支线", emphasized = true, onClick = onStudyOnly)
            TextMapButton("加入混合", onClick = onToggleMix)
        }
    }
}

/** 难度阶梯：整学科按难度选（英语 L1→L5 一点点看的入口） */
@Composable
private fun LevelLadder(branches: List<BranchProgress>, selectedLevels: Set<Int>, onPickLevel: (Int) -> Unit) {
    val merged = LinkedHashMap<Int, IntArray>()   // level -> [total, seen]
    for (branch in branches) {
        for (level in branch.levels) {
            val cell = level.level ?: continue
            val bucket = merged.getOrPut(cell) { IntArray(2) }
            bucket[0] += level.total
            bucket[1] += level.seen
        }
    }
    if (merged.isEmpty()) return

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f), RoundedCornerShape(14.dp))
            .padding(14.dp),
    ) {
        Text("按难度选", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onBackground)
        Text("点一下加进范围，再点取消；只选难度时自动按顺序推进", fontSize = 11.sp, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f))
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            merged.keys.sorted().forEach { level ->
                val cell = merged.getValue(level)
                MapChip(
                    text = "${SubjectRegistry.levelName(level)} ${cell[1]}/${cell[0]}",
                    selected = level in selectedLevels,
                    onClick = { onPickLevel(level) },
                )
            }
        }
    }
}

@Composable
private fun MapChip(text: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) EditorialColor.aiAmber else Color.Transparent)
            .border(
                1.dp,
                if (selected) EditorialColor.aiAmber else MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(
            text,
            fontSize = 11.5.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
            color = if (selected) Color.Black else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f),
        )
    }
}

@Composable
private fun TextMapButton(text: String, emphasized: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (emphasized) EditorialColor.likeGreen.copy(alpha = 0.16f) else Color.Transparent)
            .border(
                1.dp,
                if (emphasized) EditorialColor.likeGreen.copy(alpha = 0.45f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.35f),
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    ) {
        Text(
            text,
            fontSize = 12.sp,
            fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Medium,
            color = if (emphasized) EditorialColor.likeGreen else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f),
        )
    }
}

/** 发丝边进度条：与统计中心的扁平微彩口径一致 */
@Composable
private fun ProgressBar(ratio: Float) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(4.dp)
            .clip(RoundedCornerShape(2.dp))
            .background(MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(ratio.coerceIn(0f, 1f))
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(EditorialColor.likeGreen)
        )
    }
}

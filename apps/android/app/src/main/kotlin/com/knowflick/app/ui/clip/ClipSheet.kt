package com.knowflick.app.ui.clip

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.KnowFlickViewModel
import com.knowflick.app.domain.WebClipDigest
import com.knowflick.app.ui.AppIcons
import com.knowflick.app.ui.EditorialColor

/**
 * 网页剪藏面板：粘一个链接（或从浏览器「分享」进来）→ 抽正文 → AI 提炼成卡片 → 人工确认才入库。
 *
 * 正文预览与「生成卡片」分开，是因为抽取是无损的、提炼是有损的：用户得先看见
 * 我们到底抽到了什么，再决定是否花 token 让它变成卡片。
 */
@Composable
fun ClipSheet(
    viewModel: KnowFlickViewModel,
    modifier: Modifier = Modifier,
) {
    val focusManager = LocalFocusManager.current
    val stage = viewModel.clipStage
    val digest = viewModel.clipDigest
    val notice = viewModel.clipNotice
    val failure = viewModel.clipError
    val busy = stage == KnowFlickViewModel.ClipStage.FETCHING || stage == KnowFlickViewModel.ClipStage.EXTRACTING

    BackHandler(onBack = viewModel::closeClipSheet)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.98f))
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 20.dp, vertical = 8.dp),
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .size(width = 36.dp, height = 4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(MaterialTheme.colorScheme.onBackground.copy(alpha = 0.2f)),
        )
        Spacer(Modifier.height(12.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(EditorialColor.detailBlue.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = AppIcons.Newspaper,
                    contentDescription = null,
                    tint = EditorialColor.detailBlue,
                    modifier = Modifier.size(18.dp),
                )
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("剪藏网页", fontSize = 17.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Serif)
                Text(
                    "看到好文章随手收进知识库",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
                )
            }
            IconButton(onClick = viewModel::closeClipSheet) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "关闭",
                    tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        OutlinedTextField(
            value = viewModel.clipInput,
            onValueChange = { if (!busy) viewModel.updateClipInput(it) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("网页链接") },
            placeholder = { Text("粘贴 URL，或从浏览器点「分享 → KnowFlick」") },
            singleLine = true,
            enabled = !busy,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = {
                focusManager.clearFocus()
                viewModel.runClipFetch()
            }),
            trailingIcon = {
                if (stage == KnowFlickViewModel.ClipStage.FETCHING) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                }
            },
        )

        Spacer(Modifier.height(10.dp))

        OutlinedButton(
            onClick = {
                focusManager.clearFocus()
                viewModel.runClipFetch()
            },
            enabled = !busy && viewModel.clipInput.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (digest == null) "抽取正文" else "重新抽取")
        }

        // 中间可滚：正文预览长度不可控，不能把它和主操作放在同一个滚动容器里
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState()),
        ) {
            if (digest != null) {
                ClipDigestPreview(digest)
            } else if (stage != KnowFlickViewModel.ClipStage.FETCHING) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
                        .padding(16.dp),
                ) {
                    Text(
                        text = "抽到正文后会先给你看，确认再入库——剪藏不动你的卡库，除非点「提炼成卡片」。\n" +
                            "在浏览器里长按链接 → 分享 → KnowFlick，会直接打开这里并自动抽取。",
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                    )
                }
            }
        }

        // 动作与它的反馈同屏：小屏上报错如果落在滚动区外面，等于没报
        failure?.let { message ->
            Spacer(Modifier.height(10.dp))
            Text(text = message, fontSize = 12.sp, lineHeight = 18.sp, color = EditorialColor.warningOrange)
        }
        notice?.let { message ->
            Spacer(Modifier.height(10.dp))
            Text(
                text = message,
                fontSize = 12.sp,
                lineHeight = 18.sp,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
            )
        }
        if (digest != null) {
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = viewModel::clipToCards,
                enabled = stage != KnowFlickViewModel.ClipStage.EXTRACTING,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    if (stage == KnowFlickViewModel.ClipStage.EXTRACTING) {
                        "AI 正在提炼…"
                    } else {
                        "AI 提炼成卡片并置顶入堆"
                    }
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = "提炼会调用你配置的 AI 服务（一次请求，正文 ${digest.text.length} 字）",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
            )
        }
    }
}

/** 抽到的正文预览：来源、标题、正文（可滚），让「抽到了什么」在花钱之前就是可见的 */
@Composable
private fun ClipDigestPreview(digest: WebClipDigest) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f))
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = digest.siteName.ifEmpty { digest.pageURL },
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = EditorialColor.detailBlue,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = "${digest.text.length} 字" + if (digest.truncated) " · 已截断" else "",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
            )
        }
        if (digest.title.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = digest.title,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Serif,
                lineHeight = 20.sp,
            )
        }
        if (digest.description.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = digest.description,
                fontSize = 12.sp,
                lineHeight = 17.sp,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.65f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.height(10.dp))
        // 正文不套内层滚动：外层面板已经可滚，同方向嵌套滚动会吃掉拖动手势
        Text(
            text = digest.text,
            fontSize = 12.sp,
            lineHeight = 19.sp,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f),
        )
    }
}

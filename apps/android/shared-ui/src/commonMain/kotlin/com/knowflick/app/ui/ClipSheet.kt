package com.knowflick.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.WebClipDigest
import com.knowflick.app.ui.common.PlatformBackHandler
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * 网页剪藏：正文预览 → 卡片多选（可重炼）→ 确认导入。置顶是可关的开关。
 *
 * 抓取、提炼、入库都由宿主注入。面板只守 mac 端那三步，不在点「提炼」时直接写库。
 */
@Composable
fun ClipSheet(
    aiConfigured: Boolean,
    onFetch: suspend (String) -> WebClipDigest,
    onTransform: suspend (String) -> List<KnowledgeCard>,
    onImport: (List<KnowledgeCard>, Boolean) -> String,
    onClose: () -> Unit,
    initialText: String = "",
    modifier: Modifier = Modifier,
) {
    val focusManager = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf(initialText) }
    var digest by remember { mutableStateOf<WebClipDigest?>(null) }
    var cards by remember { mutableStateOf<List<KnowledgeCard>>(emptyList()) }
    var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var insertAtTop by remember { mutableStateOf(true) }
    var fetching by remember { mutableStateOf(false) }
    var transforming by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var importMessage by remember { mutableStateOf<String?>(null) }
    val busy = fetching || transforming
    var job by remember { mutableStateOf<Job?>(null) }

    fun resetResults() {
        digest = null
        cards = emptyList()
        selectedIds = emptySet()
        errorMessage = null
        importMessage = null
    }

    fun fetchPage() {
        val submitted = input.trim()
        if (submitted.isEmpty() || busy) return
        job?.cancel()
        resetResults()
        fetching = true
        job = scope.launch {
            try {
                val result = onFetch(submitted)
                digest = result
                fetching = false
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fetching = false
                errorMessage = e.message ?: "网页读取失败"
            }
        }
    }

    fun transformPage() {
        val current = digest ?: return
        if (!aiConfigured || busy) {
            if (!aiConfigured) errorMessage = "请先在设置里配置 AI 服务"
            return
        }
        job?.cancel()
        transforming = true
        errorMessage = null
        importMessage = null
        cards = emptyList()
        selectedIds = emptySet()
        job = scope.launch {
            try {
                val transformed = onTransform(current.aiNote)
                val attributed = current.attributing(transformed)
                cards = attributed
                selectedIds = attributed.map { it.id }.toSet()
                transforming = false
                if (attributed.isEmpty()) {
                    errorMessage = "AI 没有返回可导入的卡片，请重新提炼或检查网页正文。"
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                transforming = false
                errorMessage = "AI 提炼失败：${e.message ?: "未知错误"}"
            }
        }
    }

    fun importSelected() {
        val selected = cards.filter { it.id in selectedIds }
        if (selected.isEmpty()) return
        importMessage = onImport(selected, insertAtTop)
    }

    LaunchedEffect(initialText) {
        if (initialText.isNotBlank() && digest == null && !busy) fetchPage()
    }
    DisposableEffect(Unit) {
        onDispose { job?.cancel() }
    }
    PlatformBackHandler(onBack = onClose)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.98f))
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(AppIcons.Newspaper, contentDescription = null, tint = EditorialColor.detailBlue, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("网页剪藏", fontSize = 17.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Serif)
                Text(
                    "先预览抽取的正文，再决定是否发送给 AI 提炼。",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
                )
            }
            IconButton(onClick = onClose) {
                Icon(Icons.Default.Close, contentDescription = "关闭")
            }
        }

        Spacer(Modifier.height(12.dp))

        Column(
            modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = {
                    input = it
                    if (!busy) {
                        job?.cancel()
                        fetching = false
                        transforming = false
                        resetResults()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("网页链接") },
                placeholder = { Text("粘贴 URL，或从浏览器分享进来") },
                singleLine = true,
                enabled = !busy,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = {
                    focusManager.clearFocus()
                    fetchPage()
                }),
            )

            if (busy) {
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text(if (fetching) "正在匿名读取网页…" else "AI 正在提炼知识卡片…", fontSize = 14.sp)
                }
            }

            digest?.let { page ->
                Spacer(Modifier.height(16.dp))
                ClipDigestPreview(page)
            }

            if (cards.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                ClipCardPicker(
                    cards = cards,
                    selectedIds = selectedIds,
                    insertAtTop = insertAtTop,
                    onToggle = { id ->
                        selectedIds = if (id in selectedIds) selectedIds - id else selectedIds + id
                    },
                    onToggleAll = {
                        selectedIds = if (selectedIds.size == cards.size) emptySet() else cards.map { it.id }.toSet()
                    },
                    onInsertAtTopChange = { insertAtTop = it },
                )
            }

            errorMessage?.let { message ->
                Spacer(Modifier.height(12.dp))
                Text(message, color = EditorialColor.warningOrange, fontSize = 12.sp, lineHeight = 18.sp)
            }
            importMessage?.let { message ->
                Spacer(Modifier.height(12.dp))
                Text(message, fontSize = 12.sp, lineHeight = 18.sp)
            }
        }

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            when {
                importMessage != null -> Button(onClick = onClose, modifier = Modifier.weight(1f)) {
                    Text("完成")
                }
                cards.isNotEmpty() -> {
                    OutlinedButton(onClick = ::transformPage, enabled = !busy && aiConfigured, modifier = Modifier.weight(1f)) {
                        Text("重新提炼")
                    }
                    Button(
                        onClick = ::importSelected,
                        enabled = selectedIds.isNotEmpty() && !busy,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("确认导入（${selectedIds.size} 张）")
                    }
                }
                digest != null -> Button(onClick = ::transformPage, enabled = !busy && aiConfigured, modifier = Modifier.fillMaxWidth()) {
                    Text("AI 提炼成卡片")
                }
                else -> Button(
                    onClick = {
                        focusManager.clearFocus()
                        fetchPage()
                    },
                    enabled = !busy && input.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (fetching) "正在抓取…" else "抓取并预览正文")
                }
            }
        }
    }
}

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
        Text(
            text = digest.siteName.ifEmpty { digest.pageURL },
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            color = EditorialColor.detailBlue,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (digest.title.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(digest.title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Serif)
        }
        Spacer(Modifier.height(8.dp))
        Text(digest.text, fontSize = 12.sp, lineHeight = 19.sp)
    }
}

@Composable
private fun ClipCardPicker(
    cards: List<KnowledgeCard>,
    selectedIds: Set<String>,
    insertAtTop: Boolean,
    onToggle: (String) -> Unit,
    onToggleAll: () -> Unit,
    onInsertAtTopChange: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "AI 提炼预览（${selectedIds.size}/${cards.size}）",
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (selectedIds.size == cards.size) "取消全选" else "全选",
                color = EditorialColor.detailBlue,
                modifier = Modifier.clickable(onClick = onToggleAll),
            )
        }
        cards.forEach { card ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f))
                    .clickable { onToggle(card.id) }
                    .padding(end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = card.id in selectedIds, onCheckedChange = { onToggle(card.id) })
                Column {
                    Text(card.headline, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    if (card.summary.isNotEmpty()) {
                        Text(
                            card.summary,
                            fontSize = 12.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.65f),
                        )
                    }
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().clickable { onInsertAtTopChange(!insertAtTop) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = insertAtTop, onCheckedChange = onInsertAtTopChange)
            Column {
                Text("置顶到待刷卡堆", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text("新卡会优先出现在卡堆前方。", fontSize = 12.sp, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f))
            }
        }
    }
}

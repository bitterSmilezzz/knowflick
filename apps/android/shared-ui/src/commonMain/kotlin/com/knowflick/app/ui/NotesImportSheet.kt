package com.knowflick.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.CardTextUtils
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.common.PlatformBackHandler
import kotlinx.coroutines.launch

/**
 * 笔记 → 卡片：粘贴或选文件，规则解析或 AI 提炼，先预览勾选再入库。
 * 解析与提炼由宿主注入，面板不自己写库。
 */
@Composable
fun NotesImportSheet(
    aiConfigured: Boolean,
    existingCards: List<KnowledgeCard>,
    onParseRules: (String, String?) -> List<KnowledgeCard>,
    onTransform: suspend (String) -> List<KnowledgeCard>,
    onImport: (List<KnowledgeCard>, Boolean) -> String,
    onPickFile: () -> Unit,
    onClose: () -> Unit,
    incomingFileName: String? = null,
    incomingFileText: String? = null,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var useAi by remember { mutableStateOf(false) }
    var noteText by remember { mutableStateOf("") }
    var fileName by remember { mutableStateOf<String?>(null) }
    var cards by remember { mutableStateOf<List<KnowledgeCard>>(emptyList()) }
    var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var insertAtTop by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var importMessage by remember { mutableStateOf<String?>(null) }

    fun invalidate() {
        cards = emptyList()
        selectedIds = emptySet()
        errorMessage = null
        importMessage = null
    }

    LaunchedEffect(incomingFileName, incomingFileText) {
        if (!incomingFileText.isNullOrEmpty()) {
            fileName = incomingFileName
            noteText = incomingFileText
            invalidate()
        }
    }
    PlatformBackHandler(onBack = onClose)

    val existingKeys = remember(existingCards) {
        existingCards.map { CardTextUtils.normalizeHeadline(it.headline) }.toSet()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("导入笔记", fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = onClose) { Icon(Icons.Default.Close, contentDescription = "关闭") }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoiceChip("规则解析", selected = !useAi) {
                    useAi = false
                    invalidate()
                }
                ChoiceChip("AI 智能提炼", selected = useAi) {
                    useAi = true
                    invalidate()
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = noteText,
                onValueChange = {
                    noteText = it
                    fileName = null
                    invalidate()
                },
                modifier = Modifier.fillMaxWidth().height(160.dp),
                label = { Text(fileName ?: "粘贴 Markdown 或 JSON") },
                enabled = !busy,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = onPickFile, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                Text("选择本地文件")
            }
            if (busy) {
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(modifier = Modifier.height(18.dp))
                    Text(if (useAi) "AI 正在提炼…" else "正在解析…")
                }
            }
            errorMessage?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = EditorialColor.warningOrange, fontSize = 12.sp)
            }
            importMessage?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, fontSize = 12.sp)
            }
            cards.forEach { card ->
                val duplicate = CardTextUtils.normalizeHeadline(card.headline) in existingKeys
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { 
                        selectedIds = if (card.id in selectedIds) selectedIds - card.id else selectedIds + card.id
                    },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = card.id in selectedIds, onCheckedChange = {
                        selectedIds = if (card.id in selectedIds) selectedIds - card.id else selectedIds + card.id
                    })
                    Column(Modifier.weight(1f)) {
                        Text(card.headline, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(card.summary, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    if (duplicate) Text("已在库中", fontSize = 11.sp, color = EditorialColor.warningOrange)
                }
            }
            if (cards.isNotEmpty()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = insertAtTop, onCheckedChange = { insertAtTop = it })
                    Text("置顶到待刷卡堆")
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        if (importMessage != null) {
            Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("完成") }
        } else if (cards.isEmpty()) {
            Button(
                onClick = {
                    val content = noteText.trim()
                    if (content.isEmpty()) {
                        errorMessage = "笔记内容不能为空"
                        return@Button
                    }
                    if (useAi && !aiConfigured) {
                        errorMessage = "请先在设置里配置 AI 服务"
                        return@Button
                    }
                    errorMessage = null
                    busy = true
                    scope.launch {
                        try {
                            val parsed = if (useAi) onTransform(content) else onParseRules(content, fileName)
                            busy = false
                            if (parsed.isEmpty()) {
                                errorMessage = "未能在笔记中识别到有效知识卡片，请检查格式或尝试使用 AI 提炼"
                            } else {
                                cards = parsed
                                selectedIds = parsed.map { it.id }.toSet()
                            }
                        } catch (e: Exception) {
                            busy = false
                            errorMessage = if (useAi) "AI 提炼失败：${e.message}" else "笔记解析失败：${e.message}"
                        }
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (useAi) "AI 提炼" else "解析笔记") }
        } else {
            Button(
                onClick = {
                    val selected = cards.filter { it.id in selectedIds }
                    if (selected.isEmpty()) return@Button
                    importMessage = onImport(selected, insertAtTop)
                },
                enabled = selectedIds.isNotEmpty(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("确认导入（${selectedIds.size} 张）") }
        }
    }
}

@Composable
private fun ChoiceChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) EditorialColor.aiAmber.copy(alpha = 0.25f) else MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        fontSize = 13.sp,
    )
}

package com.knowflick.app.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.ai.CardChatMessage
import com.knowflick.app.ai.CardChatSession
import com.knowflick.app.ai.MessageSender
import com.knowflick.app.domain.KnowledgeCard

/**
 * 卡片专属 AI 深度追问与流式对话伴学面板（对齐 macOS CardFollowUpChatView 设计与契约）：
 * - 启发式快捷引导词（Starters: 💡/🔍/⚡/❓），一键发起探索
 * - 消息流式多轮气泡、打字光标（▋）、思考等待动画与平滑自动吸附滚动
 * - 助手单条回答工具栏（朗读此回答 + 复制文本）
 * - 软键盘自动适配（imePadding）与流式中途打断（Stop）
 */
@Composable
fun CardFollowUpChatSheet(
    card: KnowledgeCard,
    session: CardChatSession?,
    isStreaming: Boolean,
    errorMessage: String?,
    onSendMessage: (String) -> Unit,
    onCancelStreaming: () -> Unit,
    onClearSession: () -> Unit,
    onSpeakMessage: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BackHandler { onClose() }

    var showClearDialog by remember { mutableStateOf(false) }
    var inputText by remember { mutableStateOf("") }
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    val messages = session?.messages ?: emptyList()

    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            title = { Text("清空对话记录", color = Color.White, fontWeight = FontWeight.Bold) },
            text = { Text("确定清空对《${card.headline}》的追问历史吗？清空后不可恢复。", color = Color.White.copy(alpha = 0.8f)) },
            confirmButton = {
                TextButton(onClick = {
                    showClearDialog = false
                    onClearSession()
                }) {
                    Text("清空", color = EditorialColor.dislikeRed, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearDialog = false }) {
                    Text("取消", color = Color.White.copy(alpha = 0.7f))
                }
            },
            containerColor = Color(0xFF1C1C20),
        )
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF101012))
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // 顶栏：图标 + 标题 + 分类胶囊 + 清空 + 完成
            ChatHeaderBar(
                category = card.category,
                hasMessages = messages.isNotEmpty(),
                onClearClick = { showClearDialog = true },
                onClose = onClose,
            )

            Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.08f)))

            // 主内容区：空态引导词 或 消息滚动列表
            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                if (messages.isEmpty()) {
                    ChatStartersView(
                        headline = card.headline,
                        onStarterClick = { prompt ->
                            onSendMessage(prompt)
                        },
                    )
                } else {
                    ChatMessageList(
                        messages = messages,
                        onSpeak = onSpeakMessage,
                        onCopy = { text ->
                            clipboardManager.setText(AnnotatedString(text))
                            Toast.makeText(context, "已复制回答", Toast.LENGTH_SHORT).show()
                        },
                    )
                }
            }

            // 错误横幅
            AnimatedVisibility(
                visible = errorMessage != null,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                if (errorMessage != null) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF3B1818))
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = EditorialColor.dislikeRed,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = errorMessage,
                            color = Color.White.copy(alpha = 0.9f),
                            fontSize = 12.sp,
                        )
                    }
                }
            }

            Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.08f)))

            // 底部输入栏
            ChatInputBar(
                text = inputText,
                isStreaming = isStreaming,
                onTextChanged = { inputText = it },
                onSend = {
                    val prompt = inputText.trim()
                    if (prompt.isNotEmpty()) {
                        inputText = ""
                        onSendMessage(prompt)
                    }
                },
                onStop = onCancelStreaming,
            )
        }
    }
}

/** 顶栏 */
@Composable
private fun ChatHeaderBar(
    category: String,
    hasMessages: Boolean,
    onClearClick: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = AppIcons.Sparkles,
                contentDescription = null,
                tint = EditorialColor.aiAmber,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "AI 伴学追问",
                color = Color.White,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.width(10.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(EditorialColor.aiAmber.copy(alpha = 0.12f))
                    .border(1.dp, EditorialColor.aiAmber.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            ) {
                Text(
                    category.ifBlank { "知识探索" },
                    color = EditorialColor.aiAmber,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            if (hasMessages) {
                IconButton(
                    onClick = onClearClick,
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.08f)),
                ) {
                    Icon(
                        imageVector = AppIcons.Delete,
                        contentDescription = "清空对话",
                        tint = Color.White.copy(alpha = 0.6f),
                        modifier = Modifier.size(16.dp),
                    )
                }
                Spacer(Modifier.width(10.dp))
            }
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.White.copy(alpha = 0.10f))
                    .border(1.dp, Color.White.copy(alpha = 0.20f), RoundedCornerShape(16.dp))
                    .clickable(onClick = onClose)
                    .padding(horizontal = 14.dp, vertical = 6.dp),
            ) {
                Text(
                    "完成",
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

/** 空态启发式引导卡片 */
@Composable
private fun ChatStartersView(
    headline: String,
    onStarterClick: (String) -> Unit,
) {
    val starters = remember {
        listOf(
            "💡" to "用小学生都能听懂的生活比喻，解释它的底层运转机理",
            "🔍" to "在工业界、现实生活或前沿科技中有哪些典型应用或反转案例？",
            "⚡" to "这个概念与哪些其他学科存在意料之外的交叉与碰撞？",
            "❓" to "学术界最初是如何发现它的？背后有什么争议或思维迭代？",
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(12.dp))
        // 柔和光晕图标
        Box(
            modifier = Modifier
                .size(68.dp)
                .background(
                    Brush.radialGradient(
                        listOf(EditorialColor.aiAmber.copy(alpha = 0.28f), Color.Transparent),
                    ),
                    CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = AppIcons.Sparkles,
                contentDescription = null,
                tint = EditorialColor.aiAmber,
                modifier = Modifier.size(32.dp),
            )
        }
        Spacer(Modifier.height(14.dp))
        Text(
            text = "探讨《$headline》",
            color = Color.White,
            fontSize = 17.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Serif,
            lineHeight = 24.sp,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "知识卡片篇幅有限，而好奇心无限。\n选择下方启发性切入点，或直接在底部输入你的独特思考。",
            color = Color.White.copy(alpha = 0.65f),
            fontSize = 12.5.sp,
            lineHeight = 18.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Spacer(Modifier.height(28.dp))

        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "启发式追问 (Click to Ask)",
                color = Color.White.copy(alpha = 0.45f),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.height(10.dp))

        starters.forEach { (icon, text) ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 5.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color.White.copy(alpha = 0.05f))
                    .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(14.dp))
                    .clickable { onStarterClick(text) }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(icon, fontSize = 17.sp)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = text,
                        color = Color.White.copy(alpha = 0.9f),
                        fontSize = 13.sp,
                        fontFamily = FontFamily.Serif,
                        lineHeight = 19.sp,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Icon(
                        imageVector = AppIcons.ArrowUp,
                        contentDescription = null,
                        tint = EditorialColor.aiAmber.copy(alpha = 0.85f),
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

/** 消息瀑布流列表 */
@Composable
private fun ChatMessageList(
    messages: List<CardChatMessage>,
    onSpeak: (String) -> Unit,
    onCopy: (String) -> Unit,
) {
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size, messages.lastOrNull()?.content) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item { Spacer(Modifier.height(8.dp)) }
        items(messages, key = { it.id }) { msg ->
            ChatMessageBubble(
                message = msg,
                onSpeak = { onSpeak(msg.content) },
                onCopy = { onCopy(msg.content) },
            )
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

/** 单条消息气泡 */
@Composable
private fun ChatMessageBubble(
    message: CardChatMessage,
    onSpeak: () -> Unit,
    onCopy: () -> Unit,
) {
    val isUser = message.sender == MessageSender.USER

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Top,
    ) {
        if (!isUser) {
            // 导师头像
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .background(EditorialColor.aiAmber.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = AppIcons.Sparkles,
                    contentDescription = null,
                    tint = EditorialColor.aiAmber,
                    modifier = Modifier.size(14.dp),
                )
            }
            Spacer(Modifier.width(10.dp))
        }

        Column(
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
            modifier = Modifier.weight(1f, fill = false),
        ) {
            Text(
                text = if (isUser) "你" else "KnowFlick 伴学导师",
                color = Color.White.copy(alpha = 0.40f),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(bottom = 4.dp, start = if (isUser) 0.dp else 4.dp, end = if (isUser) 4.dp else 0.dp),
            )

            Box(
                modifier = Modifier
                    .clip(
                        RoundedCornerShape(
                            topStart = 16.dp,
                            topEnd = 16.dp,
                            bottomStart = if (isUser) 16.dp else 4.dp,
                            bottomEnd = if (isUser) 4.dp else 16.dp,
                        ),
                    )
                    .background(
                        if (isUser) EditorialColor.aiAmber.copy(alpha = 0.15f) else Color.White.copy(alpha = 0.06f),
                    )
                    .border(
                        1.dp,
                        if (isUser) EditorialColor.aiAmber.copy(alpha = 0.35f) else Color.White.copy(alpha = 0.12f),
                        RoundedCornerShape(
                            topStart = 16.dp,
                            topEnd = 16.dp,
                            bottomStart = if (isUser) 16.dp else 4.dp,
                            bottomEnd = if (isUser) 4.dp else 16.dp,
                        ),
                    )
                    .padding(horizontal = 14.dp, vertical = 11.dp),
            ) {
                Column {
                    if (message.content.isEmpty() && message.isStreaming) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "正在推演构思...",
                                color = Color.White.copy(alpha = 0.7f),
                                fontSize = 12.5.sp,
                            )
                            Spacer(Modifier.width(8.dp))
                            CircularProgressIndicator(
                                modifier = Modifier.size(12.dp),
                                color = EditorialColor.aiAmber,
                                strokeWidth = 1.5.dp,
                            )
                        }
                    } else {
                        Text(
                            text = message.content,
                            color = Color.White.copy(alpha = 0.95f),
                            fontSize = 14.sp,
                            lineHeight = 22.sp,
                            fontFamily = if (isUser) FontFamily.Default else FontFamily.Serif,
                        )
                    }

                    if (message.isStreaming && message.content.isNotEmpty()) {
                        Text(
                            "▋",
                            color = EditorialColor.aiAmber,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Black,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
            }

            // 助手回答工具栏（朗读 + 复制）
            if (!isUser && message.content.isNotEmpty() && !message.isStreaming) {
                Row(
                    modifier = Modifier.padding(top = 6.dp, start = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color.White.copy(alpha = 0.08f))
                            .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(12.dp))
                            .clickable(onClick = onSpeak)
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = AppIcons.VolumeUp,
                                contentDescription = null,
                                tint = Color.White.copy(alpha = 0.75f),
                                modifier = Modifier.size(12.dp),
                            )
                            Spacer(Modifier.width(4.dp))
                            Text("朗读此回答", color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp)
                        }
                    }

                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color.White.copy(alpha = 0.08f))
                            .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(12.dp))
                            .clickable(onClick = onCopy)
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = AppIcons.ContentCopy,
                                contentDescription = null,
                                tint = Color.White.copy(alpha = 0.75f),
                                modifier = Modifier.size(12.dp),
                            )
                            Spacer(Modifier.width(4.dp))
                            Text("复制", color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }
}

/** 底部输入栏 */
@Composable
private fun ChatInputBar(
    text: String,
    isStreaming: Boolean,
    onTextChanged: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .imePadding()
            .background(Color(0xFF141418))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Box(
            modifier = Modifier
                .weight(1f)
                .heightIn(min = 40.dp, max = 100.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Color.White.copy(alpha = 0.08f))
                .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(14.dp))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (text.isEmpty()) {
                Text(
                    text = "追问此知识点...",
                    color = Color.White.copy(alpha = 0.35f),
                    fontSize = 13.5.sp,
                )
            }
            BasicTextField(
                value = text,
                onValueChange = onTextChanged,
                textStyle = TextStyle(
                    color = Color.White,
                    fontSize = 13.5.sp,
                    lineHeight = 20.sp,
                    fontFamily = FontFamily.Serif,
                ),
                cursorBrush = SolidColor(EditorialColor.aiAmber),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(Modifier.width(10.dp))

        if (isStreaming) {
            // 终止按钮
            IconButton(
                onClick = onStop,
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(EditorialColor.dislikeRed.copy(alpha = 0.85f)),
            ) {
                Icon(
                    imageVector = AppIcons.Stop,
                    contentDescription = "停止生成",
                    tint = Color.White,
                    modifier = Modifier.size(16.dp),
                )
            }
        } else {
            // 发送按钮
            val canSend = text.trim().isNotEmpty()
            IconButton(
                onClick = onSend,
                enabled = canSend,
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(
                        if (canSend) EditorialColor.aiAmber else Color.White.copy(alpha = 0.12f),
                    ),
            ) {
                Icon(
                    imageVector = AppIcons.ArrowUp,
                    contentDescription = "发送追问",
                    tint = if (canSend) Color.White else Color.White.copy(alpha = 0.35f),
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

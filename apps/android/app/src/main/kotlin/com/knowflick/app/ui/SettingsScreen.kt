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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import kotlinx.coroutines.launch
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.ai.AiProviderPreset
import com.knowflick.app.ai.AiProviderPresets
import com.knowflick.app.ai.AiSettings

/**
 * 设置页：服务商预设（三分组）+ 端点/模型/密钥 + 连通测试 + 保存。
 * 外观与密度对齐全局编辑设计系统。
 */
@Composable
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
fun SettingsScreen(
    initial: AiSettings,
    initialApiKey: String,
    initialSpeech: com.knowflick.app.speech.SpeechSettings,
    initialSpeechKey: String,
    onBack: () -> Unit,
    onTestConnection: suspend (AiSettings, String) -> String,
    onSave: (AiSettings, String) -> Unit,
    onSaveSpeech: (com.knowflick.app.speech.SpeechSettings, String) -> Unit,
    isSavingSettings: Boolean,
    isSavingAiSettings: Boolean,
    isSavingSpeechSettings: Boolean,
    aiSaveNotice: String,
    aiSaveSucceeded: Boolean,
    speechSaveNotice: String,
    speechSaveSucceeded: Boolean,
    onClearAiSaveNotice: () -> Unit,
    onClearSpeechSaveNotice: () -> Unit,
    /** 凭据是否运行在 Keystore 加密存储上；false 表示已降级为明文存储，必须让用户知情 */
    credentialsEncrypted: Boolean = true,
    currentPaperTheme: PaperTheme = PaperTheme.SYSTEM,
    onSelectPaperTheme: (PaperTheme) -> Unit = {},
    soundEffectsEnabled: Boolean = true,
    onToggleSoundEffects: (Boolean) -> Unit = {},
) {
    androidx.activity.compose.BackHandler { onBack() }

    var providerId by rememberSaveable { mutableStateOf(initial.providerId) }
    var baseURL by rememberSaveable { mutableStateOf(initial.baseURL) }
    var model by rememberSaveable { mutableStateOf(initial.model) }
    var apiKey by rememberSaveable { mutableStateOf(initialApiKey) }
    // 连通性测试属于当前 Composition 的临时任务。旋转会取消旧协程，状态也必须复位，
    // 否则 rememberSaveable 会恢复 isTesting=true，让按钮永久停在“测试中”。
    var testStatus by remember { mutableStateOf("") }
    var isTesting by remember { mutableStateOf(false) }
    var speechChannel by rememberSaveable { mutableStateOf(initialSpeech.channel) }
    var speechBaseURL by rememberSaveable { mutableStateOf(initialSpeech.baseURL) }
    var speechModel by rememberSaveable { mutableStateOf(initialSpeech.model) }
    var speechVoice by rememberSaveable { mutableStateOf(initialSpeech.voice) }
    var speechKey by rememberSaveable { mutableStateOf(initialSpeechKey) }
    val isDarkTheme = MaterialTheme.colorScheme.background.luminance() < 0.35f
    val scope = rememberCoroutineScope()

    LaunchedEffect(providerId, baseURL, model, apiKey) { onClearAiSaveNotice() }
    LaunchedEffect(speechChannel, speechBaseURL, speechModel, speechVoice, speechKey) {
        onClearSpeechSaveNotice()
    }

    val currentPreset = AiProviderPresets.presets.firstOrNull { it.id == providerId } ?: AiProviderPresets.fallback()

    fun selectProvider(preset: AiProviderPreset) {
        providerId = preset.id
        if (preset.id != "custom") {
            baseURL = preset.defaultBaseURL
            if (!preset.models.contains(model)) model = preset.defaultModel
        }
        testStatus = ""
    }

    fun currentSettings(): AiSettings = initial.copy(providerId = providerId, baseURL = baseURL.trim(), model = model.trim())

    fun runTestConnection() {
        isTesting = true
        testStatus = "正在测试连接…"
        scope.launch {
            val result = onTestConnection(currentSettings(), apiKey)
            testStatus = result
            isTesting = false
        }
    }


    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .imePadding()
            .verticalScroll(rememberScrollState()),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = MaterialTheme.colorScheme.onBackground)
            }
            Text(
                "AI 服务设置",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
            )
        }

        Column(Modifier.padding(horizontal = 20.dp)) {
            // 凭据存储降级提示：Keystore 不可用时 SystemCredentialStore 会静默回退到普通
            // SharedPreferences，密钥将以明文落盘。这是「功能可用但安全姿态降级」，
            // 必须显式告知用户（与本仓库 SavedWithoutBackup 的显式上报取向一致）。
            if (!credentialsEncrypted) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(bottom = 14.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(EditorialColor.warningOrange.copy(alpha = 0.16f))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                ) {
                    Text(
                        "本机加密存储不可用，API Key 与语音密钥将以未加密方式保存在本机",
                        color = EditorialColor.warningOrange,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
            // 分组与预设
            for (group in listOf(AiProviderPresets.GROUP_ONLINE, AiProviderPresets.GROUP_LOCAL, AiProviderPresets.GROUP_CUSTOM)) {
                Text(
                    group,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(8.dp))
                androidx.compose.foundation.layout.FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    AiProviderPresets.presets.filter { it.group == group }.forEach { preset ->
                        val selected = preset.id == providerId
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(
                                    if (selected) EditorialColor.aiAmber.copy(alpha = 0.22f)
                                    else MaterialTheme.colorScheme.surface,
                                )
                                .border(
                                    1.dp,
                                    if (selected) EditorialColor.aiAmber.copy(alpha = 0.45f)
                                    else MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                                    RoundedCornerShape(8.dp),
                                )
                                .clickable { selectProvider(preset) }
                                .padding(horizontal = 10.dp, vertical = 7.dp),
                        ) {
                            Text(
                                preset.name,
                                color = if (selected) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f),
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
            }

            FieldRow(label = "Base URL", value = baseURL, onValueChange = { baseURL = it }, placeholder = "https://api.deepseek.com")
            FieldRow(label = "模型", value = model, onValueChange = { model = it }, placeholder = "deepseek-chat")
            FieldRow(
                label = if (currentPreset.requiresKey) "API Key" else "API Key（本组免密）",
                value = apiKey,
                onValueChange = { apiKey = it },
                placeholder = "sk-...",
                secret = true,
            )

            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surface)
                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                        .clickable(enabled = !isTesting) { runTestConnection() }
                        .padding(horizontal = 16.dp, vertical = 9.dp),
                ) {
                    if (isTesting) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                            Text("测试中…", color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f), fontSize = 12.sp)
                        }
                    } else {
                        Text("测试连通性", color = MaterialTheme.colorScheme.onBackground, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    }
                }
                Box(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (isDarkTheme) EditorialColor.likeGreenPastelDark else EditorialColor.likeGreenPastel)
                        .border(1.dp, if (isDarkTheme) EditorialColor.likeGreenBorderDark else EditorialColor.likeGreenBorder, RoundedCornerShape(10.dp))
                        .clickable(enabled = !isSavingSettings) {
                            onSave(currentSettings(), apiKey.trim())
                            testStatus = ""
                        }
                        .padding(horizontal = 18.dp, vertical = 9.dp),
                ) {
                    Text(
                        if (isSavingAiSettings) "保存中…" else "保存配置",
                        color = if (isDarkTheme) EditorialColor.likeGreen else Color(0xFF1E3A24),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }

            if (testStatus.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                val ok = testStatus.startsWith("连接成功")
                Text(
                    testStatus,
                    color = if (ok) EditorialColor.likeGreen else EditorialColor.dislikeRed,
                    fontSize = 12.sp,
                )
            }
            if (aiSaveNotice.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                val noticeColor = when {
                    isSavingAiSettings -> EditorialColor.aiAmber
                    aiSaveSucceeded -> EditorialColor.likeGreen
                    else -> EditorialColor.dislikeRed
                }
                Text(aiSaveNotice, color = noticeColor, fontSize = 12.sp)
            }
            if (currentPreset.id in AiProviderPresets.keylessIds && currentPreset.id != "custom") {
                Spacer(Modifier.height(6.dp))
                Text("该分组无需 API Key，应用只连接本机/局域网服务", color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f), fontSize = 11.sp)
            }

            Spacer(Modifier.height(26.dp))
            Text(
                "语音朗读",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(8.dp))
            androidx.compose.foundation.layout.FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(
                    com.knowflick.app.speech.SpeechChannel.SYSTEM to "系统语音",
                    com.knowflick.app.speech.SpeechChannel.CLOUD to "云端 /audio/speech",
                    com.knowflick.app.speech.SpeechChannel.LOCAL to "本地网关",
                ).forEach { (channel, label) ->
                    val selected = channel.name == speechChannel
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) EditorialColor.aiAmber.copy(alpha = 0.22f) else MaterialTheme.colorScheme.surface)
                            .border(
                                1.dp,
                                if (selected) EditorialColor.aiAmber.copy(alpha = 0.45f)
                                else MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                                RoundedCornerShape(8.dp),
                            )
                            .clickable { speechChannel = channel.name }
                            .padding(horizontal = 10.dp, vertical = 7.dp),
                    ) {
                        Text(label, color = if (selected) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f), fontSize = 12.sp)
                    }
                }
            }
            if (speechChannel != com.knowflick.app.speech.SpeechChannel.SYSTEM.name) {
                Spacer(Modifier.height(8.dp))
                FieldRow(label = "语音服务 Base URL", value = speechBaseURL, onValueChange = { speechBaseURL = it }, placeholder = if (speechChannel == "LOCAL") "http://127.0.0.1:8880" else "https://api.example.com")
                FieldRow(label = "语音模型", value = speechModel, onValueChange = { speechModel = it }, placeholder = "kokoro")
                FieldRow(label = "发音人 voice", value = speechVoice, onValueChange = { speechVoice = it }, placeholder = "zf_xiaobei")
                FieldRow(label = "语音 API Key", value = speechKey, onValueChange = { speechKey = it }, placeholder = "sk-...", secret = true)
            }
            Spacer(Modifier.height(10.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (isDarkTheme) EditorialColor.likeGreenPastelDark else EditorialColor.likeGreenPastel)
                    .border(1.dp, if (isDarkTheme) EditorialColor.likeGreenBorderDark else EditorialColor.likeGreenBorder, RoundedCornerShape(10.dp))
                    .clickable(enabled = !isSavingSettings) {
                        onSaveSpeech(
                            com.knowflick.app.speech.SpeechSettings(
                                channel = speechChannel,
                                baseURL = speechBaseURL.trim(),
                                model = speechModel.trim(),
                                voice = speechVoice.trim(),
                                speed = 1.0f,
                            ),
                            speechKey.trim(),
                        )
                    }
                    .padding(horizontal = 18.dp, vertical = 9.dp),
            ) {
                Text(
                    if (isSavingSpeechSettings) "保存中…" else "保存语音配置",
                    color = if (isDarkTheme) EditorialColor.likeGreen else Color(0xFF1E3A24),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            if (speechSaveNotice.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                val noticeColor = when {
                    isSavingSpeechSettings -> EditorialColor.aiAmber
                    speechSaveSucceeded -> EditorialColor.likeGreen
                    else -> EditorialColor.dislikeRed
                }
                Text(speechSaveNotice, color = noticeColor, fontSize = 12.sp)
            }
            Spacer(Modifier.height(24.dp))
            androidx.compose.material3.HorizontalDivider(
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                thickness = 1.dp,
            )
            Spacer(Modifier.height(16.dp))

            // 纸质人文视觉主题选择
            Text(
                "纸质人文视觉主题",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "精细调校的温润纸张底色与排版对比度，纯平微结构，拒绝单调刺眼",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                fontSize = 11.5.sp,
            )
            Spacer(Modifier.height(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PaperTheme.entries.forEach { theme ->
                    val isSelected = theme == currentPaperTheme
                    val previewBg = when (theme) {
                        PaperTheme.SYSTEM -> if (isDarkTheme) Color(0xFF121215) else Color(0xFFFAF9F6)
                        PaperTheme.RICE_PAPER -> Color(0xFFFAF9F6)
                        PaperTheme.PARCHMENT -> Color(0xFFF5EFE6)
                        PaperTheme.MORNING_MIST -> Color(0xFFEFF2F4)
                        PaperTheme.WARM_OBSIDIAN -> Color(0xFF121215)
                    }
                    val previewBorder = when (theme) {
                        PaperTheme.WARM_OBSIDIAN -> Color(0x33FFFFFF)
                        else -> Color(0x1F000000)
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(
                                if (isSelected) EditorialColor.aiAmber.copy(alpha = 0.12f)
                                else MaterialTheme.colorScheme.surface
                            )
                            .border(
                                1.dp,
                                if (isSelected) EditorialColor.aiAmber
                                else MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                                RoundedCornerShape(10.dp),
                            )
                            .clickable { onSelectPaperTheme(theme) }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(22.dp)
                                .clip(CircleShape)
                                .background(previewBg)
                                .border(1.dp, previewBorder, CircleShape)
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                theme.displayName,
                                color = if (isSelected) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground,
                                fontSize = 13.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                            )
                            Text(
                                theme.subtitle,
                                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                                fontSize = 11.sp,
                            )
                        }
                        if (isSelected) {
                            Text(
                                "✓ 当前生效",
                                color = EditorialColor.aiAmber,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(20.dp))
            androidx.compose.material3.HorizontalDivider(
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                thickness = 1.dp,
            )
            Spacer(Modifier.height(16.dp))

            // 拟真物理音效与触感
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "卡片拟真物理音效",
                        color = MaterialTheme.colorScheme.onBackground,
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Serif,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "划卡轻微纸张沙沙声与掌握清脆音（0 KB 纯程序合成，静音时自动静音）",
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                        fontSize = 11.sp,
                        lineHeight = 15.sp,
                    )
                }
                Spacer(Modifier.width(8.dp))
                androidx.compose.material3.Switch(
                    checked = soundEffectsEnabled,
                    onCheckedChange = onToggleSoundEffects,
                    colors = androidx.compose.material3.SwitchDefaults.colors(
                        checkedThumbColor = Color.White,
                        checkedTrackColor = EditorialColor.aiAmber,
                    ),
                )
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun FieldRow(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    secret: Boolean = false,
) {
    Column(Modifier.padding(vertical = 6.dp)) {
        Text(label, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f), fontSize = 11.sp)
        Spacer(Modifier.height(4.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = { Text(placeholder, fontSize = 13.sp, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.3f)) },
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 13.sp, color = MaterialTheme.colorScheme.onBackground),
            singleLine = true,
            visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = if (secret) KeyboardOptions(keyboardType = KeyboardType.Password) else KeyboardOptions.Default,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(8.dp),
        )
    }
}

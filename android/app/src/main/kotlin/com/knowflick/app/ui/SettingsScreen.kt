package com.knowflick.app.ui

import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import kotlinx.coroutines.launch
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
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
) {
    androidx.activity.compose.BackHandler { onBack() }

    var providerId by rememberSaveable { mutableStateOf(initial.providerId) }
    var baseURL by rememberSaveable { mutableStateOf(initial.baseURL) }
    var model by rememberSaveable { mutableStateOf(initial.model) }
    var apiKey by rememberSaveable { mutableStateOf(initialApiKey) }
    var testStatus by rememberSaveable { mutableStateOf("") }
    var isTesting by rememberSaveable { mutableStateOf(false) }
    var saveNotice by rememberSaveable { mutableStateOf("") }
    var speechChannel by rememberSaveable { mutableStateOf(initialSpeech.channel) }
    var speechBaseURL by rememberSaveable { mutableStateOf(initialSpeech.baseURL) }
    var speechModel by rememberSaveable { mutableStateOf(initialSpeech.model) }
    var speechVoice by rememberSaveable { mutableStateOf(initialSpeech.voice) }
    var speechKey by rememberSaveable { mutableStateOf(initialSpeechKey) }
    val scope = rememberCoroutineScope()

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
                "AI 服务设置",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
            )
        }

        Column(Modifier.padding(horizontal = 20.dp)) {
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
            )

            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surface)
                        .clickable(enabled = !isTesting) { runTestConnection() }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
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
                        .clip(RoundedCornerShape(8.dp))
                        .background(EditorialColor.likeGreen)
                        .clickable {
                            onSave(currentSettings(), apiKey.trim())
                            saveNotice = "已保存并生效 ✓"
                            testStatus = ""
                        }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Text("保存配置", color = androidx.compose.ui.graphics.Color(0xFF101210), fontSize = 12.sp, fontWeight = FontWeight.Bold)
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
            if (saveNotice.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(saveNotice, color = EditorialColor.likeGreen, fontSize = 12.sp)
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
                FieldRow(label = "语音 API Key", value = speechKey, onValueChange = { speechKey = it }, placeholder = "sk-...")
            }
            Spacer(Modifier.height(10.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .clickable {
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
                        saveNotice = "语音配置已保存 ✓"
                    }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text("保存语音配置", color = MaterialTheme.colorScheme.onBackground, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun FieldRow(label: String, value: String, onValueChange: (String) -> Unit, placeholder: String) {
    Column(Modifier.padding(vertical = 6.dp)) {
        Text(label, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f), fontSize = 11.sp)
        Spacer(Modifier.height(4.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = { Text(placeholder, fontSize = 13.sp, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.3f)) },
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 13.sp, color = MaterialTheme.colorScheme.onBackground),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(8.dp),
        )
    }
}

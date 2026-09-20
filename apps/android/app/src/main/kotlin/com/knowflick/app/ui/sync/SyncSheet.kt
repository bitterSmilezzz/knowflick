package com.knowflick.app.ui.sync

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.sync.RemoteDeviceInfo
import com.knowflick.app.sync.SyncClient
import com.knowflick.app.sync.SyncResult
import com.knowflick.app.ui.AppIcons
import com.knowflick.app.ui.EditorialColor
import com.knowflick.app.ui.common.AudioEffectHelper
import com.knowflick.app.ui.common.HapticFeedbackHelper
import kotlinx.coroutines.launch

/**
 * 局域网极速同步抽屉面板 (LAN P2P Sync Sheet)
 *
 * 提供零中转、零云端依赖的局域网端对端卡片数据与复习进度双向极速合并同步。
 */
@Composable
fun SyncSheet(
    isServerRunning: Boolean,
    serverPort: Int,
    localIp: String?,
    accessCode: String,
    onToggleServer: (Boolean) -> Unit,
    onExecuteSync: (target: String, onDone: (Result<SyncResult>) -> Unit) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current

    var targetIpInput by remember { mutableStateOf("") }
    var isDetecting by remember { mutableStateOf(false) }
    var detectedPeer by remember { mutableStateOf<RemoteDeviceInfo?>(null) }
    var isSyncing by remember { mutableStateOf(false) }
    var syncResult by remember { mutableStateOf<SyncResult?>(null) }
    var syncError by remember { mutableStateOf<String?>(null) }

    BackHandler(onBack = onClose)

    Box(
        modifier = modifier
            .fillMaxSize()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {},
            )
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.98f))
            .statusBarsPadding()
            .navigationBarsPadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 顶部下拉指示横条
            Box(
                modifier = Modifier
                    .size(width = 36.dp, height = 4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(MaterialTheme.colorScheme.onBackground.copy(alpha = 0.2f)),
            )

            Spacer(Modifier.height(12.dp))

            // 标题栏与关闭
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(EditorialColor.aiAmber.copy(alpha = 0.12f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = AppIcons.Sync,
                            contentDescription = null,
                            tint = EditorialColor.aiAmber,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(
                            text = "局域网极速同步",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Serif,
                            color = MaterialTheme.colorScheme.onBackground,
                        )
                        Text(
                            text = "LAN P2P 无感双向增量合并",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
                        )
                    }
                }

                IconButton(onClick = onClose) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "关闭",
                        tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                    )
                }
            }

            Spacer(Modifier.height(14.dp))

            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // 卡片 1：本机同步接收端
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(MaterialTheme.colorScheme.surface)
                        .border(1.dp, MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f), RoundedCornerShape(14.dp))
                        .padding(16.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column {
                                Text(
                                    text = "本机接收服务",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onBackground,
                                )
                                Text(
                                    text = if (isServerRunning) "服务已启动，等待其他设备连接" else "开启后其它设备可填入本机 IP 同步",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                                )
                            }
                            Switch(
                                checked = isServerRunning,
                                onCheckedChange = { checked ->
                                    HapticFeedbackHelper.click(context)
                                    onToggleServer(checked)
                                },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = Color.White,
                                    checkedTrackColor = EditorialColor.aiAmber,
                                ),
                            )
                        }

                        if (isServerRunning) {
                            val hostStr = if (localIp != null) "$localIp:$serverPort#$accessCode" else "127.0.0.1:$serverPort#$accessCode"
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(MaterialTheme.colorScheme.onBackground.copy(alpha = 0.04f))
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(8.dp)
                                            .clip(CircleShape)
                                            .background(Color(0xFF2E7D32)),
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        text = hostStr,
                                        fontSize = 12.sp,
                                        fontFamily = FontFamily.Monospace,
                                        fontWeight = FontWeight.Medium,
                                        color = MaterialTheme.colorScheme.onBackground,
                                    )
                                }

                                Row(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .clickable {
                                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                            clipboard.setPrimaryClip(ClipData.newPlainText("KnowFlick Sync Host", hostStr))
                                            HapticFeedbackHelper.tick(context)
                                            Toast.makeText(context, "已复制含配对码的同步地址", Toast.LENGTH_SHORT).show()
                                        }
                                        .padding(horizontal = 8.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(
                                        imageVector = AppIcons.ContentCopy,
                                        contentDescription = "复制",
                                        tint = EditorialColor.aiAmber,
                                        modifier = Modifier.size(14.dp),
                                    )
                                    Spacer(Modifier.width(4.dp))
                                    Text(
                                        text = "复制",
                                        fontSize = 12.sp,
                                        color = EditorialColor.aiAmber,
                                    )
                                }
                            }
                        }
                    }
                }

                // 卡片 2：连接其它设备
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(MaterialTheme.colorScheme.surface)
                        .border(1.dp, MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f), RoundedCornerShape(14.dp))
                        .padding(16.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text = "连接并同步对端",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onBackground,
                        )

                        OutlinedTextField(
                            value = targetIpInput,
                            onValueChange = { targetIpInput = it },
                            modifier = Modifier.fillMaxWidth(),
                            placeholder = {
                                Text(
                                    "填入完整地址，例如 192.168.1.102:8998#123456",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.4f),
                                )
                            },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Uri,
                                imeAction = ImeAction.Done,
                            ),
                            keyboardActions = KeyboardActions(
                                onDone = { focusManager.clearFocus() },
                            ),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = EditorialColor.aiAmber,
                                unfocusedBorderColor = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.15f),
                            ),
                            shape = RoundedCornerShape(10.dp),
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            OutlinedButton(
                                onClick = {
                                    focusManager.clearFocus()
                                    if (targetIpInput.isBlank()) {
                                        Toast.makeText(context, "请先填入对端设备的 IP 地址", Toast.LENGTH_SHORT).show()
                                        return@OutlinedButton
                                    }
                                    isDetecting = true
                                    detectedPeer = null
                                    syncError = null
                                    scope.launch {
                                        val res = SyncClient.fetchRemoteInfo(targetIpInput)
                                        isDetecting = false
                                        res.fold(
                                            onSuccess = { info ->
                                                detectedPeer = info
                                                HapticFeedbackHelper.tick(context)
                                            },
                                            onFailure = { err ->
                                                syncError = "探测对端失败：${err.message ?: "网络超时"}"
                                                HapticFeedbackHelper.warning(context)
                                            },
                                        )
                                    }
                                },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(10.dp),
                                enabled = !isDetecting && !isSyncing,
                            ) {
                                if (isDetecting) {
                                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                } else {
                                    Text("探测设备", fontSize = 13.sp)
                                }
                            }

                            Button(
                                onClick = {
                                    focusManager.clearFocus()
                                    if (targetIpInput.isBlank()) {
                                        Toast.makeText(context, "请先填入对端设备的 IP 地址", Toast.LENGTH_SHORT).show()
                                        return@Button
                                    }
                                    isSyncing = true
                                    syncResult = null
                                    syncError = null
                                    HapticFeedbackHelper.tick(context)
                                    onExecuteSync(targetIpInput) { res ->
                                        isSyncing = false
                                        res.fold(
                                            onSuccess = { result ->
                                                syncResult = result
                                                HapticFeedbackHelper.success(context)
                                                AudioEffectHelper.playMasteryChime(context)
                                            },
                                            onFailure = { err ->
                                                syncError = "同步失败：${err.message ?: "连接失败"}"
                                                HapticFeedbackHelper.warning(context)
                                            },
                                        )
                                    }
                                },
                                modifier = Modifier.weight(1.3f),
                                shape = RoundedCornerShape(10.dp),
                                enabled = !isSyncing && !isDetecting,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = EditorialColor.aiAmber,
                                    contentColor = Color.White,
                                ),
                            ) {
                                if (isSyncing) {
                                    CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                                } else {
                                    Text("开始双向极速同步", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }

                        // 探测对端结果反馈
                        detectedPeer?.let { info ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(EditorialColor.aiAmber.copy(alpha = 0.08f))
                                    .padding(12.dp),
                            ) {
                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(
                                        text = "已发现对端设备：${info.deviceName}",
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = MaterialTheme.colorScheme.onBackground,
                                    )
                                    Text(
                                        text = "包含卡片 ${info.cardCount} 张，收藏 ${info.favoriteCount} 张",
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                                    )
                                }
                            }
                        }

                        // 错误提示
                        syncError?.let { err ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFFE53935).copy(alpha = 0.08f))
                                    .padding(12.dp),
                            ) {
                                Text(
                                    text = err,
                                    fontSize = 12.sp,
                                    color = Color(0xFFE53935),
                                )
                            }
                        }

                        // 同步成功提示
                        syncResult?.let { res ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF2E7D32).copy(alpha = 0.08f))
                                    .padding(12.dp),
                            ) {
                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(
                                        text = "双向同步成功！✓",
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFF2E7D32),
                                    )
                                    Text(
                                        text = "向对端推送 ${res.pushedCount} 张，从对端拉取 ${res.pulledCount} 张（本机新增 ${res.addedCount} 张，更新学习进度 ${res.restoredCount} 张）",
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f),
                                    )
                                }
                            }
                        }
                    }
                }

                // 底部说明
                Text(
                    text = "提示：请确保两台设备接入同一局域网 Wi-Fi 或个人热点，并只把含 6 位配对码的完整地址交给可信设备。接收服务仅在你手动开启期间可用。",
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }
    }
}

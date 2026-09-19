package com.knowflick.app.ui.common

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback

/**
 * 分级触觉振动反馈助手：
 * 1. 优先使用 Android 10+ (API 29+) 原生 [VibrationEffect] 预设效果（Click、Tick、HeavyClick、DoubleClick）；
 * 2. 在较低版本或设备未配置高级线性马达时平滑回退至 Compose [HapticFeedback]；
 * 3. 分级定义：
 *    - tick: 手指初次拖拽或微小刻度感；
 *    - click: 划卡越过判定阈值（Threshold Crossed）；
 *    - success: 划归感兴趣 / 自评 GOOD 或 EASY 的正面触感；
 *    - warning: 划归略过 / 自评 AGAIN 的警示触感。
 */
class HapticFeedbackHelper(
    private val context: Context,
    private val composeHaptic: HapticFeedback? = null,
) {
    private val vibrator: Vibrator? = runCatching {
        context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }.getOrNull()

    /** 轻微刻度感（拖拽起始或微小位移） */
    fun tick() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && vibrator?.hasVibrator() == true) {
            runCatching {
                vibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
                return
            }
        }
        composeHaptic?.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }

    /** 确认触感（越过判定阈值） */
    fun click() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && vibrator?.hasVibrator() == true) {
            runCatching {
                vibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
                return
            }
        }
        composeHaptic?.performHapticFeedback(HapticFeedbackType.LongPress)
    }

    /** 成功与正面强化触感（加入收藏 / 复习达标 / GOOD / EASY） */
    fun success() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && vibrator?.hasVibrator() == true) {
            runCatching {
                vibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK))
                return
            }
        }
        composeHaptic?.performHapticFeedback(HapticFeedbackType.LongPress)
    }

    /** 略过与警示触感（略过 / 忘却重来 AGAIN） */
    fun warning() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && vibrator?.hasVibrator() == true) {
            runCatching {
                vibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK))
                return
            }
        }
        composeHaptic?.performHapticFeedback(HapticFeedbackType.LongPress)
    }
}

@Composable
fun rememberHapticFeedbackHelper(): HapticFeedbackHelper {
    val context = LocalContext.current
    val composeHaptic = LocalHapticFeedback.current
    return remember(context, composeHaptic) {
        HapticFeedbackHelper(context, composeHaptic)
    }
}

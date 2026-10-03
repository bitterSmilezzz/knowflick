package com.knowflick.app.sync

import com.knowflick.app.domain.CardJson

/**
 * 对端协议版本提示文案（docs/SYNC_PROTOCOL.md §2）：
 * - 缺字段（v1 旧端）→「对端版本较旧，建议两端升级」，不阻断同步；
 * - 高于本端支持的最高版本 →「对端版本更新」，不阻断同步；
 * - 其余（含相等）→ 无提示。
 * 纯函数便于单测；ViewModel 转发给同步结果 UI。
 */
fun syncVersionHint(
    peerProtocolVersion: Int?,
    localSupported: Int = CardJson.PROTOCOL_VERSION,
): String? = when {
    peerProtocolVersion == null -> "对端版本较旧，建议两端升级"
    peerProtocolVersion > localSupported -> "对端版本更新"
    else -> null
}

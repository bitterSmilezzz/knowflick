package com.knowflick.app.domain

import kotlinx.serialization.Serializable

/**
 * 同步删除墓碑（docs/SYNC_PROTOCOL.md §3/§4）：`{id, deletedAt(epoch ms)}`。
 * 线格式为普通 JSON 对象（数字时间戳），与 macOS 端逐字段对齐。
 * 本轮两端均无删除 UI，本地墓碑表只通过对端墓碑合并产生（协议预留）。
 */
@Serializable
data class Tombstone(val id: String, val deletedAt: Long)

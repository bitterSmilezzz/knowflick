package com.knowflick.app.ai

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * 增量对象扫描器：字节级状态机从流式累积 buffer 中提取顶层 JSON 对象。
 * 记录扫描位置，每个 delta 只扫新增字节（移植自 macOS IncrementalObjectScanner）。
 * JSON 结构字符与转义均为 ASCII，多字节 UTF-8 内容不会误触状态机。
 */
class AiObjectScanner {
    private var buffer: MutableList<Byte> = ArrayList()
    private var position = 0
    private var depth = 0
    private var inString = false
    private var escape = false
    private var start = 0
    private val found = ArrayList<JsonObject>()

    fun append(delta: String) {
        if (delta.isEmpty()) return
        buffer.addAll(delta.toByteArray(Charsets.UTF_8).asList())
        scan()
    }

    val objects: List<JsonObject> get() = found

    private fun scan() {
        while (position < buffer.size) {
            val byte = buffer[position]
            when {
                escape -> escape = false
                byte == BACKSLASH && inString -> escape = true
                byte == QUOTE -> inString = !inString
                !inString -> when (byte) {
                    BRACE_OPEN -> {
                        if (depth == 0) start = position
                        depth += 1
                    }
                    BRACE_CLOSE -> {
                        depth -= 1
                        if (depth == 0) {
                            val objData = buffer.subList(start, position + 1).toByteArray()
                            runCatching {
                                json.decodeFromString(JsonObject.serializer(), objData.decodeToString())
                            }.getOrNull()?.let { found.add(it) }
                        }
                    }
                }
            }
            position += 1
        }
    }

    private val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    companion object {
        private val QUOTE: Byte = '"'.code.toByte()
        private val BACKSLASH: Byte = '\\'.code.toByte()
        private val BRACE_OPEN: Byte = '{'.code.toByte()
        private val BRACE_CLOSE: Byte = '}'.code.toByte()
    }
}

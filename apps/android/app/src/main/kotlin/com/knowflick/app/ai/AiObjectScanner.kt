package com.knowflick.app.ai

import kotlinx.serialization.json.Json

/**
 * 增量对象扫描器：原生基本类型字节级状态机，从流式累积 buffer 中提取顶层 JSON 对象并直接解码。
 * 彻底消除 Byte 对象装箱开销与二次字符串重建。
 */
class AiObjectScanner {
    private var buffer = ByteArray(8192)
    private var size = 0
    private var position = 0
    private var depth = 0
    private var inString = false
    private var escape = false
    private var start = 0
    private val found = ArrayList<AiCardPayload>()

    fun append(delta: String) {
        if (delta.isEmpty()) return
        val bytes = delta.toByteArray(Charsets.UTF_8)
        ensureCapacity(size + bytes.size)
        System.arraycopy(bytes, 0, buffer, size, bytes.size)
        size += bytes.size
        scan()
    }

    val objects: List<AiCardPayload> get() = found

    private fun ensureCapacity(minCapacity: Int) {
        if (minCapacity <= buffer.size) return
        var newCap = buffer.size * 2
        if (newCap < minCapacity) newCap = minCapacity
        val newBuf = ByteArray(newCap)
        System.arraycopy(buffer, 0, newBuf, 0, size)
        buffer = newBuf
    }

    private fun scan() {
        while (position < size) {
            val byte = buffer[position]
            if (depth == 0) {
                if (byte == BRACE_OPEN) {
                    start = position
                    depth = 1
                }
            } else if (escape) {
                escape = false
            } else if (byte == BACKSLASH && inString) {
                escape = true
            } else if (byte == QUOTE) {
                inString = !inString
            } else if (!inString) {
                if (byte == BRACE_OPEN) {
                    depth += 1
                } else if (byte == BRACE_CLOSE) {
                    depth -= 1
                    if (depth == 0) {
                        inString = false
                        escape = false
                        val objStr = String(buffer, start, position - start + 1, Charsets.UTF_8)
                        runCatching {
                            json.decodeFromString(AiCardPayload.serializer(), objStr)
                        }.getOrNull()?.let { found.add(it) }
                    }
                }
            }
            position += 1
        }
    }

    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        private val QUOTE: Byte = '"'.code.toByte()
        private val BACKSLASH: Byte = '\\'.code.toByte()
        private val BRACE_OPEN: Byte = '{'.code.toByte()
        private val BRACE_CLOSE: Byte = '}'.code.toByte()
    }
}

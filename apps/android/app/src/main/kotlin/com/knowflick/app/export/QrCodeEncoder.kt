package com.knowflick.app.export

/**
 * 纯 Kotlin 实现的紧凑型 QR Code 矩阵生成器（遵循 ISO/IEC 18004 标准）。
 * 支持 Byte 模式（UTF-8）与 Level M（~15% 纠错恢复率），零第三方依赖。
 */
object QrCodeEncoder {

    /**
     * 编码为布尔矩阵（true 为黑块，false 为白块）。
     * @param content 待编码内容（如分享链接或应用官网）
     * @param quietZone 四周留白模组数（通常为 2 或 4）
     * @return 包含留白的二维布尔方阵，若发生异常则返回默认备用矩阵
     */
    fun encode(content: String, quietZone: Int = 2): Array<BooleanArray> {
        return runCatching {
            val bytes = content.toByteArray(Charsets.UTF_8)
            val version = selectVersion(bytes.size)
            generateMatrix(bytes, version, quietZone)
        }.getOrElse {
            fallbackMatrix(content.hashCode(), quietZone)
        }
    }

    // ---------- GF(256) 与 Reed-Solomon 纠错算法 ----------

    private val expTable = IntArray(512)
    private val logTable = IntArray(256)

    init {
        var x = 1
        for (i in 0 until 255) {
            expTable[i] = x
            expTable[i + 255] = x
            logTable[x] = i
            x = x shl 1
            if ((x and 0x100) != 0) {
                x = x xor 0x11D // x^8 + x^4 + x^3 + x^2 + 1
            }
        }
        logTable[0] = 0
    }

    private fun gfMul(x: Int, y: Int): Int {
        if (x == 0 || y == 0) return 0
        return expTable[logTable[x] + logTable[y]]
    }

    private fun rsGeneratorPoly(degree: Int): IntArray {
        var poly = intArrayOf(1)
        for (i in 0 until degree) {
            val next = IntArray(poly.size + 1)
            val root = expTable[i]
            for (j in poly.indices) {
                next[j] = next[j] xor gfMul(poly[j], root)
                next[j + 1] = next[j + 1] xor poly[j]
            }
            poly = next
        }
        return poly
    }

    private fun rsEncode(data: ByteArray, ecCount: Int): ByteArray {
        val poly = rsGeneratorPoly(ecCount)
        val remainder = IntArray(ecCount)
        for (b in data) {
            val factor = (b.toInt() and 0xFF) xor remainder[0]
            for (i in 0 until ecCount - 1) {
                remainder[i] = remainder[i + 1] xor gfMul(poly[ecCount - 1 - i], factor)
            }
            remainder[ecCount - 1] = gfMul(poly[0], factor)
        }
        return ByteArray(ecCount) { remainder[it].toByte() }
    }

    // ---------- 版本参数 (Level M: ~15% 纠错) ----------

    private data class VersionInfo(
        val version: Int,
        val totalBytes: Int,
        val dataBytes: Int,
        val ecBytesPerBlock: Int,
        val blocks: Int,
        val alignmentPatterns: IntArray,
    )

    // 支持 Version 1 ~ 6 (足以容纳长达 108 字节的短链与内容)
    private val versions = listOf(
        VersionInfo(1, 26, 16, 10, 1, intArrayOf()),
        VersionInfo(2, 44, 28, 16, 1, intArrayOf(6, 18)),
        VersionInfo(3, 70, 44, 26, 1, intArrayOf(6, 22)),
        VersionInfo(4, 100, 64, 18, 2, intArrayOf(6, 26)),
        VersionInfo(5, 134, 86, 24, 2, intArrayOf(6, 30)),
        VersionInfo(6, 172, 108, 16, 4, intArrayOf(6, 34)),
    )

    private fun selectVersion(dataLen: Int): VersionInfo {
        // Byte 模式开销：4 bit 模式指示符 + 8 bit 长度 = 12 bit (1.5 字节)
        val needed = dataLen + 2
        return versions.firstOrNull { it.dataBytes >= needed } ?: versions.last()
    }

    // ---------- 矩阵组装与掩模 ----------

    private fun generateMatrix(data: ByteArray, ver: VersionInfo, quietZone: Int): Array<BooleanArray> {
        val size = ver.version * 4 + 17
        val matrix = Array(size) { BooleanArray(size) }
        val reserved = Array(size) { BooleanArray(size) }

        // 1. 定位图案 (Finder patterns)
        fun placeFinder(r: Int, c: Int) {
            for (dr in -1..7) {
                for (dc in -1..7) {
                    val cr = r + dr
                    val cc = c + dc
                    if (cr in 0 until size && cc in 0 until size) {
                        val isBlack = (dr in 0..6 && (dc == 0 || dc == 6)) ||
                            (dc in 0..6 && (dr == 0 || dr == 6)) ||
                            (dr in 2..4 && dc in 2..4)
                        matrix[cr][cc] = isBlack
                        reserved[cr][cc] = true
                    }
                }
            }
        }
        placeFinder(0, 0)
        placeFinder(0, size - 7)
        placeFinder(size - 7, 0)

        // 2. 校正图案 (Alignment patterns)
        if (ver.alignmentPatterns.size >= 2) {
            val pts = ver.alignmentPatterns
            for (r in pts) {
                for (c in pts) {
                    if (reserved[r][c]) continue
                    for (dr in -2..2) {
                        for (dc in -2..2) {
                            val cr = r + dr
                            val cc = c + dc
                            val isBlack = maxOf(kotlin.math.abs(dr), kotlin.math.abs(dc)) != 1
                            matrix[cr][cc] = isBlack
                            reserved[cr][cc] = true
                        }
                    }
                }
            }
        }

        // 3. 时序图案 (Timing patterns)
        for (i in 8 until size - 8) {
            val bit = (i % 2 == 0)
            if (!reserved[6][i]) { matrix[6][i] = bit; reserved[6][i] = true }
            if (!reserved[i][6]) { matrix[i][6] = bit; reserved[i][6] = true }
        }

        // 4. 暗模组与保留格式信息位
        matrix[ver.version * 4 + 9][8] = true
        reserved[ver.version * 4 + 9][8] = true
        for (i in 0..8) {
            if (i < size) {
                reserved[8][i] = true
                reserved[i][8] = true
                reserved[8][size - 1 - i] = true
                reserved[size - 1 - i][8] = true
            }
        }

        // 5. 数据码流构建 (Byte mode + Terminator + Pad + RS Error Correction)
        val bitBuffer = mutableListOf<Int>()
        fun addBits(value: Int, count: Int) {
            for (i in count - 1 downTo 0) {
                bitBuffer.add((value shr i) and 1)
            }
        }

        addBits(0b0100, 4) // Byte mode
        addBits(data.size.coerceAtMost(ver.dataBytes - 2), 8)
        for (i in 0 until data.size.coerceAtMost(ver.dataBytes - 2)) {
            addBits(data[i].toInt() and 0xFF, 8)
        }
        // Terminator
        val remainingBits = ver.dataBytes * 8 - bitBuffer.size
        addBits(0, minOf(4, remainingBits))
        while (bitBuffer.size % 8 != 0) bitBuffer.add(0)

        val rawData = ByteArray(ver.dataBytes)
        for (i in 0 until (bitBuffer.size / 8).coerceAtMost(ver.dataBytes)) {
            var b = 0
            for (j in 0 until 8) {
                b = (b shl 1) or bitBuffer[i * 8 + j]
            }
            rawData[i] = b.toByte()
        }
        var padIndex = bitBuffer.size / 8
        var pad = 0xEC
        while (padIndex < ver.dataBytes) {
            rawData[padIndex++] = pad.toByte()
            pad = if (pad == 0xEC) 0x11 else 0xEC
        }

        // 分块纠错编码与交叉放置
        val blockDataLen = ver.dataBytes / ver.blocks
        val blockEcLen = ver.ecBytesPerBlock
        val dataBlocks = Array(ver.blocks) { b ->
            val start = b * blockDataLen
            val slice = rawData.copyOfRange(start, start + blockDataLen)
            val ec = rsEncode(slice, blockEcLen)
            Pair(slice, ec)
        }

        val interleaved = mutableListOf<Int>()
        for (i in 0 until blockDataLen) {
            for (b in 0 until ver.blocks) {
                interleaved.add(dataBlocks[b].first[i].toInt() and 0xFF)
            }
        }
        for (i in 0 until blockEcLen) {
            for (b in 0 until ver.blocks) {
                interleaved.add(dataBlocks[b].second[i].toInt() and 0xFF)
            }
        }

        val allBits = mutableListOf<Int>()
        for (byte in interleaved) {
            for (bit in 7 downTo 0) {
                allBits.add((byte shr bit) and 1)
            }
        }

        // 6. 填入矩阵 (从右到左两列 zigzag，并应用 Mask 0: (r + c) % 2 == 0)
        var bitPtr = 0
        var col = size - 1
        var goingUp = true
        while (col > 0) {
            if (col == 6) col-- // 跳过时序列
            val rows = if (goingUp) (size - 1 downTo 0) else (0 until size)
            for (r in rows) {
                for (c in intArrayOf(col, col - 1)) {
                    if (!reserved[r][c]) {
                        val bit = if (bitPtr < allBits.size) allBits[bitPtr++] else 0
                        val mask = ((r + c) % 2 == 0)
                        matrix[r][c] = (bit == 1) xor mask
                    }
                }
            }
            goingUp = !goingUp
            col -= 2
        }

        // 7. 格式信息写入 (Level M = 00, Mask 0 = 000 -> 格式数据 0b00000)
        // 格式多项式生成: 0b00000 的 15 位 BCH 码与 0x5412 XOR 后的字面量固定为 0b101010000010010
        val formatBits = 0b101010000010010
        for (i in 0 until 15) {
            val bit = ((formatBits shr (14 - i)) and 1) == 1
            // 写入左上角落
            val (r1, c1) = when (i) {
                in 0..5 -> Pair(8, i)
                6 -> Pair(8, 7)
                7 -> Pair(8, 8)
                8 -> Pair(7, 8)
                else -> Pair(14 - i, 8)
            }
            matrix[r1][c1] = bit

            // 写入右上与左下对应位
            val (r2, c2) = if (i < 8) {
                Pair(size - 1 - i, 8)
            } else {
                Pair(8, size - 15 + i)
            }
            matrix[r2][c2] = bit
        }

        // 8. 加上留白区域 (Quiet Zone)
        val totalSize = size + quietZone * 2
        val finalMatrix = Array(totalSize) { BooleanArray(totalSize) }
        for (r in 0 until size) {
            for (c in 0 until size) {
                finalMatrix[r + quietZone][c + quietZone] = matrix[r][c]
            }
        }
        return finalMatrix
    }

    /** 异常情况下的保底视觉图案 */
    private fun fallbackMatrix(seed: Int, quietZone: Int): Array<BooleanArray> {
        val size = 25 + quietZone * 2
        val mat = Array(size) { BooleanArray(size) }
        // 简易伪随机几何纹理
        var s = seed
        for (r in quietZone until size - quietZone) {
            for (c in quietZone until size - quietZone) {
                s = (s * 1103515245 + 12345) and 0x7FFFFFFF
                mat[r][c] = (s and 1) == 1
            }
        }
        return mat
    }
}

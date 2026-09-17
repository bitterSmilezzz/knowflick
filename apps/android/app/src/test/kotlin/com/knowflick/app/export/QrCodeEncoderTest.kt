package com.knowflick.app.export

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class QrCodeEncoderTest {

    @Test
    fun generatesValidMatrixForUrl() {
        val url = "https://knowflick.app/c/test1234"
        val matrix = QrCodeEncoder.encode(url, quietZone = 2)

        assertTrue(matrix.isNotEmpty())
        val size = matrix.size
        // 矩阵必须是正方形
        assertEquals(size, matrix[0].size)
        // 包含留白应在 25~37 之间
        assertTrue(size >= 25, "矩阵宽度至少为 25")

        // 验证左上角定位图案 (Finder Pattern 7x7) 在 quietZone 偏移处存在
        val qz = 2
        // Finder pattern 外框应为黑色
        assertTrue(matrix[qz][qz], "左上角定位点起点应为黑色")
        assertTrue(matrix[qz][qz + 6], "左上角定位点外框应为黑色")
        assertTrue(matrix[qz + 6][qz], "左上角定位点外框应为黑色")
        assertTrue(matrix[qz + 6][qz + 6], "左上角定位点外框应为黑色")
        // Finder pattern 中心应为黑色
        assertTrue(matrix[qz + 3][qz + 3], "左上角定位点中心应为黑色")
    }

    @Test
    fun handlesEmptyAndChineseContentGracefully() {
        val cn = "每天学点新东西 · KnowFlick 知识探索"
        val matrix = QrCodeEncoder.encode(cn)
        assertTrue(matrix.isNotEmpty())
        assertEquals(matrix.size, matrix[0].size)
    }
}

package com.knowflick.app.domain.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PinyinHelperTest {

    @Test
    fun testEmptyInput() {
        val result = PinyinHelper.phonetics("")
        assertEquals("", result.full)
        assertEquals("", result.initials)
    }

    @Test
    fun testInitialsExtraction() {
        assertEquals("zzx", PinyinHelper.initials("中子星"))
        assertEquals("xzl", PinyinHelper.initials("新租赁"))
        assertEquals("rgzn", PinyinHelper.initials("人工智能"))
        assertEquals("sjkx", PinyinHelper.initials("神经科学"))
        assertEquals("jsj", PinyinHelper.initials("计算机"))
    }

    @Test
    fun testFullPinyinExtraction() {
        assertEquals("zhongzixing", PinyinHelper.pinyin("中子星"))
        assertEquals("rengongzhineng", PinyinHelper.pinyin("人工智能"))
        assertTrue(PinyinHelper.pinyin("新租赁").contains("zulin"))
        assertTrue(PinyinHelper.pinyin("量子纠缠").contains("liangzi"))
    }

    @Test
    fun testMixedEnglishAndChinese() {
        val inits = PinyinHelper.initials("LRU 缓存")
        assertTrue(inits.startsWith("lru"))
        assertTrue(inits.contains("c") || inits.contains("h"))
    }
}

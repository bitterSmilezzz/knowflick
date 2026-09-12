package com.knowflick.app.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CategoryRegistryTest {

    @Test
    fun exactAliasesResolveOnlyWhenTargetExists() {
        assertEquals("AI", CategoryRegistry.resolve("ai", custom = listOf("AI")))
        // 内置白名单只有「冷知识」：别名目标不存在于用户分类时返回 nil（偏好解析剔除而非兜底）
        assertNull(CategoryRegistry.resolve("神经科学", custom = emptyList()))
        assertEquals("脑科学", CategoryRegistry.resolve("神经科学", custom = listOf("脑科学")))
        assertNull(CategoryRegistry.resolve("rust", custom = emptyList()))
        assertNull(CategoryRegistry.resolve("rust", custom = listOf("编程")))
    }

    @Test
    fun customCategoryNamesTakePrecedence() {
        assertEquals("我的笔记", CategoryRegistry.resolve("我的笔记", custom = listOf("我的笔记")))
        // 精确别名命中自定义名
        assertEquals("AI Agent", CategoryRegistry.resolve("agent", custom = listOf("AI Agent")))
    }

    @Test
    fun inclusiveAliasesMatchByContainment() {
        assertEquals("中级会计", CategoryRegistry.resolve("中级会计实务", custom = listOf("中级会计")))
        assertEquals("投资理财", CategoryRegistry.resolve("基金定投策略", custom = listOf("投资理财")))
        assertNull(CategoryRegistry.resolve("医学影像", custom = emptyList()))
    }

    @Test
    fun exactHitDoesNotFallThroughToInclusive() {
        // Swift 语义：精确别名命中但目标不在白名单 → 直接 null，不尝试包含匹配。
        // "ai" 精确命中 "AI"（无效）→ null；"ai 学习" 无精确命中 → 走包含匹配。
        assertNull(CategoryRegistry.resolve("ai", custom = listOf("学习方法")))
        assertEquals("学习方法", CategoryRegistry.resolve("ai 学习", custom = listOf("学习方法")))
    }

    @Test
    fun normalizeFallsBackForUnknownInput() {
        assertEquals("冷知识", CategoryRegistry.normalize("未知分类xyz", custom = emptyList()))
        assertEquals("AI 开发", CategoryRegistry.normalize("未知分类xyz", custom = listOf("AI 开发")))
        // "物理学" 的包含别名目标「物理」不在白名单 → 兜底
        assertEquals("冷知识", CategoryRegistry.normalize("物理学", custom = emptyList()))
        assertEquals("物理", CategoryRegistry.normalize("物理学", custom = listOf("物理")))
    }

    @Test
    fun allNamesStartWithBuiltin() {
        assertEquals(listOf("冷知识", "AI", "历史"), CategoryRegistry.allNames(listOf("AI", "历史")))
    }
}

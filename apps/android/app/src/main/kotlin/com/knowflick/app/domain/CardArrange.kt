package com.knowflick.app.domain

/**
 * 卡堆「严格防重排布」算法：与 macOS `CardThemeResolver.arrangeWithMinDistance` 对齐。
 * 1. 按确定性盐值哈希全局打散；2. 贪心选卡保证同 key 间隔 ≥ minDistance；
 * 3. 无可达候选时取「距上次出现最远」者；4. avoidingTopKey 避免首张撞上一次顶卡。
 *
 * keyBy 由调用方注入（Android 端先以确定性哈希映射 42 图池，语义关键词映射在主题里程碑对齐）。
 */
object CardArrange {
    private const val SALT = "_knowflick_salt_v4"

    /** 64-bit FNV-1a 确定性哈希（与 macOS 端一致，不依赖运行时 hashValue 随机种子） */
    fun deterministicHash(text: String): Long {
        var hash = -0x340d631b7bdddcdbL // 14695981039346656037 的无符号常量的有符号表示
        for (byte in text.toByteArray(Charsets.UTF_8)) {
            hash = hash xor (byte.toLong() and 0xFF)
            hash *= 0x100000001b3L
        }
        return hash
    }

    /** Android 端默认 key：分类 + 标题哈希 → 42 图池（后续里程碑替换为语义关键词映射） */
    fun defaultKeyFor(card: KnowledgeCard): String {
        val index = ((deterministicHash(card.category + "|" + card.headline) % 42) + 42) % 42
        return "bg$index"
    }

    fun arrange(
        cards: List<KnowledgeCard>,
        minDistance: Int = 5,
        avoidingTopKey: String? = null,
        keyFor: (KnowledgeCard) -> String = ::defaultKeyFor,
    ): List<KnowledgeCard> {
        if (cards.size <= 1) return cards

        val remaining = cards.sortedBy { deterministicHash(it.headline + SALT) }.toMutableList()
        val result = ArrayList<KnowledgeCard>(remaining.size)
        val lastSeenPos = HashMap<String, Int>()
        if (avoidingTopKey != null) lastSeenPos[avoidingTopKey] = -1

        var currentIndex = 0
        while (remaining.isNotEmpty()) {
            var bestCandidateIdx = 0
            var maxDist = Int.MIN_VALUE

            for ((i, card) in remaining.withIndex()) {
                val key = keyFor(card)
                val lastPos = lastSeenPos[key] ?: -999999
                val dist = currentIndex - lastPos
                if (dist >= minDistance) {
                    bestCandidateIdx = i
                    break
                }
                if (dist > maxDist) {
                    maxDist = dist
                    bestCandidateIdx = i
                }
            }

            // swap-remove：O(1) 摘除（与 macOS 优化一致）；扫描顺序扰动不影响正确性
            val chosen = remaining[bestCandidateIdx]
            val last = remaining.removeAt(remaining.size - 1)
            if (bestCandidateIdx != remaining.size) {
                remaining[bestCandidateIdx] = last
            }
            result.add(chosen)
            lastSeenPos[keyFor(chosen)] = currentIndex
            currentIndex += 1
        }
        return result
    }
}

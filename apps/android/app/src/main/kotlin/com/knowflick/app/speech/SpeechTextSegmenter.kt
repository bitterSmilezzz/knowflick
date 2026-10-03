package com.knowflick.app.speech

/**
 * 系统 TTS 朗读文本分段器（纯函数，便于 JVM 测试）。
 *
 * 系统音色单次 speak() 有硬上限（TextToSpeech.getMaxSpeechInputLength() ≈ 4000 字符），
 * 超限部分被引擎静默截断。这里按句末标点贪心切分为不超过上限的朗读段：
 * 能按句切就按句切，单句超限才在句内硬切，且切点不得落在代理对（emoji 等）中间。
 */
internal object SpeechTextSegmenter {

    private const val MAX_LENGTH_MUST_BE_POSITIVE = "maxLength 必须为正"

    /** 句末标点集合：贪心分段在这些字符后收束（audit 口径：。！？!?.；;\n） */
    private val sentenceEnders = charArrayOf('。', '！', '？', '!', '?', '.', '；', ';', '\n')

    /**
     * 把 [text] 切分为每段不超过 [maxLength] 的朗读段。
     * 各段拼接与原文逐字符一致（不丢字、不改字）；空文本返回空列表。
     */
    fun segment(text: String, maxLength: Int): List<String> {
        require(maxLength > 0) { MAX_LENGTH_MUST_BE_POSITIVE }
        if (text.isEmpty()) return emptyList()
        if (text.length <= maxLength) return listOf(text)

        val segments = mutableListOf<String>()
        var current = StringBuilder()

        for (sentence in splitSentences(text)) {
            when {
                sentence.length > maxLength -> {
                    // 单句超限：先冲刷已积累的段，再对这句做代理对安全的硬切
                    if (current.isNotEmpty()) {
                        segments += current.toString()
                        current = StringBuilder()
                    }
                    var from = 0
                    while (from < sentence.length) {
                        val end = hardCutEnd(sentence, from, maxLength)
                        segments += sentence.substring(from, end)
                        from = end
                    }
                }
                current.length + sentence.length > maxLength -> {
                    segments += current.toString()
                    current = StringBuilder(sentence)
                }
                else -> current.append(sentence)
            }
        }
        if (current.isNotEmpty()) segments += current.toString()
        return segments
    }

    /**
     * 把 resume 的字符起点回退到码位（code point）边界：
     * 落在低代理上说明劈开了代理对，退到高代理之前；其余原样返回。
     */
    fun snapBackToCodePointStart(text: String, index: Int): Int {
        if (index <= 0 || index >= text.length) return index
        if (Character.isLowSurrogate(text[index])) return index - 1
        return index
    }

    /** 按句末标点贪心切句：每个标点收束一句，末尾无标点的剩余文本自成一句 */
    private fun splitSentences(text: String): List<String> {
        val sentences = mutableListOf<String>()
        val start = StringBuilder()
        for (ch in text) {
            start.append(ch)
            if (ch in sentenceEnders) {
                sentences += start.toString()
                start.clear()
            }
        }
        if (start.isNotEmpty()) sentences += start.toString()
        return sentences
    }

    /** [from] 之后的硬切终点：优先 from + maxLength，落在低代理上则回退一格保住代理对 */
    private fun hardCutEnd(text: String, from: Int, maxLength: Int): Int {
        var end = from + maxLength
        if (end >= text.length) return text.length
        if (Character.isLowSurrogate(text[end])) end--
        return end.coerceAtLeast(from + 1)
    }
}

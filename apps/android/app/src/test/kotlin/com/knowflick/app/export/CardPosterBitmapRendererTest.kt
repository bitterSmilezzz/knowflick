package com.knowflick.app.export

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

@RunWith(RobolectricTestRunner::class)
class CardPosterBitmapRendererTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    private val testCard = KnowledgeCard.create(
        category = "AI 开发",
        headline = "提示工程第一课：任务、约束、示例",
        summary = "把模糊的需求拆解为清晰的约束条件，是提示词工程的核心能力。",
        details = "很多开发者误以为写 prompt 就是写自然语言闲聊，实际上高质量的 prompt 需要严格的任务边界定义、上下文约束以及 Few-Shot 示例引导。",
        source = CardSource.SEED,
    )

    @Test
    fun rendersEditorialPosterWithCorrectDimensions() {
        val bitmap = CardPosterBitmapRenderer.render(context, testCard, CardPosterStyle.EDITORIAL)
        assertNotNull(bitmap)
        assertEquals(CardPosterStyle.EDITORIAL.width, bitmap.width)
        assertEquals(CardPosterStyle.EDITORIAL.height, bitmap.height)
    }

    @Test
    fun rendersPolaroidPosterWithCorrectDimensions() {
        val bitmap = CardPosterBitmapRenderer.render(context, testCard, CardPosterStyle.POLAROID)
        assertNotNull(bitmap)
        assertEquals(CardPosterStyle.POLAROID.width, bitmap.width)
        assertEquals(CardPosterStyle.POLAROID.height, bitmap.height)
    }

    @Test
    fun generatesShareIntentSuccessfully() {
        val bitmap = CardPosterBitmapRenderer.render(context, testCard, CardPosterStyle.EDITORIAL)
        val chooser = PosterExportManager.createShareIntent(context, bitmap, testCard)
        assertNotNull(chooser)
    }
}

package com.knowflick.app.export

import android.content.Context
import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
class PosterExportManagerTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    private val testCard = KnowledgeCard.create(
        category = "冷知识",
        headline = "中子星上一茶匙物质，重达数十亿吨",
        summary = "宇宙极致致密天体，挑战人类常识认知。",
        details = "中子星物质密度堪比原子核，任何探测器都无法登陆。",
        source = CardSource.SEED,
    )

    @Test
    fun createShareIntentGeneratesReadableFile() {
        val bitmap = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888)
        val chooser = PosterExportManager.createShareIntent(context, bitmap, testCard)

        assertNotNull(chooser)
        val shareDir = File(context.cacheDir, "shares")
        assertTrue(shareDir.exists())
        val files = shareDir.listFiles()
        assertTrue(files != null && files.isNotEmpty())
    }

    @Test
    fun copyCardTextSucceeds() {
        PosterExportManager.copyCardText(context, testCard)
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val clip = clipboard.primaryClip
        assertNotNull(clip)
        val text = clip.getItemAt(0).text.toString()
        assertTrue(text.contains("中子星上一茶匙物质"))
        assertTrue(text.contains("KnowFlick"))
    }
}

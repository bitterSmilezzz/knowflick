package com.knowflick.app.data

import com.knowflick.app.domain.CardJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「工作台导出 → 安卓导入」的真实路径。
 *
 * ADR-0002 §3 说「拷过去就能打开，中间不经转换」。这以前只有**编码往返**的测试
 * （把同一份数据在安卓端读了再写），没有实测「对端真正产出的字节喂进来」。
 * 下面这份 JSON 就是 workbench 的 read_cards_json_text 打印出来的**真实输出**，
 * 含 intervalDays 的 double 形式与全部 camelCase 键。
 */
class WorkbenchExportImportTest {

    private val workbenchExport = """
        [{"id":"probe-1","materialId":null,"category":"\u6570\u5b66","headline":"\u6807\u9898","summary":"\u6458\u8981","details":"\u6b63\u6587","links":[],"tags":["tag1"],"source":"imported","createdAt":1759000000000,"editedAt":null,"seenAt":null,"swiped":null,"isFavorite":false,"favoritedAt":null,"reviewCount":0,"masteryLevel":0,"lastReviewedAt":null,"repetition":0,"intervalDays":0.0,"easeFactor":2.5,"stability":0.0,"difficulty":0.0,"subject":null,"branch":null,"level":null,"track":null,"orderKey":null,"prereq":[]}]
    """.trimIndent()

    @Test
    fun workbenchExportImportsIntoAndroid() {
        val cards = CardFileIO.decodeListSalvaging(workbenchExport)
        assertEquals("\u5bfc\u5165\u540e\u5e94\u6709\u4e00\u5f20\u5361", 1, cards.size)
        val card = cards.first()
        assertEquals("probe-1", card.id)
        assertEquals("\u6807\u9898", card.headline)
        assertEquals("\u6b63\u6587", card.details)
        assertEquals("\u6570\u5b66", card.category)
        assertEquals(1759000000000L, card.createdAt)
    }

    @Test
    fun intervalDaysIsNotSilentlyRewrittenAcrossEnds() {
        // \u684c\u9762\u7aef intervalDays \u662f f64\uff08\u5bfc\u51fa 0.0\uff09\uff0c\u5b89\u5353\u7aef\u662f Int\u3002
        // \u82e5\u89e3\u6790\u5668\u62d2\u7edd double \u6216\u9759\u9ed8\u515c\u5e95\u6210 1 \u5929\uff0c\u7528\u6237\u5728\u4e24\u7aef\u4e4b\u95f4\u5f80\u8fd4\u65f6
        // \u590d\u4e60\u8fdb\u5ea6\u4f1a\u88ab\u6084\u6084\u6539\u5199\u2014\u2014\u8fd9\u6b63\u662f \u00a73\u300c\u5230\u671f\u4e0d\u53d8\u300d\u8981\u9632\u7684\u4e8b\u3002
        val cards = CardFileIO.decodeListSalvaging(workbenchExport)
        assertEquals(1, cards.size)
        assertEquals("intervalDays should stay 0, not silently become 1", 0, cards.first().intervalDays)
    }

    @Test
    fun roundTripFromWorkbenchKeepsTheCard() {
        val cards = CardFileIO.decodeListSalvaging(workbenchExport)
        val again = CardFileIO.decodeListSalvaging(CardJson.encodeList(cards))
        assertEquals(1, again.size)
        assertEquals(cards.first().id, again.first().id)
        assertEquals(cards.first().headline, again.first().headline)
        assertEquals(cards.first().intervalDays, again.first().intervalDays)
        assertTrue("headline must survive", again.first().headline.isNotEmpty())
    }
}

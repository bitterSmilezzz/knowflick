package com.knowflick.app.sync

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.CardStore
import com.knowflick.app.domain.CardJson
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.SwipeDirection
import com.knowflick.app.domain.Tombstone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 双端标准夹具（docs/SYNC_PROTOCOL.md §7）：JSON 字符串与规格逐字节相同，
 * 测试名含 F1/F2/F3/F4 便于跨端（mac/Windows）对照。单卡线格式以两端既有
 * KnowledgeCard 编码为权威，本文件只断言解码语义。
 */
class SyncProtocolFixtureTest {

    /** §7 F1 v2 信封（逐字节） */
    private val f1Envelope = """{"protocolVersion":2,"cards":[{"id":"f1","headline":"测试卡","summary":"摘要","details":"正文","category":"冷知识","source":"seed","links":[],"createdAt":1727900000000,"seenAt":null,"swiped":null,"isFavorite":false}],"tombstones":[{"id":"dead","deletedAt":1727900001000}]}"""

    /** §7 F2 v1 裸列表（逐字节，单卡与 F1 相同） */
    private val f2BareList = """[{"id":"f1","headline":"测试卡","summary":"摘要","details":"正文","category":"冷知识","source":"seed","links":[],"createdAt":1727900000000,"seenAt":null,"swiped":null,"isFavorite":false}]"""

    @Test
    fun F1_decodesV2EnvelopeFixture() {
        val envelope = CardJson.decodeEnvelope(f1Envelope)

        assertEquals(2, envelope.protocolVersion)
        assertEquals(listOf("f1"), envelope.cards.map { it.id })
        val card = envelope.cards.single()
        assertEquals("测试卡", card.headline)
        assertEquals("摘要", card.summary)
        assertEquals("正文", card.details)
        assertEquals("冷知识", card.category)
        assertEquals(CardSource.SEED, card.source)
        assertEquals(emptyList(), card.links)
        assertEquals(1_727_900_000_000L, card.createdAt)
        assertNull(card.seenAt)
        assertNull(card.swiped)
        assertEquals(false, card.isFavorite)
        // 墓碑表随信封上浮
        assertEquals(listOf(Tombstone("dead", 1_727_900_001_000L)), envelope.tombstones)
    }

    @Test
    fun F2_decodesV1BareListFixture() {
        val envelope = CardJson.decodeEnvelope(f2BareList)

        assertNull(envelope.protocolVersion, "v1 裸列表无版本字段")
        assertEquals(emptyList(), envelope.tombstones)
        // 单卡解码结果与 F1 信封里的卡片完全一致（线格式不变承诺）
        assertEquals(CardJson.decodeEnvelope(f1Envelope).cards, envelope.cards)
    }

    /** §7 F3：墓碑抵抗（卡片时间戳取 editedAt 优先、否则 createdAt——夹具卡无 editedAt） */
    @Test
    fun F3_tombstoneResistanceFixtures() {
        val oldCard = fixtureCard(createdAt = 1_727_900_000_000L)   // 早于墓碑
        val newCard = fixtureCard(createdAt = 1_727_900_002_000L)   // 晚于墓碑
        // F3 语义对：卡片与墓碑同 id（deletedAt=1727900001000）
        val tombstone = Tombstone("f1", 1_727_900_001_000L)

        // 规则 2：本地墓碑 deletedAt ≥ 卡片时间戳 → 拒收（不复活）
        val resisting = CardStore(seedCards = emptyList())
        resisting.loadTombstones(listOf(tombstone))
        val resisted = resisting.restoreSyncPayload(listOf(oldCard), emptyList())
        assertTrue(resisting.cards.isEmpty(), "createdAt=1727900000000 遇墓碑 1727900001000 → 拒收")
        assertEquals(0, resisted.added)
        assertEquals(1, resisted.ignored)
        assertEquals(listOf(tombstone), resisting.tombstones, "抵抗后墓碑保留")

        // 规则 2 复活分支：卡片时间戳 > deletedAt → 复活合并
        val reviving = CardStore(seedCards = emptyList())
        reviving.loadTombstones(listOf(tombstone))
        val revived = reviving.restoreSyncPayload(listOf(newCard), emptyList())
        assertEquals(listOf(newCard), reviving.cards, "createdAt=1727900002000 → 复活合并")
        assertEquals(1, revived.added)
        assertEquals(emptyList(), reviving.tombstones, "复活后清除同 id 墓碑")

        // 规则 1 对偶：收到墓碑时本地旧卡被删、新卡保留
        val deleting = CardStore(seedCards = emptyList())
        deleting.replaceAll(listOf(oldCard))
        val deleted = deleting.restoreSyncPayload(emptyList(), listOf(tombstone))
        assertTrue(deleting.cards.isEmpty())
        assertEquals(1, deleted.deleted)
        assertEquals(listOf(tombstone), deleting.tombstones)

        val keeping = CardStore(seedCards = emptyList())
        keeping.replaceAll(listOf(newCard))
        val kept = keeping.restoreSyncPayload(emptyList(), listOf(tombstone))
        assertEquals(listOf(newCard), keeping.cards, "卡片比对端墓碑更新 → 保留")
        assertEquals(0, kept.deleted)
        assertEquals(emptyList(), keeping.tombstones, "未触发删除不得记墓碑")
    }

    /** §4.5：本地不存在的 id 收到墓碑也照记（防已删卡经第三方副本回流后再次灌入） */
    @Test
    fun tombstoneForUnknownIdIsStillRecorded() {
        val store = CardStore(seedCards = emptyList())
        val tombstone = Tombstone("dead", 1_727_900_001_000L)

        val result = store.restoreSyncPayload(emptyList(), listOf(tombstone))
        assertEquals(0, result.deleted)
        assertEquals(listOf(tombstone), store.tombstones, "未知 id 墓碑记入表")

        // 回流抵抗：同 id 旧卡此后到达（时间戳 ≤ deletedAt）→ 拒收
        val flowedBack = fixtureCard(id = "dead", headline = "第三方回流的已删卡", createdAt = 1_727_900_000_000L)
        val resisted = store.restoreSyncPayload(listOf(flowedBack), emptyList())
        assertEquals(0, resisted.added)
        assertTrue(store.cards.isEmpty(), "被墓碑抵抗，不复活")
    }

    /** §7 F4：details 冲突（双方有 editedAt 取新者；任一缺失沿用「较长者」） */
    @Test
    fun F4_detailsConflictFixture() {
        val a = detailsCard(details = "短", editedAt = 2_000L)
        val b = detailsCard(details = "更长的正文内容", editedAt = 1_000L)

        val merged = CardStore.mergeCard(a, b)
        assertEquals("短", merged.details, "A{短, editedAt:2000} × B{更长, editedAt:1000} → 取 A")
        assertEquals(merged, CardStore.mergeCard(b, a), "合并必须对称")

        // B 无 editedAt → 沿用旧规则（较长者）
        val bWithoutStamp = detailsCard(details = "更长的正文内容")
        assertEquals("更长的正文内容", CardStore.mergeCard(a, bWithoutStamp).details)
        assertEquals("更长的正文内容", CardStore.mergeCard(bWithoutStamp, a).details)
    }

    /**
     * 墓碑交换律（§4 对称语义）：A 给 B 的墓碑+卡片 与 B 给 A 的对称场景结果一致。
     * B 在 t=2000 删除了 x（持墓碑），A 仍持有 x 旧版（t=1000）；B 另有 y。
     * 无论先 A→B 还是先 B→A，双向载荷交换后两端终态必须完全一致。
     */
    @Test
    fun tombstoneExchangeIsCommutativeAcrossBothDirections() {
        val cardX = fixtureCard(id = "x", headline = "将被删除的卡", createdAt = 1_727_900_000_000L)
        val cardY = fixtureCard(id = "y", headline = "B 独有的卡", createdAt = 1_727_900_002_000L)
        val tombX = Tombstone("x", 1_727_900_001_000L)

        // 场景 1：先 A→B（A 推卡片），后 B→A（B 推墓碑+卡片）
        val a1 = CardStore(seedCards = emptyList()).also { it.replaceAll(listOf(cardX)) }
        val b1 = CardStore(seedCards = emptyList()).also {
            it.replaceAll(listOf(cardY))
            it.loadTombstones(listOf(tombX))
        }
        b1.restoreSyncPayload(a1.cards, a1.tombstones)   // A→B：x 被本地墓碑抵抗
        a1.restoreSyncPayload(b1.cards, b1.tombstones)   // B→A：x 被删、y 合入、墓碑记入

        // 场景 2（对称）：先 B→A，后 A→B
        val a2 = CardStore(seedCards = emptyList()).also { it.replaceAll(listOf(cardX)) }
        val b2 = CardStore(seedCards = emptyList()).also {
            it.replaceAll(listOf(cardY))
            it.loadTombstones(listOf(tombX))
        }
        a2.restoreSyncPayload(b2.cards, b2.tombstones)   // B→A：x 删、y 入
        b2.restoreSyncPayload(a2.cards, a2.tombstones)   // A→B：与场景 1 的 A→B 相同载荷语义

        // 两序终态逐字段一致（交换律）
        assertEquals(a1.cards, a2.cards, "A 端终态与交换顺序无关")
        assertEquals(a1.tombstones, a2.tombstones)
        assertEquals(b1.cards, b2.cards, "B 端终态与交换顺序无关")
        assertEquals(b1.tombstones, b2.tombstones)

        // 且双端彼此收敛为同一状态：x 已删（两端墓碑一致）、y 存活
        assertEquals(listOf(tombX), a1.tombstones, "A 记入 x 墓碑（deletedAt 取较大者）")
        assertEquals(listOf(tombX), b1.tombstones, "B 的墓碑保持 2000")
        assertEquals(listOf("y"), a1.cards.map { it.id })
        assertEquals(listOf("y"), b1.cards.map { it.id })
        assertEquals(a1.cards, b1.cards)
    }

    /** 第二轮交换零副作用：收敛后重复同步不再产生任何变更 */
    @Test
    fun tombstoneExchangeSecondRoundIsNoOp() {
        val cardY = fixtureCard(id = "y", headline = "B 独有的卡", createdAt = 1_727_900_002_000L)
        val a = CardStore(seedCards = emptyList())
        val b = CardStore(seedCards = emptyList()).also {
            it.replaceAll(listOf(cardY))
            it.loadTombstones(listOf(Tombstone("x", 1_727_900_001_000L)))
        }
        a.restoreSyncPayload(b.cards, b.tombstones)
        b.restoreSyncPayload(a.cards, a.tombstones)

        val aCards = a.cards; val aTombs = a.tombstones
        val bCards = b.cards; val bTombs = b.tombstones
        a.restoreSyncPayload(b.cards, b.tombstones)
        b.restoreSyncPayload(a.cards, a.tombstones)

        assertEquals(aCards, a.cards, "第二轮 A 不得再有变化")
        assertEquals(aTombs, a.tombstones)
        assertEquals(bCards, b.cards, "第二轮 B 不得再有变化")
        assertEquals(bTombs, b.tombstones)
    }

    // ---------- 夹具卡片构造 ----------

    private fun fixtureCard(
        id: String = "f1",
        headline: String = "测试卡",
        createdAt: Long = 1_727_900_000_000L,
    ): KnowledgeCard = KnowledgeCard(
        id = id,
        category = "冷知识",
        headline = headline,
        summary = "摘要",
        details = "正文",
        links = emptyList(),
        source = CardSource.SEED,
        createdAt = createdAt,
        seenAt = null,
        swiped = null,
        isFavorite = false,
    )

    private fun detailsCard(details: String, editedAt: Long? = null): KnowledgeCard =
        KnowledgeCard(
            id = "f1",
            category = "冷知识",
            headline = "测试卡",
            summary = "摘要",
            details = details,
            links = emptyList(),
            source = CardSource.SEED,
            createdAt = 1_000L,
            swiped = SwipeDirection.SKIP,
            editedAt = editedAt,
        )
}

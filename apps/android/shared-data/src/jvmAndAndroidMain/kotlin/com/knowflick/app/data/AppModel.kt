package com.knowflick.app.data

/**
 * 应用级状态容器：卡库存储 + 卡堆状态机。
 * 无视图依赖，可在 JVM 测试中注入临时目录直接驱动。
 */
class AppModel(
    /**
     * 卡库存储。**刻意公开**：Kotlin 的 `internal` 是按**模块**算的，本类迁进 `:shared-data`
     * 之后，宿主（`:app` / `:desktop`）再拿它就跨模块了——原先的 `internal` 直接编译不过。
     * 这里选择公开而不是给 AppModel 加十个转发方法：`saveSettingsJson` / `loadCards` 这些
     * 本来就是数据层的公开 API 面，包一层只会增加无谓间接。
     */
    val storage: CardStorage,
) {
    val store = com.knowflick.app.domain.CardStore(
        // 排布防重（minDistance）与渲染必须解析同一 key：显式接线，避免两套 key 空间再次漂移
        keyFor = com.knowflick.app.domain.CardThemeResolver::forCard,
    )

    /**
     * 启动：加载卡库。预置库退役后不再有任何「自动灌回来」的内容——
     * 空库是正常起点，落盘也如实保持为空（口径与 macOS bootstrap 一致）。
     */
    fun bootstrap() {
        store.replaceAll(storage.loadCards())
    }

    fun persistNow() {
        storage.saveCards(store.cards)
    }
}

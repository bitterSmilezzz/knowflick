# KnowFlick macOS v4.5.0

发布日期：2026-09-28。最低 macOS 14。

## 本版变化

- 界面整体迁移到新的 Cutline 风 Insight 体系：圆角浮动侧栏外壳（学习 / 资料与工具分组导航、导入笔记与网页剪藏入口）+ 深色 surface 卡片 + 1pt 描边 + 纯排版驱动，刷卡视图不再铺设摄影底图。
- 刷卡主视图以 `InsightMainView` 重写：左右拖动划走、三档触觉反馈、飞出层动画、独立回收兜底、全部模态路由与快捷键（⌘F 搜索 / ⇧⌘P 磨耳朵 / ⌘Z 撤销 / ← → 刷卡 / ⏎ 详情 / ⌘N 生成 / ⌘J 追问 / ⌘⌥P 控制台）与旧版 1:1 保留；卡片面提供朗读胶囊按键（播放中显示进度百分比，可点击暂停 / 继续）。
- 收藏 / 历史 / 统计换用 Cutline 化框架；学习工作台（今日 / 复习 / 知识库）原生化：衬线标题与琥珀主色退场，统一为无衬线字阶与选中蓝，筛选、排序、导出、每日目标调整等交互原样保留。
- 窗口默认尺寸对齐新布局（1180 × 800）；打包脚本支持固定开发签名身份（`KNOWFLICK_CODESIGN_IDENTITY` 或自签名 "KnowFlick Dev"），避免 adhoc 签名变动导致每次启动重复请求钥匙串授权。
- 旧 `CardView` / `CardDeckView` / `CardSheenOverlay` 归档至 `Views/_archived/` 供对照，不参与编译。

## 安装与升级

下载 `KnowFlick-4.5.0.app.zip`，解压后放入 Applications。已有卡库继续使用，无需重置。
附件 `KnowFlick-4.5.0.app.zip.sha256` 用于核对下载完整性。

## 验证与边界

- 双审计（子代理）：逻辑保真逐字节比对（P0/P1 均零）+ 74 文件 API 存在性交叉核对（P0 零）。
- KnowFlickCore 整模块 Swift 6 严格并发 typecheck 通过；CI（完整 Xcode）运行 Swift 测试、打包、资源与启动自检全绿（PR #9 / 合并前 macOS 3m42s）。
- 本机 CommandLineTools 27.0 无法展开 SwiftUI 宏，UI 层编译验证以 CI 为准（调查见 `docs/MAC_TOOLCHAIN_2026-09-27.md`）。
- 学习工作台的独立模式侧栏（旧 CardDeckView 时代的自带导航）随归档淘汰，导航统一由侧栏外壳承担。
- 星图 / 测验 / 听书三个面板本轮仅完成视觉 token 迁移，Cutline 原生化留待下一批。

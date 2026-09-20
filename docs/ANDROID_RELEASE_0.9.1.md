# Android 0.9.1 发布记录：安卓满帧渲染深度优化与桌面端同构同步

- **发布日期**：2026-09-20
- **版本标识**：`versionCode 19` / `versionName 0.9.1`
- **签名发布 APK**：[KnowFlick 0.9.1 签名 APK](../dist/android/KnowFlick-0.9.1.apk)（4.93 MiB，通过 R8 混淆、资源压缩、APK Signature Scheme v2 与 16-4 对齐校验）
- **SHA-256 校验码**：`ce580f28e55a37de2d4d15abff650826e2e318d4fb445c76e9d4600234ded0db`
- **R8 Mapping 文件**：[KnowFlick-0.9.1-mapping.txt](../dist/android/KnowFlick-0.9.1-mapping.txt)

---

## 一、核心升级与优化维度

### 1. 安卓端卡顿彻底根治 (120 FPS 满帧丝滑优化)
- **主卡堆手势滑动 0 重组 (Zero Recomposition)**：
  - 将手势位移、3D 轴心微倾角（`rotationY` / `rotationZ`）以及意图印章（♥ 收藏 / ✕ 略过）全部移入 Draw 阶段的 `graphicsLayer { ... }` 内部延迟读取；
  - 拖拽卡片时 Composable 树完全不发生重组，渲染直接交由 GPU 硬件层，在 120Hz/60Hz 屏幕上实现无感满帧。
- **知识全景星图引力拓扑极速瘦身（96.4% 冗余剔除）**：
  - 重构 `KnowledgeGraphEngine.kt`：利用倒排索引寻找公共关键词候选卡片，按关联系数降序排序后限制保留最强的前 2 条精炼引力线，彻底消除 $O(N^2)$ 连线爆炸；
  - 连线总数从 11,748 条狂降至 419 条（减少 96.4%），单帧绘制耗时由 >100ms 降至 <2ms。
  - `KnowledgeGraphScreen.kt` 引入视口剔除（Frustum Culling）与 LOD（缩放 < 0.75 时自动略过非高亮文字绘制），大图缩放与平移漫游无掉帧。
- **系统状态异步化与主线程零阻塞**：
  - `AudioEffectHelper.kt` 中 `isSystemMuted` 涉及 IPC `ringerMode` 调用，全部移入单线程后台 Executor 异步轮询，避免触摸事件阻塞主线程。

### 2. macOS 桌面端功能完全同构落地
- **局域网 P2P 极速同步**：
  - 基于原生 BSD Socket 监听 8998 端口（`SyncServer`）与 URLSession 客户端（`SyncClient`），支持 RFC1918 私有网段校验；
  - 自动生成 6 位随机安全配对码，与 Android 端完全互通，支持双向无感增量合并；
  - 新增 `SyncSheetView.swift` 优雅抽屉面板。
- **4 款纸质人文主题体系**：
  - 宣纸白、复古羊皮纸、晨雾冷灰、暖曜黑主题色板与渐变底色，设置页提供 4 款主题可视化切换网格。
- **16-bit PCM 拟真物理音效**：
  - 新增 `AudioEffectManager.swift`，纯 Swift 内存程序化合成 WAV 波形，严格遵循 Swift 6 并发安全与 `@MainActor` 隔离。

---

## 二、测试与质量指标

1. **Android 单元测试**：全量 28 个测试套件、140+ 单元测试 100% 绿灯全通。
2. **macOS 单元测试**：全量 35 个测试套件、242 项测试 100% 绿灯全通（`tools/test.sh --core-only`）。
3. **Android Lint 静态分析**：0 Errors，0 Fatal Issues。
4. **正式 Release APK 构建**：通过 R8 混淆、资源压缩、V2 签名与 16-4 对齐校验，大小仅 4.93 MiB。
5. **真机实测**：在 Android 模拟器上实测主卡堆 0 重组高刷滑动、知识全景星图 419 条精炼引力线漫游与分类聚焦，交互丝滑。

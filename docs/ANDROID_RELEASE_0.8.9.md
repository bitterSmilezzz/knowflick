# Android 0.8.9 发布记录：3D 触感动效、系统媒体播控、LaTeX 科学排版与 FSRS 自适应认知算法

- **发布日期**：2026-09-19
- **版本标识**：`versionCode 17` / `versionName 0.8.9`
- **签名发布 APK**：[KnowFlick 0.8.9 签名 APK](../dist/android/KnowFlick-0.8.9.apk)（5,140,157 字节，4.9 MiB，通过 R8 混淆、资源压缩、APK Signature Scheme v2 与 16-4 对齐校验）
- **SHA-256 校验码**：`11f7a7dac1512f3387c75896f227dc39be26ff2a216628a331991e6b4f01ed8c`
- **R8 Mapping 文件**：[KnowFlick-0.8.9-mapping.txt](../dist/android/KnowFlick-0.8.9-mapping.txt)

---

## 一、核心升级维度

### 1. 物理触感与 3D 轴心视差倾角动效 (Haptics & 3D Parallax)
- **分级触觉震感系统（`HapticFeedbackHelper`）**：
  - 封装 `tick()`（按压抓取）、`click()`（越过阈值阻尼）、`success()`（掌握/右划双振）、`warning()`（跳过/左划双振）四档精细物理震感。
  - 优先使用原生 `VibrationEffect.createPredefined`，并在旧版本 Android 系统上提供丝滑的毫秒级时序震动降级。
  - 主卡堆拖拽、阈值越过、左右划卡结算、底部操作按键及复习评价全量接入触觉反馈。
- **3D 轴心微光与视差倾角**：
  - 基于卡片横向位移量动态推演视差角度：`val tiltY = (offsetX / screenWidth * 12f).coerceIn(-12f, 12f)`。
  - 应用 `graphicsLayer { rotationY = tiltY; cameraDistance = 16f * density }`，实现具有真实物理景深与厚度的纸牌翻转视差。

### 2. 系统级原生媒体播控与锁屏常驻 (MediaSession & Foreground Service)
- **`SpeechPlaybackService` 原生前台媒体服务**：
  - 声明 `FOREGROUND_SERVICE` 与 `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 权限。
  - 结合 `android.media.session.MediaSession` 与 `Notification.MediaStyle` 原生通知样式。
  - 完美适配 Android 13+ / 14 / 15 系统大图波浪纹媒体播控中心，支持锁屏常驻控制与通知栏交互（上一张、播放/暂停、下一张）。

### 3. 高性能富文本与 LaTeX 科学公式排版引擎 (MarkdownTextRenderer)
- **纯 Kotlin / Compose 轻量高效解析**：
  - 无需第三方臃肿依赖，以原生 `AnnotatedString` 样式构建。
  - 结构解析：支持粗体、斜体、圆角代码块（内嵌微灰背景与边框）、引用块（左侧 3dp 琥珀色装饰条）、列表项。
  - **LaTeX 科学符号与上下标自动转换**：
    - 上标（如 `x^2`, `10^{-3}` $\rightarrow$ $x²$, $10⁻³$）；
    - 下标（如 `a_1`, `H_2O` $\rightarrow$ $a₁$, $H₂O$）；
    - 常见希腊字母与数学符号（`\alpha`, `\beta`, `\pi`, `\pm`, `\times`, `\leq`, `\geq`, `\approx`, `\rightarrow`, `\infty` 等）。
  - 主卡堆摘要卡面（`CardFace`）与卡片详情页（`DetailScreen`）全面升级支持富文本排版。

### 4. 认知科学与统计图谱（FSRS 4.5 + SM-2 双算法引擎 & 35 天打卡热力图）
- **FSRS (Free Spaced Repetition Scheduler v4.5) 引擎集成**：
  - 引入现代记忆认知前沿算法 FSRS 4.5，建立稳定性 $S$、难度 $D$ 与可提取率 $R$ 三维模型。
  - 依据 90% 目标留存率动态计算最优复习间隔，有效抑制过复习与认知疲倦。
  - 领域实体 `Card` 扩展 `stability` 与 `difficulty` 字段，向下兼容历史 JSON 存储。
  - `SpacedRepetitionEngine` 实现 SM-2 与 FSRS 双算法引擎动态双向热切换。
- **35 天（5 周）学习活跃度打卡日历热力图（`LearningHeatmap`）**：
  - GitHub 风格 7 行 $\times$ 5 列日历网格，按周对齐，圆角小方块微质感。
  - 5 阶低饱和微彩图谱（未打卡纸白 $\rightarrow$ 鼠尾草轻绿 $\rightarrow$ 翡翠中绿 $\rightarrow$ 森林墨绿），清晰直观展示连续打卡记录。
- **统计页算法动态切换微彩胶囊**：
  - 在「间隔复习与认知排程」头部嵌入交互胶囊，轻触即可在「SM-2 经典排程」与「FSRS 自适应认知算法」之间实时无缝热切换。

### 5. 性能与重组深度优化
- `Card` 实体标注 `@androidx.compose.runtime.Immutable`，向 Compose 智能重组编译器声明数据不可变契约，杜绝滑动过程中的无效重组与内存抖动。

---

## 二、测试与质量指标

1. **Android 单元测试**：全量 169 个单元测试全部通过（100% PASS，`BUILD SUCCESSFUL in 9s`）。
2. **Android Lint 静态分析**：0 Errors，0 Fatal Issues（`BUILD SUCCESSFUL in 44s`）。
3. **正式 Release APK 构建**：通过 R8 混淆、资源精简、V2 签名与 16-4 对齐校验，真机实测正常无崩溃。

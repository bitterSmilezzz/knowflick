# ADR-0001：桌面三端与 Android 共用一份 Kotlin / Compose 代码

- 状态：**已接受**（2026-10-11）；「Swift mac 端处置」已由[第一原则](../../AGENTS.md)（一套开发，多处发布）判定为**收敛而非并存**，见 §5
- 决策人：项目所有者
- 相关：`docs/windows-route/` 四份实测卷宗 · [MULTI_PLATFORM.md](../MULTI_PLATFORM.md) · [CONTEXT.md](../../CONTEXT.md)

## 1. 背景与约束

产品目标（2026-10-11 明确）：**Windows / macOS / Linux 三端 + Android，前后端都共享，一次开发多端同步。**

仓库当时的现实：

| 端 | 技术栈 | 状态 |
| --- | --- | --- |
| macOS | Swift / SwiftUI | 功能最完整（旗舰） |
| Android | Kotlin / Jetpack Compose | 功能完整 |
| Windows / Linux | — | 未启动 |

而同一份要求下的两条硬约束（沿自 Windows 路线调研）：**① 跨平台一次开发多端同步**（尽量少重复）；**② 性能与资源占用要求高**。

## 2. 决策

**以 Kotlin Multiplatform + Compose Multiplatform 作为桌面三端与 Android 的唯一共享栈：**

- **后端（逻辑）半边** = `:domain`（KMP，`androidTarget` + `jvm`）——19 文件 4149 行，无 Android 依赖；
- **前端（界面）半边** = `:shared-ui`（KMP + CMP，同样双 target）——共享 Compose 界面与主题令牌；
- **各端只是薄宿主**：`:app`（Android）、`:desktop`（桌面宿主，**同一份产物跑 Windows / macOS / Linux**）。

「一次开发多端同步」在本决策下的具体含义：**界面的改动改一次，Android 与三个桌面系统同时得到**。
它与**数据同步**（局域网 `docs/SYNC_PROTOCOL.md`）是两件事，后者是独立课题，见 §5。

## 3. 目标矩阵

| 端 | 承载方式 | 目标支持下限（官方口径） |
| --- | --- | --- |
| Android | `:app` + `:domain` + `:shared-ui` 的 android target | Android 5.0 / API 21（本仓 minSdk 26） |
| Windows | `:desktop` 的 jvm target（Skiko/awt） | Windows 10（x86-64 / arm64） |
| macOS | 同上 | macOS 13 arm64 |
| Linux | 同上 | Ubuntu 20.04（x86-64 / arm64） |

> 来源：[Compose Multiplatform 兼容性与版本页](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html)（页面日期 2026-09-22，实测复核见卷宗）。

## 4. 已经实测过的依据（不是纸面推演）

| 事实 | 证据 |
| --- | --- |
| `:domain` 在桌面 JVM 上跑通全部 171 项测试，且**不需要 Android SDK** | [KMP 探针结果](../windows-route/KMP_PROBE_RESULT.md) |
| 三条版本路线（冻结 / 最小改动 / 现代）均能支撑 CMP 桌面宿主 | [CMP 工具链对齐实验](../windows-route/CMP_TOOLCHAIN_ALIGNMENT.md) |
| 本仓选定 **Kotlin 2.1.21 + CMP 1.8.2 + BOM 2025.06.00**（三者逐号对齐），AGP 不动 | 同上 + [adr 依据] |
| Windows 目标可在 macOS 上**编译**（`skiko-awt-runtime-windows-x64` 真实解析） | 同上；运行与 MSI 打包仍需 Windows |
| `:desktop` 骨架在真实构建里复用 `:domain` 与 `:shared-ui`，无头渲染测试进 CI | [desktop/README.md](../../apps/android/desktop/README.md) |
| 界面文件搬进共享模块**不需要改调用方 import**（包名保持 `com.knowflick.app.*`） | 本次 `Theme.kt` 迁移：24 个引用文件零改动 |

## 5. 后果

### 正面

- 桌面三端与 Android 的界面/逻辑只有一份实现，**新功能天然四端同步**；
- 领域层、界面层都已被实测证明可跨 target 编译与运行，工具链风险已前置消化；
- Android 端存在成熟实现，可作为共享 UI 的**参照实现**逐块平移，而不是从零写。

### 负面（必须承认）

- **macOS 会有一段两套实现的过渡期**：Swift 原生 App 与 CMP 桌面版同时存在。按第一原则，
  这是**过渡态而不是设计选择**——Swift 侧冻结新增能力，随共享端对等而退役（§5.1）；
- CMP 桌面的 JVM + Skiko 运行时体积、冷启动与内存占用高于原生 SwiftUI（资源对比见
  [RESOURCE-REPORT](../windows-route/RESOURCE-REPORT.md)），与「性能占用要求高」这条约束存在张力；
- 平台专有能力（系统分享、菜单栏、通知、TTS/语音通道、桌面微件）在 CMP 侧要**各写一份或用 JNI/expect-actual**，
  不会自动获得。

### 待决

1. ~~Swift mac 端的最终处置~~ → **已由第一原则判定：收敛，不并存。**
   「一套开发，多处发布」不允许长期维护第二份实现，因此 mac 端的目标形态就是本 ADR 的共享端；
   `apps/mac` 的 Swift/SwiftUI 代码**冻结新增能力**，只做必要的修复与发版维护，
   待共享端在 mac 上达到功能对等后退役。执行时的顺序约束：
   - 对等之前不删任何 Swift 能力（它是当前功能最完整的端）；
   - 新功能**只写一次**，一律落在 `:domain` / `:shared-ui`；
   - 对等里程碑按功能清单逐项核对，而不是按时间点宣布。
2. **数据同步跨端化**：现有 `SYNC_PROTOCOL.md` 是 mac ↔ Android 的局域网同步。四端之后，
   桌面端要不要接入同一协议、还是改为账号/云同步，需要单独一轮设计。
   注意这条同样受第一原则约束：**不要为第二个/第三个端各写一套同步实现**。
3. **桌面端的目录与构建拓扑**：`:desktop` 目前暂驻 `apps/android` 构建内。当三端要独立打包与发版
   （`packageMsi` / `packageDmg` / `packageDeb`，各自 CI）时，应提升为 `apps/desktop/`（或按端拆分），
   与共享模块之间用 composite build / 产物契约相连。判据写在 [desktop/README.md](../../apps/android/desktop/README.md)。

## 6. 波次计划（按依赖顺序）

| # | 波次 | 内容 | 状态 |
| --- | --- | --- | --- |
| 1 | 后端共享（逻辑） | `:domain` 抽出 KMP 模块 | ✅ 已完成（#74） |
| 2 | 工具链 | 三路线实测 + 选定对齐版本 | ✅ 已完成（#76） |
| 3 | 工具链落地 | Kotlin 2.1.21 升级（AGP/BOM 不动） | ✅ 已完成（#77） |
| 4 | 桌面宿主 | `:desktop` 骨架 + CI | ✅ 已完成（#78） |
| 5 | 前端共享起步 | `:shared-ui` 模块 + 主题令牌迁移 + 首个共享组件 | ✅ 已完成（#79） |
| 6 | 界面平移（A 档） | 纯 Compose 界面平移进 `:shared-ui`；桌面宿主直接渲染共享整屏 | 🔄 进行中：已迁 6 文件 2365 行（`QuizScreen` 833 / `AppIcons` 668 / `LibraryScreen` 326 / `MarkdownTextRenderer` 297 / `LearningHeatmap` 214 / `CategoryStampColor` 27）；分档与下一批见 [UI_EXTRACTION](../windows-route/UI_EXTRACTION.md) |
| 7 | 后端共享（持久化） | `:shared-data`：卡库落盘逻辑（原子写 / 备份轮转 / 持久化队列）四端共用，宿主只注入数据目录 | ✅ 已完成：**桌面端拿到真实卡库**（读写同一份 `cards.json` 实现）；见 [desktop/README](../../apps/android/desktop/README.md) |
| 8 | 平台抽象（B 档） | 底图资源、系统返回、Toast/剪贴板、文件选择抽 expect/actual 或外移宿主 | 🔄 进行中：已落地**文件选择/归档导入导出**（共享引擎 + 各端 IO）、**触觉接缝**（`PlatformHaptics`，桌面 no-op）与**底图接缝**（`rememberBackgroundImage`，桌面 Skia + 共享 assets）——`CardFace` 因此解锁；还剩剪贴板、系统分享、Toast。`DetailScreen` 待其依赖的两个 Sheet（聊天 844 + 海报 371）一并处理 |
| 9 | 各端打包 | Windows/mac/Linux 安装包 + 三系统 CI + Release 通道 | ✅ 已完成（#81）：一份配置 × 三台 runner，各自出包并附同一 Release。**安装包图标未接入** |
| 10 | mac Swift 处置 | 冻结新增能力 → 按功能清单对等后退役（§5.1） | 进行中（按第一原则收敛） |
| 11 | 能力对齐：测验 | 测验轮次编排 `QuizCycle` 抽到 `:domain`，两端用同一份编排 + 同一份 `QuizScreen`；桌面入口放原生菜单栏 | ✅ 已完成：桌面端可用「知识测验 / 只测今天到期」，评分经 SM-2 落库；Android 的 ViewModel 改为委托同一份编排 |
| 12 | 能力对齐：统计 | 日期接缝 `rememberLearningDay`（Android 广播 / 桌面轮询）→ 解锁并迁移 `StatsScreen`(825)；桌面菜单栏加入口 | ✅ 已完成：三个共享整屏（卡库 / 测验 / 统计）在桌面全部可用 |
| 13 | 能力对齐：详情页 | 公共 API 消解（`LocalUriHandler`）+ 宿主槽位（聊天/海报 Sheet 由宿主注入）+ 推荐打分抽进 `:domain` | ✅ 已完成：四个共享整屏（卡库 / 测验 / 统计 / 详情）在桌面全部可用；桌面未接的两个 Sheet 以 `null` 传入 |
| 14 | 能力对齐：刷卡主页 | `PlatformSounds` 接缝 + `LocalWindowInfo` 替 `LocalConfiguration` + 微件/海报改槽位 → 迁入 `DeckScreen`(1051) 与 `CardFace`(281)；桌面首页改为刷卡页并加菜单导航 | ✅ 已完成：**五个整屏在桌面全部可用**；桌面不传微件/海报槽位，相关入口自然消失 |
| 15 | 能力对齐：设置页 | `AiSettings`/`AiProviderPresets`/`SpeechSettings` 迁 `:domain`（设置线格式跨端同一份）+ `SettingsScreen`(534) 迁 `:shared-ui`；桌面新增凭据存储（0600 明文文件，**如实标注非 Keystore**） | ✅ 已完成：桌面可改主题（立即生效）/音效/AI 与语音配置，设置走共享 `settings.json`；密钥只落 0600 凭据文件 |

工作量参考：[CMP-FEASIBILITY §4.2](../windows-route/CMP-FEASIBILITY.md)——Windows 端首版 22–35 人日，
三端打包与平台抽象另计。

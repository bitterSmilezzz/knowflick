# KnowFlick Windows 端路线对比：资源占用 × 跨平台复用度

> 调研日期：2026-10-10 · 调研方法：WebSearch + WebFetch 公开资料 + 本机一手实测
> 服务对象：Windows 端三条候选路线的可行性拍板（[WINDOWS_ONBOARDING.md](../WINDOWS_ONBOARDING.md) §五「路线定版后补充」）
> 相关既有结论：[STATUS_2026-09-14.md](../STATUS_2026-09-14.md) §五（已评估 Avalonia / WPF / WinUI 3 / Flutter / Tauri，**未评估 Compose Multiplatform**——本报告的增量正在于此）

## 证据等级标注约定

全文数字均带标注，请按等级采信：

| 标注 | 含义 |
| --- | --- |
| `[官方]` | 厂商官方文档、官方仓库文档 |
| `[官方issue]` | 官方仓库 issue / YouTrack 中的陈述（含厂商人员回复与用户测量） |
| `[实测·第三方]` | 第三方可复现 benchmark（有机器型号、版本、方法） |
| `[实测·本机]` | 本次在用户 Mac（darwin/arm64）上亲测，方法见 §7 |
| `[实测·本机·历史]` | 用户仓库既往在 Mac 上实测并已落盘的数字 |
| `[社区]` | 论坛/博客/个人测量，单点、无交叉验证 |
| `[推算]` | 由上述数据推导，非直接测量 |

**核心提醒**：三条路线的空载内存差距，远小于社区流行的「Tauri 省 5 倍内存」这类宣传所暗示的差距。真正决定用户体验的是**内存记在谁头上**（独立进程 vs 用户已有的浏览器）与**渲染路径的 CPU 表现**，见 §3。

---

## 0. 结论先行

1. **复用度没有悬念：路线 A（Compose Multiplatform）压倒性第一。** 它与 Jetpack Compose 共享编译器、运行时和 **同一套 `androidx.compose.*` API**（`[官方]`），本仓库 Android 端 24,655 行 Kotlin 中 **62%（15,520 行）使用 `androidx.compose.*`**，其中 **42%（10,376 行）不含任何 `android.*` framework 依赖、可直接进 commonMain**，纯领域层 86% 不含 Android 依赖（`[实测·本机]`）。Avalonia 的 XAML/SkiaSharp 与 Compose **零共享**，且不存在 Compose→Avalonia 的转换工具；路线 C 的 Web UI 与 Compose 零共享。
2. **资源占用也不是「B/C 碾压 A」那么简单。** 空载量级：Avalonia idle ≈ 140 MB、路线 C ≈ 75–200 MB（常驻 23–46 + 浏览器标签 50–150）、Compose Desktop 空窗口 ≈ 108 MB（mac，2021 年测量）/ 真实应用 153 MB、中等负载峰值 616–695 MB。**Compose 的差距主要出现在中等以上负载**，因为 Skiko 持有的 native 内存不随堆设置收敛（`[官方issue]`：堆压到 30 MB，空窗口仍占 109 MB）。
3. **Compose 的补丁是 GraalVM Native Image，但它在 Windows 上是一条未铺完的路**：同机 benchmark 显示 Native+PGO 把峰值从 616–695 MB 降到 **269 MB**、启动降到 17 ms（`[实测·第三方]`），但 Compose 官方从未把 GraalVM 作为受支持的发布路径，且 **CMP-1923「Kotlin-Native Support for Desktop」已被官方标为 Not Planned**（`[官方issue]`）——Compose 桌面端永远只有 JVM target。
4. **路线排序（按用户两条硬约束加权）**：**A > B > C**（理由与条件见 §4）。若把「资源占用」提到完全不可妥协、且复用度可以让位于此，排序翻转为 **B > A > C**。
5. 一个必须说清的现实：**路线 A 的 Windows 安装包只能在 Windows 机器上构建**（jpackage 不支持交叉编译，`[官方]`），这与仓库现有的「双机协作」铁律相容，但意味着 macOS 机器无法产出 Windows 产物。

---

## 1. 三条路线的内存 / CPU 事实

### 1.1 路线 A：Compose Multiplatform（Kotlin / JVM desktop）

**基线事实**

| 场景 | 数值 | 来源 |
| --- | --- | --- |
| 空窗口 Hello World（macOS，2021） | **108 MB** | `[官方issue]` [CMP-5100 / GH #1632](https://github.com/JetBrains/compose-multiplatform/issues/1632) |
| 同一 app 空窗口（Linux，2021） | 146 MB | 同上 |
| 强制 `-Xms30M -Xmx30M` 后空窗口（macOS） | **109 MB**（几乎不变） | 同上 |
| 真实应用 JetBrains Toolbox（macOS） | 153 MB | 同上 |
| Flutter Hello World（同 benchmark 对照） | 59.9 MB | 同上 |
| Electron Spotify（同 benchmark 对照） | 313 MB | 同上 |
| 中等负载峰值（13 CPU kernel + 渲染 + 列表，Apple M4，2026-07） | **616 MB**（C2）/ 695 MB（GraalVM JIT） | `[实测·第三方]` [Nucleus Benchmarks](https://nucleusframework.dev/en/docs/performance/benchmarks/) |
| 同 benchmark：GraalVM Native `-O3`+PGO 峰值 | **269 MB**（CPU 132.7 vs JVM 138–146） | 同上 |
| 同 benchmark：GraalVM Native `-O2` 峰值 | 278 MB（CPU 86.9，明显掉队） | 同上 |
| 同 benchmark：SwiftUI 峰值 | 268 MB | 同上 |
| 同 benchmark：Flutter 峰值 | **196 MB**（最低） | 同上 |
| 空窗口 app 包体（macOS，2025-03，Apple Silicon） | `.dmg` 64.9 MB / `.app` 124.1 MB；`packageReleaseDmg` 后 51.9 / 109.9 MB；Conveyor + ProGuard 最低 45.5 MB | `[实测·第三方]` [dev.to 实测](https://dev.to/coltonidle/compose-for-desktop-app-size-comparison-3d8h) |
| 启动 / 列表加载 | 启动 ~21 ms、列表 21 ms | `[实测·第三方]` 同上 Nucleus |

**关键机制**：Compose Desktop 的高占用来自 **Skiko（Skia 绑定）持有的 native 内存，不在 Java 堆内**。证据是 `[官方issue]` 里的实验：`-Xms30M -Xmx30M` 后堆被压到 30 MB，进程仍占 109 MB。反过来说，**调 `-Xmx` 不是省内存的手段**，用 YourKit/VisualVM 也看不到这部分。

**「JVM 启动慢 / 内存大」是否被官方承认为问题？**

- 是，但**官方从未把它列为已解决的缺陷**。GH #1632 被标签为 `desktop` + `enhancement`，官方回复给出的唯一方向是「试试编译成 GraalVM Native Image，理想产物 24–32 MB」，然后 issue 被关闭。`[官方issue]`
- 后续 YouTrack [CMP-6570「compose very poor performance on desktop」](https://youtrack.jetbrains.com/projects/CMP/issues/CMP-6570/compose-very-poor-performance-on-desktop) 仍在讨论 native 内存问题。`[官方issue]`
- 已知真实的官方 issue：**MSI 安装包在老版本已安装时不提示升级**（[CMP-8683](https://youtrack.jetbrains.com/projects/CMP/issues/CMP-8683/MSI-installer-does-not-prompt-update-when-older-version-already-installed)）。`[官方issue]`
- 社区近年（2025-08、2026-09）仍在 Reddit 反复提「Compose Desktop 内存偏高 / Skiko 非平凡应用持 300 MB native 内存」。`[社区]`（单点，未交叉验证，但方向与官方 issue 一致）

**JVM 默认堆的一个陷阱**（对「资源占用要求高」直接相关）：HotSpot G1 在未指定 `-Xmx` 时，默认最大堆 = **物理内存的 25%**（`[官方]` Oracle 文档口径）。即 32 GB 机器上默认允许堆涨到 8 GB。发布时必须显式设 `-Xmx`，否则「内存占用高」会被放大。

**CPU**：`[实测·第三方]` Nucleus 同机对比显示 Compose 桌面在 CPU kernel（138–146 分）与 SwiftUI（139）、Tauri（142）同级，渲染 GFX 略低于 SwiftUI/Tauri/Flutter（13041 vs 15013/15254/15133）。**空载 CPU 无权威数据**，定性判断为低（渲染是事件驱动的 Skia 绘制）。

---

### 1.2 路线 B：Avalonia（.NET）

| 场景 | 数值 | 来源 |
| --- | --- | --- |
| 中等复杂度 LOB 应用 idle working set（Windows，Ryzen 7，2026-05） | **~140 MB** | `[社区]` [ctco 2026 实测](https://www.ctco.blog/posts/maui-vs-avalonia-2026-cross-platform-dotnet-ui/) |
| 同应用活跃（10k 行 DataGrid） | ~260 MB | 同上 |
| 同应用 private bytes（稳态） | ~165 MB | 同上 |
| 对照：.NET MAUI 同条件 | idle ~200 MB / 活跃 ~370 MB / private ~230 MB | 同上 |
| 冷启动 / 热启动 / Native AOT | ~1.6s / ~0.8s / **~0.6s** | 同上 |
| 同条件 MAUI 冷启动 | ~2.1s | 同上 |
| Hello World 自包含发布体积（未 trim，2023，Windows） | 60–80 MB | `[社区]` [SO / Avalonia Discussion #9217](https://github.com/AvaloniaUI/Avalonia/discussions/9217) |
| **Avalonia 单文件发布实测（macOS 交叉编译 Windows）** | **PE32+ GUI x86-64，84.9 MB** | `[实测·本机·历史]` [STATUS_2026-09-14 §五](../STATUS_2026-09-14.md) |
| SkiaSharp 解码项目全部 42 张 WebP | 42/42 通过 | 同上 |

**Native AOT vs JIT**：官方文档对 Native AOT 的收益是**定性**表述——「更快的启动」「为资源受限环境减少内存占用」「无需安装 .NET 运行时」「结合 trimming 体积更小」。**官方没有给任何具体 MB 数字**。`[官方]` [Avalonia Native AOT 文档](https://docs.avaloniaui.net/docs/deployment/native-aot)

AOT 的**已知限制**（官方列出，对本项目有直接影响）`[官方]`：

- 动态控件创建必须配 trimmer 设置；**部分第三方 Avalonia 控件不兼容 AOT**；
- XAML 需要编译期绑定（`x:CompileBindings="True"`），**禁止运行时动态加载 XAML**；
- 资源必须全部 `AvaloniaResource` 内嵌，**禁止从外部动态加载**——本项目 42 张 WebP 底图需全部内嵌；
- 设计期实时预览受限。

**把 AOT 的收益量化到什么程度是安全的？** `[推算]`：官方只说「减少」，社区 idle 数据 140 MB 是 JIT 口径，AOT 后按 .NET 生态常见幅度落在 100–140 MB 区间属合理预期，但**不要当作已证实数字引用**。

**架构风险（决定「资源占用」这件事在 B 路线上有多大不确定性）**：Avalonia 在 macOS 与 Windows 上用的是**两套不同的后端实现**（`[官方issue]`，见 [STATUS_2026-09-14](../STATUS_2026-09-14.md) §五引用）。Mac 上测出来的内存/渲染表现**不能外推到 Windows**。此外社区有长期存在的**窗口 resize 时内存上涨**问题报告（[Avalonia #5646](https://github.com/AvaloniaUI/Avalonia/issues/5646)，2021 年开的，5 倍增长/500+ MB）。`[社区]`

**成熟度**：Avalonia 11.2 于 2024 末稳定移动端；**Avalonia 12 已于 2026-04 发布**（2026-02 出 Preview 1，主打 composition 渲染管线与性能）。JetBrains 自家用 Avalonia 做跨平台 .NET 工具，Rider 提供一等 XAML 工具链。`[官方]` [Avalonia 12 发布](https://avaloniaui.net/blog/avalonia-12) · [Built with Avalonia: JetBrains](https://avaloniaui.net/success/jetbrains)

---

### 1.3 路线 C：本地 Web 客户端 + 常驻进程（TypeScript / Node）

这条路线有**两笔内存**：常驻进程 + 用户的浏览器标签页。

#### (a) 常驻进程空载内存——本次本机实测

方法见 §7。同一台 Mac、同一时段、同一测量口径（RSS，运行 3–4 s 后采样）：

| 运行时（版本） | 空载 HTTP server | 裸解释器空转 |
| --- | --- | --- |
| **Bun** | **25.9 MB** | **22.5 MB** |
| **Deno** | 42.5 MB | 43.3 MB |
| **Node.js v24.18.0** | 45.5 MB | 42.5 MB |

`[实测·本机]`（本机版本：node v24.18.0、bun（`~/.bun`）、deno（`/opt/homebrew`））

**第三方交叉验证**（`[社区]` [dev.to 2025-12 对比](https://dev.to/pockit_tools/deno-2-vs-nodejs-vs-bun-in-2026-the-complete-javascript-runtime-comparison-1elm)）：Node.js 22 = 48 MB / Deno 2.0 = 42 MB / Bun 1.1 = 32 MB。**排序与本次实测一致（Bun < Deno ≈ Node）**，绝对值略有出入（版本与测量口径不同），因此这一结论可以放心用。

> Bun 官方另有宣称：Bun 1.4 相比前版「空闲 CPU 降低 5 倍、内存降低最多 35%」`[官方]` [Bun 1.4](https://bun.com/blog/bun-v1.4)——**厂商自述，未经独立验证**。

#### (b) 浏览器侧

| 项 | 数值 | 来源 |
| --- | --- | --- |
| 单个 Chrome 标签（基础页面） | 50–150 MB | `[社区]`（多家博客口径一致，无官方数据） |
| Chrome 单个渲染进程 | 50–150 MB | 同上 |
| 本机 Safari/WebKit 内容进程合计（当时打开的页面） | 121.5 MB | `[实测·本机]`（7 个 WebKit 进程 RSS 之和） |
| 本机 Electron 应用（WorkBuddy）主进程 + 辅助 node | 84.3 + 41.1 MB | `[实测·本机]` |

**路线 C 稳态内存 `[推算]`**：常驻进程 23–46 MB + 一个 Web 应用标签 50–150 MB ≈ **75–200 MB**。

**这个推算有一个对用户有利的解读**：如果用户本来就把浏览器开着（绝大多数桌面用户如此），那么浏览器进程的内存**已经付过了**，路线 C 的**边际内存增量等于常驻进程的 23–46 MB**——这是三条路线里唯一能做到"边际增量两位数 MB"的路线。

**CPU**：空载常驻进程的 CPU 接近 0（事件循环阻塞在 IO，`[实测·本机]` 观察期间无可见占用）。CPU 压力主要在浏览器渲染时出现，取决于前端实现质量，**无权威数据**。

#### (c) 路线 C 的机制性代价

本路线下浏览器**不直接访问文件系统**（文件 IO 交给常驻进程），因此 **File System Access API 的浏览器支持问题影响面很小**——这是关键结论，避免了一个常见误判。相关事实仍记录如下：

| API / 能力 | 支持情况 | 来源 |
| --- | --- | --- |
| File System Access API（本地磁盘读写） | Chrome/Edge 105+ ✅、Opera 91+ ✅；**Safari 全版本 ❌、Firefox 全版本 ❌** | `[官方]` [caniuse](https://caniuse.com/native-filesystem-api) |
| 同上（**移动端**） | Chrome for Android ❌、Safari on iOS ❌、Samsung Internet ❌ | 同上 |
| Firefox 立场 | 「harmful」，Mozilla standards-positions 明确反对 | `[官方]` 同上引用 |
| Origin Private File System（OPFS，沙箱内） | Safari / Firefox 支持 OPFS，但**不支持本地磁盘 picker** | `[官方]` [MDN File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) |

对 KnowFlick 的具体含义：现有 **局域网同步协议是纯 HTTP + `X-KnowFlick-Token`**（[SYNC_PROTOCOL.md](../SYNC_PROTOCOL.md) v2），路线 C 的常驻进程可以直接实现同一套 `/api/info`、`/api/cards` 契约，浏览器只做 UI——**协议层零改动**。离线能力靠 Service Worker + IndexedDB/OPFS，可行。

**真正的限制是产品形态，不是内存**：手机浏览器上无法写本地磁盘 → 手机上仍是"网页"而非"应用"（无后台常驻、无通知、无法与 Android 端共享本地库文件）。Android 端已有原生 App，路线 C 对手机只能做**只读浏览/同步入口**。

---

### 1.4 Electron / Tauri 与「不打包壳」的对照

任务要求查 Electron vs Tauri vs 「直接用外部浏览器」。这里有一处社区数据与可复现实测**严重冲突**，必须点明。

| 口径 | Tauri 内存 | Electron 内存 | 来源 |
| --- | --- | --- | --- |
| 社区普遍宣称 | 30–40 MB | 200–300 MB | `[社区]`（[Medium/raftlabs](https://medium.com/@raftlabs/tauri-vs-electron-a-practical-guide-to-picking-the-right-framework-5df80e360f26) 等，广泛转引） |
| **同机可复现 benchmark（Apple M4，2026-07）** | **794 MB（含 WebKit 进程树）**；主进程单独 177 MB | 未测 | `[实测·第三方]` [Nucleus](https://nucleusframework.dev/en/docs/performance/benchmarks/) |
| 真实用户报告 | 「app 二进制只占 8.5 MB，但 WebView2 一起就吃掉近 1 GB」 | — | `[社区]` r/tauri |

`[实测·第三方]` Nucleus 在同一个 benchmark 页里明确解释了这个差距的来源，是**测量口径问题而非事实矛盾**：

> Tauri/WKWebView 在 macOS 上是多进程的。Canvas 与 JS 跑在独立的 WebKit 进程（`com.apple.WebKit.WebContent` / `.GPU` / `.Networking`）里，不在 app 二进制内。仅统计主进程 RSS 是 177 MB，但把 WebKit 进程树加总才是真实占用 794 MB。

**结论**：宣称「Tauri 只用 30–40 MB」的口径**漏掉了系统 WebView 的进程树**。如果路线 C 把内存也按同样诚实的方式统计（浏览器标签 + 常驻进程），那么**「Tauri 壳」相比「直接用外部浏览器」并没有内存优势**——两者都吃系统 WebView 的钱，只是 Tauri 把这笔账藏进了自己的名字下。

**Tauri 在 Windows 上的额外事实**：依赖 WebView2，Windows 11 预装（`[官方]` [Tauri Webview Versions](https://v2.tauri.app/reference/webview-versions/)），Windows 7+ 支持；若要 embed 离线安装器（`webviewInstallMode: offlineInstaller`）**安装包增大 ~127 MB**（`[官方]` [Windows Installer](https://v2.tauri.app/distribute/windows-installer/)）。最小 app 可 <600 KB（`[官方]` [Tauri 首页](https://v2.tauri.app/start/)）。

**跨平台编译**：用户仓库已实测记录「Tauri 官方文档称跨平台编译为 last resort，仅 NSIS 实验性支持」`[实测·本机·历史]`（[STATUS §五](../STATUS_2026-09-14.md)）。

### 1.5 三条路线横向对照（口径已标注，**不可直接跨行比较**）

| 维度 | A · Compose Multiplatform | B · Avalonia | C · 本地 Web + 常驻进程 |
| --- | --- | --- | --- |
| 空载内存 | 108 MB（空窗口，mac，2021）`[官方issue]` | ~140 MB（idle，Win，2026）`[社区]` | 75–200 MB（`[推算]`，常驻 23–46 `[实测·本机]`） |
| 边际内存（用户已开浏览器时） | 108–153 MB | ~140 MB | **23–46 MB** |
| 中等负载峰值 | **616–695 MB**（JVM）/ 269–326 MB（GraalVM Native）`[实测·第三方]` | ~260 MB（10k 行表）`[社区]` | 无权威数据 |
| 启动 | ~21 ms（JVM）/ ~17 ms（Native）`[实测·第三方]`；冷启动是 JVM 弱项 | ~1.6s 冷 / ~0.6s AOT `[社区]` | 进程启动 ms 级；首屏取决于前端与网络栈 |
| 列表渲染 | 21 ms（与 JVM 一致，优于 Tauri）`[实测·第三方]` | 无同口径数据 | 取决于实现 |
| 发行体积 | dmg 45.5–64.9 MB / app 105–124 MB `[实测·第三方]` | 单文件 84.9 MB（未 trim）`[实测·本机·历史]`；AOT+trim 可更小 `[官方]` | 常驻进程运行时 30–90 MB + 前端静态资源 |
| 空载 CPU | 无权威数据，定性低 | 无权威数据，定性低 | 常驻进程 ≈ 0 `[实测·本机]` |
| 省内存的可用手段 | GraalVM Native（**不受官方支持**，CMP-1923 = Not Planned）；`-Xmx` 只能压堆、压不住 Skiko native | Native AOT + trimming（**官方支持**，无具体数字） | 选 Bun（实测最低）；浏览器侧无法控制 |

---

## 2. 复用度对比

### 2.1 本仓库的复用基线（本次实测，路线决策的直接输入）

对 `apps/android/app/src/main/kotlin/com/knowflick/app/` 逐文件统计（24,655 行 Kotlin，91 个文件）：

| 分类 | 文件数 | 行数 | 占比 |
| --- | --- | --- | --- |
| 含 `android.*` framework import（**必须平台化**） | 21 | 7,075 | 28.7% |
| 使用 `androidx.compose.*` 且**不含** `android.*`（**理论上可直接进 commonMain**） | 22 | 10,376 | 42.1% |
| 其余（Kotlin 纯逻辑 / `kotlinx.*` / `java.*`） | 48 | 7,204 | 29.2% |

把口径拆细（**两个不同的问题，不要混用**）：

| 问题 | 统计口径 | 文件数 | 行数 | 占比 |
| --- | --- | --- | --- | --- |
| 「我有没有用到 Compose？」 | 含 `import androidx.compose.*` | 33 | **15,520** | **62.0%** |
| 「我用到了非 Compose 的 androidx 吗？」 | 含 `androidx.*` 但不含 `androidx.compose.*` | 7 | 938 | 3.8% |
| 「我用到了 android framework 吗？」 | 含 `import android.*` | 21 | 7,075 | 28.7% |

**这里有一个对路线 A 有利、但容易算错的关键点**：上表第 3 行（7,075 行）是**下界而非上界**——因为很多文件同时命中多个口径（例如 `KnowFlickViewModel.kt`(1088) 同时有 `android.*` 与 `androidx.compose.*`）。真正「一行都不用改就能进 commonMain」的文件，是第 2 节那个交叉统计的 22 个文件 / 10,376 行（42.1%）；而「只要编译前处理掉 `android.*` 调用就能共用」的 Compose 代码有 15,520 行（62.0%）。

`domain/` 目录（4,141 行）：**86% 不含任何 Android 依赖**。

**必须平台化的重点文件**（行数降序）：`KnowFlickViewModel.kt`(1088)、`ui/CardFollowUpChatSheet.kt`(843)、`speech/SpeechController.kt`(772)、`MainActivity.kt`(526)、`export/CardPosterBitmapRenderer.kt`(517)、`ui/sync/SyncSheet.kt`(503)、`ui/DetailScreen.kt`(446)、`speech/SpeechPlaybackService.kt`(400)、`export/CardPosterExportSheet.kt`(370)、`widget/*`(546)、`ui/common/AudioEffectHelper.kt`(235)、`data/SystemCredentialStore.kt`(97)。

**为什么这些能平台化而不是重写**：Compose Multiplatform 官方明确「**shares the Compose compiler and runtime with Jetpack Compose and uses the same APIs**」，`androidx.compose.*` 包名在 CMP 中保持一致（`[官方]` [Relationship between CMP and Jetpack Compose](https://kotlinlang.org/docs/multiplatform/compose-multiplatform-and-jetpack-compose.html)）。因此 `import androidx.compose.foundation.*`、`material3.*`、`runtime.*` 这些**不需要改 import**——本仓库这三类 import 出现 378 + 280 + 137 + 124 次，是最大的一块可平移面。

**例外清单（官方列出，本仓库实际命中）**：`androidx.glance.*`（桌面小组件，Android 专有）、`androidx.security.crypto`（Keychain）、`android.content.*` / `android.graphics.*` / `android.os.*`（35 + 21 + 14 次）、`java.time` / `java.util.concurrent` / `java.net`（20 + 11 + 11 次）。

### 2.2 各路线复用度

| | 与现有 Android Compose 的 UI 复用 | 与 Android 的业务逻辑复用 | 与 macOS SwiftUI 端复用 | 净效果 |
| --- | --- | --- | --- | --- |
| **A · CMP** | **高**：同编译器、同运行时、同 `androidx.compose.*` 包名，import 基本不动（本仓 15,520 行 Compose 代码，其中 10,376 行不含 `android.*`） | **高**：`domain` 86% 无 Android 依赖；`kotlinx.serialization` 已在用 | **中**：可复用 [SYNC_PROTOCOL v2](../SYNC_PROTOCOL.md) 契约与 `WebClipEngine` 规则表，但语言不同（共享的是**契约与夹具**，不是代码） | Windows 端 ≈ Android 端的一次目标扩展；UI 层大量平移 |
| **B · Avalonia** | **零**：XAML + SkiaSharp vs Kotlin + Compose，无共享、无转换工具 | **零**（C#/XAML ≠ Kotlin）。Swift 端同样零 | **零** | Windows 端是**第三个独立实现**，需重写全部 UI + 领域逻辑 |
| **C · Web + 常驻** | **零**（浏览器 DOM/前端框架 vs Compose） | **中高**：同步协议是纯 HTTP + JSON，常驻进程可直接实现 `/api/cards` v2 信封；`WebClipEngine` 规则可移植到 TS | **中**：协议与 JSON 线格式共用 | UI 需重写；**但一份 Web UI 可覆盖 Win/Mac/手机浏览器** |

**B 与 Android 共享 UI 是否可行？** 不可行。Avalonia 自己可以出 iOS/Android 目标（自绘 Skia），但那要求**把 Android 端重写成 Avalonia**——等于放弃现有 24,655 行 Compose 端。官方也没有 Compose→Avalonia 的代码生成或迁移工具；只有在 GitHub Discussions 里的「Xamarin.Forms/MAUI → Avalonia」讨论，与 Compose 无关。`[官方]` [Avalonia Mobile](https://avaloniaui.net/avalonia/mobile) · `[社区]` [Avalonia Discussion #14842](https://github.com/AvaloniaUI/Avalonia/discussions/14842)

### 2.3 Compose Multiplatform 平台成熟度（2026-10 时点）

官方稳定度表（`[官方]` [Stability of supported platforms](https://kotlinlang.org/docs/multiplatform/supported-platforms.html)）：

| 目标 | Kotlin Multiplatform 核心 | **Compose Multiplatform UI** |
| --- | --- | --- |
| Android | Stable | **Stable** |
| iOS | Stable | **Stable**（自 1.8.0，2025-05 起） |
| **Desktop (JVM)** | Stable | **Stable** |
| Web (Kotlin/Wasm) | Beta | **Beta**（自 1.9.0，2025-09 起） |
| Web (Kotlin/JS) | Stable | — |

`[官方]` iOS Stable 公告：[CMP 1.8.0](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/) · Web Beta 公告：[CMP 1.9.0](https://blog.jetbrains.com/kotlin/2025/09/compose-multiplatform-1-9-0-compose-for-web-beta/)（「ready for real-world use by early adopters」）

**当前版本**：1.10.3（2026-03 版本文档）；1.10.0 引入统一 `@Preview`、Navigation 3 支持（非 Android 目标 Alpha）、**内置 Compose Hot Reload 默认开启**；部分依赖别名（`compose.ui` 等）已弃用，需改用直接版本引用；含 native/web 目标的项目需 Kotlin 2.2.20+。`[官方]` [What's new in CMP 1.10](https://kotlinlang.org/docs/multiplatform/whats-new-compose-110.html)

**桌面打包（Windows MSI/NSIS）成熟度**（`[官方]` [Native distributions](https://kotlinlang.org/docs/multiplatform/compose-native-distribution.html)）：

- 官方支持目标格式：Windows `.exe` / `.msi`、macOS `.dmg` / `.pkg`、Linux `.deb` / `.rpm`，基于 `jpackage` + `jlink`（jlink 只打包用到的 JDK 模块以压体积）。
- **交叉编译不支持**：「Cross-compilation is currently not supported, meaning you can build the specific format using the corresponding compatible OS only.」→ **`.msi` 只能在 Windows 上构建**。
- NSIS 不在官方 `TargetFormat` 列表中（列表中只有 `Exe` / `Msi`）。若需要 NSIS 安装体验，走第三方 Conveyor（非开源项目需付费许可）。
- jlink 需要手动声明所需 JDK 模块，否则 `ClassNotFoundException`。

**与 Android 共享 UI 的实际比例上限**：官方口径是「shares most of your UI code」`[官方]`，并配了 [Jetcaster 迁移指南](https://kotlinlang.org/docs/multiplatform/migrate-from-android.html)（Android-only → 四端共用）。该指南同时点出迁移的主要工作量在**替换 Android-only 依赖**（Dagger/Hilt→Koin、Coil 2→3、OkHttp→Ktor、JUnit→kotlin-test、`AnnotatedString.fromHtml()`→HtmlConverterCompose、`android.net.Uri`→uri-kmp）。**对本仓库的对应清单见 §2.1 的例外清单**——`androidx.security.crypto`、`androidx.glance`、`android.graphics`（海报位图渲染）都要各找替代。

**iOS/Web 状态对本次决策的意义**：iOS 与 Web 都**不是**本次 Windows 端要用的目标。把它们计入「跨平台一次开发多端同步」的收益时要谨慎——真正立刻兑现的只有 **Windows + Android 共用一份 Compose UI**。

---

## 3. 中国大陆网络环境的现实性

用户机器已装 v2rayN（`[实测·本机]`：`/Applications/v2rayN.app`），且仓库既有约定要求「GitHub 直连不稳时给 git 配代理」（[WINDOWS_ONBOARDING.md](../WINDOWS_ONBOARDING.md) §二）。下表按「无代理时是否可用镜像绕过」评级。

| 依赖 | 镜像可用性 | 详情 |
| --- | --- | --- |
| **Maven / Gradle 依赖（路线 A）** | ✅ 好 | 阿里云 Maven 公共代理仓库长期存在且被官方推荐（`[官方]` [阿里云镜像](https://developer.aliyun.com/mirror/maven/)）。仓库现有 [settings.gradle.kts](../../apps/android/settings.gradle.kts) 用 `google()` + `mavenCentral()`，**未配镜像**（`[实测·本机]`）——这是路线 A 要先补的第一件事 |
| **Gradle 发行版本体（路线 A）** | ✅ 好 | 华为云 `mirrors.huaweicloud.com/gradle/`（`[官方]` 实测可列出 8.14.x）、腾讯云 `mirrors.cloud.tencent.com/gradle/`、阿里云 `mirrors.aliyun.com/gradle/`。仓库 `gradle-wrapper.properties` 目前指向 `services.gradle.org` 且 `networkTimeout=10000, retries=0`——**国内首装容易直接失败**，建议改镜像 |
| **Compose Multiplatform 构件（路线 A）** | ⚠️ 需留意 | CMP 的部分构件在 `maven.pkg.jetbrains.space/public/p/compose/dev`。该域名与阿里云镜像的覆盖范围需要实测；已知社区问题（`[社区]` [moko-resources #874](https://github.com/icerockdev/moko-resources/issues/874)）提到把该仓库当通用仓库引入会产生解析问题 |
| **Kotlin/Native 工具链（路线 A 的 iOS 目标）** | ⚠️ 无镜像 | Kotlin/Native 预编译产物已上 Maven Central，但**宿主编译器仍从 `download.jetbrains.com/kotlin/native` 下载**（`[官方issue]` [KT-75836](https://youtrack.jetbrains.com/projects/KT/issues/KT-75836/Native-Host-compilers-on-maven-central)），缓存于 `~/.konan`。**Windows 端只用 JVM target，不需要它**——但若同时要 iOS 就绕不开 |
| **NuGet（路线 B）** | ✅ 中 | 微软官方中国镜像 `nuget.cdn.azure.cn/v3/index.json`（`[社区]`，多篇 2025 前后文章引用）、华为云 NuGet 镜像、腾讯云 NuGet 缓存加速 |
| **.NET SDK 本体（路线 B）** | ⚠️ 一般 | 无权威国内镜像站覆盖，主要靠 `dotnet.microsoft.com`；有 SourceForge 镜像但非官方 |
| **npm（路线 C）** | ✅ 好 | 腾讯/淘宝 npm 镜像成熟 |
| **crates.io（若考虑 Tauri）** | ✅ 好 | 清华 TUNA、中科大、rsproxy.cn 均有（`[官方]` [TUNA crates.io 帮助](https://mirrors.tuna.tsinghua.edu.cn/help/crates.io-index.git/)）；注意中科大自 2026-05-19 起不再支持完整克隆仓库 |
| **WebView2 Runtime（路线 C 若打包壳）** | ✅ | Windows 11 预装（`[官方]`）；离线嵌入安装包 +127 MB |

**评级**：路线 C（npm）与路线 A（Maven/Gradle，配镜像后）在中国大陆都没有真正的阻断点。路线 A 的**唯一硬门槛是需要 Windows 机器来构建 MSI**（jpackage 不支持交叉编译），这与仓库「双机协作」的设计相容，但要注意 CI 也必须换成 Windows runner。路线 B 的 .NET SDK 本体下载是三者中最缺国内镜像的一环。

---

## 4. 基于硬约束的推荐排序

用户两条硬约束：**① 跨平台一次开发多端同步（越少重复工作越好）** ② **性能与资源占用要求高**。

### 排序：A > B > C

**为什么 A 第一**

- 约束①上 A 不是略优而是**数量级上的优**：本仓库 62% 的 Android 代码使用 `androidx.compose.*`，而 CMP 与 Jetpack Compose 共用编译器和运行时、**保持同一套包名**——这批 import 不需要改（其中 42% 连 `android.*` 都不碰，可直接平移）。B 和 C 在这个维度上是 0。
- 约束②上 A 的短板**有明确的补丁路径**：JVM 默认堆 = 25% 物理内存这件事是配置问题（发布时显式 `-Xmx` 即可）；真正的高占用出现在中等以上负载（616–695 MB），而 GraalVM Native + PGO 把它拉到 269 MB 并顺带把启动降到 17 ms（`[实测·第三方]`）。
- 但必须如实说明**两处不确定性**（都不影响排序，影响执行计划）：
  1. **GraalVM 路线不受 JetBrains 官方支持**，CMP-1923 明确 Not Planned 原生桌面目标；AWT/Skiko 在 native image 下有已知限制，需要自己收集反射元数据。Nucleus 框架正是为填这个坑而生的第三方项目，其可行性未在本仓库验证过。
  2. **MSI 只能在 Windows 上构建**，CI 需要 Windows runner。

**为什么 B 第二，且是「资源优先」时的第一**

- B 的资源表现**最可预测**：idle ~140 MB、Native AOT 是官方支持的发布路径、无 WebView 进程树、无 JVM 堆默认值陷阱。
- 代价是约束①彻底归零：**Windows 端变成第三个独立实现**（先有 SwiftUI，再有 Compose，再有 XAML）。对「越少重复工作越好」这是最差的选择之一。
- 另有与资源无关但已由仓库既往调研确认的落地成本：代码签名（未签名会止步 SmartScreen）、**中文 IME 与 CJK 字体的真机调优**（默认字体不含 CJK 字形且不支持逗号回退链）、macOS 与 Windows 是两套后端因此 Mac 上测不出 Windows 问题（[STATUS §五](../STATUS_2026-09-14.md)）。

**为什么 C 最后**

- 约束②上 C 其实是**边际最优**的：用户已开浏览器时，新增内存只有常驻进程的 **23–46 MB**（实测 Bun 最低 25.9 MB），这是三条路线里唯一的两位数 MB 增量。若用户的诉求是「别再多一个占内存的常驻应用」，C 恰好命中。
- 但约束①上 C 与 B 一样是零共享，同时**多出一个 B 没有的问题**：手机上浏览器无法写本地磁盘（File System Access API 在 Chrome for Android / Safari iOS 均不支持），意味着手机端做不成真正的应用，只能当只读浏览入口——而 Android 原生端已经存在，路线 C 在移动端是**功能倒退**。
- 另外「不打包壳、直接用外部浏览器」相比「Tauri 壳」的省内存优势，实际上比宣传的小得多：Nucleus 同机实测把 Tauri 的 WebKit 进程树算进去是 **794 MB**，说明两者吃的是同一笔系统 WebView 的账，差别只在谁来记账（`[实测·第三方]`）。

### 一句话版本

**A 是唯一能兑现「一次开发多端同步」的选项，代价是 Windows 端内存基线在 100–150 MB、中等负载 600 MB+，需要用 GraalVM 或显式 `-Xmx` 把可控部分压住；B 是资源最优但复用度归零，等于写第三个 App；C 边际内存最低、协议层最省事，但手机端退化为只读入口。**

---

## 5. 不确定性标注

### 5.1 有官方口径（可直接引用）

- CMP 平台稳定度表（Desktop JVM / iOS = Stable，Web Wasm = Beta）、支持的打包格式列表、**不支持交叉编译**、`androidx.compose.*` 与 Jetpack Compose 同 API —— JetBrains 官方文档。
- Avalonia Native AOT 的收益是**定性**（启动更快、减少内存占用），官方**未给 MB 数字**；官方列出 AOT 的 4 项限制。
- Tauri 最小 app <600 KB、Windows 预装 WebView2、offlineInstaller 增 ~127 MB。
- File System Access API 浏览器支持（caniuse / MDN）：Safari 与 Firefox **全版本不支持**本地磁盘 picker。
- JVM 默认最大堆 = 物理内存 25%。
- Bun/Node/Deno 的 idle 内存**无官方实测口径**（Bun 1.4 的「内存降 35%」是厂商自述）。

### 5.2 是社区实测 / 单点测量（引用时需带出处，勿当权威）

- Avalonia idle ~140 MB / 活跃 ~260 MB / private ~165 MB、启动 1.6s→AOT 0.6s：来源为单一博主（ctco，2026-05）在一台 Ryzen 7 上的 LOB 应用测得的**一组数据**，无第二方复现。
- Avalonia Hello World 自包含发布 60–80 MB、Chrome 单标签 50–150 MB：多家博客口径接近但均无官方数据。
- Compose Desktop 空窗口 108 MB（mac）：来自 2021 年 issue 里的用户测量，**已 5 年**，Skia/Skiko 版本变化很大，**不应直接当作 2026 年的现状**。
- 社区宣称的「Tauri 30–40 MB vs Electron 200–300 MB」与同机可复现 benchmark（794 MB）冲突，**建议不采信前一说法**。

### 5.3 本报告的一手实测（口径最可控）

- 本机 Node/Bun/Deno 空载内存（§1.3a、§7）：同机同时段同口径，且与第三方数据排序一致。
- 本仓库 Android 代码构成统计（§2.1）：逐文件 import 扫描，可直接复现。
- 本机浏览器/Electron 进程树 RSS：单次采样，仅作量级参考。

### 5.4 没有权威数据 / 本次未能证实的

- **Compose Desktop 在 Windows 上的实际内存**：所有可得的 CMP 内存数据都来自 macOS/Linux 或 M4 机器。Skiko 在 Win32 后端下的表现**没有数据**。
- **Avalonia Native AOT 相对 JIT 的具体内存降幅**：官方只给定性描述，未找到可信的 MB 级对比（Avalonia 12 换渲染管线后更无数据）。
- **路线 C 中等负载下的浏览器内存与 CPU**：完全取决于前端实现，无行业基准。
- **三条路线的空载 CPU 占用**：均无权威数据，只有定性判断。
- **Compose Multiplatform 构件在中国大陆镜像下的实际拉取成功率**：本次未能在本机验证（本机无 JDK，无法实跑 Gradle 同步）。

### 5.5 方法论局限（应明示）

- 本机**有 JDK 17**（Homebrew `/opt/homebrew/opt/openjdk@17`，`tools/build_android.sh` 依赖它检测 JAVA_HOME）——`java` 命令不在 PATH 导致 `java -version` 报 stub 错误，属 PATH 未配置而非缺 JDK。但本次调研未实跑 Compose Desktop 内存测量（需先建 CMP 工程），二者数字仍全部来自外部来源。
- 无 Windows 机器，所有 Windows 侧结论均为二手。
- 本报告与本仓库 [STATUS_2026-09-14 §五](../STATUS_2026-09-14.md) 的既有实测**不重叠**：那次测的是「macOS 上能否跑起来/能否交叉编译」，本次测的是「内存与复用度」。

---

## 6. 若选路线 A，建议的立即可做事项（非本次任务范围，仅记录）

1. 给 [settings.gradle.kts](../../apps/android/settings.gradle.kts) 与 `gradle-wrapper.properties` 配国内镜像（阿里云 Maven + 华为/腾讯 Gradle 发行版），否则 Windows 机器首次同步会卡在 `networkTimeout=10000`。
2. 明确 `-Xmx` 发布值（JVM 默认 25% 物理内存必须显式覆盖）。
3. 在 Windows 真机上先测 **空窗口 + 中等负载**的真实内存，验证 §1.1 的 108 MB / 616 MB 两个数字是否适用——这是本报告最大的未知项。
4. 决定 GraalVM Native Image 是否进入发布路径（收益大但不受官方支持，且需要 PGO 流程：instrumented build → GUI run → rebuild）。

---

## 7. 附：本机实测方法与可复现命令

**环境**：macOS（darwin/arm64）；node v24.18.0（DimAgent 内置运行时）、bun（`~/.bun/bin/bun`）、deno（`/opt/homebrew/bin/deno`）。

**方法**：启动进程 → 等待 3–4 秒（避开启动峰值）→ `ps -o rss= -p <pid>` 读取 RSS → 加上 `pgrep -P <pid>` 子进程 RSS → 终止进程。空载 HTTP server 使用各运行时最小实现（Node `http.createServer`、Bun `Bun.serve`、Deno `Deno.serve`），各监听独立端口。

**复现脚本**：`/tmp/kf_idle_test.py`（用 `uv run python /tmp/kf_idle_test.py` 执行）

**进程树采样**：`ps -Aeo rss=,args=` 按关键字汇总（Electron / WebKit / 浏览器）。

**代码复用度统计**：对 `apps/android/app/src/main/kotlin/com/knowflick/app/` 下全部 `*.kt` 逐文件 `grep -E '^import (android|androidx|com\.google)\.'` 与 `^import androidx\.compose\.`，按行数归类汇总。

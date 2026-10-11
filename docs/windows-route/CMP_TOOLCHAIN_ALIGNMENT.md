# CMP 工具链对齐实验（2026-10-11）

> 承接 [KMP domain 探针结果](KMP_PROBE_RESULT.md)：领域层已经能在桌面 JVM 上跑，
> 本文件回答下一层问题——**桌面 UI 宿主（Compose Multiplatform）该用哪套版本，以及它和现有
> Android 构建怎么共处**。工作量与 UI 抽取范围见 [CMP-FEASIBILITY.md](CMP-FEASIBILITY.md)，
> 路线取舍见 [DECISION_MEMO.md](DECISION_MEMO.md)。

## 结论摘要

1. **三条版本路线全部实测通过**（编译 + 运行 + 离屏组合渲染 + 消费 `:domain` 产物），
   也就是说「Kotlin ↔ CMP ↔ Compose BOM 三方不对齐」这个被列为最大风险的前置条件，
   **已经从「未知风险」变成「三选一的取舍」**。
2. **最小改动路线是三处版本里只动一处**：`Kotlin 2.0.21 → 2.1.21` + 引入 `CMP 1.8.2`，
   **AGP 8.9.2 与 Compose BOM 2025.06.00 都不动**——因为 BOM 2025.06.00 锁的
   `androidx.compose.*` 正是 1.8.2，与 CMP 1.8.2 对应的 Jetpack Compose 版本逐号相同。
3. **独立构建可以让桌面端直接上现代版本，且不需要动 Android 端**：实测 Kotlin 2.4.21 的
   消费者能正常编译并运行由 Kotlin 2.0.21 编译的 `:domain` 产物（含 `@Serializable` 往返）。
   **但方向是单向的**：反过来（新编译器产出、旧编译器消费）会被元数据版本卡死，详见下文
   「元数据方向性」——这条决定了共享 UI 时谁必须升 Kotlin。
4. **Windows 目标可在 macOS 上编译**：显式取 `compose.desktop.windows_x64` 时解析到
   `skiko-awt-runtime-windows-x64:0.9.4.2`，构建通过（不能在本机运行）。
   出 MSI 仍需 Windows 机器（jpackage 不支持交叉编译，与既有报告一致）。

## 版本生态现状（先纠正一处过时前提）

调研报告（2026-10-10）把版本讨论停在「Kotlin 2.0.21 / CMP 1.7.3 / CMP 1.8+ 需 Kotlin ≥2.1」。
一天后实测镜像上的实际可用版本（`maven-metadata.xml`，阿里云公共镜像与 Maven Central 一致）：

| 组件 | 镜像上可见版本（尾部） |
| --- | --- |
| Kotlin | … 2.2.21 · 2.3.21 · **2.4.21** · 2.5.0-Beta1 |
| Compose Multiplatform | 1.7.3 · 1.8.2 · 1.9.3 · 1.10.3 · 1.11.1 · **1.12.1** · 1.13.0-alpha02 |

官方文档（[Compatibility and versions](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html)，页面日期 2026-09-22）给出两条硬规则：

- **CMP ≥ 1.8.0 要求 Kotlin ≥ 2.1.0**（K2 编译器切换的后果）；
- **「最新的 CMP 永远兼容最新的 Kotlin」，不需要手工对齐**；Compose 编译器插件版本必须等于 Kotlin 插件版本。

以及一张关键映射表——**CMP 与它对应的 Jetpack Compose 版本**：

| Compose Multiplatform | Jetpack Compose |
| --- | --- |
| 1.7.3 | 1.7.6 |
| 1.8.2 | **1.8.2** |
| 1.12.1 | 1.12.1 |

而本仓库 `apps/android/app/build.gradle.kts` 用的 `compose-bom:2025.06.00`，实测其 POM 锁的是
`androidx.compose.ui/runtime/foundation/animation = 1.8.2`（`material3 = 1.3.2`）。
**CMP 1.8.2 ↔ Jetpack 1.8.2 ↔ BOM 2025.06.00 三者严丝合缝**——这就是最小改动路线的依据。

## 实测矩阵

四个探针工程（`.scratch/cmp-toolchain/`，gitignore，不随仓库分发；关键配置见下文「复现」）：

| 路线 | Kotlin | CMP | 依赖的 `:domain` 产物 | 编译 | 测试 |
| --- | --- | --- | --- | --- | --- |
| `freeze`（冻结现状） | 2.0.21 | 1.7.3（skiko 0.8.18） | Kotlin **2.0.21** 编译的 `domain-jvm.jar` | ✅ | ✅ 2/2 |
| `aligned`（最小改动） | 2.1.21 | 1.8.2 | 同上 | ✅ | ✅ 2/2 |
| `modern`（现代版） | 2.4.21 | 1.12.1（skiko 0.9.4.2） | 同上 | ✅ | ✅ 2/2 |
| `win-target`（Windows 目标） | 2.1.21 | 1.8.2 + `desktop-jvm-windows-x64` | 同上 | ✅ | 未跑（Windows 二进制，本机不能执行） |

每个工程的两个测试是：

1. `domainSmokeRunsOnDesktopJvm`——`CardStore.replaceAll` + `KnowledgeCard` 的 `@Serializable`
   往返 + `SubjectRegistry.subjectSummaries` + `CardJson.encodeDate`，全部跑在桌面 JVM；
2. `composableRendersHeadless`——`runComposeUiTest { setContent { ProbeContent() } }`，
   **离屏**组合出真实 UI 并断言文本存在（不开窗口，不需要图形会话）。

即：Compose 桌面运行时在这些版本上**真的能渲染**，不只是「能编译」。

## 关键架构分叉：同一个 Gradle 构建，还是两个

探针暴露的真正决策点不是版本号，而是**构建拓扑**——因为 Gradle 的 Kotlin 插件版本在
一个构建内是共享的：

| | 同一构建（`:desktop` 进 `apps/android`） | 独立构建（桌面端自己的 Gradle 构建） |
| --- | --- | --- |
| Kotlin 版本 | 与 `:app` 共享 → 被 Android 端能承受的版本**封顶** | 各用各的，**版本隔离** |
| 今天就能上的版本 | `aligned`：Kotlin 2.1.21 + CMP 1.8.2（BOM 不动） | `modern`：Kotlin 2.4.21 + CMP 1.12.1 |
| `:domain` 消费方式 | `implementation(project(":domain"))`，零接线成本 | 需要产物机制：mavenLocal/文件仓库发布，或 composite build 替换 |
| Android 端风险 | 需要验证 AGP 8.9.2 与 Kotlin 2.1.21 的共存（**下一波**） | Android 端**完全不动** |
| 代价 | 桌面端被旧工具链拖住 | 多一套构建与发布接线；`shared/` 之外的复用点变「跨构建契约」 |

**实测支撑第 3 条结论**：`modern` 工程用 Kotlin 2.4.21 编译，消费 Kotlin 2.0.21 产出的
`domain-jvm.jar`，编译与运行全部通过——Kotlin 元数据的向后兼容在这里是成立的。

**诚实边界**：探针用的是 `files(domain-jvm.jar)` 直接引产物，验证的是**产物级前向兼容**；
独立构建所需的**真实接线（发布到 mavenLocal / 文件仓库，或 `includeBuild` 替换）本次未验证**。

## 元数据方向性：谁必须升 Kotlin（本实验最硬的一条约束）

「共享代码」在独立构建里变成「跨构建消费产物」，于是 Kotlin 元数据的**可读方向**就成了硬约束。
实测两个方向（生产者编 jar，消费者编代码）：

| 生产者 | 消费者 | 结果 |
| --- | --- | --- |
| Kotlin 2.1.21 | Kotlin 2.0.21 | ✅ 通过 |
| Kotlin 2.4.21 | Kotlin 2.0.21 | ❌ 失败 |

失败时的原文（可直接作为判据引用）：

```text
e: Class 'probenew.NewApi' was compiled with an incompatible version of Kotlin.
   The actual metadata version is 2.4.0, but the compiler version 2.0.0 can read versions up to 2.1.0.
```

即 **编译器只能向后读一个次版本的元数据**：Kotlin 2.0.21 最高读到 2.1.0。由此得到三条可直接用的推论：

1. **Android 端停在 2.0.21 时，能消费的最高产物是 Kotlin 2.1.x**——而 CMP ≥ 1.8.0 的最低要求恰好是
   Kotlin 2.1.0。所以「独立构建 + CMP 1.8.2 共享 UI + Android 端一行不改」在元数据层面是**成立**的。
2. 想要现代 CMP（1.9+/1.12，对应 Kotlin 2.2+/2.4+）共享 UI，**Android 端必须跟着升**——
   2.2 及以上的元数据，2.0.21 读不了。
3. 同一构建里插件版本共享，第 1 条的腾挪空间不存在：要让 `:app` 与桌面模块同处一构建且用 CMP 1.8.2，
   Android 端的 Kotlin 就必须到 2.1.x。

## 推荐路线

**先走「同一构建 + `aligned` 三方对齐」：Kotlin 2.0.21 → 2.1.21，AGP 8.9.2 与 BOM 2025.06.00 不动。** 理由：

- 只动一个版本号，桌面与 Android 的 Compose 版本逐号一致（都是 1.8.2），回归面最小；
- 同一构建下 `:domain` 就是普通项目依赖，没有发布接线这道额外工序；
- 2.1.21 正好落在「2.0.21 能读」的边界内，任何为兼容而临时保留的旧模块都不会被元数据卡住；
- 若这条走不通（见下），**独立构建路线已被本实验证明可行**：它可以做到 Android 端一行不改，
  代价是 `:domain` / 共享 UI 模块要成为跨构建契约，且桌面端与共享 UI 的 Kotlin 上限被锁在 2.1.x。

**这条推荐成立的前提尚未验证**：AGP 8.9.2 与 KGP 2.1.21 在真实 Android 工程上的共存
（实测预期是「高于已知上限」告警，非阻塞，但必须用 330 项测试 + Lint + R8 跑一遍才算数）。
这正是下一波清单第 1 项。

## 下一波清单（按依赖顺序）

1. **Android 端 Kotlin 2.1.21 升级试验**：改根 `build.gradle.kts` 的
   `org.jetbrains.kotlin.android` / `plugin.compose` / `plugin.serialization` 三处版本，
   跑 `./tools/build_android.sh` 全量（330 项测试 + Lint + R8 + 签名）。
   预期噪声：KGP 会对 AGP 8.9.2 打印「高于已知上限」告警（当前 2.0.21 已在打），非阻塞。
2. **`:desktop` 骨架进仓库**：Kotlin JVM + CMP 1.8.2 + `project(":domain")`，把本实验的
   `Main.kt` / 冒烟测试照搬，接进 CI（注意：**新模块的测试任务没人点名就会静默不跑**，
   `:domain:jvmTest` 的教训）。
3. **Windows 侧验证**：Windows 机器上跑 `runDistributable` 与 `packageMsi`；
   首次真机运行前不要宣称「Windows 端可用」。
4. **UI 抽取**：按 CMP-FEASIBILITY §4.1 的 A/B/C 三档推进（A 档平移、B 档抽接口、C 档各写）。

## 复现

```sh
# 三个工程的差异只在这四行
cd .scratch/cmp-toolchain/<freeze|aligned|modern>
#   plugins { kotlin("jvm") version "…" ; id("org.jetbrains.compose") version "…" }
#   implementation(files("../../../apps/android/domain/build/libs/domain-jvm.jar"))
#   testImplementation(compose.uiTest)   # 需 @file:OptIn(ExperimentalComposeLibrary::class)
#   compose.desktop { application { mainClass = "com.knowflick.desktopprobe.MainKt" } }

# :domain 产物（Kotlin 2.0.21 编译）
cd apps/android && ./gradlew :domain:jvmJar

# 跑任一路线
cd .scratch/cmp-toolchain/aligned && JAVA_HOME=…/openjdk@17 ./gradlew test

# Windows 目标（macOS 上可编译、不可运行）
#   把 implementation(compose.desktop.currentOs) 换成 compose.desktop.windows_x64
#   验证解析结果：./gradlew dependencies --configuration runtimeClasspath | grep windows
#   → org.jetbrains.skiko:skiko-awt-runtime-windows-x64:0.9.4.2
```

环境：Gradle 8.11.1、JDK 17（Homebrew openjdk@17）、macOS。CMP 1.12.1 那条线 KGP 会提示
「Gradle 8.11.1 已弃用，Kotlin 2.5.0 起最低 8.14.4」——若选现代路线，Gradle 需一并升级。

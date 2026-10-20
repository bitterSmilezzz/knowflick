# KMP domain 探针结果（2026-10-11）

> 前置：[Windows 端路线调研备忘](DECISION_MEMO.md) 决策树的「先做 domain 探针」分支。
> 本文件只记**实测结论与遗留项**；资源与工作量对比见 [RESOURCE-REPORT.md](RESOURCE-REPORT.md)，
> 逐文件纯度与 CMP 全量可行性见 [CMP-FEASIBILITY.md](CMP-FEASIBILITY.md)。
> 代码落地：`apps/android/domain/`（Gradle 模块 `:domain`）。

## 探针要回答的问题

来自 CMP-FEASIBILITY §4.3「需实测项」：

| # | 问题 | 本探针结论 |
| ---: | --- | --- |
| 1 | 双 JVM target（`androidTarget` + `jvm`）下，含 `java.time` / `java.util` 的文件能否放进共享源集？ | ✅ 能，但**不能**放 `commonMain`——用中间源集 `jvmAndAndroidMain`（见下） |
| 2 | Kotlin 2.0.21 时代的 KMP 与 AGP 8.9.2 能否共存？ | ✅ 构建/测试全绿，仅一条官方兼容性告警（非阻塞） |
| 5 | 本机构建环境（`java` 不在 PATH，JDK 在 `/opt/homebrew/opt/openjdk@17`） | ✅ 该 JDK 可用；另测得「领域层测试不需要 Android SDK」（见下） |

## 做了什么

新增 Gradle 模块 `apps/android/domain`（`:domain`）：

```text
apps/android/domain/
├── build.gradle.kts                     # KGP multiplatform + serialization + com.android.library
└── src/
    ├── commonMain/                      # 3 文件 129 行：CardTextUtils / CategoryRegistry / Tombstone
    ├── jvmAndAndroidMain/               # 16 文件 4020 行：卡片模型、卡库状态机、学科与学习范围、
    │                                    #   统计、搜索、图谱、间隔重复、剪藏抽取（含 java.* 的全部文件）
    └── jvmTest/                         # 15 文件 2850 行：领域层测试套件（原在 app/src/test）
```

- **领域层 19 文件 4149 行整体迁入**，包名保持 `com.knowflick.app.domain` 不变；装配层（`data/` `ui/` 根包）
  经 `implementation(project(":domain"))` 消费，**import 零改动**。
- 测试套件 15 文件一并迁入 `:domain:jvmTest`；`app/src/test` 从 46 文件降到 34 文件。
- 两侧 target 均为 JVM 17；`:domain` 只依赖 kotlinx-serialization（common）与
  `org.jetbrains.compose.runtime:runtime:1.7.3`（jvmAndAndroid，供 `@Immutable` 注解）。

## 结论 1：`java.*` 的落位是 `jvmAndAndroidMain`，不是 `commonMain`

**做法**：在 `build.gradle.kts` 里手建中间源集，官方默认层级模板不给「JVM + Android」组合自动建共享源集
（[文档列为不支持组合](https://kotlinlang.org/docs/multiplatform/multiplatform-hierarchy.html)），
但 group 声明是 KGP 支持的扩展点，androidx 自己也在用同一手法（`datastore-core` 的 `jvmAndAndroidMain`）：

```kotlin
applyDefaultHierarchyTemplate {
    common {
        group("jvmAndAndroid") {
            withAndroidTarget()
            withJvm()
        }
    }
}
```

**实测的反例（重要）**：把 `java.time.Instant` 放进 `commonMain`，`:domain:build` **也能通过**。
但原因不是「commonMain 支持 `java.*`」，而是本配置下元数据编译任务被禁用：

```text
> Task :domain:compileCommonMainKotlinMetadata SKIPPED
Skipping task ':domain:compileCommonMainKotlinMetadata' as task onlyIf 'Task is enabled' is false.
```

即 `commonMain` 从不单独编译，只随各 target 编译，而两个 target 都是 JVM 家族——`java.*` 于是解析得通。
**这是当前 target 组合的副作用，不是可依赖的契约**：一旦加入非 JVM target（iOS / Web）或启用元数据编译
立即失效。因此仓库把含 `java.*` 的文件显式留在 `jvmAndAndroidMain`：把可移植边界画在源集上，
而不是押在一个被跳过的任务上。

**推论**：领域层今天的可移植上限是 **JVM 家族宿主**（Android + Windows/macOS/Linux 桌面）。
要往 iOS / Web 走，先做 CMP-FEASIBILITY §2.2 的选项 1：`java.time` → `kotlinx-datetime`、
`java.util.Collections/Arrays/UUID` → Kotlin 标准库等价物（9 文件约 25 处调用）。

## 结论 2：工具链共存 —— 可用，有一条告警

Kotlin 2.0.21 + KGP multiplatform + AGP 8.9.2 + Compose BOM 2025.06.00 在本模块共存，构建与测试全绿。
唯一噪声是 KGP 的官方兼容性告警：

```text
Kotlin Multiplatform <-> Android Gradle Plugin compatibility issue:
The applied Android Gradle Plugin version (8.9.2) is higher than the maximum known to the Kotlin Gradle Plugin.
Maximum tested Android Gradle Plugin version: 8.5
```

这是**已知上限声明**（KGP 2.0.21 未测过 AGP 8.9），不是错误。可加
`kotlin.mpp.androidGradlePluginCompatibility.nowarn=true` 抑制；本项目**暂不抑制**，保留可见性——
真出问题时这条告警是第一线索。

## 测试与环境证据

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 领域层（桌面 JVM，无 Android 运行时） | `./gradlew :domain:jvmTest` | **171 项全绿** |
| Android 装配层单测 | `./gradlew :app:testDebugUnitTest` | **159 项全绿** |
| Lint（两个模块） | `./gradlew :app:lintDebug` | 无 error |
| 学科契约 | `python3 tools/check_taxonomy.py` | 通过（脚本路径已随迁） |
| 合并总数 | 二者相加 | **330 项**（迁移前 app 单侧 330 → 迁移后 159 + 171） |

**「领域层测试不需要 Android SDK」的实测**（回答 4.3 #5，也是本次最有用的环境事实）：

```sh
# 移走 local.properties 并把 ANDROID_HOME 指向不存在的路径
mv apps/android/local.properties /tmp/ && \
ANDROID_HOME=/nonexistent-android-sdk ./gradlew --console=plain --rerun-tasks :domain:jvmTest
# → BUILD SUCCESSFUL，171 项重新执行（不是 UP-TO-DATE 复用）
```

对照，同样条件下 Android 装配层在**配置阶段**就失败：

```text
* What went wrong:
Could not determine the dependencies of task ':app:compileDebugJavaWithJavac'.
> SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable
  or by setting the sdk.dir path in your project's local properties file.
```

**意义**：Windows（或任何只有 JDK 17 的机器）拿到仓库即可**编译并测试共享领域层**——领域逻辑的
增量开发、走查与回归不必先装 Android SDK / Android Studio。要出 Android 产物仍需 SDK。

## 复现命令

```sh
cd apps/android
export JAVA_HOME=/opt/homebrew/opt/openjdk@17      # macOS；Windows 用 JDK 17 安装路径

./gradlew :domain:jvmTest                          # 领域层 171 项（桌面 JVM）
./gradlew :app:testDebugUnitTest :domain:jvmTest :app:lintDebug   # CI 同款门禁
```

CI 与本地脚本已同步：`.github/workflows/android.yml` 与 `tools/build_android.sh` 都显式点名
`:domain:jvmTest`，workflow 的「汇总测试结果」步骤同时扫 `app/…/testDebugUnitTest/*.xml` 与
`domain/…/jvmTest/*.xml`——**不点名就会静默少跑 171 项**，这是本次迁移最容易踩的坑。

## 遗留项（留给下一波）

1. **CMP UI 共享**：本探针只到领域层，桌面 UI 宿主还不存在。UI 平台绑定与工具链三方对齐见
   CMP-FEASIBILITY §4.3 #2/#3/#4，粗估 22–35 人日（Windows 端首版）。
2. **非 JVM target**：要 iOS / Web 需先替换 `java.*`（见结论 1 的推论），约 9 文件 25 处。
3. **测试未 commonTest 化**：171 项落在 `jvmTest` 且写的是 `org.junit` API；转 `kotlin.test`
   才能在多 target 复用（纯机械改动，涉及 2850 行）。当前 jvm 目标已同时覆盖「桌面」与
   「Android 上的 JVM 语义」，不影响本探针结论。
4. **Windows 机器就位时间**：决定下一步（domain 共享 + 另写 UI，还是全量 CMP）在物理哪台机器做。

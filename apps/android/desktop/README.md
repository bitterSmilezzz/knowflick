# :desktop —— 桌面宿主骨架

Kotlin JVM + Compose Multiplatform 的**骨架**宿主（不是产品界面）。它与 Android 端共用
`apps/android/domain`（`:domain`，KMP）里的同一份领域逻辑。

## 现状

| 项 | 状态 |
| --- | --- |
| 共享领域层 | ✅ `implementation(project(":domain"))`，卡库状态机 / JSON 线格式 / 学科表均可用 |
| 共享界面层 | ✅ `implementation(project(":shared-ui"))`——主题与 `KnowledgeCardTeaser` 与 Android 端是同一份代码 |
| Compose 运行时 | ✅ CMP 1.8.2，与 Android 端 `compose-bom:2025.06.00`（`androidx.compose.*` = 1.8.2）逐号对齐 |
| 离屏渲染测试 | ✅ `./gradlew :desktop:test`（2 项：领域层复用 + 共享界面无头渲染） |
| 三端目标 | ✅ 一份产物跑 Windows / macOS / Linux（jvm target；实际打包各端各出） |
| 真实界面 | ❌ 未实现——属「UI 抽取」波次，范围见 [CMP-FEASIBILITY §4.1](../../../docs/windows-route/CMP-FEASIBILITY.md) |
| 卡库持久化 | ❌ 桌面侧还没有 data 层；`DomainBridge` 用示例卡验证链路 |
| 打包分发 | ❌ 未接（`packageMsi` / `packageDmg` / `packageDeb` 需各端真机验证） |

总目标与决策见 [ADR-0001](../../../docs/adr/0001-desktop-tri-platform-shared-kotlin.md)。

跑起来看骨架窗口：

```sh
cd apps/android
./gradlew :desktop:run          # 需要图形会话；测试用 headless，不进 CI 的窗口路径
./gradlew :desktop:test         # 只需 JDK 17——**不需要 Android SDK**
```

## 为什么暂驻 `apps/android/` 构建内

`apps/*/` 的约定是「一端一目录」，这里的安排是一个**有意的暂时取舍**：

- Compose Multiplatform 的 UI 共享要求共享模块**同时有 android 与 jvm 两个 target**，
  而 android target 必须在 Android 构建里编译（`:app` 要消费它）。所以共享代码天然长在
  `apps/android` 下；
- 宿主自己则既可以留在这个构建里（`project(":domain")` 零接线成本），也可以独立成
  `apps/desktop/` 自己的构建（走 composite build 或产物发布，版本可解耦）。

选型矩阵与实测见 [CMP 工具链对齐实验](../../../docs/windows-route/CMP_TOOLCHAIN_ALIGNMENT.md)。
**什么时候该挪**：当 Windows 端要独立发版、要自己的 CI 与打包流水线时，把宿主提升为
`apps/desktop/`（或 `apps/windows/`）并配自己的 workflow；届时共享模块仍留在
`apps/android`，两者通过 composite build / 产物契约相连。

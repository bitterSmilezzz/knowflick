# KnowFlick — Agent 工作手册

> 本文件是**项目级**约定，随仓库分发：任何机器上的任何 agent 在同一份规则下工作。
> 机器/环境相关的事（装什么、怎么起）见 [双机开发环境](docs/WINDOWS_ONBOARDING.md)。
> 领域语言以 [CONTEXT.md](CONTEXT.md) 为准；多端协作规范以 [MULTI_PLATFORM.md](docs/MULTI_PLATFORM.md) 为准。

## 仓库定位

KnowFlick 是多端学习工作台。**目标架构（[ADR-0001](docs/adr/0001-desktop-tri-platform-shared-kotlin.md)）：Windows / macOS / Linux 三端 + Android 共用一份 Kotlin Multiplatform + Compose Multiplatform 代码**——`:domain`（逻辑）+ `:shared-data`（持久化）+ `:shared-ui`（界面）共享，各端只是薄宿主。现状：`apps/android`（`:app` Android 宿主 + 三个共享模块 + `:desktop` 桌面宿主）· `apps/mac`（Swift/SwiftUI，**第二实现，已冻结新增能力**，按第一原则收敛退役）· `shared/assets`（契约与底图）。

**当前处于产品转向期**：预置知识库已退役（PR #70），知识内容改由用户剪藏/导入产生。规格见 [剪藏提炼复习设计规格](docs/CLIP_INGEST_DESIGN_2026-10.md)。**实现新功能前先读该规格，不要按 old seed 库时代的假设写代码。**

## 第一原则：一套开发，多处发布

**一份代码，多处产出。** 任何改进若引入**第二份实现**（同一能力在各端各写一遍）、或把本可共享的代码按端分叉，
都要回避——除非项目所有者明确拍板接受这次例外。

- **目标矩阵**：Android · Windows · macOS · Linux，共享 `:domain`（逻辑）+ `:shared-ui`（界面），各端只是薄宿主。
- **允许各端各写的只有「平台边界」**：系统分享 / 通知、TTS 与音频通道、文件选择器、系统返回、平台资源读取……
  且必须收在 `expect`/`actual` 或宿主适配层里，**不允许复制整块逻辑**。
- **历史例外（只许收敛，不许扩大）**：`apps/mac` 的 Swift/SwiftUI 是第二份实现——**冻结新增能力**，
  待共享端达到功能对等后退役；不要往它里面加「只有 mac 才有」的功能。
- **判断口径**：动手前先问「这件事能不能只写一次？」；答不上来就别写第二遍。
  同理，**共享模块的依赖要为四端考虑**（钉一个只有单端可用的库 = 变相分叉），见 [UI_EXTRACTION](docs/windows-route/UI_EXTRACTION.md) 里 Material 图标那条。

## 双机协作铁律

**两台开发机（macOS / Windows）通过 GitHub 协作，永不同步工作目录。**

1. **同步中枢只有 GitHub。** 禁止用 iCloud / 网盘 / SMB / 局域网盘同步工作树——两个 agent 同时写同一份 `.git` 必然损坏索引；构建目录（mac `.build` 1.8G、android `build` 258M）也完全不该跨机复制。
2. **一个分支同一时刻只在一台机器签出。** 接活前 `git fetch && git log --oneline origin/main -5` 确认起点；开工先推到 origin（哪怕空提交），另一台机器看到的分支就是「已被占」。
3. **改动的端在能验证它的机器上做。** Xcode 只有 mac 有（UI 层编译验证）；Windows SDK 只有 Windows 机有。表：

   | 改动 | 在哪台机器做 | 验证命令 |
   | --- | --- | --- |
   | `apps/mac/**` UI 层 | macOS | 云端 CI（无完整 Xcode 时）或本地 `./tools/test.sh` |
   | `apps/mac/**` Core | 任意机器可改 | `./tools/test.sh --core-only`（只需 CommandLineTools） |
   | `apps/android/{domain,shared-data,shared-ui,desktop}/**`（共享逻辑 / 持久化 / 界面 + 桌面宿主） | 任意机器，**只需 JDK 17，不要 SDK** | `cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test`（201 项） |
   | 其余 `apps/android/**` | 任意机器（JDK 17 + SDK） | `./tools/build_android.sh` |
   | `shared/**` 契约 | 任意机器，但**两端 CI 都要绿** | `python3 tools/check_taxonomy.py` |
   | Windows 端 | Windows | 视路线而定 |

4. **合并前 rebase 到最新 main**（保持线性历史，与仓库既有习惯一致）。
5. **CI 是跨机的裁判。** 本地跑不了的验证（mac UI 层）由 [macOS workflow](.github/workflows/macos.yml) 在云端 Xcode runner 上兜底；永远不要以「我这边跑不了」为由跳过 CI 结论核对。

## 提交与分支

命名、提交信息格式、tag 规则**全部以** [MULTI_PLATFORM.md](docs/MULTI_PLATFORM.md) §分支模型 为准，此处不重复。要点：

- 分支：`<端>/<主题>`（`mac/…`、`android/…`、`win/…`、`chore/…`、`docs/…`），从最新 main 切出，完成即合回并删除。
- 提交：`<type>(<端>): <描述>`；跨端用 `repo` 或省略。
- **只暂存本任务明确修改的文件**（显式路径 `git add`），不用 `git add -A`；不碰无关改动；不加 `--no-verify`。

## 验证与交付

**改完代码跑对应验证，跑不了就如实说明并指明 CI 兜底。** 常用命令：

```sh
./tools/test.sh --core-only        # mac Core（CLT 环境可跑，多数改动够用）
./tools/test.sh                    # mac 全量（需完整 Xcode）
cd apps/mac && ./build_app.sh      # mac 打包
./tools/build_android.sh           # android：单测 + Lint + release + 签名校验
cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test   # 共享逻辑/持久化/界面 + 桌面宿主 201 项（只需 JDK 17，无需 SDK）
cd apps/android && ./gradlew :desktop:packageDmg   # 桌面安装包（本系统；发布三端由 desktop.yml 的 matrix 出）
./tools/sync_shared_assets.sh      # 共享资源同步（两端测试脚本会自动调）
python3 tools/check_taxonomy.py    # 三处学科契约一致性
```

发版流程见 [MULTI_PLATFORM.md](docs/MULTI_PLATFORM.md) §提交与发布；产物不入 Git，Release 附件依赖本地上传（android）或 CI workflow（mac `v*` tag）。

## 会话工作区与文档纪律

- **临时产物写 `.scratch/<主题>/`**（已 gitignore），不要散落在仓库根目录；不要提交 `.scratch/` 内容。
- 跨会话的结论要**落到仓库**（`docs/` 或代码注释），只写在 `.scratch/` 的结论另一台机器看不到。
- 发布记录写 `docs/<端>_RELEASE_<版本>.md`；CHANGELOG 顶部对应端的分节登记。**两端的 CHANGELOG 与 docs 是同仓文件——这就是为什么禁止长期分叉分支，也是为什么改动要小步合回。**
- 修改领域语言（新词条、口径变化）→ 同步更新 [CONTEXT.md](CONTEXT.md)；架构决策 → `docs/adr/`（首个：[ADR-0001 桌面三端与 Android 共用一份代码](docs/adr/0001-desktop-tri-platform-shared-kotlin.md)）。

## 已知陷阱

- **`shared/assets` 不要在 `apps/*/` 留副本**——mac 用 `sync_shared_assets.sh` 生成进 bundle，android 用 Gradle `assets.srcDirs` 直读；两份副本必然漂移（历史教训见 MULTI_PLATFORM.md）。
- **mac UI 层报 `SwiftUIMacros.StateMacro` 找不到 = 缺完整 Xcode**，不是代码问题，交给 CI。
- **行尾**：仓库一律 LF（`.gitattributes` 管辖）。Windows 上 clone 后如果 `git status` 出现大范围假修改，先查 `git config core.autocrlf`——应为 `false`（或 `input`），不要设为 `true`。
- **两个 workflow 路径过滤**：改 mac 不会触发 android CI、反之亦然。改了 `shared/**` 则两端 CI 都会跑——这是有意设计，因为契约漂移必须两端同抓。
- **Gradle 任务要显式点名 `:domain:jvmTest` / `:shared-data:jvmTest` / `:shared-ui:jvmTest` / `:desktop:test`**：这四个模块都不在 `:app` 的依赖图里，跑 `:app:testDebugUnitTest` 不会带上它们，也不会报错，只是静默少跑。`tools/build_android.sh`、`android.yml`、`desktop.yml` 已同步点名，改验证命令时别漏。
- **跨模块后 `internal` 直接失效**：Kotlin 的 `internal` 按**模块**算，把类搬进共享模块后，宿主再访问原先的 `internal` 成员就编译不过（`:shared-data` 迁移时 `AppModel.storage`、`CardPersistenceQueue` 都踩了）。要么公开并说明理由，要么在共享模块内收口——别用「本来就是 internal」当借口把 API 面搅乱。
- **新增 Gradle 模块必须同时更新四处**：`tools/build_android.sh`、`android.yml` 的测试步骤、workflow 里「汇总测试结果」的 glob 路径、以及 `desktop.yml` matrix 里的任务列表——只改名不加汇总，CI 绿了但覆盖率已经掉了。
- **搬文件进共享模块时不要改包名**：`:domain`（`com.knowflick.app.domain`）、`:shared-data`（`com.knowflick.app.data`）与 `:shared-ui`（`com.knowflick.app.ui`）都保持原包名，调用方 import 零改动。这是上万行代码能分批平移的前提，别为了「模块名好看」制造上千处 import 改动。
- **`java.*` 不要放进 `:domain` 的 `commonMain`**：当前 `androidTarget + jvm` 组合下能编译通过，但那是元数据编译被跳过的副作用，加非 JVM target 即失效；含 `java.time`/`java.util` 的文件放 `jvmAndAndroidMain`（依据见 [KMP 探针结果](docs/windows-route/KMP_PROBE_RESULT.md)）。
- **界面搬进 `:shared-ui` 会遇到三类平台边界**（实测清单见 [UI_EXTRACTION](docs/windows-route/UI_EXTRACTION.md)）：系统返回 `BackHandler` 桌面不存在（**外移宿主**，CMP 1.8 没有公共替代）；多平台 Material 图标停更于 1.7.3；含 `java.*` 的界面文件放 `jvmAndAndroidMain`。挑文件别靠印象——`python3 tools/classify_ui_portability.py` 按依赖闭包分档。
- 全仓扫描类工作**严禁 head 截断后下「清零」结论**（PR #45 教训）。

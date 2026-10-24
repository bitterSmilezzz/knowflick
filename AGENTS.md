# KnowFlick — Agent 工作手册

> 本文件是**项目级**约定，随仓库分发：任何机器上的任何 agent 在同一份规则下工作。
> 机器/环境相关的事（装什么、怎么起）见 [双机开发环境](docs/WINDOWS_ONBOARDING.md)。
> 领域语言以 [CONTEXT.md](CONTEXT.md) 为准；多端协作规范以 [MULTI_PLATFORM.md](docs/MULTI_PLATFORM.md) 为准。

## 仓库定位

KnowFlick 是多端学习工作台。**活计划是 [ADR-0002](docs/adr/0002-desktop-web-split-from-android.md)**：Windows / Linux / macOS 与稍后的网页共用一份 Web 界面（Vite + React + TypeScript）加 Tauri 壳；Android 单独留在现有 Kotlin / Compose。iOS 先不做。两套共享 `cards.json` 与 `settings.json` 的结构，不共享界面。

现状里的 Kotlin 共享模块仍然在：`apps/android` 的 `:app`、`:domain`、`:shared-data`、`:shared-ui`，外加已冻住的 `:desktop`（JVM + Skiko）。`:desktop` 不再加功能，第一套闭环跑通之前不删。Swift/SwiftUI 的 `apps/mac` 已删除，不要恢复。`shared/assets` 仍是契约与底图。

[ADR-0001](docs/adr/0001-desktop-tri-platform-shared-kotlin.md) 是「桌面跟安卓共用 Compose」那条旧活计划的记录，新功能不要按它往 `:shared-ui` 里加桌面界面。

**产品**：预置知识库已退役，知识来自用户剪藏与导入。第一套第一版只做学习闭环（剪藏、笔记导入、AI 出卡、刷卡、卡库与详情、收藏与历史、测验、统计、导出）。条目 / wiki 等模型仍搁置，不要写进 [CONTEXT.md](CONTEXT.md)。细节以 ADR-0002 为准。

## 第一原则：一套开发，多处发布

**同一套里一份代码。** 项目所有者已拍板：桌面加网页是一套，安卓是另一套（[ADR-0002](docs/adr/0002-desktop-web-split-from-android.md)）。这是接受的分界，不是再往下拆的许可证。

- **第一套**：Windows、Linux、macOS 一份 Web 界面。不要为 Windows 再写一套，也不要把这套界面做进 `:shared-ui`。
- **第二套**：安卓的 Kotlin 模块内部仍然一份代码。平台边界（分享、通知、文件选择、系统返回）留在宿主。
- **不要恢复** `apps/mac`。**不要**把安卓和 iOS 绑成一个新框架。iOS 按 ADR-0002 先不做。
- **判断口径**：动手前先问「这件事落在哪一套？」同一套里能写一次就写一次。

## 双机协作铁律

**两台开发机（macOS / Windows）通过 GitHub 协作，永不同步工作目录。**

1. **同步中枢只有 GitHub。** 禁止用 iCloud / 网盘 / SMB / 局域网盘同步工作树——两个 agent 同时写同一份 `.git` 必然损坏索引；构建目录（`apps/workbench` 的 `node_modules/` 与 `src-tauri/target/`、android 的 `build/`、仓库根的 `dist/`）也完全不该跨机复制。
2. **一个分支同一时刻只在一台机器签出。** 接活前 `git fetch && git log --oneline origin/main -5` 确认起点；开工先推到 origin（哪怕空提交），另一台机器看到的分支就是「已被占」。
3. **改动的端在能验证它的机器上做。** 三端安装包只能在各系统本地构建（Tauri 与 jpackage 都不支持交叉编译）；Android 装配层（`:app`）要 SDK，其余 Kotlin 模块只要 JDK 17。表：

   | 改动 | 在哪台机器做 | 验证命令 |
   | --- | --- | --- |
   | 已删除的 `apps/mac/**` | — | 不要恢复 |
   | `:desktop`（JVM + Skiko） | — | 已冻住：不加功能，闭环跑通前不删。新桌面不在这里加 |
   | `apps/workbench/**`（第一套桌面，Vite + React + Tauri） | 任意机器（Node + Rust） | `./tools/verify_workbench.sh`（`npm test` + `tsc` + `cargo test`，同 `workbench.yml`）；发布另走 [workbench-release.yml](.github/workflows/workbench-release.yml)（tag `workbench-v*`，三台 runner 各出一档） |
   | `apps/android/{domain,shared-data,shared-ui,desktop}/**`（共享逻辑 / 持久化 / 界面 + 桌面宿主） | 任意机器，**只需 JDK 17，不要 SDK** | `cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test`（201 项） |
   | 其余 `apps/android/**` | 任意机器（JDK 17 + SDK） | `./tools/build_android.sh` |
   | `shared/**` 契约 | 任意机器，但**两端 CI 都要绿** | `python3 tools/check_taxonomy.py` |
   | Windows / Linux 上的安装与首启 | Windows / Linux | 装完跑一遍冒烟：导入 → 刷卡 → 测验 → 导出（本机只能出 DMG，这两档未实测） |

4. **合并前 rebase 到最新 main**（保持线性历史，与仓库既有习惯一致）。
5. **CI 是跨机的裁判。** 共享端与 Android 由 android.yml / desktop.yml 兜底。Swift 的 macos.yml 已随 `apps/mac` 删除。

## 提交与分支

命名、提交信息格式、tag 规则**全部以** [MULTI_PLATFORM.md](docs/MULTI_PLATFORM.md) §分支模型 为准，此处不重复。要点：

- 分支：`<端>/<主题>`（`workbench/…`、`android/…`、`desktop/…`、`chore/…`、`docs/…`），从最新 main 切出，完成即合回并删除。mac 端已删除，不再有 `mac/*` 分支。
- 提交：`<type>(<端>): <描述>`；跨端用 `repo` 或省略。
- **只暂存本任务明确修改的文件**（显式路径 `git add`），不用 `git add -A`；不碰无关改动；不加 `--no-verify`。

## 验证与交付

**改完代码跑对应验证，跑不了就如实说明并指明 CI 兜底。** 常用命令：

```sh
./tools/build_android.sh           # android：单测 + Lint + release + 签名校验
cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test   # 共享逻辑/持久化/界面 + 桌面宿主（只需 JDK 17，无需 SDK）
cd apps/android && ./gradlew :desktop:packageDmg   # 冻结 JVM 桌面安装包（本系统；三端由 desktop.yml 的 matrix 出）
./tools/verify_workbench.sh        # 第一套桌面（apps/workbench）：npm test + tsc + cargo test（三端安装包由 workbench-release.yml 出）
python3 tools/check_taxonomy.py    # 契约 JSON 与共享端学科表一致
python3 tools/check_clip_parity.py # 剪藏规则表：Kotlin ↔ TypeScript 逐条一致（有序表按序比、集合表按集合比、token 必须全小写）
```

发版流程见 [MULTI_PLATFORM.md](docs/MULTI_PLATFORM.md) §提交与发布；产物不入 Git，Release 附件依赖本地上传（android）或 CI workflow（`workbench-v*` 与 `desktop-v*` tag）。

### Rust 编译产物定期清理（存储不会无限膨胀）

`apps/workbench/src-tauri/target/` 会随构建无限增长（本轮清理前实测约 15 GB）。本机装了**独立于本仓**的周清理任务：

- **调度**：LaunchAgent `local.agents.rust-clean`，每周日 03:00 运行 `~/.agents/scripts/rust-clean-sweep.sh`
- **策略**：扫 `~/workspace` 下所有 `Cargo.toml`，仅当 `target/` ≥ 5 GiB 时执行 `cargo clean`（debug + release 全清）
- **护栏**：只要有 `cargo` / `rustc` / `rust-analyzer` / `cargo-tauri` 在跑，整轮跳过——正在构建或调试的产物不动；仓根放 `.rust-clean-skip` 可让本仓永久跳过
- **手动**：`~/.agents/scripts/rust-clean-sweep.sh --dry-run` 先看会清什么；`--project "$PWD"` 只清本仓。日志在 `~/Library/Logs/rust-clean/sweep.log`
- **代价**：清理后下一次 `cargo test` / `verify_workbench.sh` 是全量重编（几分钟）

## 会话工作区与文档纪律

- **临时产物写 `.scratch/<主题>/`**（已 gitignore），不要散落在仓库根目录；不要提交 `.scratch/` 内容。
- 跨会话的结论要**落到仓库**（`docs/` 或代码注释），只写在 `.scratch/` 的结论另一台机器看不到。
- 发布记录写 `docs/<端>_RELEASE_<版本>.md`；CHANGELOG 顶部对应端的分节登记。**两端的 CHANGELOG 与 docs 是同仓文件——这就是为什么禁止长期分叉分支，也是为什么改动要小步合回。**
- 修改领域语言（新词条、口径变化）→ 同步更新 [CONTEXT.md](CONTEXT.md)；架构决策 → `docs/adr/`。当前活计划是 [ADR-0002](docs/adr/0002-desktop-web-split-from-android.md)；[ADR-0001](docs/adr/0001-desktop-tri-platform-shared-kotlin.md) 已被它替代。

## 已知陷阱

- **`shared/assets` 不要在 `apps/*/` 留副本**——现在三处都是直接引用：android 用 Gradle `assets.srcDirs`、第一套桌面用 Vite `publicDir`（进 `dist/`）、`:desktop` 用 classpath 资源。两份副本必然漂移（历史教训见 MULTI_PLATFORM.md）。
- **行尾**：仓库一律 LF（`.gitattributes` 管辖）。Windows 上 clone 后如果 `git status` 出现大范围假修改，先查 `git config core.autocrlf`——应为 `false`（或 `input`），不要设为 `true`。
- **三条 workflow 的路径过滤**：改 `apps/workbench/**` 只触发 workbench 那两条，改 `apps/android/**` 只触发 android / desktop——都是有意设计，各端额度不互相烧。改 `shared/**` 与 `tools/**` 则多条会跑，因为契约与脚本是共用的。
- **Gradle 任务要显式点名 `:domain:jvmTest` / `:shared-data:jvmTest` / `:shared-ui:jvmTest` / `:desktop:test`**：这四个模块都不在 `:app` 的依赖图里，跑 `:app:testDebugUnitTest` 不会带上它们，也不会报错，只是静默少跑。`tools/build_android.sh`、`android.yml`、`desktop.yml` 已同步点名，改验证命令时别漏。
- **跨模块会连续踩两类 Kotlin 限制**（每次搬文件都验一遍）：① **`internal` 按模块算**——类搬进共享模块后，宿主再访问原先 `internal` 的成员直接编译不过（`AppModel.storage`、`CardPersistenceQueue`）；② **跨模块的 public 属性不能 smart cast**——`preview.settingsJson != null` 之后仍要落局部变量才能用（`:domain` 的 `editedAt`、`:shared-data` 的 `settingsJson` 都踩过）。处理原则：该公开的公开并写明理由，不要用转发方法堆间接。
- **宿主的重组契约：卡库与会话都不是 Compose 状态**——`CardStore`/`QuizSession` 是普通类，且评分只改**同一实例**的内部进度。宿主必须「写入后 `version++`」并且**版本驱动的屏幕外面套 `key(version)`**（只订阅会话实例收不到失效通知，会出现「评分后界面不动」这类静默故障）。Android 侧见 `MainActivity` 的 `key(viewModel.version)`，桌面侧见 `:desktop` 的 `DesktopHost`。
- **新增 Gradle 模块必须同时更新四处**：`tools/build_android.sh`、`android.yml` 的测试步骤、workflow 里「汇总测试结果」的 glob 路径、以及 `desktop.yml` matrix 里的任务列表——只改名不加汇总，CI 绿了但覆盖率已经掉了。
- **搬文件进共享模块时不要改包名**：`:domain`（`com.knowflick.app.domain`）、`:shared-data`（`com.knowflick.app.data`）与 `:shared-ui`（`com.knowflick.app.ui`）都保持原包名，调用方 import 零改动。这是上万行代码能分批平移的前提，别为了「模块名好看」制造上千处 import 改动。
- **`java.*` 不要放进 `:domain` 的 `commonMain`**：当前 `androidTarget + jvm` 组合下能编译通过，但那是元数据编译被跳过的副作用，加非 JVM target 即失效；含 `java.time`/`java.util` 的文件放 `jvmAndAndroidMain`（依据见 [KMP 探针结果](docs/windows-route/KMP_PROBE_RESULT.md)）。
- **共享屏的返回语义用接缝，不要外移给宿主**：`PlatformBackHandler(enabled) { … }`
  （Android actual=activity 的 BackHandler，桌面 no-op）。早期把返回外移到每个宿主调用点，结果是
  「一个屏的返回语义拆在两个文件里 + 宿主越写越厚 + 每迁一屏都要记得改宿主」；补上接缝后五处宿主包装全部删除。
- **界面搬进 `:shared-ui` 会遇到几类平台边界**（实测清单见 [UI_EXTRACTION](docs/windows-route/UI_EXTRACTION.md)）：
  系统返回用 `PlatformBackHandler` 接缝（**别外移到宿主**）；多平台 Material 图标停更于 1.7.3（钉 1.7.3）；
  含 `java.*` 的界面文件放 `jvmAndAndroidMain`；**自己开画布用平台绘图 API 量文字的界面搬不了**
  （实测知识图谱屏用 `android.graphics.Paint`，需改写成 `TextMeasurer`/`DrawScope` 才能共享）。
  挑文件别靠印象——`python3 tools/classify_ui_portability.py` 按依赖闭包分档，但**最终以真编译为准**。
- **共享代码不要硬编码 `Dispatchers.Main`**（实测教训）：`:shared-data` 的 `ChatStateHolder` 原先写死
  `withContext(Dispatchers.Main)`，Android 正常，但纯 JVM（桌面宿主/单测）里没有 Main 调度器 →
  `Module with the Main dispatcher had failed to initialize`，症状是「回答已流出、`isStreaming` 永不结束」。
  修法是把调度器做成**构造参数**（默认保持 `Dispatchers.Main`），由宿主注入。同类：`Dispatchers.IO`、系统时钟、默认时区。
- **Gradle 的输入校验先于任何 `doFirst` 执行**：想在「任务输入缺失」时给友好提示，`doFirst` 里守不住
  （实测：图标文件缺失时打包任务在动作执行前就因输入校验失败）。正确做法是**独立校验任务 + `dependsOn`**
  （见 `apps/android/desktop/build.gradle.kts` 的 `verifyAppIcons`）。
- **`paths` 过滤对 tag 推送不生效**（GitHub 官方文档原话："Path filters are not evaluated for pushes of tags"）：
  同一个 `push` 块里同时写 `tags:` 与 `paths:` 是安全的，tag 一定会触发。仓库旧文档曾写反过，别照旧说法去挑提交打 tag。
- **Tauri 打包别把 Vite `publicDir` 里的静态资源再列一遍 `bundle.resources`**：底图已随 `publicDir` 进 `dist/`，
  运行时按 `/bg/<key>.webp` 取；再 bundle 一份只会落进产物的 `_up_/` 前缀目录（运行时不经过它），
  实测让 DMG 从 11.64 涨回 13.96 MiB。改 `tauri.conf.json` 的 `bundle` 前后都该跑一次 `npm run tauri build -- --bundles dmg` 看体积。
- **`apps/workbench` 的图标是派生物**：源是**唯一一份美术** `shared/icons/AppIcon.iconset/`，
  用 `npx tauri icon <1024 源>` 生成，产物**入库**；它还会顺带生成 iOS / Android / Windows Store 那一堆用不上的目录，删掉再提交。
  ⚠️ **美术源本身不入 Git**（`.gitignore` 里忽略，理由见那里的注释）——仓库分发的只有派生出的
  `.icns` / `.ico` / `.png`。新 clone 的机器上没有 iconset，**要改图标得先拿到原始美术**，否则 `generate_app_icons.py` 会因找不到母版直接退出。
  `tools/build_icon.swift`（母版 → iconset，末尾自动调 `iconutil`）与 `tools/verify_icon.swift`（逐像素校验 ICNS 各阶是否与母版一致）
  是**同一套美术流程的本机步骤**：没有别的脚本引用它们，CI 也不跑它们——留着是给「拿到原始美术后照着重做」当参照，不是死代码，别顺手删。
- 全仓扫描类工作**严禁 head 截断后下「清零」结论**（PR #45 教训）。
- **别用文件 mtime 判断「内容变没变」**（实测教训）：Linux 的 inode 时间戳取自
  coarse clock，粒度约 1/HZ（4ms）——两次不同的写入可能拿到**同一个** mtime；
  而 macOS 是 ns 精度，本机永远复现不出来，CI（ubuntu）上才偶发。
  `db_library_signature` 因此从 mtime+大小改成内容指纹（SHA-256）。同理：
  「本地是绿的」不能当作跨平台结论。另一侧的坑：测试里裸 `listener.accept()`
  会把整个 `cargo test` 挂死（实测 24 分钟）——起本地服务等连接一律用
  「非阻塞 accept + 截止时间」，`http.rs` 的回环测试是范本。

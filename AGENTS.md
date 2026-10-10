# KnowFlick — Agent 工作手册

> 本文件是**项目级**约定，随仓库分发：任何机器上的任何 agent 在同一份规则下工作。
> 机器/环境相关的事（装什么、怎么起）见 [双机开发环境](docs/WINDOWS_ONBOARDING.md)。
> 领域语言以 [CONTEXT.md](CONTEXT.md) 为准；多端协作规范以 [MULTI_PLATFORM.md](docs/MULTI_PLATFORM.md) 为准。

## 仓库定位

KnowFlick 是多端学习工作台：`apps/mac`（Swift/SwiftUI，完整功能）· `apps/android`（Kotlin/Compose，完整功能）· Windows 端（规划中）· `shared/assets`（契约与底图，单一事实来源）。

**当前处于产品转向期**：预置知识库已退役（PR #70），知识内容改由用户剪藏/导入产生。规格见 [剪藏提炼复习设计规格](docs/CLIP_INGEST_DESIGN_2026-10.md)。**实现新功能前先读该规格，不要按 old seed 库时代的假设写代码。**

## 双机协作铁律

**两台开发机（macOS / Windows）通过 GitHub 协作，永不同步工作目录。**

1. **同步中枢只有 GitHub。** 禁止用 iCloud / 网盘 / SMB / 局域网盘同步工作树——两个 agent 同时写同一份 `.git` 必然损坏索引；构建目录（mac `.build` 1.8G、android `build` 258M）也完全不该跨机复制。
2. **一个分支同一时刻只在一台机器签出。** 接活前 `git fetch && git log --oneline origin/main -5` 确认起点；开工先推到 origin（哪怕空提交），另一台机器看到的分支就是「已被占」。
3. **改动的端在能验证它的机器上做。** Xcode 只有 mac 有（UI 层编译验证）；Windows SDK 只有 Windows 机有。表：

   | 改动 | 在哪台机器做 | 验证命令 |
   | --- | --- | --- |
   | `apps/mac/**` UI 层 | macOS | 云端 CI（无完整 Xcode 时）或本地 `./tools/test.sh` |
   | `apps/mac/**` Core | 任意机器可改 | `./tools/test.sh --core-only`（只需 CommandLineTools） |
   | `apps/android/**` | 任意机器（JDK 17 + SDK） | `./tools/build_android.sh` |
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
./tools/sync_shared_assets.sh      # 共享资源同步（两端测试脚本会自动调）
python3 tools/check_taxonomy.py    # 三处学科契约一致性
```

发版流程见 [MULTI_PLATFORM.md](docs/MULTI_PLATFORM.md) §提交与发布；产物不入 Git，Release 附件依赖本地上传（android）或 CI workflow（mac `v*` tag）。

## 会话工作区与文档纪律

- **临时产物写 `.scratch/<主题>/`**（已 gitignore），不要散落在仓库根目录；不要提交 `.scratch/` 内容。
- 跨会话的结论要**落到仓库**（`docs/` 或代码注释），只写在 `.scratch/` 的结论另一台机器看不到。
- 发布记录写 `docs/<端>_RELEASE_<版本>.md`；CHANGELOG 顶部对应端的分节登记。**两端的 CHANGELOG 与 docs 是同仓文件——这就是为什么禁止长期分叉分支，也是为什么改动要小步合回。**
- 修改领域语言（新词条、口径变化）→ 同步更新 [CONTEXT.md](CONTEXT.md)；架构决策 → `docs/adr/`（当前为空，重大决策时首次启用）。

## 已知陷阱

- **`shared/assets` 不要在 `apps/*/` 留副本**——mac 用 `sync_shared_assets.sh` 生成进 bundle，android 用 Gradle `assets.srcDirs` 直读；两份副本必然漂移（历史教训见 MULTI_PLATFORM.md）。
- **mac UI 层报 `SwiftUIMacros.StateMacro` 找不到 = 缺完整 Xcode**，不是代码问题，交给 CI。
- **行尾**：仓库一律 LF（`.gitattributes` 管辖）。Windows 上 clone 后如果 `git status` 出现大范围假修改，先查 `git config core.autocrlf`——应为 `false`（或 `input`），不要设为 `true`。
- **两个 workflow 路径过滤**：改 mac 不会触发 android CI、反之亦然。改了 `shared/**` 则两端 CI 都会跑——这是有意设计，因为契约漂移必须两端同抓。
- 全仓扫描类工作**严禁 head 截断后下「清零」结论**（PR #45 教训）。

# Windows 开发机上手

> 新机器（Windows）接入 KnowFlick 双机协作的完整清单。项目级 agent 约定见根目录 [AGENTS.md](../AGENTS.md)；
> 多端分支/提交/tag 规范见 [MULTI_PLATFORM.md](MULTI_PLATFORM.md)。
> 本文件描述**环境事实**，随机器状态更新；最后核对：2026-10-14（[ADR-0002](adr/0002-desktop-web-split-from-android.md) 之后：桌面第一套是 `apps/workbench`，`apps/mac` 已删除）。

## 一、开工前必读

1. **同步中枢只有 GitHub。** clone 到本地磁盘（推荐 `D:\workspace\KnowFlick` 这类纯英文短路径），**绝不要放到 OneDrive / 网盘 / 局域网共享盘**——同步进程会与 git 抢 `.git`，两个 agent 并发写必然损坏索引。
2. **行尾**：本仓库一律 LF（根目录 `.gitattributes` 管辖）。clone 后确认：

   ```powershell
   git config core.autocrlf   # 应为 false 或 input，若是 true 请执行下面一行
   git config core.autocrlf false
   ```

   若 `git status` 出现大范围「修改」但没改过代码——先查这一项，那是行尾假 diff。

3. **一个分支同一时刻只在一台机器签出**（铁律见 AGENTS.md）。开工前 `git fetch && git pull --ff-only`。

## 二、按「这台机器要干什么」装环境

| 任务 | 需要装 | 验证命令（Git Bash / WSL 下执行） |
| --- | --- | --- |
| **第一套桌面（Windows / macOS / Linux）** | **Node 22+ 与 Rust 工具链**——不需要 JDK，也不需要 Android SDK | `./tools/verify_workbench.sh`；打本系统那一档：`cd apps/workbench && npm run tauri build -- --bundles msi` |
| Android 构建与测试 | JDK 17（Temurin 或 MS OpenJDK）、Android SDK（Platform 35 + Build Tools 35.0.0） | `./tools/build_android.sh`（需先配 `signing.properties`，见下） |
| Android 单测/Lint（不签名） | 同上，不需要 keystore | `cd apps/android && ./gradlew :app:testDebugUnitTest :app:lintDebug` |
| 共享 Kotlin 模块（`:domain` / `:shared-data` / `:shared-ui` / 冻结的 `:desktop`） | 只要 JDK 17 | `cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test` |
| 契约校验 | Python 3 | `python3 tools/check_taxonomy.py`、`python3 tools/check_clip_parity.py` |
| 只改文档 / 契约 | 无（纯文本改动，推给对端或 CI 验证） | — |

### Android 环境细节（Windows）

- **JDK 17**：`JAVA_HOME` 指向 JDK 17 安装目录。`tools/build_android.sh` 现有 JAVA_HOME 探测逻辑（Homebrew / `/usr/libexec/java_home`）是 macOS 专用；Windows 上需先手动设置：

  ```powershell
  $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.x-hotspot"
  ```

  2026-10-10 已做前向兼容修补：`sha256sum`/`shasum` 自动选择、`python3`/`python` 自动探测（macOS 行为不变，Windows Git Bash 可跑）。JAVA_HOME 探测仍是 macOS 专用逻辑，Windows 上需按上面手动设置。
- **Android SDK**：装到默认位置后，在 `apps/android/local.properties` 写 `sdk.dir=C\:\\Users\\<你>\\AppData\\Local\\Android\\Sdk`（该文件已 gitignore，每台机器自己配）。
- **签名（仅发布需要）**：`apps/android/signing.properties` + release keystore 不入 Git。keystore 在本机 macOS 侧 `~/.local/share/knowflick/signing/`，**转移必须走加密渠道**（不要用聊天工具明文发私钥）；非发布任务不需要它。

### 网络（中国大陆）

- Gradle / Maven / NuGet / npm 建议预配镜像（阿里云 Maven、腾讯 npm 等）；GitHub 直连不稳时给 git 配代理。
- CI 在 GitHub 云端跑，不走本机网络。

## 三、双机日常协作流

```text
[任一机器] git fetch && git pull --ff-only
           ↓
[接活机器] 从最新 main 切分支 → 推到 origin（占位即锁定）
           ↓
[开发中]   小步提交、按 AGENTS.md 的验证矩阵跑本机验证
           ↓
[完成]     rebase main → 推分支 → 开 PR → 等 CI 绿 → 合并删分支
```

**并行避让**：

- 两台机器同时开工时，按**套**分活（第一套 `apps/workbench` / 第二套 `apps/android` 互不碰），或按文件域分（见 AGENTS.md 验证矩阵）。Windows 上的桌面开发就落在 `apps/workbench`——**不再新建 `apps/win/`**（[ADR-0002](adr/0002-desktop-web-split-from-android.md)）。
- `CHANGELOG.md`、`CONTEXT.md`、`docs/` 是共享文件，最容易撞。习惯：先把自己的段落写在分支上，PR 里解决冲突；不要「两边同时改同一节」。
- `shared/**` 改动触发两端 CI——这是有意设计（契约漂移必须两端同抓），但意味着**改 shared 前先与对端打招呼**。

## 四、这台 mac 的现状（对端参考）

- JDK 17 = Homebrew `openjdk@17`（`/opt/homebrew/opt/openjdk@17`）。它**不在全局 PATH 上**，跑 Gradle 前先 `export JAVA_HOME=/opt/homebrew/opt/openjdk@17`。
- Android SDK 在 `~/Library/Android/sdk`（Platform 35 / Build Tools 35.0.0）。
- Node 与 Rust 可用：第一套桌面的门禁（`./tools/verify_workbench.sh`）与 DMG 打包都在本机验证过。
- Swift/SwiftUI 的 `apps/mac` 已整体删除，**不再需要 Xcode**；不要恢复它。

## 五、Windows 上的第一套桌面

路线已定（[ADR-0002](adr/0002-desktop-web-split-from-android.md)）：**Windows 不单独成套**，与 macOS / Linux 共用 `apps/workbench` 那一份 Web + Tauri 代码。所以这台机器的接入就是三步——装 Node 22+ 与 Rust → clone → `cd apps/workbench && npm ci` → `./tools/verify_workbench.sh`。**没有 `apps/win/`，也没有 `win-v*` tag**；发布走 `workbench-v*`（[workbench-release.yml](../.github/workflows/workbench-release.yml)），MSI 由 Windows runner 构建。

在这台机器上能验的：`npm test` / `tsc` / `cargo test`，以及 `npm run tauri build -- --bundles msi` 出 MSI 后**实际安装并跑一遍**（导入 → 刷卡 → 测验 → 导出）。不能验的：DMG 与 DEB。

历史路线调研（已归档，不再是待决项）见 [多端现状报告](STATUS_2026-09-14.md) §五。

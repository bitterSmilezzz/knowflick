# Windows 开发机上手

> 新机器（Windows）接入 KnowFlick 双机协作的完整清单。项目级 agent 约定见根目录 [AGENTS.md](../AGENTS.md)；
> 多端分支/提交/tag 规范见 [MULTI_PLATFORM.md](MULTI_PLATFORM.md)。
> 本文件描述**环境事实**，随机器状态更新；最后核对：2026-10-10。

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
| 只改 mac 端 Core / 文档 / 契约 | 无（纯文本改动，推给对端或 CI 验证） | — |
| Android 构建与测试 | JDK 17（Temurin 或 MS OpenJDK）、Android SDK（Platform 35 + Build Tools 35.0.0） | `./tools/build_android.sh`（需先配 `signing.properties`，见下） |
| Android 单测/Lint（不签名） | 同上，不需要 keystore | `cd apps/android && ./gradlew :app:testDebugUnitTest :app:lintDebug` |
| Windows 端开发（路线待定） | 视路线而定：CMP 需 JDK；Avalonia 需 .NET 8 SDK；Web+常驻需 Node 20+ | 待路线定版后补 |
| 契约校验 | Python 3 | `python3 tools/check_taxonomy.py` |
| mac 端任何验证 | **不能**（无 Xcode）——推 PR 交给 CI | 云端 macOS workflow |

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

- 两台机器同时开工时，按端分活（mac / android / windows 互不碰），或按文件域分（见 AGENTS.md 验证矩阵）。
- `CHANGELOG.md`、`CONTEXT.md`、`docs/` 是共享文件，最容易撞。习惯：先把自己的段落写在分支上，PR 里解决冲突；不要「两边同时改同一节」。
- `shared/**` 改动触发两端 CI——这是有意设计（契约漂移必须两端同抓），但意味着**改 shared 前先与对端打招呼**。

## 四、这台 mac 的现状（对端参考）

- 完整 Xcode 已装（`/Applications/Xcode.app`，Swift 6.4）：mac UI 层可在本机编译验证，不再只靠 CI。
- JDK 17 = Homebrew `openjdk@17`；Android SDK 在 `~/Library/Android/sdk`（Platform 35 / Build Tools 35.0.0）。
- 本轮新引入：根目录 `.gitattributes`（LF 归一）、`AGENTS.md`（agent 手册）、本文件。

## 五、Windows 端启动（路线定版后补充）

技术栈调研历史结论见 [多端现状报告](STATUS_2026-09-14.md) §五；路线拍板与开工顺序待定，定版后在此补：新建 `apps/win/`（或按选定路线命名）、CI workflow、tag 规则（`win-v*`）。

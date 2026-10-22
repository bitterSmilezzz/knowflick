# KnowFlick

<div align="center">

**多端学习工作台 — 剪藏、提炼、复习**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/bitterSmilezzz/knowflick?include_prereleases&logo=github)](https://github.com/bitterSmilezzz/knowflick/releases)

</div>

---

KnowFlick 把「你收藏的内容」变成「你能复习的卡片」。知识全部来自你自己的积累：**网页剪藏**、**笔记导入**，或配置一个兼容 OpenAI 的端点让 **AI 出卡**。仓库不自带卡片库——**空库是正常起点**，任何启动路径都不会往库里灌内容。

## 端与分工

按交互形态分两套（活计划见 [ADR-0002](docs/adr/0002-desktop-web-split-from-android.md)）：

| 套 | 端 | 技术 | 目录 |
| --- | --- | --- | --- |
| 第一套 | Windows / Linux / macOS（以及稍后的网页） | 一份 Web 界面（Vite + React + TypeScript）+ Tauri 壳 | `apps/workbench` |
| 第二套 | Android | Kotlin + Jetpack Compose | `apps/android` |
| — | iOS | 未定，先不做 | — |

两套**共享数据文件，不共享界面代码**：同一个数据目录、同一份 `cards.json` / `settings.json` 结构，拷过去就能打开，中间不经转换。

> 沿革：Swift / SwiftUI 的 `apps/mac` 已删除。[ADR-0001](docs/adr/0001-desktop-tri-platform-shared-kotlin.md) 那条「桌面与安卓共用一份 Kotlin 界面」不再是活计划；它留下的 Kotlin 共享模块（`:domain` / `:shared-data` / `:shared-ui`）原样保留，Android 继续用，冻住的 JVM 桌面宿主 `:desktop` 不再加功能。

## 当前版本

| 端 | 版本 | 状态 |
| --- | --- | --- |
| Android | `android-v0.10.3` | 已发布([发布记录](docs/ANDROID_RELEASE_0.10.3.md)) |
| 第一套桌面（`apps/workbench`） | v0.1.0 | 学习闭环可用,见下 |
| 冻结的 JVM 桌面（`:desktop`） | `desktop-v0.1.0` | 不再加功能,发布通道与上面那条独立 |

完整演进见 [CHANGELOG.md](CHANGELOG.md)。

## 第一套桌面 · v0.1

学习闭环已经能用：剪藏、笔记导入、AI 出卡、刷卡、卡库与详情、收藏与历史、测验（SM-2 / FSRS）、统计、导入导出。

- **刷卡**：摄影底图卡面，拖拽或 `←` / `→` 划走；卡面显示分类、标题与摘要
- **剪藏**：贴 URL → 抓正文预览 → AI 提炼成卡片 → 选卡入库（抓取在壳里做，绕开浏览器同源策略）
- **测验**：四档自评驱动间隔重复，档位与 Android 同一套 SM-2 / FSRS 规则
- **导入导出**：导入认 ZIP 与 JSON；导出的「另存为」选 `.zip` 得备份包（卡片 + 设置），选 `.json` 得裸 `cards.json`
- 快捷键与其余操作见应用内「帮助」面板

第一版**不含**：语音朗读、磨耳朵、知识星图、卡片追问、海报导出、局域网同步、桌面微件、学习地图。

### 下载安装

从 [Releases](https://github.com/bitterSmilezzz/knowflick/releases) 下载 `KnowFlick-Workbench-<版本>-<系统>.<扩展名>`：macOS 是 `.dmg`、Windows 是 `.msi`、Linux 是 `.deb`。

> 未签名应用首次打开可能被系统拦下：macOS 在「系统设置 → 隐私与安全性」点「仍要打开」，或执行 `xattr -dr com.apple.quarantine /Applications/KnowFlick.app`；Windows 在 SmartScreen 提示里选「更多信息 → 仍要运行」。

### 构建与运行

需要 Node 22+ 与 Rust 工具链（开发机不必装 Android SDK）：

```sh
cd apps/workbench
npm install
npm run tauri dev                       # 开发（起 Tauri 窗口 + 前端 dev server）
npm run dev                             # 只起前端，http://localhost:1420（无壳能力）

cd ../..
./tools/verify_workbench.sh             # 门禁：npm test + tsc + cargo test + 冒烟套件
cd apps/workbench && npm run tauri build -- --bundles dmg   # 本系统那一档安装包

# 门禁里还包含 13 套浏览器冒烟（界面级回归）。它们要真实浏览器与运行中的 Vite，
# 所以开着一个 dev server 时才会跑；缺工具就明确 SKIP，不会让门禁红掉。
npm run dev &                            # 另开一个终端：前端 dev server
./tools/run_all_smokes.sh                # 只跑浏览器冒烟
```

三端安装包**不在本机出**：Tauri 与 jpackage 一样不支持交叉编译。打 tag `workbench-v<版本>` 触发
[workbench-release.yml](.github/workflows/workbench-release.yml)，三台 runner 各构建一档、各过一遍门禁，
再由 `tools/assemble_workbench_release.sh` 统一命名、附到 Release。

## Android 端

`apps/android`（Kotlin + Jetpack Compose，最低 Android 8.0 / API 26）保持现状，功能面比第一套桌面宽：除学习闭环外，还有语音朗读与磨耳朵、知识星图、局域网同步、桌面微件等。

构建、安装、模块划分与发版见 [Android 端说明](apps/android/README.md)。

## AI 服务

两套都**只连你自己的端点**：不做 KnowFlick 账号、不代管模型、不代理你的请求。

- **第一套桌面**：设置页填 Base URL / 模型 / API Key，可「测试连接」。密钥存在数据目录旁的单独文件里（仅本机用户可读的明文文件，**未接系统钥匙串**，如实告知强度）。
- **Android**：除自填端点外另有内置服务商预设（DeepSeek、硅基流动、Kimi、智谱 GLM、阿里云百炼、OpenAI、本地 Ollama 等），密钥走 Android Keystore。

两套都用「一次请求拿回若干候选卡 → 分类规范化 → 标题去重 → 内容长度门槛」，AI 生成的卡片带可关闭的来源标记。差别在传输：Android 走 SSE 流式（够数即停、另有近重复抑制），第一套桌面是一次性请求。

## 数据存储

两套共用同一套文件结构，只是数据目录不同：

| 平台 | 数据目录 |
| --- | --- |
| Windows | `%APPDATA%\KnowFlick\store` |
| macOS | `~/Library/Application Support/KnowFlick/store` |
| Linux | `$XDG_DATA_HOME/KnowFlick/store`（默认 `~/.local/share/KnowFlick/store`） |
| Android | 应用私有目录 `filesDir/store`（需 root 或走导出才能直接看到） |

目录里的文件：`cards.json`（主库）、`cards.backup.json` / `cards.backup.2.json`（两代轮转备份）、`settings.json`、`search_history.json`。
API 密钥不在这些文件里——它在数据目录旁的 `credentials/` 下单独一个文件，**不进卡片 JSON、不进设置 JSON、不进导出包**。

> **从已删除的 macOS 端（Swift 版）搬数据**：那一版把 `cards.json` / `settings.json` 直接放在数据目录**根下**，而现在的两套都读 `store/` 子目录。把文件移进 `store/` 即可——结构相同，中间不需要转换。（实测本机就是这样：根下留着旧的 `cards.json` / `settings.json`，两套读的是 `store/`。）

卡片背景图来自 [Unsplash](https://unsplash.com)（Unsplash License，可免费商用），共 42 张，按领域分池，已做压暗与底部渐变处理以保证文字可读性。

## 让 Agent 查你的卡库（MCP / CLI）

[`tools/knowflick-mcp/`](tools/knowflick-mcp/README.md) 是个零第三方依赖的 MCP 服务器：Qoder / Claude Desktop / Cursor 这类支持 MCP 的 Agent 可以把你的卡库当知识源来检索、看学科地图与学习路径；同一份逻辑也提供命令行入口（`kf.mjs`），给连不上 MCP 的场合用。

默认**只读**卡库；需要沉淀新卡时追加到同目录的 `staged_cards.json`（与 `cards.json` 同构），由 App 的导入界面**人工确认**——不存在 Agent 静默改库。CLI 与 MCP 的结果由测试断言逐条一致。

## 项目结构

多端仓库：各端应用在 `apps/`，跨端共享内容在 `shared/`。分支模型、版本号与发版流程见[多端协作规范](docs/MULTI_PLATFORM.md)。

```
KnowFlick/
├── apps/
│   ├── workbench/           # 第一套桌面：Vite + React + Tauri（Windows / Linux / macOS）
│   │   ├── src/domain/          # 卡片、卡库、排列、间隔重复、统计、搜索、剪藏抽取、笔记解析（含 Vitest 单测）
│   │   ├── src/ui/ · src/shell/ # 界面组件与壳能力封装（文件对话框、网络、凭据）
│   │   └── src-tauri/           # Rust 壳：数据目录、原子写与备份轮转、正文抓取、AI 请求、导出
│   └── android/             # Android 端（Gradle + Compose）
│       ├── domain/              # :domain — KMP 领域层（jvm + androidTarget）
│       ├── shared-data/         # :shared-data — 持久化与归档导入导出
│       ├── shared-ui/           # :shared-ui — Compose 共享界面层
│       ├── desktop/             # :desktop — 已冻住的 JVM 桌面宿主，不再加功能
│       └── app/                 # :app — Android 装配层
├── shared/
│   ├── assets/              # 跨端共享资产（唯一事实来源）：taxonomy_map.json、bg/*.webp
│   └── icons/               # 安装包图标：派生的 .icns / .ico / .png（美术源 iconset 不入 Git）
├── tools/                   # 跨端脚本：verify_workbench.sh / build_android.sh / check_taxonomy.py / assemble_*_release.sh / generate_app_icons.py
├── docs/                    # ADR、多端协作规范、发布记录与评审报告
├── assets/                  # README 展示资源
├── CHANGELOG.md             # 完整版本更新日志
└── CONTEXT.md               # 领域词汇表（架构评审与实现的统一语言）
```

## 技术说明

- **第一套桌面**：Vite + React + TypeScript 写界面，Tauri 2 的 Rust 壳只做窗口、本机文件、系统菜单与网络代理；卡片规则（抽取、排列、间隔重复、统计）全写在 Web 这一层，Rust 侧只搬字节、管文件。
- **Android**：原生 Kotlin + Compose。与框架无关的领域逻辑收在 `:domain`（KMP），持久化在 `:shared-data`，界面在 `:shared-ui` 与 `:app`。
- **契约**：`shared/assets/taxonomy_map.json` 是学科契约的唯一事实来源，`python3 tools/check_taxonomy.py` 在 CI 上校验它与各端内嵌表一致。
- **共享底图不落副本**：两端都直接读 `shared/assets/bg/`（Android 走 Gradle `assets.srcDirs`，第一套桌面走 Vite `publicDir`），仓库里不留第二份。

## 更新日志

详见 [CHANGELOG.md](CHANGELOG.md)。

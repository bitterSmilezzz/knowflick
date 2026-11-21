# Rust 到 Go：迁移的技术判断（第二部分：Go 方案调研）

> 承接 [ADR-0005](0005-rust-to-go-migration-rationale.md)。那一篇固定了「为什么想迁」的事实，
> 这一篇只回答「Go 这边有什么」，**不回答「该不该迁」**（那是第三部分）。

## 一、结论摘要

| 能力 | Go 侧现状 | 判断 |
| --- | --- | --- |
| 桌面外壳 | **Wails v3.1.0**（2026-11-01 发布，37.2k star） | 可用，与 Tauri 同类 |
| 单一二进制 | Wails 用 `//go:embed` 把前端打进可执行文件 | **成立**，且比 Tauri 少一套工具链 |
| TS 类型自动生成 | `wails3 generate bindings` 从 Go struct 生成 | **成立**，直接消掉 ADR-0005 §2.5 的手工对齐 |
| SQLite | `mattn/go-sqlite3`（9.3k star，cgo）或 `glebarez/go-sqlite`（887 star，纯 Go） | **有，两条路** |
| HTTP 客户端 | `go-resty/resty`（11.8k star）或标准库 `net/http` | **有，且更简单** |
| **语音转写（ASR）** | **没有成熟绑定**（详见 §3） | **这是最大风险点** |
| Go 工具链 | **本机未安装**（`go: command not found`） | 前置条件 |

## 二、桌面外壳：Wails v3

### 2.1 它是什么

Wails 的定位与 Tauri 几乎一致：**把 Go 后端和 Web 前端包进一个二进制**。官方 README 的原话是
「wrap both Go code and a web frontend into a single binary」。

实测（GitHub API，2026-11-19）：

| 项 | 值 |
| --- | --- |
| 最新版 | **v3.1.0**（2026-11-01） |
| star | 37,160 |
| 最近推送 | 2026-11-17（活跃） |
| 仓库文件数 | 21,372 |

作为对比，Tauri 是 112,995 star。**Wails 的社区规模约为 Tauri 的三分之一**——这不影响能不能用，
但影响遇到问题时能找到多少现成答案。

### 2.2 关键能力（README 原文 + 源码核对）

- **单一二进制**：源码里 `//go:embed assets/*` 把前端资源嵌进可执行文件。
  这与 Tauri 的「前端产物塞进 Rust 二进制」结果相同，但**开发期只有一套工具链**。
- **自动生成 TS 类型**：官方文档 `features/bindings/models.md` 明确写「Wails automatically generates
  JavaScript/TypeScript classes from Go structs」，命令是 `wails3 generate bindings`。
  生成的类型带构造函数、类型标注与 JSDoc。
- 原生对话框与菜单、深浅色主题、毛玻璃效果、Go↔JS 统一事件系统。

**这一条直接回应 ADR-0005 §2.5**：那 136 个 `#[tauri::command]` 每次改签名要手工同步三处，
在 Wails 里类型是**生成**的，改 Go struct 后重新 generate 即可。这是迁移能带来的**实质改善**，
不只是「换个语言」。

### 2.3 需要确认的风险

- **v3 才刚发不久**（v3.1.0，2026-11-01）。v2 是长期稳定版，v3 是重写。
  用 v3 意味着接受一个相对年轻的 API；用 v2 则拿不到上面那些 v3 的绑定生成体验。
- **Wails 官网被 Cloudflare 拦截**（实测 `wails.io/docs` 返回挑战页），文档要走 GitHub 仓库里的
  `docs/mpress/content/`。这不是技术问题，但说明**查文档的路径与 Tauri 不同**。

## 三、最大的风险：语音转写（ASR）

项目现在用 `whisper-rs 0.16`（Rust 对 whisper.cpp 的绑定）做本地语音转写。
**Go 侧没有等价物**，这是本次调研最重要的负面发现。

实测搜索结果（GitHub API，2026-11-19，按 star 排序）：

| 项目 | star | 最近更新 | 实际是什么 |
| --- | --- | --- | --- |
| `appleboy/go-whisper` | 102 | 2026-04-01 | **Docker 镜像**，不是库 |
| `ardanlabs/bucky` | 26 | 2026-11-12 | 原生 Go 绑定（最接近，但 26 star） |
| `joaquindelcanto/go-whisper.cpp` | 2 | 2025-05-25 | 开发环境模板 |
| `AlexSnet/whisper.go` | 0 | 2025-03-30 | 绑定 |
| `donghquinn/go-whisper-cpp` | 0 | 2025-07-21 | 绑定 |

**没有一个是能直接替代 `whisper-rs` 的成熟库。** 三条可能的出路，各有代价：

| 出路 | 代价 |
| --- | --- |
| 用 cgo 包 whisper.cpp（自己写绑定） | 要维护 C++ 编译链；**ADR-0005 §2.3 记的 `CMAKE_ASM_COMPILER` 那类问题会原样搬过来** |
| 用 `ardanlabs/bucky`（26 star） | 依赖一个很小的项目，API 稳定性未知 |
| 改成外部进程调用 whisper.cpp 可执行文件 | 多一个进程要打包与守护，但**编译期依赖消失** |

**这一项必须在第三部分单独评估**，它可能单独决定迁移划不划算。

## 四、数据层与网络层

### 4.1 SQLite

两条路，取舍很清楚：

| 方案 | star | cgo | 取舍 |
| --- | --- | --- | --- |
| `mattn/go-sqlite3` | 9,279 | **需要** | 成熟、生态最大；但 cgo 意味着交叉编译变复杂，且**编译变慢**——这与迁移的初衷（加快开发循环）有冲突 |
| `glebarez/go-sqlite` | 887 | **不需要**（纯 Go） | 交叉编译友好、编译快；但非官方实现，极端 SQL 行为可能有差异 |

项目现在用 `rusqlite` 的 `bundled` 特性（自带 SQLite 源码）。迁移后如果选纯 Go 方案，
**编译速度这一项会有明显改善**；如果选 cgo 方案，改善有限。

### 4.2 HTTP

`go-resty/resty`（11,832 star，2026-11-15 活跃）或标准库 `net/http`。
这一层**比 Rust 简单**：`reqwest` 的 `rustls-tls`、`stream` 这些 feature 组合在 Go 里不需要显式声明。

## 五、Go 相对 Rust 的结构性优势（针对本项目）

| 项 | Rust + Tauri | Go + Wails |
| --- | --- | --- |
| 依赖数量 | **720 个 crate**（`Cargo.lock`） | 通常几十个 module |
| 调试产物 | **6.4 GB**（实测） | 预计数百 MB 量级（未实测，**不能当结论**） |
| 全量重编 | 几分钟（720 crate + C++ 依赖） | 预计显著更快（**未实测**） |
| 工具链数量 | 2 套（npm + cargo） | 2 套（npm + go），但 `go build` 一步出二进制 |
| 跨语言类型 | 手写 136 处约定 | **自动生成** |

**注意**：表里带「未实测」的两项是**推断**，不是结论。第三部分如果要给数字，必须真的装 Go 跑一遍。

## 六、这篇不回答的

- 迁移划不划算、分几步、先迁哪块 —— **第三部分**
- ASR 那块到底怎么办 —— 第三部分必须给出具体方案，否则整个迁移不成立

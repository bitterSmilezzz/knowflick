# 阶段 0 验证结果：Go 技术栈三项能力实测

> 承接 [ADR-0007](0007-go-migration-feasibility.md) 的「阶段 0」要求：
> 在动手迁任何业务代码之前，先证明三件事能成。**三项全部通过。**

## 一、结论

| 验证项 | 结果 | 关键证据 |
| --- | --- | --- |
| Wails v3 能打包 | **通过** | 9.9 MB 单一可执行文件，全量构建 25 秒 |
| 纯 Go SQLite 能读现有库 | **通过** | 读出 3 个真实素材（含中文），FTS5 可用，写入正常 |
| ASR 走外部进程 | **通过** | Go 驱动 `whisper-cli`，6.26 秒返回正确文字 |

**阶段 0 通过，可以进入阶段 1。**

## 二、环境

| 项 | 值 |
| --- | --- |
| Go | **1.27.4**（`brew install go`，240 MB） |
| Wails CLI | **v3.1.0**（`go install`，27.6 秒） |
| SQLite 驱动 | `modernc.org/sqlite v1.62.0`（**纯 Go，无 cgo**） |
| whisper.cpp | **1.9.5**（`brew install whisper-cpp`，**bottled 预编译**） |

## 三、验证一：Wails v3 能打包

```
wails3 init -n wailsapp -t react
wails3 build
```

**模板直接有 `react`（React + TypeScript + Vite）**——与 KnowFlick 前端技术栈一致，不是勉强凑合。

实测结果：

| 项 | 值 |
| --- | --- |
| 全量构建（含前端 + Go 编译 + 打包） | **24.97 秒** |
| 产物 | `bin/wailsapp`，**9,908,114 字节（9.9 MB）** |
| 前端产物 | 172 KB（gzip 56 KB） |
| npm 依赖 | 27 个包 |

**注意**：这个 9.9 MB 是**单一可执行文件**，不是 .app 包。对比 Rust 侧调试产物 123 MB 的 .app
（内含 126 MB 可执行文件）——虽然两者不可直接比较（release vs debug），但量级差异明显。

### 3.1 一个环境坑（记录备查）

`npm install` 在本机会**卡住不动**，根因是 `~/.npmrc` 里的代理指向已关闭的 127.0.0.1:7897，
环境变量又指向 10808，两者都不通。解法：

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_USE_ENV_PROXY \
  npm install --userconfig <无代理的 npmrc>
```

**这不是 Wails 的问题，是本机 npm 配置的问题**——但迁移时 CI 也会遇到，要写进文档。

## 四、验证二：纯 Go SQLite 读现有库

用的是**真实库文件**：`~/Library/Application Support/KnowFlick/store/knowflick.db`（372 KB）。

```go
db, _ := sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
```

实测结果：

```
materials: 3
  material b48ab896: 这是一条明确标记的界面验收记录，用来验证桌面录入、阅读和 SQLite 持久化。
  material 3adb4d3d: 原生界面验收：这条内容通过桌面窗口真实录入，用来验证三栏工作台、SQLite 持久化与刷新后的恢复。
  material 2c1469a9: 胶囊验收 20261019：确认回车先落库再隐藏。
FTS5 works, hits: 0
write works
```

**四项都通过**：

1. 打开真实库（只读模式）。
2. 读出真实数据，**中文完全正常**（无编码问题）。
3. **FTS5 全文索引可用**——这是最容易出问题的一项，纯 Go 实现支持了它。
4. 写入路径正常（内存库建表、插入、读回）。

### 4.1 库结构规模

实测这个库有 **47 张表**，包括：

- 业务表：`notes`、`materials`、`cards`、`knowledge_bases`、`note_revisions`、`projects`、`goals`
- **FTS5 虚拟表 5 组**：`fts_notes`、`fts_materials`、`fts_cards`、`fts_note_chunks`（每组 6 张影子表）
- 向量表：`card_embeddings`、`note_chunk_embeddings`

**纯 Go 驱动能吃下全部 47 张表**，说明数据层迁移没有结构性障碍。

## 五、验证三：ASR 走外部进程

### 5.1 关键发现：whisper.cpp 有预编译包

ADR-0006 §3 判断「Go 没有成熟 whisper 绑定」是对的，但**遗漏了一条路**：

**`whisper.cpp 1.9.5` 在 Homebrew 里是 bottled（预编译）的。**

这意味着外部进程方案**不需要编译任何 C++**——直接 `brew install whisper-cpp` 就有 `whisper-cli`。
这比 ADR-0007 里设想的「自己编 whisper.cpp」简单得多，也彻底绕开了 `CMAKE_ASM_COMPILER` 那类问题。

### 5.2 端到端实测

用系统 TTS 合成一段英文语音，转成 16 kHz 单声道 WAV，再用 Go 驱动 `whisper-cli`：

```go
cmd := exec.CommandContext(ctx, "whisper-cli",
    "-m", model, "-f", wav, "-l", "en", "-otxt", "-of", outBase, "--no-prints")
```

结果：

```
elapsed: 6.256s
text: "Hello this is a test of speech recognition."
```

**识别完全正确。** whisper 自身耗时 702 ms（Metal 加速），6.26 秒里大部分是进程启动与模型加载。

### 5.3 与现有 Rust 实现的关系

值得注意：**Rust 侧本来就有外部进程调用**——`asr.rs` 里用 `Command::new("afconvert")` 转音频格式。
所以「外部进程」不是新引入的架构，只是把 whisper 也挪到这条路上。

### 5.4 模型下载的坑

HuggingFace 直连会 **Connection reset**，`hf-mirror.com` 镜像可用（HTTP 200，77 MB 下完）。
迁移后模型下载逻辑要支持镜像回退，这与现有 Rust 实现的做法一致。

## 六、阶段 0 未验证的（诚实边界）

| 项 | 为什么没验 | 什么时候验 |
| --- | --- | --- |
| Windows / Linux 打包 | 本机只有 macOS | 阶段 3 前必须在对应系统验 |
| 真实录音的识别准确率 | 只测了 TTS 合成的清晰语音 | 阶段 2 迁 ASR 时用真实录音 |
| 大模型（base/small）的耗时 | 只测了 tiny（77 MB） | 阶段 2 |
| 47 张表的**写**入兼容性 | 只验了只读打开 + 内存库写入 | 阶段 1（要在真实库副本上写） |
| Wails 的 .app 打包与签名 | 只验了裸可执行文件 | 阶段 3 |

## 七、下一步（阶段 1）

按 ADR-0007：

1. Go 侧先实现**只读**能力：打开现有库、列出笔记、搜索。
2. 前端用 Wails 绑定接上，**与现有 Tauri 版本并存**。
3. 不删任何 Rust 代码。

**阶段 1 的第一件事**：在真实库的**副本**上验证 47 张表的写入路径——阶段 0 只验了只读。

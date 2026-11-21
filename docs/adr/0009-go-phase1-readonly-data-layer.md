# 阶段 1：Go 只读数据层与 Wails 外壳落地

> 承接 [ADR-0007](0007-go-migration-feasibility.md) 与 [ADR-0008](0008-go-phase0-spike-results.md)。
> 阶段 1 的目标是「数据层先行、与现有 Rust 版并存、不删任何 Rust 代码」——本篇记录做到了什么、怎么验的、还差什么。

## 一、这一阶段交付了什么

| 产物 | 路径 | 说明 |
| --- | --- | --- |
| Go 只读数据层 | `apps/workbench-go/internal/library/library.go` | 打开现有库、列笔记、FTS5 + LIKE 检索 |
| Wails v3 外壳 | `apps/workbench-go/main.go`、`preview.go` | 窗口、原生文件选择器、服务方法 |
| 共享前端入口 | `apps/workbench/go-preview/` | 复用 `MarkdownRenderer` 与设计令牌，独立 Vite 构建 |
| 构建脚本 | `tools/build_workbench_go.sh` | 生成绑定 → 前端打包 → `go build`，一步出二进制 |

**前端没有重写。** `go-preview/main.tsx` 只做布局，正文渲染直接 `import { MarkdownRenderer }`——
与 Tauri 版是同一份组件、同一份 `tokens.css`。这正是 ADR-0007 说「前端是资产不是负债」的落地。

## 二、只读是**强制**的，不是约定

```go
uri.RawQuery = "mode=ro&_pragma=busy_timeout(5000)&_pragma=query_only(1)"
```

两道闸：SQLite 的 `mode=ro` 打开标志 + `query_only` pragma。测试直接断言写入会被拒：

```go
if _, err := repo.db.ExecContext(ctx, "UPDATE notes SET title='invalid' WHERE id='go-phase1-pinned'"); err == nil {
  t.Fatal("read-only connection accepted a write")
}
```

**为什么这么较真**：迁移期间最容易出的事故是新后端顺手改了用户的真库。只读不是「这一阶段先不做写」，
是这一阶段的产品边界。

## 三、踩到并修掉的坑

### 3.1 路径必须转成 `file:` URI，否则含 `#` `?` `%` 的路径直接打不开

第一次跑测试就红了：

```
stat .../中文 #备份?.db: no such file or directory
```

`sql.Open("sqlite", path)` 把裸路径当 DSN 解析，`#` 之后被当成片段截掉了。修法是统一走
`databaseURI()` 构造 `url.URL{Scheme: "file"}`——顺带把「相对路径 vs 绝对路径」「Windows 盘符」
也收进一个函数里。留了一条回归测试，文件名就是 `中文 #备份?.db`（Windows 上自动去掉 `?`，因为 `?` 不能作文件名）。

### 3.2 绑定默认引 npm 包，桌面端必须用 `-b` 内嵌运行时

`wails3 generate bindings` 默认生成 `import ... from "@wailsio/runtime"`。桌面包里没有这个 npm 包，
于是前端构建会去解析它、又被我加的 `rollupOptions.external: ["/wails/runtime.js"]` 挡在外链——
两边不匹配。改用 `-b`（bundled runtime）后，绑定直接引 `/wails/runtime.js`，由 Wails 在 WebView 里注入，
前端与 Go 都不用带 npm 依赖。

### 3.3 生成的 TS 模型把切片当可空

生成器把 Go 的 `[]Note` 映射成 `Note[] | null`，`null` 检查全在编译期报 `TS18047`。
这与「Go 的 nil slice 序列化成 `null`」一致，所以**不改生成器**，在 UI 侧用 `?? []` 收口——
这是真实的运行期契约，不是类型噪音。

## 四、怎么验的（三层证据）

### 三层证据的分工

| 层 | 证明什么 | 命令 |
| --- | --- | --- |
| Go 单测 | 读写语义、只读强制、路径怪异字符 | `cd apps/workbench-go && go test ./...` |
| 跨运行时对拍 | **Go 写的库，Rust 读出来一样** | `cargo test go_preview_snapshot_parity -- --ignored` |
| 原生窗口 | 真实 WebView 里列表/搜索/渲染都对 | 无障碍树断言 + 截图 |

### 4.1 跨运行时对拍是这一阶段最关键的一条

做法：用真实库的 `VACUUM INTO` 克隆出一份，**由 Go 写入**夹具数据（4 篇笔记、2 条修订、FTS 索引，
其中 1 篇在回收站、1 篇故意不进 FTS 用来钉 LIKE 兜底），然后**让 Rust 读同一个文件**：

```rust
let fixture_ids: Vec<_> = notes.iter().map(|note| note.id.as_str())
    .filter(|id| id.starts_with("go-phase1-")).collect();
assert_eq!(fixture_ids, ["go-phase1-pinned", "go-phase1-newer", "go-phase1-fallback"]);
```

对拍的是**行为**不是字节：排序（置顶优先、其次更新时间）、FTS5 前缀 AND 查询、LIKE 兜底、
回收站不进结果、当前修订号与 Markdown 正文原样。Rust 侧 4 个查询全部与本轮 Go 侧一致。

**方向也验了另一半**：阶段 0 是「Rust 建的库 → Go 读」，这一阶段是「Go 写的库 → Rust 读」。
两个方向都通，说明 47 张表的 schema 与索引语义在两边是同构的，不在「一方能读另一方写的库」这种单边假设上。

### 4.2 原生窗口里实际看到的

打开夹具库后，无障碍树读出：

```
AXStaticText = "已显示 3 篇"          ← 回收站那篇不在列表里
AXButton "迁移验收置顶 置顶"
AXButton "迁移验收归档 已归档"
AXStaticText = "修订 2 · …"          ← 修订号来自 current_revision
AXStaticText = "中文迁移样本 bridgephase migration"  ← Markdown 渲染后正文
```

在真实 WebView 里输入 `bridgephase migrat` 回车 → 「找到 1 篇」，且不出现回收站那篇；
换成 `中文字串` → 命中 LIKE 兜底的 `迁移验收子串`，其余两篇不出现。

### 4.3 一个 UI 缺陷（截图才看得出来）

无障碍树里 `笔记列表` 区域高度只有 275pt，`搜索` 按钮被挤成两行（「搜」「索」）。
单测与断言都发现不了这种问题——**截图才发现**。修法是给输入框 `flex: 1`、按钮 `flex: none`。

## 五、实测数字

| 项 | 值 |
| --- | --- |
| Go 二进制（`CGO_ENABLED=0`） | **12.7 MB**（13,277,442 字节） |
| 前端产物 | 233 KB（gzip 72.9 KB） |
| `go build` 增量 | **0.07 s** 量级（ADR-0007 已测） |
| 真实库表数 | **50**（含 FTS5 影子表） |
| 与 Rust 对拍的断言 | 4 条查询 + 排序 + 修订 + 正文 |

## 六、这一阶段**没做到**的（必须先说清楚）

| 项 | 现状 | 为什么现在不做 |
| --- | --- | --- |
| **写能力** | **完全没有**。Go 侧只读，写入仍只有 Rust | 阶段 1 的定义就是「数据层先行、只读」；写要等对拍把语义钉死 |
| 与现有 Tauri 版**同一个应用内切换** | 没做。Go 版是**独立二进制**，与 Tauri 版**并存**但不同进程 | ADR-0007 写的「通过开关切换」我按「并存」理解成两个可共存的产物；真要一个应用内切后端，是另一件事 |
| `.app` 打包与签名 | 没做，只有裸可执行文件 | 阶段 3 |
| Windows / Linux | 没做，只在 macOS | 阶段 3 前必须验 |
| 大库性能 | 没测。夹具 3 篇，真实库 0 篇笔记 | 需要造一个几万篇的库来测分页与 FTS |
| 搜索结果翻页 | 没做，只取前 60 条并提示「缩小范围」 | 与列表翻页不是一回事，单独设计 |
| 知识库、分块检索、附件、向量 | 全没做 | 阶段 2 按模块迁 |

**特别说明「同一个应用内切换」这条**：ADR-0007 的原话是「与现有 Tauri 版本并存，通过开关切换」。
本轮做出来的是**两个独立产物**（现有 Tauri 版 + 新 Go 版），靠用户选哪个应用来「切换」，
不是应用内的一个开关。这在迁移期是够用的（Rust 版仍是唯一可交付产物），但它不等于 ADR 写的那个形态，
这里如实记下，不当作已完成。

## 七、下一步（阶段 2）

1. **先把写能力补上**，并且**只动副本**：在 `VACUUM INTO` 出来的克隆上实现 `note_upsert`，
   与 Rust 的 `note_upsert` 逐条对拍（修订号、`base_revision` 冲突、FTS 同步、回收站）。
2. 写能力对拍通过后，再决定「Go 版直接写用户库」还是「先只读展示 + Rust 写」。
3. 之后按 ADR-0007 的顺序迁：`media/backup` → `http/mail` → `chunker/embed` → `asr`。

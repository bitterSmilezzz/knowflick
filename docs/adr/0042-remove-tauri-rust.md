# ADR-0042：移除 Tauri/Rust 壳，第一套桌面只保留 Go

- 状态：已接受（2026-11-23）
- 取代：ADR-0002 中「第一套桌面 = Web 界面 + Tauri 壳」的壳层选择；[ADR-0005](0005-rust-to-go-migration-rationale.md)、
  [ADR-0006](0006-go-stack-research.md)、[ADR-0007](0007-go-migration-feasibility.md) 的调研结论在本条落地
- 相关：[ADR-0009](0009-go-phase1-readonly-data-layer.md) 起的一系列 Go 迁移条目

## 背景

第一套桌面（`apps/workbench`）原本是 Vite + React 前端加 Tauri 2 的 Rust 壳。Rust 侧的代价已经在
[ADR-0005](0005-rust-to-go-migration-rationale.md) 里量化过：720 个 crate、`target/` 6.4 GB、增量编译 8.78 s 对
Go 的 0.069 s、136 处前后端手工对齐、两套工具链与两套测试命令。Go 侧（`apps/workbench-go`，Wails v3
单二进制）在阶段 0–1（ADR-0008 / 0009）验证过 Wails 打包、纯 Go SQLite 与 ASR 外部进程三条硬前提后，
逐项迁移已经完成：前端仍在 `apps/workbench`，壳能力、数据层、抓取、AI 请求、导出全部由 Go 承接。

迁移完成之后，Rust 目录仍留在工作树里：`apps/workbench/src-tauri/`（`Cargo.toml` / `Cargo.lock` /
`build.rs` / `capabilities` / `permissions` / `icons` / `src`）。它已经不是可交付产物，但仍在
消耗注意力：门禁里跑着只对 Tauri 有效的检查、文档把 Tauri 当成现行架构、构建目录里留着 `target/`。

## 决定

1. **删除整个 `apps/workbench/src-tauri/`**。Rust 不再承担任何生产职责；历史实现只在 Git 历史里可查，
   不在工作树里保留副本。
2. **第一套桌面 = `apps/workbench`（前端）+ `apps/workbench-go`（Go 壳）**。构建入口只有
   `tools/build_workbench_go.sh`（Wails v3 单二进制），它同时产出 `apps/workbench-go/bin/` 与嵌入的前端 bundle。
3. **发布通道暂停**。`workbench-release.yml` 保留一个显式的失败占位 job：Go 侧的 DMG / MSI / DEB 打包
   与校验方案尚未就绪，打 `workbench-v*` tag 不再触发任何构建、也不产出附件。与其留一条注定红或
   静默产出残缺附件的线，不如显式停掉。
4. **只保护 Tauri 的检查一并删除**：`tools/check_tauri_permissions.py`（命令 / `build.rs` / capability
   三处一致）与它的回归测试。Tauri ACL 已不存在，这条检查没有可守的对象。
5. **有跨端价值的检查迁到 Go，而不是删掉**：
   - `check_rust_error_messages.py` → `tools/check_go_error_messages.py`（面向用户的错误消息整句英文）；
   - `check_user_facing_content.py` 的扫描目标从 `src-tauri/src/*.rs` 改为 `apps/workbench-go` 的 Go 字面量；
   - `check_source_labels.py` 的来源类型扫描加入 Go 目录（`SourceType` 字段与 SQL 写入）；
   - `check_clip_parity.py` 的字符集嗅探窗口第三处从 Rust `http.rs` 改为 Go `internal/httpx` 的 `MetaSniffBytes`；
   - `check_loopback_parity.mjs` 的对照端从 Rust 改为 Go（`go test -run TestPrintsLoopbackVerdictsForCrossPlatformParity`）。

## 迁移时被守卫逮到的两个真实缺陷

它们的共同点是「Rust 版是对的，Go 初版悄悄偏了」——正好说明这些检查迁过来比删掉更有价值：

1. **字符集嗅探窗口 2048 ≠ 1024**。Kotlin 与 TS 都是 `META_SNIFF_BYTES = 1024`，Go 的 `charsetFromMeta`
   写成 `2048`。同一页在桌面与安卓可能解出不同编码。修法：Go 引入 `MetaSniffBytes = 1024` 常量，
   并让 `check_clip_parity.py` 三方比对。
2. **回环判定把 IPv4 映射地址算成本机**。`net.IP.IsLoopback()` 对 `::ffff:127.0.0.1` / `[::ffff:7f00:1]`
   返回 true，而 TS / Android 的口径是「只认 localhost、字面量 127.0.0.1、IPv6 的 ::1，映射写法不算」。
   同一份 `settings.json` 写着 `http://[::ffff:127.0.0.1]:11434/v1` 时，桌面会免密钥、安卓会要密钥。
   修法：`isLoopbackHost` 显式拒绝 `ip.To4() != nil` 的 IPv6 写法，由 `check_loopback_parity.mjs` 逐条对拍。

## 后果

- 仓库里不再有 `Cargo.toml` / `.rs` / `src-tauri`。`~/.cargo` / `~/.rustup` **没有删**：本机还有
  AgentIsland 等仍在迁 Go 的 Rust 仓库，Rust 工具链与那个周清理任务都继续服务它们。
- 门禁（`tools/verify_workbench.sh`）现在是：前端 `npm test` + `tsc` + 静态守卫（含新的 Go 错误文案与
  来源标签）→ `go vet` + `go test ./...` → 回环判定 Go↔TS 对拍 → 本机浏览器冒烟。CI 对应
  `workbench.yml` 的 web-checks / go-checks / browser-smokes 三个 job。
- **发布能力是净损失**：在 Go 打包方案就绪前，第一套桌面只能在本机构建可执行文件，用户拿不到 DMG / MSI / DEB。
  这是有意接受的代价（工作树里没有任何一条 Rust 路径能继续产出）。

## 遗留（明确未做，不要当成已完成）

1. **前端仍 import `@tauri-apps/api` 等 JS 包**。Go 构建通过 `apps/workbench/go-preview/vite.config.mts`
   的 alias 把它们换成 `tauri*Shim.ts`（走 Wails bindings），因此运行时已无 Tauri；但这套命名与依赖
   仍是历史包袱，后续应改名（如 `shell/*`）并移除 `@tauri-apps/*` 依赖。
2. **「半中半英」错误消息没有守卫**。Rust 版还有一条检查：不允许把底层错误直接拼进中文句子
   （`{e}`）。Go 侧对应写法是 `fmt.Errorf("前缀：%w", err)`，现有 121 处。要治理得先有
   `error_text.explain(...)` 的等价层，本轮只在 `check_go_error_messages.py` 守「整句英文」这一类。
3. **安装包图标生成流程缺失**。`npx tauri icon` 随 Rust 壳删除；`shared/icons/AppIcon.iconset/` 美术源与
   派生图标仍在，恢复打包时补生成步骤。
4. **打包/发布矩阵未重建**。三平台安装包格式、产物命名、tag 规则与附件清单要在 Go 打包方案里重新定义，
   然后把 `workbench-release.yml` 的占位 job 换回真实矩阵。

## 复现与回滚

- 验证现状：`./tools/verify_workbench.sh`（本机 Node 22+ / Go 1.27+），或只跑 `web` / `go` 分片。
- 回滚：从 Git 历史恢复 `apps/workbench/src-tauri/` 与被删的两个检查脚本即可；但迁移后的 Go 后端已承接
  全部壳能力，回滚等于同时回退到 Rust 壳的维护代价（见 ADR-0005）。

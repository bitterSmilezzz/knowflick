# Workbench 正式版（1.0）实现计划

日期：2026-11-24。起点：`workbench-v0.1.0` 已发布（可安装，但仍是**预览级**：未签名、只有 arm64、Windows/Linux 未首启验收）。
本文只回答「还差什么、按什么顺序做、什么算做完」；产品功能范围仍以 [DELIVERY_ROADMAP](DELIVERY_ROADMAP.md) 的 R0–R5 为准。

## 0. 正式版判定（Definition of Done）

**硬门槛（缺一不算 1.0）**

1. **品牌一致**：窗口标题、首屏、关于页、安装包、二进制名里不再出现「预览 / preview / Go 版」；对用户只剩 KnowFlick。
2. **平台覆盖**：macOS（arm64 + x64）、Windows x64、Linux amd64 各有可安装产物；产物命名与 SHA256SUMS 一致。
3. **安装可信**：macOS Developer ID 签名 + notarytool 公证 + staple，`spctl -a` 通过；Windows Authenticode 签名，
   `signtool verify /pa` 通过；Linux DEB 至少校验包内容与依赖。
4. **三平台首启验收**：每一档都走完「安装 → 首启 → 导入 → 刷卡 → 测验 → 导出 → 卸载/重装」，有真机或 VM 证据。
5. **数据安全**：0.1.0 → 1.0 升级不丢库；备份到新目录可恢复；写入中强杀进程后库可打开；双开不互相破坏。
6. **真实依赖证据**：真实模型端点、真实 IMAP、真实麦克风至少各一项通过；验收表等级随之更新，未验的仍标待验。
7. **发布工程**：版本号、Release notes、SHA256SUMS、回滚说明齐全；tag 触发的构建与上传全绿。

**建议门槛（不阻塞发版，但应记录结论）**

- R1 的「新手能独立续写并找回」做 3–5 人任务式走查；
- 冷启动、常驻内存、安装包体积有基线数字；
- WebView 内容的可访问性（当前 AX 树只暴露菜单栏）有结论：修，或明确列为已知限制。

## 1. 现状差距

| 项 | 现状（0.1.0） | 到 1.0 要做什么 |
| --- | --- | --- |
| 品牌 | 窗口标题 `KnowFlick · Go 版只读预览`；首屏 `Go 版预览`；二进制 `knowflick-go-preview`；构建目录 `go-preview/` | 去 preview：改标题、首屏、二进制名、打包脚本引用与文档；目录可保留但不出现在用户可见处 |
| macOS 签名 | ad-hoc（`codesign -dv` 显示 `Signature=adhoc`） | Developer ID Application 证书 + hardened runtime + entitlements + notarytool + stapler |
| macOS 架构 | 只有 arm64 | 矩阵加 Intel（`macos-13` 或 x64 runner），产物名 `macos-x64` |
| Windows 签名 | 无，SmartScreen 会拦 | Authenticode 证书 + CI `signtool`；说明 SmartScreen 声誉仍需时间积累 |
| Windows/Linux 首启 | 只有构建证据 | 真机/VM 安装、首启、五步闭环、卸载；证据进验收表 |
| 数据升级 | 未验 0.1.0 → 1.0 | 老库样本升级、失败回滚、备份/恢复、强杀恢复、双开 |
| 真实依赖 | 模型/IMAP/麦克风均待验 | 真端点 + 真账号 + 物理麦克风，各留一条证据 |
| 法务/隐私 | 只有 MIT LICENSE | THIRD_PARTY_NOTICES、隐私说明（本地优先、会联网的场景逐条列） |
| 可靠性 | 未见单实例/崩溃处理代码 | 评估单实例锁、SQLite 完整性检查、异常退出提示 |
| 可访问性 | WebView 内容不在 AX 树 | 评估 Wails/WebView 可访问性方案，或写明限制 |
| 性能 | 前端单 chunk 786 kB 告警 | 冷启动/内存基线；按加载路径拆包（不追求数字） |

## 2. 工作包（WP）

### WP1 品牌收口（0.5–1 天，无外部依赖）

- `apps/workbench-go/main.go` 的 `Title` 改为 `KnowFlick`；
- `apps/workbench/go-preview/main.tsx` 首屏 `Go 版预览` 小标题去掉，只留产品名与「只读/编辑」状态；
- `tools/build_workbench_go.sh` 输出改 `bin/knowflick`，`tools/package_workbench_go.sh` 的 `BIN` 同步；
- 检查 smoke/scripts/docs 里对旧二进制名的引用；`grep -rn 'Go 版预览|只读预览|knowflick-go-preview'` 归零（用户可见面）。
- **验收**：装出来的 app 窗口标题、首屏、二进制名都不含 preview；DMG 里 app 名仍是 `KnowFlick.app`。

### WP2 版本与发布工程（0.5 天）

- 版本策略建议：先出 `workbench-v0.9.0-rc1`（预发布）给验收，全部硬门槛过后再 `1.0.0`；不要直接把 0.1.0 改 1.0.0。
- 更新 `apps/workbench/package.json`、Release 记录模板、CHANGELOG 分节；预发布用 `gh release create --prerelease`。
- **验收**：tag → 三平台矩阵 → 组装 → Release 全绿；SHA256SUMS 与本地产物逐项一致。

### WP3 macOS 签名与公证（外部 1–3 天 + 代码 0.5 天）

- 需要：Apple Developer Program 账号、Developer ID Application 证书、Team ID、notarytool 凭据（存 CI secret）。
- 打包脚本：`codesign --force --options runtime --timestamp --entitlements …`（麦克风/网络按实际能力最小化）；
  `xcrun notarytool submit … --wait`；`xcrun stapler staple`；`spctl -a -vv` 验收。
- **验收**：干净机器（或新用户）双击安装包不再被 Gatekeeper 拦；`codesign --verify --deep --strict` 通过。

### WP4 Windows 代码签名（外部 1–3 天 + 代码 0.5 天）

- 需要：Authenticode 证书（OV 或 EV；EV 对 SmartScreen 更快）、CI secret、`signtool` 步骤。
- **验收**：`signtool verify /pa` 通过；安装器属性里发布者正确；SmartScreen 行为记录（声誉积累不是代码能解决的）。

### WP5 平台矩阵补全（0.5–1 天）

- macOS x64：加 `macos-13`（或 x64 runner）出 `macos-x64` DMG；arm64 保持。
- Linux：amd64 已有；如要 arm64 另加 runner，非 1.0 必需。
- **验收**：四档产物（mac arm64 / mac x64 / win x64 / linux amd64）都能装、都能启动。

### WP6 三平台首启验收（1 天，需 Windows 机 + Linux VM）

- 在 Windows 开发机跑 NSIS 安装器：安装 → 首启 → 导入 → 刷卡 → 测验 → 导出 → 卸载（保留用户库）→ 重装。
- Linux 用 VM/容器外的 Ubuntu：`dpkg -i` → 首启 → 同上五步 → 卸载。
- **验收**：每档一份证据（截图仅辅助，以 AX/文件/数据库为准）；结果回填 [FIRST_VERSION_ACCEPTANCE](../FIRST_VERSION_ACCEPTANCE.md)。

### WP7 数据安全与可靠性（1–2 天）

- 用 0.1.0 产出的库做升级样本：启动 1.0 → 数据、附件、复习进度一致；失败时给出可回滚提示。
- 备份到新目录 → 恢复 → 校验；写入中 `kill -9` → 重开 → `PRAGMA integrity_check`；双开行为。
- WebDAV 凭据文件与 mail 凭据的权限（目录 0700 / 文件 0600）；备份包必须排除凭据（已有实现，补回归）。
- **验收**：以上每项有命令与结果；不通过就修，不能只写「已知问题」。

### WP8 真实依赖验收（1–2 天，需账号/设备）

- 真实模型：一个 OpenAI 兼容端点或本地 Ollama/vLLM，验出卡、问答、引用。
- 真实 IMAP：QQ（授权码+TLS）、163；Gmail/Microsoft 若 LOGIN 不适用标 OAuth 待接。
- 物理麦克风：桌面录音 → 保存 → 重启 → 回放 → 导出。
- **验收**：每条都有等级（可用/有限可用/待验/失败）与证据链接，不回填「支持」二字。

### WP9 法务、隐私与可访问性（0.5–1 天）

- `THIRD_PARTY_NOTICES.md`：Wails、React、Vite、字体与图标来源的许可清单；`PRIVACY.md`：本地数据位置、联网场景
  （模型、IMAP、WebDAV、更新检查）与关闭方式；确认无遥测。
- 可访问性：评估 WebView AX 暴露；至少保证键盘可达主要流程；结论写进发布记录。
- **验收**：文档进仓库；应用内「关于/隐私」入口可打开对应说明。

### WP10 性能与包体基线（0.5 天）

- 记录冷启动（秒）、常驻内存（MB）、DMG/EXE/DEB 体积；前端 786 kB chunk 按路由拆一次，比较前后。
- **验收**：基线数字进发布记录；拆包不引入白屏/加载失败。

## 3. 里程碑与顺序

| 里程碑 | 内容 | 依赖 | 建议节奏 |
| --- | --- | --- | --- |
| M0 可测试 RC | WP1 + WP2 + WP5，发 `0.9.0-rc1` 预发布 | 无 | 第 1 周 |
| M1 可信任安装 | WP3 + WP4，签名/公证/Windows 签名接上 | 证书采购（外部） | 与 M0 并行，证书到位后 2–3 天 |
| M2 证据齐 | WP6 + WP7 + WP8 | Windows 机、Linux VM、账号、麦克风 | 第 2 周 |
| M3 GA | WP9 + WP10 + RC 修复，发 `1.0.0` | M0–M2 全绿 | 第 3 周（外部条件不阻塞时） |

依赖关系：WP1/WP5 先行；WP3/WP4 只依赖证书；WP6 依赖 M0 产物与机器；WP7/WP8 可立即开始；WP9/WP10 在 GA 前收口。

## 4. 风险与应对

1. **证书采购周期**：Developer ID 与 Windows 证书都要审核；没有证书时先做 M0/M2，签名留到最后接线，不阻塞其余验收。
2. **SmartScreen 声誉**：签名后仍可能提示，需下载量积累；发布说明如实写，不承诺「零提示」。
3. **Intel Mac runner 可用性**：`macos-13` 队列可能慢；备选自建 x64 或交叉产物（Wails 不支持交叉，需真机）。
4. **Windows/Linux 机器**：没有机器就只能标「待验」，不能用 CI 构建冒充首启验收。
5. **范围蔓延**：R2/R3 功能（导入向导、WebDAV 同步、OCR）不进 1.0；1.0 只收「可信安装 + 数据安全 + 现有闭环」。

## 5. 需要所有者拍板

1. 版本节奏：`0.9.0-rc1 → 1.0.0`（推荐）还是一次性 `1.0.0`。
2. macOS / Windows 签名证书是否采购或使用现有证书；Team ID 与 CI secret 由谁提供。
3. Windows 机与 Linux VM 的执行时间（WP6 必需）。
4. 真实模型 / IMAP 账号用哪一个（WP8 必需）。
5. 是否把「自动更新」纳入 1.0：当前没有更新器，建议**不纳入**，1.0 用手动下载 + 校验和。

## 6. 非目标（1.0 不做）

- R2/R3 的新来源、同步、OCR/ASR 流水线、Android 端同步；
- 插件市场、协作编辑、Web 端；
- 自动更新器（除非所有者另行拍板）；
- Intel Mac 以外的其他架构（Linux arm64 视需要）。

## 7. 完成后的发布动作

1. 全绿后打 `workbench-v1.0.0` 注解 tag；CI 出四档产物 + SHA256SUMS；
2. 写 `docs/workbench_RELEASE_1.0.0.md`（含签名指纹、首启证据、已知限制）；
3. CHANGELOG 分节；Release notes 里置顶「安装说明 / 校验方法 / 回滚」；
4. 保留 0.1.0 作为历史版本，不删除；1.0 发布后再评估是否清理旧附件。

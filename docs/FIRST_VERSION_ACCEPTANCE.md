# 第一版功能验收清单

[ADR-0002 §2](../../docs/adr/0002-desktop-web-split-from-android.md) 写明第一版交付物是九项：

> 剪藏、笔记导入、AI 出卡、刷卡、卡库和详情、收藏和历史、测验、统计、导出。

这张表把每一项对应到**「有哪个测试证明它能用」**，并标出证据的强度。
它不是功能清单，是**证据清单**——没有证据的项就还只是「代码在那儿」。

## 证据强度

| 标记 | 含义 |
| --- | --- |
| **A** | 真实浏览器里走完整路径并断言状态（有界面冒烟或单测） |
| **B** | 逻辑层有单测，交互层靠人工或弱覆盖 |
| **C** | 只有代码存在，没有自动化证据 |

## 已修缺陷的证据覆盖

除了「交付物有没有」，还有一层：**修过的缺陷，它的回归测试还在不在**。
测试可能在后来的某次改动里被改弱或删掉——那时缺陷就悄悄回来了。

`tools/check_doc_consistency.py` 的 **EVIDENCE_MAP** 登记了回归证据位置与关键标识；
其中也包含边界用例与同一问题的多处证据，因此条目数不等于独立缺陷数。
文件或标识缺失时会报警，但仅凭字符串仍在，不能证明断言没有变弱。
**它在门禁里**，作为静态线索检查；行为是否正确仍须以实际测试结果为准。

而且不止「文件还在」——还核对**它真的会被跑**：

| 核对 | 抓什么 |
| --- | --- |
| 文件与标识还在 | 文件或登记标识被删；无法判定所有断言是否变弱 |
| 浏览器冒烟在 `run_all_smokes.sh` 列表里 | 套件存在但没人调 |
| Android 模块被 CI 显式点名 | Gradle 任务漏点名 → **静默少跑** |
| 前端单测在 vitest 收集范围里 | 文件在但不会被收集 |

这些检查帮助发现遗漏的证据与执行入口，不能代替行为测试或证明所有回归路径都已覆盖。

其中一条曾经只有浏览器层的证据（要真实浏览器，CI 跑不了），已抽成纯函数
（`domain/restoreRules.ts`）并补了单测。

## 怎么读这张表

「证据」一列给的是**测试文件**，不是「我试过」。点进去能看见断言，那就是证据；
点进去发现是空的，那这一行就只是我的说法。

证据的运行位置分三层：

| 层 | 在哪跑 | 覆盖什么 |
| --- | --- | --- |
| **门禁（每次提交）** | `verify_workbench.sh` | 前端 382 项 + Rust 测试（通过与忽略分开报告）+ 13 套浏览器冒烟 + MCP + 来源矩阵 + taste gate + 文档一致性 |
| **CI 三端** | 四条 workflow | 同一套门禁在 Linux / Windows / macOS 各跑一遍（含三平台安装包） |
| **本机真机** | `real_app_pages.mjs` | 真实 macOS 窗口逐页点击与截图（CI 跑不了，只有这台机器能跑） |

> 本机 Rust 输出为 **85 passed、3 ignored**，共 88 条测试声明。声明数不能当成通过数；
> 不同平台的实际执行结果以各 runner 日志为准。浏览器冒烟需要 agent-browser 与运行中的 Vite，
> 缺少条件时明确 SKIP，因此 CI 中的静态检查通过不代表浏览器交互已在 CI 执行。

## 逐项对照

| ADR 承诺 | 状态 | 证据 |
| --- | --- | --- |
| 剪藏 | ✅ | `clipEngine.test.ts`、`clipEngine.crossend.test.ts`、`fixtures.test.ts`（真实 GBK/UTF-8 页面）、`tools/check_clip_parity.py`（三端一致） |
| 笔记导入 | ✅ | `import_ui_smoke.mjs`（27 项）、`subscription.test.ts`、`fixtures.test.ts`（真实 DOCX/PPTX/feed） |
| AI 出卡 | **A** | `workspace_ui_smoke.mjs` **拦截 fetch 注入假模型响应**，验证整条链路：素材 → 请求 → 预览 → 确认 → 落库 → 回溯 materialId。仍然**没有真实模型的调用证据**（需要 API key），但链路本身是验过的 |
| 刷卡 | ✅ | `desktop_interaction_smoke.mjs`（键盘划走）、`review_ui_smoke.mjs`（19 项：评分写回、间隔算出、掌握度前进、重载后仍在） |
| 卡库和详情 | ✅ | `workspace_ui_smoke.mjs`（76 处断言）、`EntryInspector.test.tsx` |
| 收藏和历史 | ✅ | `workspace_ui_smoke.mjs`（收藏、归档、移回收件箱）、`model.test.ts` |
| 测验 | ✅ | `quizSession` / `review.test.ts`、`review_ui_smoke.mjs`；界面入口见 `workspace_ui_smoke.mjs` |
| 统计 | ✅ | `StatsView` + `workspace_ui_smoke.mjs`（指标块数量与口径）、Rust `db_get_stats` |
| 导出 | ✅ | `markdownExport.test.ts`（13 项，含 Anki TSV）、`systemBackup.test.ts`（7 项，无损往返）、`settings_plugins_smoke.mjs`（真实 .kfbackup 导出→恢复） |

## 横向能力

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 来源矩阵（7 种来源进收件箱→被搜到→转成卡→可回溯） | ✅ | `sourceMatrix.test.ts`（7 项，CI 每次跑）+ `source_matrix_smoke.mjs`（5 项，交互层） |
| 跨端契约（`cards.json` 导出与导入） | ✅ | `card.crossend.test.ts` / `CardJsonCrossEndTest.kt`（两端逐字节一致）、`WorkbenchExportImportTest.kt`（真实字节） |
| 复习算法两端一致（SM-2 / FSRS） | ✅ | `review.test.ts`、Android `FsrsEngineTest.kt`；参数逐行比对 |
| Anki TSV 导出（两端同格式） | ✅ | 桌面端 `markdownExport.test.ts` 4 项 + Android `CardExportEngineTest.kt` 4 项，两端格式对齐 |
| 备份无损往返 | ✅ | `systemBackup.test.ts`、`settings_plugins_smoke.mjs` |
| 外部接口（MCP） | ✅ | `mcp_smoke.mjs`（7 项，在门禁里） |
| 规模（4000 条内容） | ✅ | `scale_ui_smoke.mjs`（6 项，页内计时） |
| 界面质感 | ✅ | `taste_usability_gate.mjs`（13 项，**已纳入门禁**）+ 13 套浏览器冒烟（`run_all_smokes.sh`，也在门禁里）；`real_app_pages.mjs` 在**真实 macOS 窗口**上逐页验证（cliclick 点击 + 像素比对确认页面真的切换） |
| 数据出口（凭据不外流） | ✅ | `dataEgress.test.ts`（5 项，哨兵密钥跑所有导出路径）+ `store.redact.test.ts`（6 项）+ Rust `http.rs` 的 `redact_secrets`（含走真实 401 服务器的路径级测试） |
| 凭据存放 | ✅ | 桌面端 `<data_root>/credentials/apiKey.credential`（`store/` 的**兄弟目录**，导出天然带不走）；浏览器端 sessionStorage。不进 SQLite、不进任何导出格式 |
| 文档与实现一致 | ✅ | `check_doc_consistency.py`（在门禁里）：当前状态类文档里的数字与命令要跟得上实际 |

## 还没证据的

1. **真实模型的调用**——链路已用假端点验证（请求发出、响应解析、预览确认、
   落库回溯都验过）；但「真实模型返回的内容能不能被正确解析」需要 API key。
   `cardsFromModelText` 对**输出格式**的健壮性已经用假响应验过（引用编号、
   markdown 围栏、嵌套数组、空数组）；仍未验的是真实模型返回的**内容质量**
   （`details` 少于 80 字会被丢弃、标题重复会去重——真实模型偶尔会踩这两条）。
2. **真机语音录制**——面板已确认，但没有真的按下录音键并保存。
3. **Windows / Linux 安装后首启**——CI 出 msi/deb，本机只能出 DMG，没有人在那两台机器上跑过流程。
4. **真机录音**——面板在真机上确认过（「准备录音 / 开始录音 / 保存语音笔记」，
   并写明「录音保存在本机；转写走本地 Whisper，不上传音频」），但**没有真的按下
   录音键并保存**。

## 怎么用这张表

新增功能时，在对应行补上证据；**没有证据就不要勾**。
反过来，这张表上的空白就是下一轮该做的地方——不是「还有什么功能没想好」，
而是「哪些承诺还只是代码在那儿」。

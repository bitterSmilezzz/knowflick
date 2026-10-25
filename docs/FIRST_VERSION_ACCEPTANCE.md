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
| **门禁（每次提交）** | `verify_workbench.sh` | 前端 576 项 + Rust 测试（通过与忽略分开报告）+ 17 套浏览器冒烟 + MCP + 来源矩阵 + taste gate + 文档一致性 |
| **CI 三端** | 四条 workflow | 同一套门禁在 Linux / Windows / macOS 各跑一遍（含三平台安装包） |
| **本机真机** | `real_app_pages.mjs` | 真实 macOS 窗口逐页点击与截图（CI 跑不了，只有这台机器能跑） |

> 最近本机 Rust 输出为 **101 passed、3 ignored**，共 104 条测试声明。声明数不能当成通过数；
> 不同平台的实际执行结果以各 runner 日志为准。
>
> **浏览器冒烟现在在 CI 上真的跑**（2026-10-23 起）：`workbench.yml` 有独立的
> `browser-smokes` job，装 agent-browser 与浏览器二进制、起 Vite、逐套跑完 13 套
> （`tools/ci_run_browser_smokes.sh`）。此前 CI 上它们是整体 SKIP 的——
> 验收清单里 19 条「已修缺陷 → 证据测试」的登记因此在 CI 上一条断言都不产生。
> `run_all_smokes.sh` 仍保留给本机用（它缺 agent-browser 时 exit 0，
> 所以 CI 不能用它）。
>
> 仍**不在** CI 上跑的：真机逐页验证（`real_app_pages.mjs`，需要真实 macOS 窗口）。

## 逐项对照

| ADR 承诺 | 状态 | 证据 |
| --- | --- | --- |
| **可持续编辑笔记（R1 切片）** | ✅ | `notes_editor_smoke.mjs`（26 项：新建可写、自动保存、刷新恢复、修订推进、回收站删/恢复、入知识库、搜索命中正文、笔记本与标签的组织与筛选、元数据不追加修订、附件引用进正文且引用可搜）；领域契约 Rust `notes.rs` 5 项 + `note.test.ts` 5 项（修订冲突、库内检索不串库、老库迁移）；备份 v2 往返 `systemBackup.test.ts` |
| 剪藏 | ✅ | `clipEngine.test.ts`、`clipEngine.crossend.test.ts`、`fixtures.test.ts`（真实 GBK/UTF-8 页面）、`tools/check_clip_parity.py`（三端一致） |
| 笔记导入（文件） | ✅ | `import_ui_smoke.mjs`（28 项）、`subscription.test.ts`、`fixtures.test.ts`（真实 DOCX/PPTX/feed） |
| **手写笔记** | ✅ | `notes_ui_smoke.mjs`（40 项，含「保存后阅读区**真的重绘出笔迹**」——按像素判定非透明像素，以及「清空笔迹要先点两次」）、`ink.test.ts`（7 项：归一化、撤销、损坏数据不崩） |
| **语音笔记** | **A** | `notes_ui_smoke.mjs`（用 Chrome 合成麦克风跑完「开始 → 计时前进 → 停止 → 可回放 → 可保存」，并用浏览器解码器确认录到的字节**能解出真实时长与采样率**）、`media.rs`（Rust 侧落盘与读回）。**未验**：物理麦克风、系统权限、桌面附件落盘（见下「还没证据的」） |
| AI 出卡 | **A** | `workspace_ui_smoke.mjs` **拦截 fetch 注入假模型响应**，验证整条链路：素材 → 请求 → 预览 → 确认 → 落库 → 回溯 materialId。仍然**没有真实模型的调用证据**（需要 API key），但链路本身是验过的 |
| 刷卡 | ✅ | `desktop_interaction_smoke.mjs`（键盘划走）、`review_ui_smoke.mjs`（19 项：评分写回、间隔算出、掌握度前进、重载后仍在） |
| 卡库和详情 | ✅ | `workspace_ui_smoke.mjs`（90 项）、`EntryInspector.test.tsx` |
| 收藏和历史 | ✅ | `workspace_ui_smoke.mjs`（收藏、归档、移回收件箱）、`model.test.ts` |
| 测验 | ✅ | `quizSession` / `review.test.ts`、`review_ui_smoke.mjs`；界面入口见 `workspace_ui_smoke.mjs` |
| 统计 | ✅ | `StatsView` + `workspace_ui_smoke.mjs`（指标块数量与口径）、Rust `db_get_stats` |
| 导出 | ✅ | `markdownExport.test.ts`（13 项，含 Anki TSV）、`systemBackup.test.ts`（7 项，无损往返）、`settings_plugins_smoke.mjs`（真实 .kfbackup 导出→恢复） |
| **邮箱（收信源）** | **A** | `mailbox_ui_smoke.mjs`（45 项，跑在**浏览器模式**）、Rust `mail.rs`（IMAP 解析与落库）、`check_rust_error_messages.py`（24 条校验错误必须是中文）。**桌面端真机已验**：整个邮箱功能曾因 Tauri 权限清单漏项被 ACL 全拒（界面报英文的 `not allowed by ACL`），已修并加了守卫 `check_tauri_permissions.py`。**未验**：真实 IMAP 服务器上的收信（需账号与网络） |

> 状态 **A** = 主链路已验，但仍有**依赖外部条件**的一环没验（见文末「还没证据的」）。

## 横向能力

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 来源矩阵（7 种来源进收件箱→被搜到→转成卡→可回溯） | ✅ | `sourceMatrix.test.ts`（10 项，CI 每次跑）+ `source_matrix_smoke.mjs`（6 项，含旧 note 在真实收件箱中的中文标签） |
| 跨端契约（`cards.json` 导出与导入） | ✅ | `card.crossend.test.ts` / `CardJsonCrossEndTest.kt`（两端逐字节一致）、`WorkbenchExportImportTest.kt`（真实字节） |
| 复习算法两端一致（SM-2 / FSRS） | ✅ | `review.test.ts`、Android `FsrsEngineTest.kt`；参数逐行比对 |
| Anki TSV 导出（两端同格式） | ✅ | 桌面端 `markdownExport.test.ts` 4 项 + Android `CardExportEngineTest.kt` 4 项，两端格式对齐 |
| 备份无损往返 | ✅ | `systemBackup.test.ts`、`settings_plugins_smoke.mjs` |
| 不可撤销操作有二次确认 | ✅ | `check_destructive_confirm.py`（界面上的「一点即删」都要经由确认入口）+ `destructive_confirm_reverse_test.py`（四种退化逐个塞进去确认守卫报红）；共享实现 `deleteConfirm.ts` / `useDeleteConfirm.ts` |
| 外部接口（MCP） | ✅ | `mcp_smoke.mjs`（8 项；有库分支依赖本机库）；`mcp_server_smoke.mjs`（20 项独立临时库检查）由 6 项反向验证调用，验证正常基线通过、退化以 AssertionError 失败。宿主与 stdio 无链接写入均验证为 manual，旧 note 显示兼容由前端测试覆盖 |
| 规模（4000 条内容） | ✅ | `scale_ui_smoke.mjs`（6 项，页内计时；**时间断言按实测分布定预算**，见 `SMOOTHNESS.md`） |
| 键盘可达（模态） | ✅ | `taste_usability_gate.mjs`：手写/语音面板打开后焦点进入面板、Tab 在面板内循环、Escape 关闭并归还焦点（此前这些面板键盘完全不可达）。原生 `<dialog>` 的「记录」模态由浏览器提供同样能力 |
| 界面质感 | ✅ | `taste_usability_gate.mjs`（13 项，**已纳入门禁**）+ 17 套浏览器冒烟（**CI 上也在跑**：`workbench.yml` 的 `browser-smokes` job）；`real_app_pages.mjs` 在**真实 macOS 窗口**上逐页验证（cliclick 点击 + 像素比对确认页面真的切换） |
| 数据出口（凭据不外流） | ✅ | `dataEgress.test.ts`（5 项，哨兵密钥跑所有导出路径）+ `store.redact.test.ts`（6 项）+ Rust `http.rs` 的 `redact_secrets`（含走真实 401 服务器的路径级测试） |
| 凭据存放 | ✅ | 桌面端 `<data_root>/credentials/apiKey.credential`（`store/` 的**兄弟目录**，导出天然带不走）；浏览器端 sessionStorage。不进 SQLite、不进任何导出格式 |
| 文档与实现一致 | ✅ | `check_doc_consistency.py`（在门禁里）：当前状态类文档里的数字与命令要跟得上实际 |

## 还没证据的

1. **真实模型的调用与质量**——假端点已验证请求、解析、预览、确认与落库回溯。
   合成样本覆盖短正文、重复标题、引用编号、围栏、空标题与错误类型字段；这些是
   已知边界的回归，不能代表真实模型内容质量或所有输出风格。本机无已配置的
   模型密钥，也未发现运行中的本地模型服务；真实端点验收仍待补。
2. **真实麦克风与桌面录音保存**——合成媒体输入证明浏览器录音组件可以生成
   可解码音频，不能代替物理麦克风、系统权限、Tauri WebView 与桌面附件落盘验收。
   仍需在桌面客户端录制、保存、重启后回放，确认内容与附件都保留。
3. **Windows / Linux 安装后首启**——CI 已构建 msi/deb；尚无安装后完成
   导入 → 刷卡 → 测验 → 导出的验收证据。
4. **真实 IMAP 服务器上的收信**——邮箱的界面、校验、落库与错误文案都验过了
   （且修掉了「整个邮箱功能被 ACL 全拒」那个缺陷），但**没有连过真实的
   IMAP 服务器**：需要一个可用的邮箱账号与网络。IMAP 协议细节（多文件夹、
   垃圾邮件判定、大附件跳过）目前只有单元测试覆盖。

## 已补上的（原先空白）

- **真机逐页验证**（2026-10-23）：`real_app_pages.mjs` 在**真实 macOS 窗口**上
  逐页点击「认知简报 / 产物库 / 统计 / 知识测验」，并用**内容区像素比对**确认
  页面真的切换了（5 项全过）。截图复核：侧栏「应用」段左对齐、无多余空白条。

  这项验证**必须在解锁状态下跑**：锁屏时点击照样生效，但截到的是锁屏界面
  （带时钟，每秒都变），像素比对会**永远**判定「变了」——那不是证据。
  工具现在会先查 `CGSSessionScreenIsLocked`，锁屏就如实 SKIP 并说明原因。

- **合成输入的浏览器录音组件**（2026-10-23）：Chrome 假麦克风下执行开始、
  计时前进、停止，获取非零字节并用 AudioContext 解码，确认时长与采样率有效。
  损坏字节的负向验证被断言拒绝。浏览器点击保存后，断言出现桌面端提示；
  本测试未证明桌面保存成功。当前 notes 冒烟 29 项，本机门禁已执行；
  CI 缺 agent-browser 时仍会 SKIP，不能据此声称 CI 执行过录音交互。

## 怎么用这张表

新增功能时，在对应行补上证据；**没有证据就不要勾**。
反过来，这张表上的空白就是下一轮该做的地方——不是「还有什么功能没想好」，
而是「哪些承诺还只是代码在那儿」。

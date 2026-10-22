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

## 逐项对照

| ADR 承诺 | 状态 | 证据 |
| --- | --- | --- |
| 剪藏 | ✅ | `clipEngine.test.ts`、`clipEngine.crossend.test.ts`、`fixtures.test.ts`（真实 GBK/UTF-8 页面）、`tools/check_clip_parity.py`（三端一致） |
| 笔记导入 | ✅ | `import_ui_smoke.mjs`（27 项）、`subscription.test.ts`、`fixtures.test.ts`（真实 DOCX/PPTX/feed） |
| AI 出卡 | **B** | `aiTransform` 有实现与 UI 入口；**没有真实模型调用的自动化证据**（需要 API key） |
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
| 界面质感 | **B** | `taste_usability_gate.mjs` 存在但**未纳入门禁**；`tools/real_app_pages.mjs` 在**真实 macOS 窗口**上逐页验证（cliclick 点击 + 像素比对确认页面真的切换） |

## 还没证据的

1. **AI 出卡的真实模型调用**——需要 API key 与网络，自动化跑不了。
2. **真机语音录制**——面板已确认，但没有真的按下录音键并保存。
3. **Windows / Linux 安装后首启**——CI 出 msi/deb，本机只能出 DMG，没有人在那两台机器上跑过流程。
4. **真机录音**——面板在真机上确认过（「准备录音 / 开始录音 / 保存语音笔记」，
   并写明「录音保存在本机；转写走本地 Whisper，不上传音频」），但**没有真的按下
   录音键并保存**。

## 怎么用这张表

新增功能时，在对应行补上证据；**没有证据就不要勾**。
反过来，这张表上的空白就是下一轮该做的地方——不是「还有什么功能没想好」，
而是「哪些承诺还只是代码在那儿」。

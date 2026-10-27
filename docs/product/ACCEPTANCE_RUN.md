# 验收运行记录（T12）

本文件是**运行结果**的登记处，不是结论。结论在
[R1](R1_PROGRESS.md) / [R2](R2_PROGRESS.md) / [R3](R3_PROGRESS.md) /
[R4](R4_PROGRESS.md) 与 [审计修复登记](../audits/2026-10-25/FIXES.md)。

口径沿用路线图：**实际 PASS/FAIL/SKIP 分开报，声明数不当作通过数**。
缺真实账号、设备或凭据的项一律记 SKIP 并写明原因——不拿合成测试冒充真实验收。

## 一、本轮门禁运行（工作台第一套）

- 平台：macOS 14（darwin arm64），Node 26.7.0，Rust stable，Python 3.15
- 分支：`workbench/second-brain-validation`，提交 `d3b8041`（真机替换用的构建）
- 命令：`tools/verify_workbench.sh`（= CI `workbench.yml` 同口径）

| 门禁段 | 结果 | 实际数字 |
| --- | --- | --- |
| `npm test`（vitest） | PASS | 84 个测试文件、542 项用例全部通过 |
| `npx tsc --noEmit` | PASS | 无输出 |
| `cargo test --locked` | PASS | 134 passed、0 failed、3 ignored（忽略项是万条延迟基准，默认不跑） |
| 代理环境复跑（`cargo test --lib http::tests`） | PASS | 回环请求不被系统代理吃掉 |
| 静态守卫（12 个 unittest + 9 个脚本） | PASS | 含文档一致性、Tauri 权限三处一致、中文错误文案、空断言、破坏性确认、来源标签 |
| 反向验证（守卫真的在守东西） | PASS | 4 个退化用例都被对应守卫报出 |
| 浏览器冒烟 | PASS | 15 套全部通过 |
| MCP 接入冒烟 | PASS | 10 项（任意 cwd、默认只读、显式授权、模块停用吊销） |
| 真机外部写入冒烟 | **SKIP** | 屏幕处于锁屏状态——像素比对会截到锁屏界面给出假通过，解锁后重跑 |

### 15 套浏览器冒烟明细

| 套件 | 结果 | 项数 |
| --- | --- | --- |
| `taste_usability_gate` | PASS | — |
| `workspace_ui_smoke` | PASS | — |
| `brain_ui_smoke` | PASS | 36 |
| `import_ui_smoke` | PASS | 33 |
| `notes_ui_smoke` | PASS | 40 |
| `notes_editor_smoke` | PASS | 26 |
| `note_retrieval_smoke` | PASS | 15 |
| `mailbox_ui_smoke` | PASS | 45 |
| `review_ui_smoke` | PASS | 19 |
| `scale_ui_smoke` | PASS | 6 |
| `settings_plugins_smoke` | PASS | — |
| `subscriptions_ui_smoke` | PASS | — |
| `source_matrix_smoke` | PASS | 6 |
| `usability_journey_smoke` | PASS | 13 |
| `desktop_interaction_smoke` | PASS | 22 |
| `desktop_external_write_smoke` | PASS（真机） | 9 项：应用在运行、窗口在屏、交通灯可辨、切到卡库页且截图指纹稳定、**MCP 脚本取自已安装应用内随包分发的那份**、默认只读时写工具被明确拒绝并说明开启方法、显式授权后独立进程写入成功、新卡写进应用正在用的那个库、外部写入后界面自动刷新 |

## 二、审计项 ↔ 反例测试绑定

审计 [2026-10-25](../audits/2026-10-25/REPORT.md) 的每条 P0/P1 都绑定一个
**旧实现必失败**的测试；修复说明与提交号见 FIXES.md。

| 审计项 | 级别 | 绑定测试 | 旧实现下的表现 |
| --- | --- | --- | --- |
| KF-001 | P0 | `backupCollect.test.ts`（冷启动不打开笔记页仍有全量笔记） | 旧导出取界面缓存 → 快照为空 |
| KF-002 | P0 | `noteSession.test.ts`（冲突后继续输入不自动提交） | 旧冲突分支前移基线 → 下一次输入覆盖远端 |
| KF-003 | P0 | Rust `restore_upsert_preserves_revision_times_and_deleted_state` | 旧恢复走普通编辑 → 修订归 1、删除态复活 |
| KF-004 | P1 | `noteSession.test.ts`（属性后写正文不回退） | 旧属性写列表快照 → 正文保存覆盖新属性 |
| KF-005 | P1 | Rust `note_list_pagination_walks_all_pages` | 旧布尔语义 → 回收站读不到、all≠active+deleted |
| KF-006 | P1 | `notesRestore.test.ts`（同名异 id 成员迁移） | 旧恢复跳库但按新 id 挂成员 → 关系丢失 |
| KF-007 | P1 | `backupRestore.test.ts`（第 1/N/最后一条失败、附件缺失、取消） | 旧外层 catch 一律写「未受影响」→ 文案与副作用不符 |
| KF-008 | P1 | `backupCollect.test.ts`（分页全量 + 附件两路覆盖） | 旧导出复用界面查询上限 → 静默漏内容 |
| KF-009 | P1 | `systemBackup.test.ts`（篡改 v3/v2 包拒绝、截断、重复条目、计数不符） | 旧恢复只 warn → 篡改被接受 |
| KF-010 | P1 | `repository.browserNotes.test.ts`（损坏 → 锁定写入） | 旧解析失败返回空库 → 下次保存覆盖原值 |
| KF-011 | P1 | Rust `card_content_change_invalidates_embedding_while_review_change_keeps_it` | 旧更新卡片不清向量 → 改正文后旧向量仍在 |
| KF-012 | P1 | `moduleLifecycle.matrix.test.ts`（6 模块启停矩阵） | 旧开关只改配置 → 执行层不读开关 |
| KF-013 | P1 | `mcp_install_smoke.mjs`（任意 cwd、绝对路径 + `--dir`） | 旧配置指仓内相对路径 → 安装用户 module not found |
| KF-014 | P2 | 本轮 T11 收口：恢复与导出各只有一个规则入口 | 旧两处编排 → 改一处漂移 |
| KF-015 | P1 | `tools/test_windows_console.py` 等守卫的反向验证 | 旧门禁假绿 → 断言不真守东西 |

## 三、外部条件相关（保持「待真实验收」）

| 项 | 状态 | 缺什么 |
| --- | --- | --- |
| 真实邮箱账号收信（QQ/163 只读、Gmail OAuth） | 待真实验收 | 真实账号与网络；Gmail OAuth 是独立工程，不给兼容承诺 |
| 真实模型生成与引用质量 | 待真实验收 | 用户自有账号与密钥；本轮未替用户产生费用 |
| 物理麦克风录音落盘 | 待真实验收 | 物理设备与系统权限（浏览器合成麦克风已验，非物理设备） |
| Windows / Linux 安装与首启 | 待真实验收 | 安装包构建不等于安装；需在目标系统实测导入 → 刷卡 → 测验 → 导出 |
| 真实 WebDAV 服务兼容性 | 待真实验收 | 真实服务实例（协议层已自验，自建与用户服务各一） |
| 检索质量基准（≥100 条中英混合问题、首 5 条命中率 ≥90%） | 待人工标注 | 人工标注语料；不是代码任务 |
| 真机外部写入冒烟 | **已验收** | 屏幕解锁后补跑，9 项通过（见上表）；证据是 AX 树、进程输出与 SQLite 行——不靠看图 |

### 真机安装与替换（本轮）

- 构建：`apps/workbench` 下 `npm run tauri build -- --bundles app` → `target/release/bundle/macos/KnowFlick.app`（57.11 MiB）。
- 替换：`/Applications/KnowFlick.app`（旧包 10-24 12:03 构建，落后 54 个提交）先移到
  `.scratch/install-backup/KnowFlick.app.bak-20261026`（仓库内、已 gitignore），再装新包。
- 新包校验：`Contents/Resources/tools/mcp-server.mjs` 存在（旧包没有——T10 之前
  没把服务端脚本随包分发）；二进制时间戳与新构建一致。
- 真机界面证据（AX 树，非截图）：侧栏「应用」段含 **复盘 / 我的记忆 / 目标 / 项目记忆 / 创作台**
  五个入口；来源筛选含「笔记」页签；点开「创作台」后读到标题、说明文案与候选卡片。
- 用户数据未受影响：库在 `~/Library/Application Support/KnowFlick/`，在 app 包之外，
  替换只换应用本体。

## 四、复核方式

```sh
# 全量门禁（= CI 同口径）
./tools/verify_workbench.sh

# 单套冒烟
node tools/<suite>.mjs

# 审计修复登记
docs/audits/2026-10-25/FIXES.md
```

守卫类脚本请从**仓库根**运行（路径与 EVIDENCE_MAP 有关）。
CI 四档（Workbench / Workbench Release / Desktop 三平台 / Android）在
PR #95 上复核；本机绿不等于跨平台绿——Linux 的 inode 时间戳粒度、
Windows 的 cp1252 控制台都要在 CI 上才复现得出来。

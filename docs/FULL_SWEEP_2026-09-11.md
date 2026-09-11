# Brooks-Lint — Full Sweep Report

**Mode:** Full Sweep  
**Scope:** KnowFlick repository, 131 tracked files; Swift production, Core, tests, packaging and tools. Existing uncommitted work was preserved.  
**Health Score:** 97/100 (bounded estimate after safe fixes; run the health dashboard again for an exact recalculation.)

本次完整扫描覆盖代码衰减、测试质量、技术债和架构四个维度。发现的问题分为可安全修复项和需要后续设计决策的结构性项；安全项已完成并通过测试。

## Dimension Summary

| Dimension | Scanned | Safe Applied | Extended Applied | Reverted | Residual |
|---|---:|---:|---:|---:|---:|
| Review (R1–R6) | 111 tracked Swift/project files | 5 | 0 | 0 | 2 |
| Test (T1–T6) | 20 test suites | 3 | 0 | 0 | 1 |
| Debt | 8 hotspot modules | 1 | 0 | 0 | 2 |
| Audit | 4 dependency layers | 0 | 0 | 0 | 3 |

## 修复内容

### R1/R2 — 保存错误路径可见

**Symptom:** 设置和聊天记录写入使用 `try?`，界面无法区分保存成功与失败。  
**Source:** Code Complete — Defensive Programming；Clean Architecture — Explicit Error Paths。  
**Consequence:** 磁盘权限、空间或文件冲突时，用户可能只在重启后发现设置或对话丢失。  
**Remedy:** 新增 throwing storage API；AppStore 将聊天保存错误放入会话错误状态，设置入口写入 `lastError`；保留旧非抛出 API 兼容现有调用方。

### R2/R6 — 损坏数据不再静默删除

**Symptom:** 主文件和备份都无法解码时，旧实现直接删除两个文件。  
**Source:** Code Complete — Fail Safe Defaults；Domain-Driven Design — Entity Lifecycle。  
**Consequence:** 最后的恢复线索被抹掉，用户无法人工取回部分数据。  
**Remedy:** 将损坏文件移动为带时间和随机后缀的隔离副本，再由应用重新初始化；回归测试验证两个损坏文件都被保留。

### T5 — 新增失败路径和完整性测试

新增测试覆盖设置/聊天写入失败、损坏文件隔离、语音实例注入、应用退出清理、统计分类稳定排序、设置与会话损坏隔离、超大导入文件保护、400 张卡片后台 JSON 往返、取消写入、预览截断与完整导出。Swift 测试共 140 项、20 个 suite 通过，Python 工具测试 3 项通过。

## Residual Items

### Warning — R1/R2：AppStore 仍承担过多生命周期

**Symptom:** `AppStore.swift` 约 778 行，同时管理卡堆、复习、AI、聊天、语音、设置和持久化。  
**Source:** Refactoring — Divergent Change；A Philosophy of Software Design — Deep Modules。  
**Consequence:** 新功能容易跨越多个状态边界，修改一个流程时需要回归整个应用。  
**Remedy:** 后续拆出 `CardLibraryStore`、`ReviewPlanner`、`ChatSessionStore`，先以协议和 characterization tests 固定行为，再逐步迁移。  
**Not applied because:** 跨模块结构变更，需单独设计与迁移窗口。

### Warning — R1：界面大文件持续增长

**Symptom:** `CardDeckView`、`SettingsView`、`ImportNotesModalView` 和 `ExportCardsModalView` 均超过 500 行。  
**Source:** Code Complete — Routine Size；Refactoring — Extract Method / Extract Class。  
**Consequence:** UI 状态、业务动作和布局同时变化，视觉修改容易影响键盘、持久化或模态路由。  
**Remedy:** 按页面状态抽取独立子视图和 action coordinator；保持 ActiveSheet 作为唯一模态入口。  
**Not applied because:** 需要跨多个视图的结构调整，当前没有必要为单次优化引入大范围风险。

### 已处理 — R5：共享语音单例穿透状态边界

**Symptom:** Store 和多个 View 直接访问 `SpeechSynthesizerService.shared`。  
**Source:** Clean Architecture — Dependency Inversion。  
**Consequence:** 多窗口、测试和未来本地/云端语音实现难以隔离。
**Remedy:** 应用入口可注入独立语音服务实例；卡片堆和详情页统一读取当前 AppStore 实例，同时保留旧默认实例兼容性。

### Suggestion — T5：原生 UI 自动化覆盖仍为空

**Symptom:** 核心 Swift 行为有测试，窗口布局、菜单、辅助功能树和模态流依靠人工 CUA 验收。  
**Source:** How Google Tests Software — Change Coverage；Working Effectively with Legacy Code — Characterization Tests。  
**Consequence:** SwiftUI 重构可能出现编译通过但窗口状态、焦点或文字裁切回归。  
**Remedy:** 增加少量 macOS UI smoke 流程，优先覆盖工作台导航、复习队列、导入预览和编辑保存。  
**Not applied because:** 需要单独建立稳定的原生 UI 测试运行方式。

## Fix Log

| # | Risk | Outcome | Change |
|---:|---|---|---|
| 1 | R1/R2 | applied | Storage 增加 throwing 设置与聊天写入 API；AppStore 和 UI 显示保存失败 |
| 2 | R2/R6 | applied | 损坏 cards.json 与 backup 隔离保留，避免不可逆删除 |
| 3 | T5 | applied | 增加持久化失败、数据隔离和完整导出测试 |
| 4 | R1/R2 | residual | AppStore 拆分，保留到后续架构迭代 |
| 5 | R1 | residual | 超大 SwiftUI 页面拆分，保留到 UI 组件化迭代 |
| 6 | R5 | applied | AppStore 支持注入语音服务，卡片堆和详情页使用当前实例 |
| 7 | R1/R5 | applied | 应用后台与退出统一清理任务、停止语音并同步刷盘 |
| 8 | R3 | applied | 搜索引擎缓存拼音字段转换，限制缓存容量并保持线程安全 |
| 9 | R3 | applied | 统计分类并列时使用稳定名称排序，避免重绘时列表跳动 |
| 10 | R2/R6 | applied | 设置与聊天记录损坏时隔离普通文件，目录冲突保持原状并继续报告写入失败 |
| 11 | T1/T2 | applied | Storage 测试改为场景-结果命名，降低失败定位成本 |
| 12 | T2/T5/R3 | applied | 统计计算改为单次遍历聚合，测试保留明确超时而非脆弱的纯 yield 等待 |
| 13 | T5/R1 | applied | 为折叠菜单、搜索、朗读和磨耳朵控制补充 VoiceOver 标签与动态值 |
| 14 | R2/R6 | applied | 导入笔记增加 32MB 大小上限，在解析前拒绝超大文件 |

## 验证

- `./tools/test.sh --disable-sandbox`: 140 tests / 20 suites passed。
- `python3 -m unittest discover -s tools -p 'test_*.py'`: 3 tests passed。
- `git diff --check`: passed。
- Release 构建和 AppIcon 全尺寸校验：passed。
- 语音服务实例注入编译验证：passed。
- 搜索拼音缓存编译与回归验证：passed。
- 多 Agent 测试质量与性能审查：passed；连续两次完整 Swift 回归均通过。
- UI 可访问性与键盘交互审查：passed。

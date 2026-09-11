# KnowFlick 二十轮优化总结（2026-09-11）

> 基线 v3.2.0（141 tests / 20 suites）→ 终点 v3.9.0（172 tests / 25 suites，KnowFlickCore 运行于 Swift 6 严格并发）。
> 每轮流程：多 agent 审计或开发 → `tools/test.sh` 全绿 → 提交 + tag + CHANGELOG/文档更新。
> 审计素材：三路并行审计共发现 72 项问题（核心层 C1–C24、UI 层 U1–U25、测试/文档/工具链 T1–T23）与 8 条补测试建议，全部闭环（修复、补测试、文档化或明确记录取舍）。

## 轮次总览

| 轮 | 版本 | 主题 | 关键产出 |
|---|------|------|---------|
| R1 | v3.2.1 | 缺陷修复 | 详情页「下一张」失效、聊天 `%` 渲染损坏、导出 DateFormatter 数据竞争、saveSettings 回滚语义、版本单一来源（AppVersion.swift） |
| R2 | v3.2.2 | 输入即卡顿 | 搜索异步防抖（后台线程）、favorites 派生快照、visualSpec 零图片解码行渲染、关键词内容哈希缓存 |
| R3 | v3.3.0 | 图谱交互 | 滚轮/捏合缩放落地（此前有承诺无实现）、空格重置、历史页 Esc 最上层优先 |
| R4 | v3.3.1 | 测试加固 A | arrangeWithMinDistance 性质测试（同图间隔≥5）、种子增量合并回归、16 档预设一致性、FNV/42键锚点 |
| R5 | v3.3.2 | 测试加固 B | 聊天全链路 URLProtocol 传输测试、持久化并发契约、磨耳朵推进回调、图谱四档评分带、测验守卫契约重写 |
| R6 | v3.4.0 | 设置与 Toast | 外观改统一保存语义（放弃修改可兑现）、applySettingsChange 轻量通道、分类提示分离、6 套 Toast 统一为 EditorialToast |
| R7 | v3.4.1 | 导入导出 | JSON 毫秒日期+逐卡挽救、收藏导出统一管线（锚点修复）、O(n²)→O(n)、标题误抓、种子合并归一化口径 |
| R8 | v3.4.2 | 持久化性能 | 切后台零阻塞（persistImmediately）、bootstrap IO 后台化+didSet 风暴消除（7 次重算→2 次）、聊天落盘异步化、备份轮转零解码快路径 |
| R9 | v3.5.0 | AI 服务 | 聊天 429/5xx 重试、服务端错误体透出、IncrementalObjectScanner 增量扫描（O(n²)→O(n)）、预设匹配表驱动、max_tokens 封顶 |
| R10 | v3.5.1 | 图谱性能 | buildGraph 取消返回部分结果、swap-remove O(1)、keyCache 修剪、拼音缓存半驱逐、星图 nodeMap 预计算 |
| R11 | v3.5.2 | 可访问性 | 搜索结果行 Button 化+合并标签、图标按钮 accessibilityLabel、测验快捷键决策记录 |
| R12 | v3.6.0 | 深浅色适配 | 音频条语义动态色、进度/错误色统一、聊天窗口弹性尺寸、扫光去重 |
| R13 | v3.6.1 | 死代码 | speakTerm/shared 单例/interleavedAndDeduplicated/Storage 非抛版包装清理 |
| R14 | v3.6.2 | 构建链路 | build_icon 自动 iconutil、打包失败清理半成品、导入脚本校验前移、docs 快照声明、CHANGELOG Unreleased |
| R15 | v3.7.0 | 文档对齐 | README 快捷键四作用域分表、徽章 Swift 6.0、CONTEXT.md 过期描述修正、存储表/结构树补全 |
| R16 | v3.7.1 | 工具链验证 | 图标链路端到端实测、自检命令入 README、测试计数口径注明 |
| R17 | v3.7.2 | UI/算法打磨 | 海报期号确定性、到期排序预计算、测验选题 Set 化、进度保护、飞出动画 completion 化、PanelPresenter、TimelineView 移除 |
| R18 | v3.8.0 | Swift 6 | KnowFlickCore + 测试目标迁至严格并发（nonisolated(unsafe) 锁纪律、AIService Sendable、@preconcurrency AVFoundation） |
| R19 | v3.8.1 | 交叉复审 | 双 agent 复审全部 diff，修复 P1 聊天清除→重开竞态（内存墓碑）、P2 动画回调兜底、P2 设置写盘静默失败等 |
| R20 | v3.9.0 | 收尾 | 全量回归（测试/Release/打包三验证）、本总结文档 |

## 审计发现闭环情况

- **P0/P1 全部修复**：U1、U2、C2、C3（R1）；U3、U8（R3）；U4–U6（R2）；C15、C20（R9）；T3、T5、T6（R15）。
- **P2 大部分修复**，个别明确取舍：U9（sheet 嵌套，依赖 macOS 窗口模型天然隔离，保留现状）；U13（drawingGroup 与玻璃材质冲突，评估后不做）；U18 相关的跨零点刷新（接受边缘场景并文档化）。
- **P3 全部处理或记录**：死代码清理（R13）、格式统一（R14/R15）、性能打磨（R17）。
- **8 条补测试建议全部落地**（R4/R5），测试规模 141 → 172 项、20 → 25 个 suite。

## 关键架构改进

1. **持久化通道统一**：卡片、设置、聊天三类写入全部经同一后台串行队列（FIFO + revision 校验），主线程零同步 IO；退出经 `shutdown()` 同步收口。
2. **版本单一来源**：`AppVersion.swift` → Info.plist（构建时提取）/ User-Agent / 关于页。
3. **缓存纪律**：内容哈希缓存 + 存活集修剪 + 软驱逐，全部带锁纪律注释并通过并发测试。
4. **Swift 6 前置**：核心层严格并发迁移完成，App 层迁移路径已清晰（风险集中在 SwiftUI 视图长尾）。
5. **测试防线**：README/CONTEXT 的产品承诺（防重排布、种子合并、免密预设、学习数据保留）均有专属回归测试。

## 遗留与后续建议

- App 层（Sources/KnowFlick）迁移 Swift 6：预计天级工作量，建议单独立项。
- 超长视图文件拆分（SettingsView/CardDeckView 约 1000 行）：纯风格重构，建议结合功能迭代进行。
- 星图空格快捷键与检索框的极端抢占行为需真机验证（P3 观察项）。
- 批量生成数量若放宽超过 9 张/次，需配合分批请求（max_tokens 封顶 8192）。

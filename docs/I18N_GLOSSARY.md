# KnowFlick i18n 术语表

2026-10-05 定案。全部英文文案遵循此表，新增词条先对表再落笔；改词条 = 改这里 + 改词典，同一个 PR。

## 机制（已实证）

- **中文原句即 key**：SwiftUI `Text("刷卡")` 的字面量自动作为 Localizable.strings 的 key 查主包表。中文侧零文件零查表（开发区域就是中文），**视图代码基本不动**。
- 词典位置：`apps/mac/Resources/Localization/en.lproj/Localizable.strings`，由 `build_app.sh` 复制进 `.app/Contents/Resources/`；Info.plist 声明 `CFBundleDevelopmentRegion=zh-Hans` + `CFBundleLocalizations=[zh-Hans, en]`。
- 插值文案的 key 是格式化模式：`Text("还剩 \(n) 张")` → 词典键 `"还剩 %lld 张"`。
- 语言切换：跟随系统；设置页可手动覆盖（写 `AppleLanguages`，重启生效）。
- 语气：**简洁工具风**（Linear/Raycast 式短语，不带句号），标题类用 Title Case，按钮/行内用 Sentence case。

## 术语表（定案译法）

| 中文 | English | 备注 |
| --- | --- | --- |
| 卡片 / 知识卡片 | card / Knowledge Cards | |
| 刷卡 | Swipe / swiping | 动词短语用 swiping（Start swiping） |
| 今日 | Today | |
| 复习 | Review | |
| 知识库 | Library | |
| 收藏（阁） | Saved | 名词用 Saved，不译作 Favorites（与历史/全部构成范围组） |
| 历史 | History | |
| 统计 | Stats | 导航用 Stats，标题 Statistics 可互换 |
| 学习地图 | Learning Map | |
| 星图 | Knowledge Graph | 不用 Star Map |
| 磨耳朵 | Ambient Listening | 「连续朗读」continuous playback |
| 听书（控制台） | Speech Console | |
| 测验 | Quiz | |
| 掌握 / 已掌握 | mastered / Mastered | |
| 待巩固 | reinforcing | |
| 未读 / 已读 | unread / read | |
| 追问（AI 伴学） | Ask AI | |
| 海报 | Poster | |
| 导入笔记 | Import Notes | |
| 剪藏 | Web Clip | |
| 局域网同步 | LAN Sync | |
| 学习范围 | study scope | |
| 到期 / 到期复习 | due / due for review | |
| 巩固中 | reinforcing | |
| 目标 | goal | |

## 分批计划

- Batch 1：壳（InsightShell）+ 工作台（LearningWorkspace）+ 语言覆盖设置项
- Batch 2：详情页 + 卡片正面（DetailView / InsightCardView / InsightMainView 刷卡区）
- Batch 3：工具页（Quiz / QuizCard / KnowledgeGraph / LearningMap / SpeechConsole / AmbientBar）
- Batch 4：面板（Settings / Sync / Export / Import / WebClip / Search / Chat / History / Stats）+ 杂项

每批一个 PR，词典按 MARK 分区累积；插值键随用随补，格式占位符 %lld/%@ 必须与代码一致。

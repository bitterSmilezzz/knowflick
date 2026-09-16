# Android 0.8.6 修复与优化记录

日期：2026-09-16。本轮以 `.scratch/optimization-2026-09-16/android-audit.md` 的审计结论为依据，修复底图映射与防重排布脱钩这一用户可见缺陷（P0-1），补齐 macOS 已有的「撤销上一张」，并处理一批正确性、性能与安全 UX 项。全部改动均在 Android 15 ARM64 模拟器上完成验证。

## 交付

- [KnowFlick 0.8.6 签名 APK](../dist/android/KnowFlick-0.8.6.apk)：4,139,875 字节（3.95 MiB），`versionCode 14` / `versionName 0.8.6`，R8 + 资源压缩 + v2 签名 + ZIP 对齐校验通过，内置新采集的 baseline profile。
- [SHA-256 校验文件](../dist/android/KnowFlick-0.8.6.apk.sha256)、[R8 mapping](../dist/android/KnowFlick-0.8.6-mapping.txt)。

APK SHA-256：

```text
26fb011b3865284fc2fc1a187f22261ba91e6b5266a76b3db2bec293bdbdda90
```

---

## 1. P0-1 底图映射：从「单分类一张图」到「领域多图池 + 关键词细分」

### 问题（审计 P0-1，本轮实测确认）

原实现有两处独立缺陷叠加：

1. **排布与渲染用的是两套不相交的 key 空间**。排布侧 `CardArrange.defaultKeyFor` 返回 `bg0..bg41`，渲染侧 `ThemeKey.forCard` 返回 `physics` / `ai` 等语义名（而且哈希输入也不同：`category|headline` vs `headline`）。于是 `arrange(minDistance = 5)` 算出来的「同 key 间隔 ≥5」与用户实际看到的底图毫无关系。
2. **已知分类被整体折叠到单张底图**。`ThemeKey.categoryAliases` 把分类直接映射为一个 key：冷知识→`study`、AI→`ai`、AI 开发→`coding`、AI Agent→`agent`、中级会计→`accounting`、投资理财→`economy`。

实测（修复前，214 张种子卡）：

| 分类 | 卡数 | 不同底图数 | 用到的图 |
| --- | --- | --- | --- |
| 冷知识 | 160 | 1 | study |
| 投资理财 | 13 | 1 | economy |
| 中级会计 | 12 | 1 | accounting |
| AI | 10 | 1 | ai |
| AI 开发 | 10 | 1 | coding |
| AI Agent | 9 | 1 | agent |
| **全局** | **214** | **6** | — |

这直接违反 `CONTEXT.md` 第 31 行的承诺：「即使在『中级会计』或『AI Agent』等单分类内刷卡也张张不同」。

### 修复

**a) key 空间接线**：`AppModel` 构造 `CardStore` 时显式传入 `keyFor = CardThemeResolver::forCard`；`CardStore` 与 `CardArrange.arrange` 的默认 key 也改为同一解析器，`CardArrange.defaultKeyFor` 已删除。排布与渲染从此共用同一 key 函数。

**b) 多图池移植**：新增 `domain/CardThemeResolver.kt`，逐条移植 macOS 权威实现 `CardThemeResolver.swift`：四个领域池（计算机与 AI 15 / 自然宇宙科学 15 / 人文心智 10 / 商业财会金融 8，共 42 张）+ 56 条细分语义关键词规则 + 42 键确定性哈希兜底；并加单卡键缓存（按 id + 内容三元组校验、卡库变更后裁剪），避免 `arrange` 的 O(n²) 候选扫描重复做关键词匹配。

**c) 跨端一致性**：写脚本核对两端源码，56 条关键词规则（顺序与内容）与 5 个 key 清单逐项一致：

```sh
python3 .scratch/optimization-2026-09-16/verify_theme_parity.py
# Swift 关键词规则：56 条；Kotlin 关键词规则：56 条
# allKeys / techPool / sciencePool / humanitiesPool / financePool: 2 端逐项一致
# ✅ 两端关键词规则、领域池与 42 键清单逐条一致
```

核对中发现并修正了一处真实偏差：哈希兜底原先用 Kotlin 的有符号 `%` 再归一化，而 macOS 用的是 **UInt64** 取模（2^64 不是池长的倍数，两者不等价）。已改用 `Long.remainderUnsigned`，保证同一张卡在两端落到同一张底图。

### 修复后分布（同一份 214 张种子库）

| 分类 | 卡数 | 修复前不同底图数 | 修复后不同底图数 |
| --- | --- | --- | --- |
| 冷知识 | 160 | 1 | **34** |
| 投资理财 | 13 | 1 | 5 |
| 中级会计 | 12 | 1 | 6 |
| AI | 10 | 1 | 7 |
| AI 开发 | 10 | 1 | 5 |
| AI Agent | 9 | 1 | 5 |
| **全局** | **214** | **6** | **38** |

修复后 key 直方图（key=张数）：`math=22 language=15 neuroscience=13 architecture=12 chemistry=11 cognitive=10 astronomy=10 biology=9 history=8 philosophy=8 ocean=7 meteorology=6 coding=6 physics=5 relativity=5 database=5 security=5 music=5 geology=5 network=4 robotics=4 psychology=4 algorithm=4 crypto=3 accounting=3 study=3 optics=3 economy=3 spacecraft=2 datastructure=2 sociology=2 life=2 quantum=2 ecology=2 rust=1 geography=1 compiler=1 agent=1`。单张图最多承载 22 张（修复前 `study` 一张承载 160 张）。

### 视觉抽查（模拟器实拍）

在 1080×2340 模拟器上连续划卡并逐帧截图，取卡面中段（避开文字带）做 64 位 aHash：

| 相邻帧 | 汉明距离 |
| --- | --- |
| shot1 vs shot2 | 32/64 |
| shot2 vs shot3 | 20/64 |
| shot3 vs shot4 | 13/64 |
| shot4 vs shot5 | 15/64 |
| shot5 vs shot6 | 36/64 |

6 张连续卡片得到 6 个互不相同的 aHash，平均色也各不相同；其中两张人工查看确认为真实摄影底图（冷知识「中子星」卡 → 星云/宇宙图；投资理财「散户亏损」卡 → 暗调质感图），无灰块占位、无连续撞图。

### 护栏测试（新增）

- `CardThemeResolverTest`（12 项，纯 JVM）：池结构完整、四池并集覆盖 42 键、分类→池映射、56 条关键词细分（会计/理财/AI/Agent/宽域科学人文全覆盖）、哈希兜底确定性、**缓存随内容变更失效**、未知分类不坍缩、单分类内 ≥25 种 key。
- `SeedThemeDistributionTest`（Robolectric）：加载真实种子库，打印修复前后分布表，并断言「修复后严格更分散」「每个分类都不得坍缩为单张图」「冷知识 ≥20 种」「5 个自定义分类各 ≥3 种」「单张图承载 ≤ 总数/6」。断言不绑定具体魔数，任何分布退化都会失败。
- `SeedLoaderRobolectricTest.bgAssetsMatchAllKeysExactly`：枚举 `assets/bg/*.webp`，与 `CardThemeResolver.allKeys` 严格一一对应——这是 P0-2 的落实点。

## 2. P0-2 `%42` 魔数消除

`CardArrange.kt:25` 与 `AppModel.kt:105` 的 `% 42` 字面量随 P0-1 一并消失：

- 池长度一律取 `list.size`（`hashIndex(text, poolSize)`，内含 `require(poolSize > 0)`）；
- 新增资产护栏测试：`assets/bg/` 的文件名集合必须与 `allKeys` 完全相同。此前往图池加第 43 张会让未识别分类的卡片 `IndexOutOfBoundsException` 崩溃，减图则静默改变映射——两种情形现在都会在 JVM 测试阶段失败。

## 3. P0-3 `QuizSession.build` 去 O(n²)

- 原实现把 `LearningPlan(pool, today).due` **算了两遍**（一次 `.toSet()`、一次列表）；
- `favorites` / `historyRead`（List）被当作集合做 `it !in ...` 成员判断，退化 O(n²)，且 `KnowledgeCard` 是 14 字段 data class（等值比较含最长数百字的 `details`）。调用点在主线程（`MainActivity` → `KnowFlickViewModel.startQuiz/nextQuizRound`），导入大归档后点「知识测验」会卡住主线程数秒。
- 改为：`due` 只算一次，全部按 `id` 建 `HashSet` 做集合运算。有 6 项现成 `QuizSessionTest` 用例护栏，全部通过。

顺带删除 `QuizSession.companion` 的 `var onRecord`——可变全局单例、无任何调用点，一旦被赋值会持有捕获引用造成泄漏。

## 4. P1-1 撤销上一张（新功能 + 契约修复）

- **语义修复**：`CardStore.undoLastSwipe` 原先无条件 `isFavorite = false, favoritedAt = null`，且在卡片本身已被 ♥ 收藏时会把收藏抹掉，违反 `CONTEXT.md`「收藏与喜好解耦」。现改为：`seenAt` / `swiped` 从**刷卡前快照**还原，`isFavorite` / `favoritedAt` **不参与还原**——与 macOS `AppStore.undoLastSwipe`（只重置 seenAt/swiped）口径一致。用快照而非硬编码 `null`，修掉了「已读卡在历史页再划后撤销会被抹掉浏览时间并错误推回卡堆」的问题。
- **UI 入口**：顶栏 ⋮ 菜单首项「撤销上一张」，仅在可撤销时可点（`CardStore.canUndoLastSwipe` → `KnowFlickViewModel.canUndoLastSwipe`）。撤销后卡片精准插回卡堆顶部（`recompute` 的插回分支改用快照 id 判定）。撤销为一次性的，撤销栈消费后即禁用。
- **测试**：`CardStoreTest` 新增 5 项（撤销后卡片回顶 + 历史 -1、显式收藏在撤销后保留、左划后撤销保留收藏且 `swiped` 还原为 RIGHT、已读卡撤销还原原 `seenAt`、撤销栈一次性）；`DeckScreenTest` 新增 1 项仪器测试走完整 UI 链路（划走 → 菜单撤销 → 卡片回顶且 `seenAt == null`）。

## 5. P1-2 Keystore 降级可见

`SystemCredentialStore.isEncrypted` 此前只被仪器测试消费，UI 从不读取——KDoc 与 README 却都写着「设置页可提示降级」。现设置页消费该标记，Keystore 不可用（密钥以明文落盘）时在顶部显示橙色提示条：「本机加密存储不可用，API Key 与语音密钥将以未加密方式保存在本机」。新增 `EditorialColor.warningOrange` 语义色，与品牌强调色 `aiAmber` 区分。

## 6. P1-3 备份策略明确化（含端到端实测）

`AndroidManifest.xml` 原先既未声明 `allowBackup`（默认 true）也未提供任何排除规则，`shared_prefs/knowflick_credentials.xml` 会进入 Auto Backup，而解密它的 Keystore 主密钥随设备存活、不可跨设备恢复。

**修复**：保留 Auto Backup（`allowBackup="true"`，卡片库 `cards.json` 含收藏/历史/复习进度，换机不该丢），但把凭据排除在云备份与换机直传之外：新增 `res/xml/data_extraction_rules.xml`（API 31+）与 `res/xml/backup_rules.xml`（API ≤30），二者都只 `<exclude domain="sharedpref" path="knowflick_credentials.xml" />` 与 `knowflick_credentials_plain.xml`。取舍已写入 `apps/android/README.md`。

**实测**（Android 15 模拟器，AOSP local transport，`bmgr` 驱动）：

| # | 步骤 | 结果 |
| --- | --- | --- |
| 1 | 有规则：造数据（含卡片与凭据文件）→ `bmgr backupnow` → 卸载（模拟换机）→ 重装 → `bmgr restore` | `files/store/cards.json` md5 `2244896e…` 与备份前**完全一致**；`shared_prefs/` 恢复后为空 → 凭据未进入备份集 |
| 2 | 对照组（临时移除 `dataExtractionRules` + `fullBackupContent` 两个属性后重建）：同一流程 | `shared_prefs/knowflick_credentials.xml` **被完整恢复**，md5 `e9c301c4…` 与备份前一致、mtime 为恢复时间戳（1970-01-22）→ 密文被搬到了主密钥已不存在的新装环境 |
| 3 | 对照组残留状态继续跑仪器测试（新进程读取不可解密的密文文件） | `CredentialPersistenceTest.credentialsSurviveNewStoreInstance` 的 `assertTrue("设备应支持 Keystore 加密存储", store.isEncrypted)` **失败** → 实测到 `EncryptedSharedPreferences.create()` 抛异常、`SystemCredentialStore` 静默回退明文库（`isEncrypted == false`） |

即：审计 P1-3 的两段推断（① 密文会被备份恢复；② 主密钥缺失时静默降级明文）都由第 2、3 步在设备上实测确认。第 3 步的失败是实验残留状态导致的**预期观测**，非代码缺陷；清理设备后全量仪器测试 29/29 通过。

**未做成的部分（诚实记录）**：曾尝试把「密文不可解密 → 降级」写成永久仪器测试（在测试里把 keyset 换成立即无法解密的内容），未成功：`ContextImpl` 对 `SharedPreferences` 实例有进程内缓存，同一进程内覆盖文件不会被重新读取，`EncryptedSharedPreferences.create()` 因此不抛异常。要把它变成自动化护栏，需要给 `SystemCredentialStore` 加一个可注入的 store 工厂（可测性改造），属独立技术债；当前该场景只有手工复现步骤（见 `apps/android/README.md` 的表格）。

## 7. P2 性能与健壮性

| # | 位置 | 修复 |
| --- | --- | --- |
| a | `BackgroundImage.kt` | 去掉 `@Synchronized`（`LruCache` 自身线程安全）。原先 IO 线程解码一张 1000×1450 WebP 期间会阻塞主线程查缓存——正好落在划卡切换/预热的帧里 |
| b | `BackgroundImage.kt` | 缓存上限从固定 32 MiB 改为 `min(32 MiB, maxMemory/8)`（下限 4 MiB），随设备堆缩放 |
| c | `SpeechController.kt` | 远程语音改用 `prepareAsync()` + `setOnPreparedListener`，去掉主线程同步 `prepare()`；错误路径仍由 `setOnErrorListener` / `onFailure` 兜底回退系统 TTS |
| d | `DeckScreen.kt` | 划卡阈值 dp 化：`220f/180f/28f/900f` → 80dp 阈值 + 0.82 回滞比例 + 10dp 旋转除数 + 实测卡宽（未测量时退回屏宽）。原先 220px 在 3.5x 密度机约 63dp、2x 机约 110dp，同一版本不同手机手感不一致 |
| e | `AiService.kt` | `ping` 与 `generateCards` 的 model 口径统一：生成路径不再原样发 `"model": ""`，改为失败快速并给出可读原因（`ping` 保留探测兜底，已注明用途） |
| f | `AiService.kt` | 分批排除名单从 `take(100)` 改为 `takeLast(100)`（保留最近 100 条），让第 2..4 批看得到前一批新排除的标题 |
| g | `AiService.kt` | `onDelta` 的线程语义写入 KDoc：在 OkHttp 回调线程执行、且 429/5xx 重试会重放整段流（当前无调用方，接入「生成中展示」前必须先切主线程） |
| h | `CardJson.kt` | `links` 逐条 `runCatching`：某个 links 元素不是对象时只丢该链接，不再让整张卡在「逐卡挽救」模式下被丢弃 |
| i | `SpeechController.kt` | 临时音频文件名用完整 `card.id` 替代 `card.id.hashCode()`（消除哈希碰撞导致播放中文件被覆盖） |
| j | `SpeechController.kt` | `setLanguage(Locale.CHINA)` 返回码检查：缺中文引擎时走 `failSystemTts`，不再静默失败 |
| k | `LibraryScreen.kt` | `historyFilter` 并入 `remember(cards, version, historyFilter)`；修正 KDoc 里「收藏阁支持取消收藏」的不实描述（取消收藏需进详情页，本轮不做行内 ♥ 按钮） |
| l | `CardStorage.kt` | 以注释显式记录「rename 后未对父目录 fsync」的取舍与理由（Java 层无移植写法 + `cards.backup.json` 轮转兜底） |
| m | `CardStore.kt` | `CardThemeCache.prune` 空占位落地为真实缓存裁剪（与 P0-1 的主题缓存配套） |

**有意未改**（审计结论即为「保持现状可接受」）：`flushPending()` 的 `onPause` 400ms 等待上限；`promoteToDeckTop` 仍是死代码（Android 无全局搜索入口，与 P1-4 一起留给后续版本）。

## 8. Lint 定案

`SystemCredentialStore` 的 `commit()` 保留 + `@SuppressLint("ApplySharedPref")` + 注释说明「返回值驱动设置页成功/失败提示、凭据不能容忍后台排队丢写」。理由与审计 §1.1 一致：改 `apply()` 会让 `SettingsScreen` 的「写入设备失败，请重试」分支变成不可达的静默假成功。

## 9. 依赖升级（仅安全项）

- `androidx.security:security-crypto` **1.1.0-alpha06 → 1.1.0**（摆脱 alpha）。1.1.0 起 `EncryptedSharedPreferences` / `MasterKey` 被 androidx 弃用，代码以文件级 `@Suppress("DEPRECATION")` + TODO 承接，并把「迁移 DataStore + Tink 或原生 AndroidKeyStore」连同「save/delete 改 suspend」登记为独立技术债。
- `androidx.lifecycle` **未能升级**（审计 §1.2 的「2.11.0 实测可用」在本项目不成立，本轮实测三处阻断）：
  - 2.11.0：组内版本对齐会把 `lifecycle-runtime-compose` 一起升到 2.11.0，其 AAR 元数据 `minCompileSdk=37` + `minAndroidGradlePluginVersion=9.1.0`，`checkDebugAarMetadata` 直接失败；
  - 2.10.0（元数据 `minCompileSdk=35` / AGP 8.6.0，本可通过）与 2.9.4：其 lint 检测器（`NonNullableMutableLiveDataDetector` / `RememberInCompositionDetector`）用新版 Kotlin 分析 API 编译，在 AGP 8.7.3 自带 lint 下抛 `IncompatibleClassChangeError`，`lintDebug` 崩溃。不为此 disable 掉 `NullSafeMutableLiveData` 等正确性检查。
  - 结论：lifecycle 升级必须与 AGP 工具链升级（≥8.9，可能连带 compileSdk 36/37 与 Kotlin 版本）作为一个整体版本推进。
- `androidx.activity:activity-compose` 不动（1.13.0 要求 `minCompileSdk=36` + AGP ≥ 8.9.1）；`androidx.test` 三件套不动（`robolectric:4.14.1` 依赖 `androidx.test:monitor:1.7.2`，单独升 `core` 到 1.7.0 会造成类路径混装）。

## 10. 版本、baseline profile 与文档

- `versionCode 13 → 14`，`versionName "0.8.5" → "0.8.6"`（`aapt2 dump badging` 核对为 `versionCode='14' versionName='0.8.6'`，APK 内含 42 个 `assets/bg/*.webp`）。
- **baseline profile 已重采**：P0-1 改了卡堆排布与渲染路径，按 README 要求执行 `./gradlew :app:generateReleaseBaselineProfile`（3 分 08 秒，模拟器），规则 17530 → 17802 条（新增 495 / 删除 222 / 未变 17308，约 96% 未变）；随后重新构建 Release APK 以嵌入新 profile（本记录开头的 SHA-256 即重采后的产物）。
- `apps/android/README.md` 更新：版本号、撤销功能、底图多图池、备份策略（含实测表与代价说明）、凭据降级提示、依赖升级阻断清单、baseline profile 重采记录。

---

## 回归验证（全部在最终状态上重跑）

| 检查 | 结果 |
| --- | --- |
| JVM / Robolectric 单元测试 | **96 项通过**，0 失败，0 跳过（本轮从 77 增加 19 项） |
| Android 15 ARM64 模拟器仪器测试（`knowflick-release-check`） | **29 项通过**，0 失败，0 跳过（本轮新增 1 项撤销 UI 测试） |
| Debug Lint | **0 错误 / 5 警告**（原 0 错误 / 8 警告）：`ApplySharedPref` 2 条已按定案抑制、`security-crypto` alpha 1 条随升级消除；剩余 5 条 `GradleDependency` 均为上文 §9 记录的有意保留 |
| `:app:compileDebugKotlin --rerun-tasks` | 成功，**0 警告**（security-crypto 升级引入的 2 条 deprecation 已由文件级抑制吸收） |
| Release 构建与签名 | R8、资源压缩、v2 签名、ZIP 对齐（`apksigner verify` + `zipalign -c -P 16 4`）全部通过 |
| 底图分布 | 全局 6 → **38** 种 key；冷知识 160 张 1 → **34** 种 |
| 视觉抽查 | 6 张连续卡片 6 个不同 aHash，人工确认底图为真实摄影图 |
| 备份恢复实测 | 卡片库 md5 级一致恢复；凭据未进入备份集（对照实验中被恢复，并实测到静默降级明文） |

## 验证边界

- 全部验证在 Android 15 ARM64 模拟器（`knowflick-release-check`，AVD 配置 `hw.gpu.enabled=no` 走软件渲染）完成，无真机验证。掉帧与流畅度结论只作相对基准；划卡阈值 dp 化的**手感**（80dp 阈值是否合适）需在真机上人工确认。
- `hw.gpu.enabled=no` 的软件渲染下，底图解码与绘制的耗时远高于真机，因此本次未对 P2-a/b 的掉帧收益做量化断言，只验证了逻辑正确性与测试通过。
- 远程语音 `prepareAsync()` 改动无法在模拟器上验证真实音频通道（需可出网环境 + 云端/本地语音服务），只验证了编译与既有仪器测试通过；错误回退路径未实机触发。
- 撤销功能的 UI 入口放在顶栏 ⋮ 菜单（而非顶栏独立图标）：顶栏已有 5 个图标按钮，再加一个会挤压标题；菜单项在首项、且不可撤销时置灰。
- 未验证 `lifecycle 2.10.0` 在升级 AGP 后是否真的可用（只验证了当前工具链下不可用）。

# Android 0.8.4 修复与优化记录

日期：2026-09-14。本轮先在 Android 15 ARM64 模拟器复现，再修复、优化并回归验证。

## 交付

- [KnowFlick 0.8.4 签名 APK](../dist/android/KnowFlick-0.8.4.apk)：4,138,717 字节（3.95 MiB），versionCode 12，R8 + 资源压缩 + v2 签名 + ZIP 对齐通过。
- [SHA-256 校验文件](../dist/android/KnowFlick-0.8.4.apk.sha256)、[R8 mapping](../dist/android/KnowFlick-0.8.4-mapping.txt)。

APK SHA-256：

```text
a158cb4bcae5b04e43b641dd7e834cb2dbc60366419371f53cc0f382492cf45e
```

包体从 0.8.3 的 7.88 MiB 降到 3.95 MiB（−49.9%），主要来自背景图转 WebP。

## 本轮发现的核心缺陷

### 重新探索后界面不刷新（稳定复现）

刷完全部卡片进入空态后，点「重新探索全部卡片 ↻」：**数据层已正确重置**（`seenAt` 全清、未读回到 214 张），**但界面仍停在空态**，必须重启应用或旋转屏幕才恢复。

定位过程（A/B 对照，均为原始构建）：

| 构建 | 结果 |
| --- | --- |
| 修复前 | 5/5 复现失败 |
| 在 `DeckScreen` 内加一行读取 `version` | 5/5 正常 |

根因是失效链是隐式的：`CardStore.deck` 是普通可变属性，Compose 观察不到；`DeckScreen(version = ...)` 的 `version` 参数在函数体内**从未被读取**，因此参数比较认为无变化而跳过重组。插入一张卡能刷新（卡堆顺序变化），但整表重置（清空历史）在跳过重组时就完全静默。

**修法**：把卡堆做成显式参数（`deck: List<KnowledgeCard>`），由 `MainActivity` 在读取 `viewModel.version` 后传入，用列表内容比较驱动重组。顺带在卡堆清空时兜住 `flyingCard` 残留（飞出层的清理协程会随视图移除被取消）。

### 高价值修复

| 问题 | 位置 | 修法 |
| --- | --- | --- |
| 归档恢复按整卡覆盖，抹掉本机收藏与浏览进度 | `domain/CardStore.kt` `restoreArchive` | 改为按字段合并：内容取归档、学习状态取本机，收藏与熟练度取并集 |
| 归档恢复在主线程做 O(n×m) 标题匹配 | 同上 | 建立 id / 归一化标题索引，复杂降为 O(n+m) |
| `onPause` 的 flush 只排队不等待，后台被回收即丢最后一批改动 | `KnowFlickViewModel.flushPending` | 新增 `enqueueAndWait`，同步等待落盘（上限 400ms），队列已关闭时直接同步写 |
| 流式响应无整体超时，卡住的流会让 `isGenerating` 永真 | `ai/AiService.kt`、`speech/RemoteSpeechClient.kt` | 补 `callTimeout`（300s / 180s） |
| 同名分享文件原地截断，可能破坏接收方正在读的内容 | `data/ShareFileWriter.kt` | 每次写唯一文件名 |
| 语音临时文件固定名被下一张卡覆盖 | `speech/SpeechController.kt` | 按卡片 id 命名，并清理 1 小时前的旧文件 |

新增 `restoreArchiveKeepsLocalStudyStateWhenArchiveOmitsIt` 测试守护合并语义；把该修复回退后测试立即失败，确认不是空转测试。

## 优化

- **背景图转 WebP**：42 张 JPEG（6.35 MiB）→ WebP q72（2.31 MiB，省 63.7%）。图池 key 与文件一一对应，分类别名全覆盖。
- **提高解码尺寸**：阈值 450 → 1450。此前源图 1000×1450 被降到 500×725，在 1080p 设备上要放大 1.92 倍，顶卡明显发虚。
- **扩大图片缓存**：12 MiB → 32 MiB（单张约 2.9 MiB，原上限只放得下 4 张，刷几张就重复解码）。
- **裁剪图标依赖**：移除 `material-icons-extended`（2277 个图标），自绘必需的 4 个（Bookmarks / Headphones / Sync / VolumeUp，路径取自 Google 官方 24px SVG，Apache-2.0），其余用 `material-icons-core`。debug APK 内图标类字符串从 11398 降到 310，dex 从 42.2 MB 降到 29.1 MB。
- **baseline profile**：接入 `androidx.baselineprofile` 1.4.1 与 `:baselineprofile` 采集模块，覆盖冷启动、刷卡、收藏阁路径。生成 15052 条规则，其中 528 条命中应用自身类（此前 APK 内的兜底 profile **0 条**）。
- **小热点**：知识库列表复用 `SimpleDateFormat`（原先每行每次重组新建）、过滤排序结果加 `remember`。

## 回归验证

| 检查 | 结果 |
| --- | --- |
| JVM / Robolectric | 77 项通过，0 失败，0 跳过 |
| Android 15 ARM64 模拟器仪器测试 | 28 项通过，0 失败，0 跳过 |
| Debug Lint | 0 错误，8 警告（与 0.8.3 持平） |
| Release 构建 | R8、资源压缩、v2 签名、ZIP 对齐通过 |
| 重新探索刷新（release 包真实坐标） | 3/3 通过（修复前 5/5 失败） |
| UI 探针（release 包） | 滑动切换、阈值回弹、收藏后立即划走、8 次快速连续划动、重启保持进度、详情往返、旋转、历史筛选全部通过 |
| 0.8.3 → 0.8.4 覆盖安装 | 安装成功，收藏 4→4、历史 3→3、收藏时间戳与顶卡一致 |

## 早期排查中确认的环境因素

上一版文档记录「模拟环境完成」，本轮补充量化：模拟器以 `-gpu swiftshader_indirect`（纯软件渲染）启动时，60 次滑动实测 643/657 帧卡顿（97.87%）、native heap 涨到 52 MiB、并触发一次输入分发超时 ANR（主线程阻塞在 `HardwareRenderer.syncAndDrawFrame`，同时 system_server 与 systemui 也在掉帧）。改用 `-gpu host` 后 native heap 涨幅降到 8 MiB。掉帧与内存表现受模拟器渲染后端强烈影响，不能外推到真机。

## 验证边界

自动化、逐帧断言与真实坐标操作均在 Android 15 ARM64 模拟器完成，未连接实体手机。真机刷新率、触控采样率、厂商系统差异，以及真实付费 AI / 语音服务的端到端表现仍需在实际环境验证。

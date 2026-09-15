# Android 0.8.5 修复与优化记录

日期：2026-09-15。本轮针对滑卡渲染与动效卡顿、Baseline Profile 采集器缺陷以及大卡库导出阻塞主线程等问题完成优化与修复，并在 Android 15 ARM64 模拟器上完成全套验证。

## 交付

- [KnowFlick 0.8.5 签名 APK](../dist/android/KnowFlick-0.8.5.apk)：4,138,717 字节（3.95 MiB），versionCode 13，R8 + 资源压缩 + v2 签名 + ZIP 对齐通过。
- [SHA-256 校验文件](../dist/android/KnowFlick-0.8.5.apk.sha256)、[R8 mapping](../dist/android/KnowFlick-0.8.5-mapping.txt)。

APK SHA-256：

```text
b0e0d06ab497cf17904a27c57066d4148f589c11955e802633d385eb9f905e3b
```

## 本轮优化与问题修复

### 1. 滑卡层级重绘减负与背景图预解码

- **问题现象**：原卡堆对可视范围内的前 3 层卡片均完整调用 `CardFace`，导致底层（depth >= 2）卡片实际上只露出一圈外轮廓圆角，却同样承担了全屏大图渲染、渐变着色器计算及完整文字排版，极大消耗 GPU 算力与内存带宽。
- **优化方案**：
  - 最深层（depth >= 2）改用轻量纯色背板（`MaterialTheme.colorScheme.surface` + `clip(RoundedCornerShape(18.dp))`）渲染，阻断无意义的图形绘制与文本排版。
  - 新增 `PreloadBackgroundImage`：最深层在后台 IO 协程中预解码下一张图到 `BackgroundImageCache`；待用户划走顶卡、下层卡片升层时直接命中内存位图，杜绝滑动过程中的解码停顿。
- **退场动画调优**：
  - 飞出退场动画时长从 220ms 缩短到 180ms。
  - 退场卡片透明度改在位移前半程（`1f - travel / (total * 0.55f)`）快速淡出，避免在 GPU 负载较高时旧卡长时间遮盖新顶卡，产生“划走后又闪回上一张”的视觉残留。

### 2. 修复 Baseline Profile 采集器静默跳过核心路径

- **问题现象**：0.8.4 的 BaselineProfile 规则中，应用自身类规则仅 528 条，且 `LibraryScreen` 相关规则为 0 条。排查发现采集脚本存在两处缺陷：
  - `By.res(packageName, "deck_top_card")`：Jetpack Compose 默认将 `testTag` 导出为裸 `resource-id`，带上包名前缀后永远查不到；且读取 `visibleCenter` 在异步图载入重建节点时易偶发 `StaleObjectException`。
  - `By.text("收藏阁")`：收藏阁在界面上是仅含图标与 `contentDescription` 的 IconButton，查找文本永远返回 null，导致滑卡和知识库两段核心测试被静默跳过。
- **修复方案**：
  - 查找改为裸 ID `By.res("deck_top_card")`，手势使用屏幕物理坐标滑动，解绑对易变语义节点的中心点依赖。
  - 收藏阁改用 `By.desc("收藏阁")` 定位。
  - 全程加入严格的 `check(...)` 与超时断言，任一阶段元素缺失直接抛错中断，杜绝“静默跳过假通过”。
- **采集收益**：新生成的 Profile 中，应用命中规则数从 528 条提升至 750 条，明确覆盖 `CardStore.swipe`、118 条 `DeckScreen` 规则以及此前缺失的 73 条 `LibraryScreen` 规则。

### 3. 知识库与归档导出移出主线程

- **问题现象**：原先在知识库页面点击「分享收藏笔记」或「导出 JSON 归档」时，直接在主线程执行全量卡片 JSON/Markdown 序列化并写入文件，大卡库导出时会造成主线程明显停顿。
- **修复方案**：将序列化调用与文件写入统一收敛至 `MainActivity.shareFile`，使用 `withContext(Dispatchers.IO)` 异步执行，解除对 UI 交互主线程的阻塞。

## 回归验证

| 检查 | 结果 |
| --- | --- |
| JVM / Robolectric 单元测试 | 77 项通过，0 失败，0 跳过 |
| Android 15 ARM64 模拟器仪器测试 | 28 项通过，0 失败，0 跳过 |
| Debug Lint | 0 错误，8 警告（与 0.8.4 持平） |
| Release 构建与签名 | R8、资源压缩、v2 签名、ZIP 对齐校验全部通过 |
| UI 自动化探针（真机/模拟器坐标） | `card_tap`、`library_back`、`rotation` 均通过 |
| 0.8.4 → 0.8.5 覆盖安装升级 | 相同发布签名覆盖安装成功，收藏状态（1/1）、历史足迹（1/1）及卡片内容 100% 完整保留 |

## 验证边界

自动化测试、逐帧断言、升级保留探针及坐标操作均在 Android 15 ARM64 模拟器（`emulator-5554`）完成。因模拟器渲染层受宿主 GPU 与负载影响，掉帧数据主要作为相对基准；在真机硬件上的最终流畅度建议在实体机上进一步检验。

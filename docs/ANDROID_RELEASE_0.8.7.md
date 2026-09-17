# Android 0.8.7 修复与优化记录

日期：2026-09-17。本版本重点攻克了用户反馈的**「滑动意图检测准确度不高、存在误检测/误触发」**问题，对 Android 端的卡片物理拖拽模型、主轴方向锁定、印章显隐死区以及 Fling 速度追踪进行了系统化重构，彻底杜绝了单手微晃闪烁印章与纵向/斜向滑动误划走卡片的顽疾；同时落地了卡面微光渐变边框、意图动态印章、收藏心跳反馈以及知识库一体化双胶囊分段栏等全套 UI 美化与微交互动效。

## 交付产物

- [KnowFlick 0.8.7 签名 APK](../dist/android/KnowFlick-0.8.7.apk)：4,156,259 字节（3.96 MiB），`versionCode 15` / `versionName 0.8.7`，R8 + 资源压缩 + v2 签名 + ZIP 对齐校验通过。
- [SHA-256 校验文件](../dist/android/KnowFlick-0.8.7.apk.sha256)、[R8 mapping](../dist/android/KnowFlick-0.8.7-mapping.txt)。

APK SHA-256：

```text
61fd0a190784262b58802335f3b47cb2386bb1d0b4a531498a353e58e5556c7b
```

---

## 1. 卡片手势检测准确度与防误检测体系重构

### 问题根因分析

1. **印章透出死区过浅**：此前在拖拽位移超过 8dp（进度仅 0.08）时即开始显露印章，单手握持机身微晃或点按时极易造成印章瞬时闪烁的视觉毛刺。
2. **缺乏主轴方向判据（纵滑/斜滑误划走）**：原逻辑仅检测水平绝对位移 `abs(drag.x) > threshold`。用户在纵向滚屏或斜向滑动时，只要横向分量偶发越过阈值，卡片就会被意外划走。
3. **缺少纵向物理约束与速度加权**：卡片纵向全向自由漂移，且未结合用户手指划动速度，导致慢速迟疑时易误触发、快速轻甩时又不够利落。

### 重构与优化方案

1. **印章安全死区扩至 28%**：
   - 在 [`CardFace.kt`](../apps/android/app/src/main/kotlin/com/knowflick/app/ui/CardFace.kt) 将印章透明度公式重构为：`((progress - 0.28f) / 0.52f).coerceIn(0f, 1f)`。
   - 在位移进度小于 28%（约 35dp+）区间内印章完全保持 100% 透明，在 `[0.28f, 0.80f]` 区间平滑展开，大于 80% 稳固实心显示，彻底消除微动与晃动误显。
2. **主轴横向锁定（Horizontal Dominance Guard）**：
   - 在 [`DeckScreen.kt`](../apps/android/app/src/main/kotlin/com/knowflick/app/ui/DeckScreen.kt) 引入 `HORIZONTAL_DOMINANCE_RATIO = 1.20f`。
   - 唯有在横向位移显著占据主导（`|dx| > |dy| * 1.20f`）时才允许计算印章进度与底卡提升；纵向或斜向滑动时，强制屏蔽印章和底卡透出，并在释放后直接吸附回中。
3. **纵向物理阻尼（Vertical Damping）**：
   - 卡片纵向位移添加 `translationY = drag.y * 0.35f` 阻尼约束，手感扎实跟手，释放瞬间平滑回弹。
4. **引入 `VelocityTracker` 速度辅助**：
   - 追踪手势释放时的瞬时速度，当横向位移达到基本安全距离（`28.dp`）且水平甩动速度大于 `600.dp/s`（且 `|vx| > |vy| * 1.35f`）时精准识别为 Fling（快速轻划），兼顾防误触与敏捷度。

---

## 2. 卡面与知识库视觉质感与微交互升级

1. **手势滑动动态意图印章反馈 (Swipe Intent Stamp)**：
   - 左右拖拽时印章伴随 `0.85 -> 1.0` 弹性缩放与 `±12°` 动态倾斜，强化决策感知；精确校准边距防裁切（`top = 100.dp`, `start/end = 48.dp`）。
2. **卡面微光渐变边框与排版呼吸感**：
   - 卡片容器升级为 `20.dp` 柔和圆角，叠加 `1.dp` 垂直微光渐变描边（`White 25% -> White 8%`）；
   - 大标题添加细微阴影，分类标签与底部提示采用磨砂玻璃胶囊（Glassmorphic Capsule）边框；
   - 底部操作栏引入弹簧缩放交互，收藏按键增加脉冲心跳跳动反馈（`1.0 -> 1.26 -> 1.0`）。
3. **知识库一体化双胶囊分段条 (Segmented Tabs)**：
   - 重构为现代 iOS/macOS 风格的嵌入式双胶囊切换条，配合柔和微背景与状态指示；强化空态视图与卡片条目质感。

---

## 3. 全量测试与质量指标

- **JVM 单元测试**：`./gradlew :app:testDebugUnitTest`（**96 / 96 全部通过**，0 failed, 0 skipped）。
- **Android Lint**：`./gradlew :app:lintDebug`（**0 Error, 0 Warning**）。
- **模拟器仪器测试**：`./gradlew :app:connectedDebugAndroidTest`（**31 / 31 全部通过**，新增 `verticalSwipeDoesNotAdvanceCard` 与 `diagonalSwipeDominantlyVerticalDoesNotAdvanceCard` 防误判自动化用例）。
- **发布构建**：通过 V2/V3 签名与 16-4 对齐校验，生成 `dist/android/KnowFlick-0.8.7.apk`。

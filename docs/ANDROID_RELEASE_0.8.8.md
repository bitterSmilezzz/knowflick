# Android 0.8.8 发布记录：基于间隔重复算法（SM-2）的智能复习系统与专属复习卡堆模式

- **发布日期**：2026-09-19
- **版本标识**：`versionCode 16` / `versionName 0.8.8`
- **签名发布 APK**：[KnowFlick 0.8.8 签名 APK](../dist/android/KnowFlick-0.8.8.apk)（5,107,237 字节，4.87 MiB，通过 R8 混淆、资源压缩、APK Signature Scheme v2 与 16-4 对齐校验）
- **SHA-256 校验码**：`8db39fb49f4d7e64e15c2394e62b6e3b0021ba09df35a0e7a15c8cd5bbfe6eae`

---

## 一、核心变更与设计

### 1. 核心 SM-2 记忆模型引擎 (`SpacedRepetitionEngine`)
- **四档评分体系**：划分 `AGAIN (0/重来)`、`HARD (1/较难)`、`GOOD (2/良好)`、`EASY (3/容易)`。
- **动态记忆间隔**：
  - 第 1 次复习：1 天。
  - 第 2 次复习：HARD 为 3 天，GOOD 为 6 天，EASY 为 7 天。
  - 第 3+ 次复习：当前间隔乘简易度因子 $I_{new} = \text{round}(I \times EF)$，EASY 额外享有 1.3 倍加成。
  - 简易度因子（EF）演进：根据用户评级动态调整，下限 1.3，上限 3.0。
- **艾宾浩斯遗忘曲线可提取率预测**：
  - 基于模型 $R(t) = \exp(-0.10536 \cdot t / I)$，以百分比（0%~100%）在卡片头部实时展示记忆留存率。
- **动态间隔预告（`previewNextIntervals`）**：
  - 底部自评按键实时根据当前卡片的真实记忆历史计算出如果选择「重来/较难/良好/容易」各自将获得的下次间隔天数。

### 2. 数据与存储模型向后兼容升级
- `KnowledgeCard` 扩展字段：`repetition: Int = 0`, `intervalDays: Int = 1`, `easeFactor: Double = 2.5`。
- `CardJson` 完备编解码：旧卡数据与 macOS 端导出的 JSON 导入时自动填充缺省默认值，完全向后兼容。
- `LearningPlan` 升级：优先基于动态 SM-2 间隔计算 `reviewDate`，兼容旧版 1/3/7 天掌握度逻辑。
- `CardStore` 增设 `recordReviewResult`：统一调度算法结果落地与卡堆响应式重构。

### 3. 主刷卡流专属复习卡堆模式 (`Review Deck Mode`)
- **智能入口徽标**：常规模式下若存在到期卡片，顶栏标题右侧显示琥珀色「• 复习 N」徽标，支持一键切换。
- **沉浸式复习顶栏**：复习模式下独立渲染「专属复习卡堆 (N)」与「退出复习」轻量胶囊按钮，彻底杜绝小屏文本折行挤压。
- **卡片记忆留存率芯片**：卡片正面左上方展示「🧠 留存 X% · Y天间隔」。
- **底部四档自评按键**：复习模式下底部操作栏替换为 4 档颜色柔和的高辨识度自评按键，分别显示动态天数。
- **手势划卡映射**：左划等同于「重来」，右划等同于「良好」。
- **复习达标祝贺面板**：本轮到期卡片全部复习完毕后展示金星祝贺面板，统计本次强化张数，提供「返回常规探索卡堆」一键按钮。

---

## 二、测试与验证

1. **单元测试**：
   - `apps/android/app/src/test/kotlin/com/knowflick/app/domain/spaced/SpacedRepetitionEngineTest.kt`：全量测试涵盖首次/二次/多次间隔演化、EF 边界约束、遗忘衰减率预测、间隔预告与 QuizRating 映射。
   - 全工程 Gradle 单测 (`arch -arm64 ./gradlew :app:testDebugUnitTest`)：全部执行通过（26 actionable tasks, BUILD SUCCESSFUL）。
2. **静态代码检查**：
   - Gradle Lint (`arch -arm64 ./gradlew :app:lintDebug`)：0 errors, HTML 报告输出正常。
3. **正式构建与签名验证**：
   - `./tools/build_android.sh` 执行通过。
   - `apksigner verify --verbose --print-certs`：APK Signature Scheme v2 验证通过。
   - `zipalign -c -P 16 4`：4 字节及 16 字节对齐验证通过。
4. **模拟器真机实测**：
   - 安装于 `knowflick-release-check` 模拟器环境。
   - 验证了主界面标题与徽标在各分辨率下的排版抗挤压表现。
   - 实测了通过知识测验/学习积累记忆数据、时间推进模拟到期卡片出现。
   - 实测了从常规卡堆切换至「专属复习卡堆模式」、卡片正面「🧠 留存 73% · 1天间隔」芯片展示。
   - 实测了底部 4 档自评按键点击递减待复习计数。
   - 实测了复习全部完成后成功进入「今日到期复习圆满达成！」统计卡片，并一键无缝切回常规探索卡堆。

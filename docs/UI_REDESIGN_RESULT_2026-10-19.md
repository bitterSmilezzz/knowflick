# 界面重做验收记录（2026-10-19）

> 依据 [UI 设计规范](UI_DESIGN_SPEC_2026-10-19.md)。视觉方向经三稿对比后选定 A「克制型」。
> 本文件只记录**已经跑过并核验**的行为。未做的部分在 §5 如实列出。

## 1. 这一轮改了什么

### 1.1 先解决「为什么不好看」的根因

调研确认旧界面同时挂着两套设计系统：`styles.css`（暖赭衬线纸感）在构建产物里排在 `workspace.css` 之后，于是旧规则赢了——按钮被强制成 `32px/8px 圆角`、控件字体变衬线、简报页标题按 28px 衬线渲染、暖赭 `--accent` 覆盖工作区配色。字号体系是 8–13px，最小 8px。

处理方式不是再叠一层样式，而是**删掉旧系统**：

| 删除 | 原因 |
|---|---|
| `src/App.tsx`（948 行） | 已无任何引用，被 `Workspace` 取代 |
| `src/styles.css`（485 行） | 两套令牌互相覆盖的根源 |
| `CardSheet` / `HelpSheet` / `ImportRestoreSheet` / `InboxView` / `QuickCaptureModal` / `SearchSheet` | 仅被已删除的 `App.tsx` 引用 |
| `StudyViews` 里 4 个仅被 `App.tsx` 使用的视图 | 保留仍在用的 `QuizView` 并改写为新皮肤 |

现在只有**一份**设计令牌（`ui/workspace/tokens.css`）和**一份**布局样式（`workspace.css`）。构建产物 CSS 从 27.5 KB 降到 13.7 KB。

### 1.2 按 A 稿落地的几何

1040×760 窗口下实测：`grid-template-columns` = **200px / 320px / 520px**，列表行 56–61px，正文留白 32px，正文 14px / 行高 22.4px，最小文字 12px，控件 30–32px，圆角只有 4px 与 8px。

### 1.3 原生接缝（四项，已实现）

| 接缝 | 实现 | 证据 |
|---|---|---|
| macOS 标题栏融合 | `tauri.conf.json` 设 `titleBarStyle: "Overlay"` + `hiddenTitle: true`；`.ws-header` 用 `-webkit-app-region: drag`，按钮 `no-drag`；桌面端不再画假交通灯（仅浏览器预览画） | 原生截图里系统交通灯与「KnowFlick / 我的知识库 / 收件箱」同一行，无第二组灯 |
| 系统菜单栏 | `lib.rs` 的 `build_menu` 提供 KnowFlick / 文件 / 编辑 / 显示；菜单项通过 `knowflick:menu` CustomEvent 通知前端 | `System Events` 读到菜单栏 `Apple, KnowFlick, 文件, 编辑, 显示`；点「记录一件闪念」真实弹出录入面板；点「显示 → 收藏」真实切到收藏页 |
| 系统深浅实时跟随 | `useSystemAppearance` 监听 `matchMedia('(prefers-color-scheme: dark)')`，切换即时生效，无需重启 | 主题令牌挂在 `.ws` 上，`data-appearance` 改变后 `--ink` 立即从 `#1c1e20` 变为 `#e6e8ea` |
| 系统钥匙串 | **未接入**。当前密钥仍存本机文件，设置页如实说明 | 见 §5 |

### 1.4 本轮实际修掉的界面缺陷

这些不是"优化"，是实跑时发现的功能性问题：

1. **保存按钮点不到**：设置表单很长，`保存设置` 被推出视口，点击落空、保存静默不生效。→ 保存动作移到常驻底栏（`form` 属性跨元素提交）。
2. **列表行被压成半宽**：`.ws button` 的 `inline-flex` 覆盖了行的 `display:block`，标题只剩 40px 宽、显示成「白...」。→ 加 `.ws button.ws-entry { display: block }`，标题恢复 245px。
3. **深色主题文字不可见**：令牌定义在 `:root`，而 `data-appearance` 挂在 `.ws` 上，深色变量从未生效；实际深色来自浏览器深色模式，导致侧栏浅色文字压在深色底上。→ 令牌作用域改到 `.ws`，并在 `.ws` 上重建 `color`。
4. **提示条遮挡控件**：曾盖住列表标题，后又盖住阅读区底栏的「编辑」按钮（实测点击无效）。→ 移到右下空白区，避开底栏与状态栏。
5. **窄窗口导航打不开**：导航收起后 `.ws-header-side` 仍占 78px 并覆盖切换按钮。→ 收窄时把该单元格移出布局。
6. **提示条只在部分视图渲染**：收藏/整理视图的保存成功、保存失败都没有反馈。→ 提升为外壳级单一提示宿主。
7. **主题名与样式对不上**：设置页写「宣纸白/暖曜黑」，样式表只认 2 个值。→ 收敛为 `跟随系统 / 浅色 / 深色` 三档，并加白名单校验。

## 2. 数据契约没有破坏

外观在界面上是三档，但 `settings.json` 的 `paperTheme` 键要与安卓共用，而安卓 `PaperTheme.fromName` 只认 `RICE_PAPER` / `WARM_OBSIDIAN`。所以写盘时映射回旧名称：

```
SYSTEM → SYSTEM
LIGHT  → RICE_PAPER
DARK   → WARM_OBSIDIAN
```

直接写 `LIGHT`/`DARK` 会让安卓读成 `SYSTEM`，跨端主题失效。旧值反向映射（`PARCHMENT`/`MORNING_MIST` → 浅色）也已覆盖，并有单测守住。

## 3. 验收

### 3.1 自动化回归（`tools/workspace_ui_smoke.mjs`）

22 项全部通过，覆盖：三栏真实渲染、网格解析出三列、最小字号、无横向溢出、录入开合、保存按钮可达、刷新后正文仍在、素材转卡保留关联、收藏持久化、两字中文检索、无结果空状态、栏目标签、设置页、外观恰好三档、设置保存可达、深色即时生效、重启后主题与复习开关保留、保存失败保留草稿并显示原因、Esc 关闭、窄窗收起导航、窄窗重新展开。

复现：

```sh
cd apps/workbench && npm run dev          # 已在 1420
node tools/workspace_ui_smoke.mjs
```

### 3.2 门禁

`./tools/verify_workbench.sh` 全绿：前端 **29 文件 / 112 测试通过**，`tsc` 无错误，`cargo test --locked` **21 测试通过**。

### 3.3 原生窗口实测

在真实 Tauri 窗口里通过 `System Events` 完成：点「记录」→ 填入正文 → 点「存入收件箱」→ **SQLite 出现该行**（50 字符，`inbox`）→ 列表与阅读区同步更新 → 杀掉进程重启 → 数据与「上次位置」完整恢复。系统菜单与 Overlay 标题栏在同一窗口内一并核验。

## 4. 仍未解决 / 有代价的地方

- **macOS 的 Overlay 标题栏是 macOS 专属行为**，Windows 需按 Fluent 另行接 `windowEffects`（Mica），本轮未在 Windows 机器上验证。
- **侧栏 1040px 下不收起**，低于 980px 才收起；窄窗时导航是浮层而非可拖拽分栏，分隔条拖拽调整宽度**尚未实现**（规范里写了"可调整"，目前只做到"可收起"）。
- 提示条是浮层，长文档滚动时仍可能与正文重叠，只是不再盖住控件。

## 5. 明确没有做（不要让下一轮误以为已完成）

- 系统钥匙串存 API Key（仍是本机文件，设置页如实说明）
- Windows Mica 材质与 Windows 端实机验证
- 分栏拖拽调宽、宽度记忆
- 键盘上下选择列表、`/` 聚焦搜索
- 第三方插件宿主与沙箱
- 语音 / OCR / PDF / Office 解析
- 向量检索（仍是 FTS5 + RRF）
- 多设备同步

## 6. 截图

`.scratch/ui-redesign-2026-10-19/`（不入库）：空库浅色、有内容浅色；三方向对比稿在 `.scratch/ui-directions-2026-10-19/`。
原生窗口证据（本机临时目录）：标题栏融合、录入面板、保存后、重启后、菜单触发录入、菜单切换栏目。

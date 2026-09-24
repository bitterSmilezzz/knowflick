# 独立 Code Review：双端剪藏来源去重

## 审查基准与范围

- 外部审查软件 / Agent：Antigravity（Gemini 3.8 Flash High）。
- 隔离 worktree：`/private/tmp/knowflick-20260924T184946Z`。
- 短期分支：`codex/knowflick-cross-webclip-attribution-20260924T184946Z`。
- Base commit：`1e213ed82d8ec75cdb322e52b1ce1e0a5066bf52`（`origin/main`）。
- 审查候选 staged tree：`516a9332197f61504b6a6276ae3c735d53f120af`；审查时 `HEAD` 仍指向 base，以满足先审查再提交。
- Diff：`/private/tmp/knowflick-20260924T184946Z-review.patch`，SHA-256 `7c053896cfd692534008b46bc6c11c43b2a6e8c8e5eb8e2397cebcb7b7b969d3`。
- 范围：相对 base 的全部 13 个暂存源码、测试、版本及发布文档文件。审查覆盖 Swift/Kotlin 归因行为、Android AI 服务与 ViewModel 职责、调用路径、边界条件、生命周期、安全隐私、回归风险和测试覆盖。
- Agent 确认读取完整 patch 与隔离 worktree；本次审查只读，没有修改文件或运行命令。

## 结论

**零项未解决的确认问题（P0–P3）。** 审查确认双端都会移除 AI 卡片中与原始提交 URL 或 canonical URL 完全相同的链接，并将 canonical 来源链接稳定放在首位；其他链接的相对顺序保留。

Android 将来源归因从 `AiService.transformNoteToCards` 移到 `WebClipDigest.attributing`，由 `KnowFlickViewModel` 在 AI 提炼后调用。审查确认这与 macOS 的归因边界一致，且 `CancellationException`、界面状态和入库路径没有回归。

## 非阻塞观察及处理

1. **URL 相似写法仍可能重复**：当前按完整字符串匹配，尾斜杠、协议或域名大小写不同的链接不会去重。这是有意保持的保守边界，避免把语义不同的查询或页面地址误当作重复；两个平台发布说明均明确记录此限制，本轮不扩大 URL 规范化范围。
2. **ViewModel 胶水层没有独立集成测试**：纯归因函数在 Swift 与 Kotlin 均有直接用例，ViewModel 路径是 AI 提炼后调用该函数再入库的线性编排。审查认为这是低风险测试边界，不构成缺陷；保留现有覆盖。

上述观察均非确认问题，因此没有代码修复或复审轮次。最终审查后未再改动产品代码。

## 主任务验证

- `./tools/test.sh --core-only`：341 项测试、45 个套件通过。
- `cd apps/mac && swift build --target KnowFlickCore`：通过。完整 SwiftUI 应用由 PR 的 macOS GitHub Actions 验证。
- `./tools/build_android.sh`：通过；264 项 JVM 单测、Debug/Release Lint、Release/R8、签名与 ZIP 对齐检查通过。
- `cd dist/android && shasum -a 256 -c KnowFlick-0.10.1.apk.sha256`：通过。
- `cd dist/android && unzip -tq KnowFlick-0.10.1.apk`：通过。
- `git diff --cached --check`：通过。

外部审查 Agent 未运行测试或构建；以上结果由主任务执行并记录。

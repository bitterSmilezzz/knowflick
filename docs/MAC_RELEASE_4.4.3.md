# KnowFlick macOS v4.4.3

发布日期：2026-09-24。最低 macOS 14。

## 本版变化

- 新增网页剪藏入口：可从学习工作台、知识库和「文件 → 从网页剪藏…」打开，快捷键为 `⌥⌘I`。
- 抓取后先显示正文预览；页面只匿名读取，不发送 Cookie。用户点击「AI 提炼成卡片」后，才将正文发送到已配置的 AI 服务。
- AI 结果可逐张勾选确认导入，可选择置顶到待刷卡堆；每张新卡均以导入来源保存，并把原网页链接放在来源列表第一项。

## 安装与升级

下载 `KnowFlick-4.4.3.app.zip`，解压后放入 Applications。已有卡库继续使用，无需重置。
附件 `KnowFlick-4.4.3.app.zip.sha256` 用于核对下载完整性。

## 验证与边界

- 本机 `./tools/test.sh --core-only`：341 项测试、45 个套件通过；新增来源链接首位与去重断言。
- `swift build --target KnowFlickCore`、SwiftUI 源文件语法解析、Shell 变量 lint、学科契约检查及 MCP 工具测试（23 项）通过。
- 完整 SwiftUI 应用构建、签名、资源和启动检查由 GitHub Actions macOS workflow 验证。
- 网页抓取沿用既有匿名静态 HTML 解析能力；需要登录或主要依赖脚本渲染的页面可能无法提取正文。AI 不会在用户点击提炼前收到网页正文。

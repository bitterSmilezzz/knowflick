# KnowFlick macOS v4.4.2

发布日期：2026-09-24。最低 macOS 14。

## 本版变化

- 网页剪藏使用 `URLSession.AsyncBytes` 增量读取响应，正文最多读取 4 MB 加 1 个超限探测字节；超限后取消当前请求并保留截断标记，避免先将完整大响应缓冲到内存。
- 收到非成功 HTTP 状态或不支持解析的响应类型时，在读取响应正文前结束请求。

## 安装与升级

下载 `KnowFlick-4.4.2.app.zip`，解压后放入 Applications。已有卡库继续使用，无需重置。
附件 `KnowFlick-4.4.2.app.zip.sha256` 用于核对下载完整性。

## 验证与边界

- 本机 `./tools/test.sh --core-only`：340 项测试、45 个套件通过；`swift build --target KnowFlickCore` 通过。
- Shell 变量 lint、共享学科契约检查与 MCP 工具测试通过。
- 新增离线异步字节流测试，验证超限时只读取到第 4 MB + 1 字节，并区分恰好到限的正常响应；本轮没有请求真实网页。
- 本机只有 Command Line Tools。完整 macOS 应用构建、签名、资源和启动检查由 GitHub Actions 的 macOS workflow 验证。

# KnowFlick macOS v4.4.4

发布日期：2026-09-25。最低 macOS 14。

## 本版变化

- 网页剪藏提炼出的卡片会将规范网页地址保留在来源列表首位，并移除 AI 同时返回的原始提交地址或规范地址重复项。
- 其他 AI 生成的参考链接及其顺序保持不变。

## 安装与升级

下载 `KnowFlick-4.4.4.app.zip`，解压后放入 Applications。已有卡库继续使用，无需重置。
附件 `KnowFlick-4.4.4.app.zip.sha256` 用于核对下载完整性。

## 验证与边界

- 本机 `./tools/test.sh --core-only`：341 项测试、45 个套件通过；`swift build --target KnowFlickCore` 通过。
- 完整 SwiftUI 应用构建、签名、资源和启动检查由 GitHub Actions macOS workflow 验证。
- 去重按完整 URL 字符串匹配本次提交地址与抽取出的规范地址。仅有大小写、尾斜杠或查询参数差异的其他地址可能仍会同时显示。

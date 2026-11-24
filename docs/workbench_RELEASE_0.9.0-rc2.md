# KnowFlick Workbench 0.9.0-rc2

0.9 公测的第二个候选版。macOS 为 ad-hoc 签名，Windows 尚未签名。系统可能提示手动确认。[安装和校验指南](https://github.com/bitterSmilezzz/knowflick/blob/main/docs/INSTALL_UNSIGNED.md)

## 从 RC1 升级

本版修复无搜索历史时旧版导出无法恢复的问题。新版可读取这些已导出的备份。升级前复制资料库目录并保留备份，确认恢复结果后再使用新库。整库恢复会重建活动笔记的全文和分块索引，回收站笔记仍保持不可搜索。

## 安装包

- macOS Apple Silicon 和 Intel 下载对应的 DMG。Windows x64 使用 EXE，Ubuntu 24.04 amd64 使用 DEB。
- 下载后核对 `SHA256SUMS.txt`。可用 `gh attestation verify <安装包> --repo bitterSmilezzz/knowflick` 验证构建来源。
- 许可正文随安装包分发。正式 0.9 公测仍按[实现计划](https://github.com/bitterSmilezzz/knowflick/blob/main/docs/product/GA_PLAN.md)核对完整使用闭环和真实邮箱等证据。

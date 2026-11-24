# KnowFlick Workbench 0.9.0-rc2

0.9 公测的第二个候选版。macOS 为 ad-hoc 签名，Windows 尚未签名，系统可能提示手动确认。见[安装和校验指南](INSTALL_UNSIGNED.md)。

## 从 RC1 升级

本版修三处真机缺陷，均已在本机 macOS 27.2 上复验：

1. **新库导出的备份无法恢复**：从未搜索过的资料库导出 v11 时缺少 `search_history.json`，恢复器直接拒收。
   现在导出固定写入空搜索历史；旧版已导出的同类包也能被新版读取（不声明该条目的 v11 兼容）。
2. **复习评分不落库**：共享工作台评分后发的是整张卡片，Go 侧却只接受学习字段，
   结果 `review_events` 永远为空。现在前端把评分后的学习字段映射成 `state` 再发，评分与间隔重复真正生效。
3. **桌面壳导出备份不落盘**：WebView 不支持浏览器 Blob 下载，工具栏的「导出备份」点了没反应。
   现在壳内走原生保存对话框，由 Go 写入前端生成的备份字节。

升级前仍建议复制资料库目录并保留一份备份。整库恢复会重建活动笔记的全文与分块索引，回收站笔记保持不可搜索。

## 安装包

- macOS Apple Silicon / Intel 选对应 DMG；Windows x64 用 EXE；Ubuntu 24.04 amd64 用 DEB。
- 下载后先核对 `SHA256SUMS.txt`，可用 `gh attestation verify <安装包> --repo bitterSmilezzz/knowflick` 验证构建来源。
- 许可正文随安装包分发；正式 0.9 公测仍按[实现计划](product/GA_PLAN.md)核对完整使用闭环与真实邮箱等证据。

## 本机验证记录（macOS 27.2 / Apple Silicon）

| 项 | 结果 |
| --- | --- |
| 新库导出 → 恢复 | 空库导出 `schemaVersion=11`、14 个条目、`search_history.json=[]`；Go 与共享界面的恢复用例均通过 |
| 旧包兼容 | 去掉三个搜索历史声明的 v11 包可读入；声明存在但缺文件时仍拒绝 |
| 复习评分 | 真机导入卡片 → 知识测验 → 评分「容易」→ `review_events` 落一行、`review_count=1` |
| 备份导出落盘 | 真机点「导出备份」→ 原生保存框 → 4685 字节、manifest 与 14 个条目可读 |
| 安装包首启 | 两档 macOS DMG 已加进 CI：镜像复制 → 校验签名 → 启动 → 等 `store/knowflick.db` |

## 已知限制

1. **未签名、未公证**：macOS 首次打开需手动放行，Windows 会触发 SmartScreen。
2. **Windows / Linux 尚未在真机走完首启闭环**：CI 已覆盖安装、启动与卸载，五步业务闭环仍待补。
3. **素材来源待确认**：图标美术与 42 张底图在仓库里没有来源与授权记录，详见 [第三方组件与许可](../THIRD_PARTY_NOTICES.md)。
4. **真实 IMAP 未验**：没有可用邮箱账号，只验了界面、校验与错误文案。

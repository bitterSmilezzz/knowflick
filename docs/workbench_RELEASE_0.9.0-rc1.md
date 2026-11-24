# KnowFlick Workbench 0.9.0-rc1

面向安装与资料库兼容性验证的候选版。macOS 包采用临时签名，尚未经过 Apple 公证。Windows 安装器没有 Authenticode 签名。系统可能在首次打开时提示，安装步骤见[无签名安装指南](https://github.com/bitterSmilezzz/knowflick/blob/main/docs/INSTALL_UNSIGNED.md)。

## 下载与校验

- macOS 选择 Apple Silicon（`arm64`）或 Intel（`x64`）的 DMG，系统要求 macOS 13 或更高。
- Windows 选择 `x64.exe`。Linux 选择 `linux-amd64.deb`，候选版基于 Ubuntu 24.04 构建，使用 GTK4 与 WebKitGTK 6.0。
- 对照 `SHA256SUMS.txt` 验证下载内容，也可通过 `gh attestation verify <安装包路径> --repo bitterSmilezzz/knowflick` 核对 GitHub 构建来源。

## 升级与回退

升级前关闭旧版并备份资料库与附件。回退时安装 [0.1.0](https://github.com/bitterSmilezzz/knowflick/releases/tag/workbench-v0.1.0) 后打开升级前的备份副本，将新版资料库另存。备份或迁移时请妥善保管库内原件和凭据。

## 本机验证记录（macOS 27.2 / Apple Silicon）

| 项 | 结果 |
| --- | --- |
| 启动与建库 | 以隔离数据目录启动安装包内的 `.app`，自动创建 `store/knowflick.db`；三次启动耗时 1.27 s / 0.04 s / 0.03 s（首次含建库），常驻内存约 118–122 MiB |
| 物理麦克风 | 系统授权弹窗 → 录制 → 停止 → 保存 → 界面提示「语音笔记已存入收件箱：3 秒」；音频 opus/48 kHz 单声道、`ffprobe` 可解码；重启后附件与素材行仍在，`PRAGMA integrity_check` = ok |
| 真实模型 | 本地 llama.cpp（Qwen2.5-1.5B-Instruct，权重校验与发布方 etag 一致）：出卡被应用解析器接受；问答按检索到的笔记作答并引用编号 |
| 数据安全 | 0.1.0 建的库升级后笔记、卡片、复习记录、订阅与全文索引一致；备份包往返后内容一致、凭据目录不入包；两个写者并发时第二个被修订号拒绝；`kill -9` 落在提交前时库仍完整、正文保持已提交版本 |

### 已知限制

1. **未签名、未公证**：macOS 首次打开需手动放行，Windows 会触发 SmartScreen。
2. **仅 Apple Silicon 与 amd64**：没有 Linux arm64 与 Intel Mac 的 macOS 产物以外的其它架构。
3. **Windows / Linux 尚未在真机走完首启闭环**：CI 只验到安装、启动与卸载。
4. **素材来源待确认**：图标美术与 42 张底图在仓库里没有来源与授权记录，
   未按 MIT 再许可；详见 [第三方组件与许可](../THIRD_PARTY_NOTICES.md)。

## 本版变更

- 桌面窗口统一显示 KnowFlick，资料库仍可按需要启用编辑。「版本与隐私」使用与发布标签一致的版本号。
- 新增 Intel Mac 安装包，Linux 安装依赖与实际链接库一致。安装包内附依赖许可正文。
- 公开测试版的安装、升级、备份恢复及真实依赖验收进度以[验收记录](https://github.com/bitterSmilezzz/knowflick/blob/main/docs/FIRST_VERSION_ACCEPTANCE.md)为准。反馈时附系统版本、安装包文件名与复现步骤。

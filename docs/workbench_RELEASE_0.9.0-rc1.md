# KnowFlick Workbench 0.9.0-rc1

面向安装与资料库兼容性验证的候选版。macOS 包采用临时签名，尚未经过 Apple 公证。Windows 安装器没有 Authenticode 签名。系统可能在首次打开时提示，安装步骤见[无签名安装指南](https://github.com/bitterSmilezzz/knowflick/blob/main/docs/INSTALL_UNSIGNED.md)。

## 下载与校验

- macOS 选择 Apple Silicon（`arm64`）或 Intel（`x64`）的 DMG，系统要求 macOS 13 或更高。
- Windows 选择 `x64.exe`。Linux 选择 `linux-amd64.deb`，候选版基于 Ubuntu 24.04 构建，使用 GTK4 与 WebKitGTK 6.0。
- 对照 `SHA256SUMS.txt` 验证下载内容，也可通过 `gh attestation verify <安装包路径> --repo bitterSmilezzz/knowflick` 核对 GitHub 构建来源。

## 升级与回退

升级前关闭旧版并备份资料库与附件。回退时安装 [0.1.0](https://github.com/bitterSmilezzz/knowflick/releases/tag/workbench-v0.1.0) 后打开升级前的备份副本，将新版资料库另存。备份或迁移时请妥善保管库内原件和凭据。

## 本版变更

- 桌面窗口统一显示 KnowFlick，资料库仍可按需要启用编辑。「版本与隐私」使用与发布标签一致的版本号。
- 新增 Intel Mac 安装包，Linux 安装依赖与实际链接库一致。安装包内附依赖许可正文。
- 公开测试版的安装、升级、备份恢复及真实依赖验收进度以[验收记录](https://github.com/bitterSmilezzz/knowflick/blob/main/docs/FIRST_VERSION_ACCEPTANCE.md)为准。反馈时附系统版本、安装包文件名与复现步骤。

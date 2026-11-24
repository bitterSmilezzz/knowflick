# 无签名安装指南（0.9 公开测试版）

> 0.9 是**未签名**的公开测试版：macOS 没有经过 Apple 公证，Windows 安装器没有 Authenticode 签名。
> 这不是缺陷隐瞒——签名证书要等产品通过商用可行性评审后再申请（见 [正式版计划](product/GA_PLAN.md)）。
> 本页给出各平台的安装、校验与回滚步骤。

## 先校验文件（三平台通用）

Release 里附 `SHA256SUMS.txt`。下载后在同一目录执行：

```sh
# macOS / Linux
shasum -a 256 -c SHA256SUMS.txt

# Windows（PowerShell）
Get-FileHash .\KnowFlick-Workbench-<版本>-windows-x64.exe -Algorithm SHA256
# 与 SHA256SUMS.txt 中对应行比对
```

0.9 起 Release 还会带 GitHub 构建 provenance，可用：

```sh
gh attestation verify KnowFlick-Workbench-<版本>-macos-arm64.dmg --repo bitterSmilezzz/knowflick
```

（0.1.0 尚无 attestation；该命令从 0.9 起可用。）

## macOS

1. 打开 DMG，把 `KnowFlick.app` 拖进「应用程序」。
2. 首次打开会被 Gatekeeper 拦下（「无法验证开发者」）。任选其一：
   - 右键（或按住 Control 点击）App →「打开」→ 在弹窗里再点「打开」；
   - 「系统设置 → 隐私与安全性」→ 页面底部「仍要打开」；
   - 终端执行：`xattr -dr com.apple.quarantine /Applications/KnowFlick.app`
3. 装好后从「应用程序」正常启动即可；后续更新重复步骤 1–2。

**不要**在系统设置里全局关闭 Gatekeeper 来绕过——只对这一个 App 放行。

## Windows

1. 运行 `.exe` 安装器；SmartScreen 提示「Windows 已保护你的电脑」时：
   点「更多信息」→「仍要运行」。
2. 安装完成后从开始菜单启动；卸载走「设置 → 应用 → KnowFlick → 卸载」。
3. 安装器未签名，属性里的发布者显示为未知——以 SHA256 校验为准。

## Linux（DEB）

```sh
sudo dpkg -i KnowFlick-Workbench-<版本>-linux-amd64.deb
# 若缺依赖：
sudo apt-get -f install
knowflick
```

DEB 未做 GPG 签名；用 `dpkg-deb -I` 查看 control 字段，用上面的 SHA256 校验文件。

## 回滚

- 安装包回滚：卸载当前版本，装回上一版（Release 历史里保留 0.1.0 与 0.9.0）。
- 回退应用时使用升级前的资料库副本，并单独保留升级后的库。资料库默认在
  - macOS：`~/Library/Application Support/KnowFlick`
  - Windows：`%APPDATA%\KnowFlick`（以应用内「打开资料库」显示的路径为准）
  - Linux：`$XDG_DATA_HOME/KnowFlick`，默认 `~/.local/share/KnowFlick`
- 升级前建议在应用内做一次「导出/备份」，备份包会排除凭据文件。

## 出问题时怎么报

带上：系统版本、安装包文件名、`SHA256SUMS.txt` 校验结果、应用内「关于」显示的版本、
以及复现步骤。不要附完整资料库或含密码的截图。

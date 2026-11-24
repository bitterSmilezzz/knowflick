# KnowFlick Workbench 0.1.0 发布记录

- 发布日期：2026-11-24
- 版本来源：`apps/workbench/package.json` 的 `version`（唯一来源；`src-tauri/tauri.conf.json` 已随 ADR-0042 删除）
- 发布方式：注解 tag `workbench-v0.1.0`，`workbench-release.yml` 三平台矩阵构建后由
  `tools/assemble_workbench_release.sh` 校验命名/版本、生成 `SHA256SUMS.txt` 并上传 Release

## 产物

| 系统 | 文件 | 说明 |
| --- | --- | --- |
| macOS（Apple Silicon） | `KnowFlick-Workbench-0.1.0-macos-arm64.dmg` | `.app` 拖入 Applications；ad-hoc 签名，未公证 |
| Linux（x86_64） | `KnowFlick-Workbench-0.1.0-linux-amd64.deb` | `sudo dpkg -i`；依赖 GTK3 + WebKitGTK 4.1 |
| Windows（x64） | `KnowFlick-Workbench-0.1.0-windows-x64.exe` | NSIS 安装器；未签名，SmartScreen 会提示 |

Release 同时附 `SHA256SUMS.txt`。**没有 MSI**：Wails v3 的打包命令只支持 deb/rpm/archlinux/dmg，
Windows 安装器用 NSIS 生成；这是 ADR-0042 记录的口径，不是本次遗漏。

## 同版本包含的关键变化

- 第一套桌面完成 Rust/Tauri → Go（Wails v3）迁移，仓库内不再有 Rust 代码；构建入口
  `tools/build_workbench_go.sh`，安装包入口 `tools/package_workbench_go.sh`。
- 前端移除 `@tauri-apps/*` 依赖，桥接层收进 `apps/workbench/src/shell/bridge/`。
- 用户可见错误改用 `internal/errtext`（中文原因 + 下一步，原始英文放括号），门禁新增「%w 未走 errtext」判据。
- 安装包图标接入 `shared/icons` 的 icns/ico/png；不再依赖 `npx tauri icon`。
- 产品侧包含 R0–R4 的既有工作（笔记编辑、知识库、导入报告、复习历史、MCP 项目授权等），
  明细见 [CHANGELOG](../../CHANGELOG.md) 与 [产品路线](../product/DELIVERY_ROADMAP.md)。

## 验证证据

| 项 | 证据 |
| --- | --- |
| 三平台构建 | CI run 45304074590：macOS / Linux / Windows 三 job 全绿 |
| 组装与校验 | CI run 45305793849：校验 tag 版本与三类产物命名，生成 `SHA256SUMS.txt` |
| 上传链路 | 草稿 Release 演练 run 45309459222：3 个安装包 + `SHA256SUMS.txt` 实际上传成功（验证后删除草稿） |
| macOS 启动 | 本机挂载 DMG → 启动 `.app`，进程存活、窗口渲染正常（AX 树核对） |
| Linux DEB 结构 | `control` 字段、文件清单（`/usr/bin/knowflick`、desktop、图标）已核对 |
| Windows EXE | PE32 + Nullsoft Installer 结构已核对 |
| 正式发布 | CI run 45316883403：三平台 + 组装上传四 job 全绿；Release 已发布（非草稿），4 个附件齐全 |
| 下载校验 | 从 Release 下载的 3 个安装包用 `SHA256SUMS.txt` 逐项校验全部 OK |
| macOS 首启（本机） | 挂载正式 DMG → 复制 `.app` → 以独立 HOME 启动：进程存活、窗口渲染正常、自动创建 `~/Library/Application Support/KnowFlick/store/knowflick.db`，正常退出。界面默认「只读预览」，点「启用编辑」进入编辑态 |

## 已知限制（发布时必须如实告知）

1. **未签名 / 未公证**：macOS 首次打开会被 Gatekeeper 拦（需「仍要打开」或 `xattr -dr com.apple.quarantine`）；
   Windows 会触发 SmartScreen。正式分发需 Developer ID + notarytool 与 Windows 代码签名。
2. **仅 Apple Silicon**：没有 Intel Mac 产物；Intel 用户需等待 x64 矩阵。
3. **Windows/Linux 安装首启未在真机走完**：CI 只验证构建与产物结构；安装、升级、卸载与
   「导入 → 刷卡 → 测验 → 导出」待真机验收（见 R0 缺口）。
4. **Windows/Linux 未验通知、托盘与麦克风权限**等平台行为。
5. **首屏仍带「Go 版预览 / 只读预览」字样**：只读是安全默认（点「启用编辑」才写库），但「预览」措辞与正式版不符；已列入章程的工程卫生（去 `preview` 命名），下个小版本处理，不影响数据完整性。

## 回滚

- 附件可先从 Release 撤下；tag 可删除；用户数据在本地资料库目录，不受安装包回滚影响。
- 若需回退实现：Git 历史保留 Rust 壳（ADR-0042「复现与回滚」），但不建议——Go 壳已承接全部能力。

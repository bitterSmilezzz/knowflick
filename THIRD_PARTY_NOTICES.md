# 第三方组件与许可

KnowFlick Workbench 以 **MIT License** 分发（见 [LICENSE](LICENSE)）。安装包内含 Go 二进制（Wails v3 桌面壳）
与内嵌的前端 bundle（React），本文件列出其中每一个第三方组件、其许可，以及**许可原文实际放在安装包的哪里**。

本表按 **0.9.0-rc1** 的构建记录整理。版本以 [go.mod](apps/workbench-go/go.mod) / [go.sum](apps/workbench-go/go.sum)
与 [package-lock.json](apps/workbench/package-lock.json) 为准；依赖升级后本表必须同步更新。

## 许可文本如何随安装包分发

打包时 [tools/collect_workbench_notices.mjs](tools/collect_workbench_notices.mjs) 会读本仓 `LICENSE`、Go 工具链、
**本平台实际链接的** Go 模块和 `node_modules` 里的生产依赖，把许可原文拼成一份 `KnowFlick-Licenses.txt`
（按 `=== 组件 / 文件名 ===` 分节，不改写原文）。[tools/package_workbench_go.sh](tools/package_workbench_go.sh) 把它放进：

| 安装包 | 许可文本位置 |
| --- | --- |
| macOS（DMG / .app） | `KnowFlick.app/Contents/Resources/KnowFlick-Licenses.txt` |
| Linux（.deb） | `/usr/share/doc/knowflick/copyright`（Debian 的文档惯例） |
| Windows（NSIS 安装器） | 安装目录下的 `KnowFlick-Licenses.txt` |

各平台包里的文本**不完全相同**，这是有意的：Windows 包多 `go-ole/go-ole`，Linux 包多 `godbus/dbus/v5`，
macOS 包没有这两个；Go 标准库的许可来自构建机上的 Go 工具链。仓库里的本文件是**索引**，
许可原文以构建产物里的那份为准——它由依赖内容生成，不会与 `go.sum` / `package-lock.json` 脱节。

## 随 Go 二进制分发的模块

| 组件 | 版本 | 许可 | 平台 | 随包分发的许可文本 |
| --- | --- | --- | --- | --- |
| [Wails v3](https://github.com/wailsapp/wails)（桌面壳，含内置 WebView 运行时） | v3.1.0 | MIT | macOS / Windows / Linux | `LICENSE` |
| [modernc.org/sqlite](https://modernc.org/sqlite)（纯 Go SQLite） | v1.62.0 | BSD-3-Clause；内含 SQLite（公有领域）与 sqlite-vec（MIT） | 三平台 | `LICENSE`、`LICENSE-3RD-PARTY.md`、`LICENSE-SQLITE`、`LICENSE-SQLITE_VEC` |
| [modernc.org/libc](https://modernc.org/libc) | v1.80.1 | BSD-3-Clause；内含 musl 等第三方（见其 3RD-PARTY 文件） | 三平台 | `LICENSE`、`LICENSE-3RD-PARTY.md` |
| [modernc.org/memory](https://modernc.org/memory) | v1.12.1 | BSD-3-Clause | 三平台 | `LICENSE`、`LICENSE-GO`、`LICENSE-LOGO`、`LICENSE-MMAP-GO` |
| [modernc.org/mathutil](https://modernc.org/mathutil) | v1.7.1 | BSD-3-Clause | 三平台 | `LICENSE` |
| [dustin/go-humanize](https://github.com/dustin/go-humanize) | v1.1.0 | MIT | 三平台 | `LICENSE` |
| [google/uuid](https://github.com/google/uuid) | v1.6.0 | BSD-3-Clause | 三平台 | `LICENSE` |
| [remyoudompheng/bigfft](https://github.com/remyoudompheng/bigfft) | v0.0.0-20230129092748-24d4a6f8daec | BSD-3-Clause | 三平台 | `LICENSE` |
| [mattn/go-isatty](https://github.com/mattn/go-isatty) | v0.0.24 | MIT | macOS / Windows | `LICENSE` |
| [ncruces/go-strftime](https://github.com/ncruces/go-strftime) | v1.1.0 | MIT | macOS / Windows | `LICENSE` |
| [go-ole/go-ole](https://github.com/go-ole/go-ole) | v1.3.0 | MIT | Windows | `LICENSE` |
| [godbus/dbus/v5](https://github.com/godbus/dbus) | v5.2.2 | BSD-2-Clause | Linux | `LICENSE` |
| [golang.org/x/sys](https://pkg.go.dev/golang.org/x/sys) | v0.49.0 | BSD-3-Clause + PATENTS | 三平台 | `LICENSE`、`PATENTS` |
| [golang.org/x/text](https://pkg.go.dev/golang.org/x/text) | v0.42.0 | BSD-3-Clause + PATENTS | 三平台 | `LICENSE`、`PATENTS` |
| Go 标准库 | go1.27 系列（0.9.0-rc1 构建为 go1.27.4） | BSD-3-Clause + PATENTS | 三平台 | 构建机 `GOROOT/LICENSE`、`GOROOT/PATENTS` |

补充说明：

- **SQLite 是公有领域**（`LICENSE-SQLITE`），不要求署名；这里登记它是为了把「二进制里有一份 SQLite」写清楚。
- `modernc.org/sqlite` 自带的 `LICENSE-3RD-PARTY.md` 已逐一列出其传递依赖（含 `go-humanize`、`uuid`、`bigfft`、
  `go-strftime`、`x/sys`）与内嵌 C 代码的来源，原文照收，不做摘要。
- 二进制里只有**上表列出的模块**：用 `go version -m` 读 0.9.0-rc1 的 macOS 二进制可复核（12 个 dep），
  Windows / Linux 的差别仅在上表标注的三行。

## 随前端 bundle 分发的 npm 包

前端由 Vite 构建，运行时依赖只有 React 家族，打进 `vendor-*.js`（包内保留各自的 `@license` 注释）：

| 组件 | 版本 | 许可 | 说明 |
| --- | --- | --- | --- |
| [React](https://react.dev/) | 19.3.0 | MIT | `react.production` / `react-jsx-runtime` |
| [React DOM](https://react.dev/) | 19.3.0 | MIT | `react-dom.production` / `react-dom-client` |
| [scheduler](https://www.npmjs.com/package/scheduler) | 0.28.0 | MIT | React DOM 的运行时依赖，**同样是随包分发的第三方代码** |

以上三个包的许可原文取自 `node_modules/<包>/LICENSE`，与 Go 模块一起拼进 `KnowFlick-Licenses.txt`。
React 系列的版权声明是 `Copyright (c) Meta Platforms, Inc. and affiliates.`

## 只用于构建与测试（不随安装包分发）

| 组件 | 版本 | 许可 |
| --- | --- | --- |
| [Vite](https://vite.dev/) | 6.4.4 | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 4.7.0 | MIT |
| [TypeScript](https://www.typescriptlang.org/) | 5.9.3 | Apache-2.0 |
| [Vitest](https://vitest.dev/) | 5.0.5 | MIT |
| `@types/*`（node / react / react-dom） | 见 lock | MIT |

这些包只出现在构建机与 CI 上，不进安装包，因此不需要随包分发许可文本；列在这里是为了让「仓库里有哪些第三方代码」一眼可查。

## 图标、底图与字体

- **字体**：没有打包第三方字体，界面使用系统字体。已核：仓库内没有 `@font-face`，也没有 `.woff/.woff2/.ttf/.otf` 文件。
- **应用图标**：`shared/icons/` 的 `.icns` / `.ico` / `.png` 是派生产物，母版 `AppIcon.iconset/` 不在仓库内；
  仓库里**没有**图标美术的来源、作者或授权记录。
- **界面底图**：`shared/assets/bg/*.webp`（42 张）随应用分发；仓库里**没有**这些图片的来源、作者或授权记录。

最后两类素材**没有被本文件按 MIT 再许可**：它们是项目自用素材，能否再分发取决于项目所有者对美术来源的确认
（自绘/自摄/AI 生成，或已获授权的第三方作品）。在确认之前，不要把 MIT 当作它们的授权依据；如果其中确有第三方作品，
必须在此登记来源与授权。今后引入任何第三方代码、图片、图标、字体或示例数据，都要在本文件登记来源、版本与许可，
并在 `CHANGELOG.md` 写明。

## 复核方式

```sh
# Go 侧：二进制里实际链接了哪些模块（版本与校验和都在 build info 里）
go version -m apps/workbench-go/bin/knowflick

# 逐平台看模块（-tags production 与实际构建一致；不加会多出 dev 专用依赖）
cd apps/workbench-go && GOOS=windows GOARCH=amd64 go list -deps -tags production \
  -f '{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}}{{end}}{{end}}' . | sort -u

# 前端生产依赖（应为 react / react-dom / scheduler 三个）
cd apps/workbench && npm ls --omit=dev --all --parseable
```

# KnowFlick Workbench（第一套桌面前端）

[ADR-0002](../../docs/adr/0002-desktop-web-split-from-android.md) 第一套桌面的**前端**：Vite + React + TypeScript。
壳层是同仓的 [`apps/workbench-go`](../workbench-go)（Go / Wails v3 单二进制）；Rust/Tauri 壳已整体删除
（[ADR-0042](../../docs/adr/0042-remove-tauri-rust.md)）。

与 Android / 冻结的 JVM 桌面共用 `cards.json`、`settings.json` 与 `store` 目录结构。

## 开发

```sh
npm ci
npm run dev            # 浏览器模式：http://localhost:1420（无壳能力，剪藏抓取/AI/落盘走不到）
```

需要完整桌面能力时，从仓库根构建并在本机启动 Go 版：

```sh
./tools/build_workbench_go.sh                     # 生成 Wails bindings + 前端 bundle + Go 二进制
./apps/workbench-go/bin/knowflick-go-preview      # 启动桌面窗口
```

## 验证

```sh
../../tools/verify_workbench.sh        # 全部：npm test + tsc + 静态守卫 + go vet/go test + 回环对拍（+ 本机浏览器冒烟）
../../tools/verify_workbench.sh web    # 只前端
../../tools/verify_workbench.sh go     # 只 Go（含回环对拍，需要本目录的 node_modules）
```

CI：[`.github/workflows/workbench.yml`](../../.github/workflows/workbench.yml)（web-checks / go-checks / browser-smokes）。

## 打包与发布

**暂停**。Go 版 DMG / MSI / DEB 打包与校验方案尚未就绪，`workbench-v*` tag 不触发构建、也不产出附件
（[ADR-0042](../../docs/adr/0042-remove-tauri-rust.md)）。恢复条件与待补项见该 ADR 的「遗留」一节。

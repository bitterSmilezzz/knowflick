# KnowFlick Workbench

ADR-0002 第一套桌面：Vite + React + Tauri。与 Android / frozen JVM 桌面共用 `cards.json`、`settings.json` 与 `store` 目录结构。

## 开发

```sh
cd apps/workbench
npm install
npm run tauri dev   # 需要 Rust toolchain；前端 http://localhost:1420
```

仅前端（无壳能力）：

```sh
npm run dev
```

## 验证

```sh
../../tools/verify_workbench.sh   # npm test + tsc --noEmit + cargo test，与 CI 同一套
```

CI：`.github/workflows/workbench.yml`（每次 push / PR 跑上面这一条）。

## 打包与发布

```sh
npm run tauri build -- --bundles dmg    # 本机系统那一档（macOS 是 dmg，Windows 是 msi，Linux 是 deb）
```

三端安装包**不在本机出**：Tauri 与 jpackage 一样不支持交叉编译，DMG / MSI / DEB 各要在自己的系统上构建。
打 tag `workbench-v<版本>` 触发 `.github/workflows/workbench-release.yml`：三台 runner 各出一档、
各自过一遍 `verify_workbench.sh`，再由 `tools/assemble_workbench_release.sh` 统一命名、生成
`SHA256SUMS.txt` 并附到 Release。该脚本可本地空跑（拿真实 DMG + 占位 msi/deb 即可验证命名映射与守卫）：

```sh
../../tools/assemble_workbench_release.sh --tag workbench-v0.1.0 --artifacts-dir <下载产物目录>
```

版本号是三处一致的：`package.json`、`src-tauri/tauri.conf.json`、tag。tag 对不上会被脚本直接拦下。

### 图标

`src-tauri/icons/` 里的 `.icns` / `.ico` / 多档 PNG 是**派生物**，源自唯一一份美术
（`shared/icons/AppIcon.iconset/`——**美术源本身不入 Git**，仓库只分发派生出的图标文件）。改了美术就重新生成一次，产物入库：

```sh
npx tauri icon ../../shared/icons/AppIcon.iconset/<最大的那张 1024 源>
# 生成后会多出 android/ ios/ Square*.png StoreLogo.png 等本项目不用的目录，删掉；
# 只留桌面打包要用的那几个（各档 PNG + .icns + .ico），并同步 tauri.conf.json 的 bundle.icon
```

## 默认数据路径

| 平台 | 卡库 `store` |
| --- | --- |
| macOS | `~/Library/Application Support/KnowFlick/store` |
| Windows | `%APPDATA%\KnowFlick\store` |
| Linux | `$XDG_DATA_HOME/KnowFlick/store`（默认 `~/.local/share/KnowFlick/store`） |

摄影底图来自仓库 `shared/assets/bg/`，随 Vite 的 `publicDir` 进 `dist/`（运行时按 `/bg/<key>.webp` 取），
**不再单独列进 `bundle.resources`**——那份副本会落在打包产物的 `_up_/` 前缀目录里，运行时不经过它，
白白让安装包多几 MB。

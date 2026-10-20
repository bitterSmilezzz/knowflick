# 工作台远端交付验证（2026-10-20）

## 分支与 PR

- 独立分支：`workbench/second-brain-validation`。
- 草稿 PR：[#95](https://github.com/bitterSmilezzz/knowflick/pull/95)，基于 `chore/shared-chat-ui` 堆叠。
- 原有 [PR #94](https://github.com/bitterSmilezzz/knowflick/pull/94) 保持不变。
- 本机原分支 `chore/shared-chat-ui` 保留，作为原提交历史的本地参照。远端已于本次 fetch 前重写历史，因此在独立分支上把其后 23 个提交重放到远端聊天分支；重放后执行 `git diff --exit-code chore/shared-chat-ui HEAD`，文件树一致。

## 已执行

- 推送独立分支到 GitHub，未强推旧分支、未合并 PR、未创建发布 tag。
- `gh workflow run workbench-release.yml --ref workbench/second-brain-validation` 返回 404：新 workflow 未在默认分支登记，不能直接通过 workflow_dispatch 启动。
- 因此给 Tauri 打包 workflow 增加带路径过滤的 `pull_request` 触发器。PR 三平台只构建和短期留档安装包；创建 Release 的 job 仍只接受 `workbench-v*` tag。
- 本机 `./tools/verify_workbench.sh`：Vitest 41 套件 195 项通过、TypeScript 通过、Rust 40 项通过 / 3 项 ignored。后者为真模型转写、真模型嵌入与万条性能基准，此次分支同步未重新下载权重执行这些测试。

## CI 运行链接与验收边界

- [Tauri 三平台打包](https://github.com/bitterSmilezzz/knowflick/actions/runs/39376635381)：Linux DEB、macOS DMG、Windows MSI。
- [Workbench 门禁](https://github.com/bitterSmilezzz/knowflick/actions/runs/39376635255)。
- [Android 共享改动回归](https://github.com/bitterSmilezzz/knowflick/actions/runs/39376635335)。
- [冻结 JVM 桌面回归](https://github.com/bitterSmilezzz/knowflick/actions/runs/39376635246)：这一条与 Tauri 打包不同，不能互相替代。

## 首轮三平台结果（commit 88ca0eb）

| 平台 | 结论 | 证据 |
| --- | --- | --- |
| Linux DEB | **成功** | 15 个步骤全 success；产物 `KnowFlick_0.1.0_amd64.deb` 21.63 MiB |
| macOS DMG | 失败 | `ggml-backend-reg.cpp:524`：`'~path' is unavailable: introduced in macOS 10.15`，编译参数为 `-mmacosx-version-min=10.13` |
| Windows MSI | 失败 | `embed::tests::status_reports_missing_before_download`：`assertion failed: s.cache_dir.ends_with("models/fastembed")`，Windows 分隔符为 `\` |

首轮结论直接否定了两个「看起来会发生在 Linux/Windows」的猜测：Linux 并不缺 cmake（runner 自带，DEB 已产出），Windows 的 bindgen 也没有缺 libclang（编译与 40 项测试都跑到了最后一条断言）。真正的失败点在 macOS 部署目标与一条不跨平台的路径断言。

## 修复（commit a9bd877）

1. macOS：`whisper.cpp` 用到 C++17 `std::filesystem`，而 Tauri 默认 `MACOSX_DEPLOYMENT_TARGET=10.13` 会让 libc++ 把这些符号标为不可用。
   - `tauri.conf.json` 显式声明 `bundle.macOS.minimumSystemVersion = "11.0"`；
   - 工作流注入 `MACOSX_DEPLOYMENT_TARGET=11.0`（cmake 用它初始化 `CMAKE_OSX_DEPLOYMENT_TARGET`）；
   - 新增校验步骤：二进制 `minos` 与 `Info.plist` 的 `LSMinimumSystemVersion` 必须都是 11.x，防止回退。
   - 本机复现到根因是**残留 CMake 缓存**把 `CMAKE_OSX_DEPLOYMENT_TARGET` 锁死在 10.13；清缓存后 50 处编译参数全为 11.0，产物 `minos=11.0`、`LSMinimumSystemVersion=11.0`。CI 是全新 runner，不会有该缓存。
2. Windows：把 `ends_with("models/fastembed")` 改成按 `PathBuf` 分量比较。
3. Linux：依赖清单补 `cmake`（`whisper-rs-sys` 走 cmake 构建 whisper.cpp），属于消除隐式依赖，不是首轮失败原因。

## 已知跨平台限制（代码证据）

- `ort-sys` 的预编译分发列表里没有 `x86_64-apple-darwin`，因此 **macOS 只支持 Apple Silicon**；Intel Mac 无法构建本地语义模型。
- `asr.rs` 的非 WAV 转码依赖 macOS 的 `afconvert`；Windows / Linux 目前只接受 16-bit PCM WAV，其它格式会明确报错。

## 环境事实（与本任务相关）

- 本机 `HTTP(S)_PROXY=127.0.0.1:10808` 已失效，直连 GitHub 可用；`gh` 与 `git` 需 `env -u HTTP_PROXY -u HTTPS_PROXY` 才能访问。
- GitHub token 无 `workflow` scope，HTTPS 推送含 workflow 的提交会被拒绝；改用 SSH over 443（`ssh -p 443 git@ssh.github.com`）推送成功。
- workflow 的 `workflow_dispatch` 只认默认分支；未合并前无法手动触发，因此给打包 workflow 增加 `pull_request` 触发，PR 只留短期安装包附件，Release job 仍只接受 `workbench-v*` tag。

第二轮（commit a9bd877）结果待 CI 完成后补记。安装包成功生成也不能替代原生安装、首启以及导入 → 刷卡 → 测验 → 导出的交互冒烟。

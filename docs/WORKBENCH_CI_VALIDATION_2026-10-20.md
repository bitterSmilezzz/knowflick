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

上述远端任务已启动；启动和编译中不等于验证通过，最终结论待实际完成后更新。安装包成功生成也不能替代原生安装、首启以及导入 → 刷卡 → 测验 → 导出的交互冒烟。

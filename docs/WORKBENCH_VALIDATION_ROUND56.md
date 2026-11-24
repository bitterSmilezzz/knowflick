# Round 56 验证记录

## 侧栏折叠标题

真实 macOS 窗口中，「应用」的三角与文字被 `justify-content: space-between`
分到两端。修复为 `summary.ws-group-label { justify-content: flex-start }`。

- 浏览器回归：测量实际文字节点相对标题左边缘的位置，必须测到至少一个标题。
- 恢复旧 CSS 的反向验证：门禁以 exit 1 拒绝，报告「应用（左偏移 137px）」。
- macOS 安装版已重建并截图复核；真实窗口逐页点击五项通过。
- 截图与临时日志放在本机 `.scratch/shots/`，不作为跨机器可访问附件提交。

## 命令注册检查误报的更正

`git show 7715955:apps/workbench/src-tauri/src/lib.rs` 可见
`db_list_stale_embedding_card_ids` 原本是 `generate_handler` 的最后一项，未带尾逗号。
旧检查器的正则要求逗号，因而漏掉末项。此前“未注册导致索引中断”的说法没有依据。
本轮撤回 `f7e25b9` 添加的重复项，保留原有末项。

检查器七项隔离回归在 `tools/test_check_doc_consistency.py`：旧实现四项失败，
修正后七项通过。覆盖末项无逗号、有尾逗号、缺失命令、TSX、泛型与单引号、
重复注册、排除测试文件。命令名动态生成等语法不在静态核对的保证范围内。

## f7e25b9 的 CI 证据

[Workbench 门禁](https://github.com/bitterSmilezzz/knowflick/actions/runs/39813088453)、
[Android](https://github.com/bitterSmilezzz/knowflick/actions/runs/39813878910)、
[冻结桌面](https://github.com/bitterSmilezzz/knowflick/actions/runs/39813887236) 均成功。

[Workbench 打包 run 39813870209](https://github.com/bitterSmilezzz/knowflick/actions/runs/39813870209)
的聚合状态仍为 `in_progress`，但实际 job 均已结束：

| Job | 结果 | Job ID |
| --- | --- | --- |
| macOS DMG | success | 119947085038 |
| Linux DEB | success | 119947085490 |
| Windows MSI | success | 119947085706 |
| 附到 Release | skipped（分支手动运行，未打发布 tag，符合配置） | 119960546078 |

DMG、DEB、MSI 三个 artifact 已生成。run 总状态与 jobs 状态不一致，
不能再描述为“Windows 还在打包”，也不能把 run 总结论写成 success。
本地 `gh run watch` 已停止，远端 run 与产物保留。

## 统计口径

本机前端 381 项通过；Rust 84 项通过、3 项 ignored（共 87 条声明）。
新增的检查器七项测试单独计数，不混入 Vitest 数字。
证据登记表有 51 条路径与标识，包含重复问题的多处证据和边界用例，
不等于 51 个独立缺陷，也不能证明所有断言都足够强。

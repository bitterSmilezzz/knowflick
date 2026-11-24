# 第二阶段第六刀：备份附件恢复（restore_media）迁到 Go

> 承接 ADR-0014。那一轮迁了「新写入 / 读取」，但备份恢复要走另一条路：**保持原相对路径**，否则笔记正文里的引用会失效。这一刀补上。

## 一、Go 实现

`media.Restore(dir, relative, bytes)` 对齐 Rust `restore_media` 的口径：

| 约束 | 说明 |
| --- | --- |
| 路径 | 必须恰好 3 段 `media/<kind>/<file>`；kind 合法；文件名只允许 ASCII 字母数字、`.`、`_`、`-`，且不能是 `.` 或 `..` |
| 类型 | 扩展名必须与 kind 匹配（audio: webm/ogg/m4a/wav；image: png/jpg/jpeg/webp/gif/heic/heif；ink: json） |
| 大小 | 非空且不超过该 kind 的上限 |
| 目录 | 逐级创建并用 `Lstat` 拒绝符号链接和非目录 |
| 同路径已有文件 | 必须普通文件、大小相同且**字节完全相同**才幂等成功；否则明确报错，**一律不覆盖** |
| 发布 | 临时文件 `Sync()` 后用硬链接原子发布；链接失败再检查一次已有文件，清临时文件 |

**「不覆盖」是备份恢复的保守口径**：重放同一包应当幂等成功；同路径不同内容说明包或本地状态有分歧，静默覆盖会毁掉用户数据。

### 一处与 Rust 对齐被测试纠正

首版用例把 `media/image/.hidden.png` 当作不安全路径要求拒绝，但 Rust 的校验只排除名字恰好为 `.` 或 `..`——点开头的文件名是允许的。按 Rust 的真实口径改了用例，不是放宽安全性：路径穿越所需的 `..` 已被精确挡住。

## 二、验证

| 方向 | 结果 |
| --- | --- |
| Go 语义 | PASS：恢复后相对路径不变、可按路径读回；同内容重复恢复幂等成功；同路径不同内容被拒且原文件未被改；7 条不安全路径被拒 |
| Go 恢复 → Rust 读 | PASS：Rust 按原相对路径 `media/image/fixed-restore.png` 读回 `go-restored-payload`；Rust 用不同内容调用 `restore_media` 同样被拒，文件未变 |
| Rust 写 → Go 读 | PASS（上一轮夹具继续有效） |

扩展 `go_media_round_trip` 覆盖恢复路径；`go test ./...` 全绿。服务层新增 `RestoreAttachment`（共 13 个绑定方法），只读模式拒写；**UI 入口未接**。

## 三、还没做

- 完整备份包（`.kfbackup`）的打包/解包与对账；
- 附件 UI 入口（选择、预览、恢复）；
- 真实备份包回放；
- Windows / Linux 与 `.app` 签名。

## 四、下一步

继续 `http/mail` → 向量 → `asr`；备份包整体迁移另行安排。

# 第二阶段第五刀：附件存储（media）迁到 Go

> 按 ADR-0007 的顺序，从 `media` 开始迁非笔记模块。Rust 侧 `media.rs` 的契约是：文件只写进 `<library>/media/<kind>/`、返回相对路径、原子落盘并读回大小校验、拒绝路径穿越。

## 一、Go 实现

`apps/workbench-go/internal/media/media.go` 对齐了这些口径：

| 契约 | Go 实现 |
| --- | --- |
| 目录固定 | `media/<audio|image|ink>/`，新附件生成 UUID 文件名 |
| base64 IPC | 字节走 base64，不展开成数字数组（Rust 那轮已说明收益） |
| 原子写入 | `.part` 临时文件 → `Sync()` → `Rename()`；失败清临时文件 |
| 读回校验 | `Stat().Size()` 与写入长度不等就删掉并报错 |
| 路径安全 | 拒绝绝对路径、反斜杠、空段、`.`/`..`，且解析后必须仍在 `media/` 内 |
| 大小上限 | audio 64 MB / image 16 MB / ink 8 MB；kind 与 MIME 必须匹配 |

另外把 `SaveAttachment` / `ReadAttachment` 接成 Wails 服务方法（12 个方法），供后续界面使用；**界面入口本轮未接**。

## 二、双向对拍

| 方向 | 做法 | 结果 |
| --- | --- | --- |
| Go 写 → Rust 读 | Go 用 `media.Save` 写 256 字节（0–255 全值）到 fixture，Rust `read_media` 读回 | PASS，逐字节一致；`../relative.txt` 被拒 |
| Rust 写 → Go 读 | Rust `save_media` 写 `rust-cross-runtime-media`，Go `media.Read` 读回 | PASS |

Go 侧另有 2 项用例：往返一致性（含全 256 字节值）、路径穿越/类型 MIME/空与超限守卫，并断言写入后没有残留 `.part`。

### 一处过程错误

首版把 `use std::env;` 加在 Rust 的 `mod tests` 顶部但测试函数在另一个模块作用域，编译报 `cannot find module or crate env`。修法是把 import 放进实际使用它的测试函数里——不是加更多 import 碰运气。

## 三、还没做

- 界面里的附件选择/预览入口（服务方法已有，UI 未接）；
- 备份包里的附件恢复（`restore_media` 那条保持原路径的分支还没迁）；
- 大文件与真实麦克风录音；
- Windows / Linux 与 `.app` 签名。

## 四、下一步

继续按 ADR-0007：`backup`（含 `restore_media` 路径保持）→ `http/mail` → 向量部分 → `asr`。

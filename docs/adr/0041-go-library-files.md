# 第三十二刀：JSON 文件读写与卡片三代轮转迁到 Go

> 承接 ADR-0040（凭据）。凭据放哪已经定了，这一刀是**普通 JSON 文件**：
> 卡片轮转、设置、导入报告、搜索历史。

## 一、迁了什么

| 能力 | Go | 与 Rust 的关系 |
| --- | --- | --- |
| 读一组文件 | Read / ReadOptional | 不存在返回 nil 而不是错误 |
| 写卡片 | SaveCards | **三代轮转**：cards.json → backup → backup.2 |
| 写设置/报告/历史 | SaveSettings / SaveImportReport / SaveSearchHistory | 都走原子写 |
| 读导入报告 | ReadImportReport | 没有报告返回 nil，调用方显示「无报告」 |

## 二、三代轮转的顺序不能改

```
if backup 存在 {
    if backup2 存在 { 删除 backup2 }
    backup → backup2
}
if main 存在 { main → 备份成 backup }
原子写 main
```

两个细节：

1. **先删二代再推一代**：否则二代会被一代顶掉，误保存后只剩一版可回退；
2. **main 是「复制」成 backup，不是移走**：主文件在新内容写成功之前始终可用——
   写失败时用户手上还有上一版，而不是一个空文件。

## 三、验证

| 用例 | 内容 |
| --- | --- |
| Go 4 项 | 连存四次验证三代逐级推进与第四次顶掉二代；读缺失全部为 nil；设置/历史/报告往返；首次保存不产生备份、无残留临时文件 |
| Go 写 → Rust 读 | 通过：Rust `read_library` 读出 `go-v3/go-v2/go-v1` 与设置 |
| Rust 写 → Go 读 | 通过：Go `Read` 读出 `rust-v3/rust-v2/rust-v1` 与设置 |

轮转顺序是那种**两边各写各的都能自测通过**的逻辑——只有让对方读自己写的三代，
才能发现「一代和二代反了」这种不会报错的错。

## 四、还没做

| 项 | 现状 |
| --- | --- |
| `read_cards_json_text`（优先从 SQLite 导出） | 未迁，要 `db::list_cards` |
| 平台路径 `data_root()` | 未迁（含 QA/调试覆盖，与平台强相关） |
| Rust 侧凭据 0644 | 未修（ADR-0040 记录） |

**Go 版现在会读写这些 JSON 并与 Rust 三代轮转一致；但「从库里导出卡片」这条主路径还没接上。**

## 五、下一步

`db::list_cards` —— 它同时解锁「从资料库导出卡片」与 `read_cards_json_text`。

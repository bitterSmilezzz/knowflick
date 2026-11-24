# 第三十一刀：凭据文件层（路径规则、原子写、权限）迁到 Go

> 承接 ADR-0038/0039。归档与加密都有了，这一刀补**密钥放哪、怎么写**——
> 凭据放错或写坏，比备份打不开更难查。

## 一、迁了什么

| 能力 | Go | 与 Rust 的关系 |
| --- | --- | --- |
| 路径规则 | File / APIKey | 库名为 `store` 时凭据放**父目录**的 `credentials/`，否则放库目录内 |
| 读 | Read | 不存在返回空串而不是错误（还没配过是常态） |
| 写 | Write / WriteAPIKey | 建目录 + 原子写 + 收紧权限 |
| 原子写 | AtomicWrite | 临时文件 → Sync → Rename，不留半截 |

### 1.1 为什么 store 目录要特殊处理

库目录可能被整体替换或迁移。凭据跟着它一起没，用户看到的是
**「升级后所有密钥都没了」**，而且没有任何报错。所以库名为 `store` 时凭据落在父目录。

## 二、发现一处权限不对称（已统一，但记录原状）

实测 Rust 两侧行为不同：

| 文件 | Rust 写出的权限 |
| --- | --- |
| `apiKey.credential` | `-rw-------`（0600，`write_api_key` 显式 chmod） |
| `webdav.credential` | `-rw-r--r--`（0644，`write_named_credential` 只原子写、不设权限） |

证据来自本轮双向对拍的真实产物（`ls -lR` 直接列出）：Rust 写出的两个文件权限不同，
Go 写出的两个都是 0600、目录 0700。

**Go 侧统一收紧到 0600**——凭据就是凭据，两条路径不该一个严一个松，
这也与 mail 包的 0600/0700 口径一致。

这是一处**刻意的偏离**，不是照抄：Rust 侧我加了一条 `credential_write_permissions_asymmetric_in_rust`
把当前行为钉住（断言 webdav 现在是 0644），哪天 Rust 也收紧，这条会失败提醒我们该同步改文档。

## 三、验证

| 用例 | 内容 |
| --- | --- |
| Go 5 项 | store/非 store 两条路径规则；读缺失返回空串；写后 0600 文件 + 0700 目录 + 无 .tmp 残留；API key 走同一规则；原子写覆盖不留临时文件 |
| Go 写 → Rust 读 | 通过：`read_api_key` 与 `read_named_credential` 按同一条路径规则读到同样的值 |
| Rust 写 → Go 读 | 通过：apiKey 与 webdav 值一致，且 apiKey 不可被他人读 |

## 四、还没做

| 项 | 现状 |
| --- | --- |
| 从资料库导出（`read_cards_json_text`） | 未迁，要 `db::list_cards` |
| settings / search_history / import_report 的读写 | 未迁（规则与 cards 的原子写相同，属同一批） |
| 平台路径 `data_root()` | 未迁（含 QA/调试覆盖逻辑，与平台强相关） |
| Rust 侧统一 0600 | **未做**——本轮只改 Go，Rust 的 0644 仍在，靠上面那条测试记录 |

**Go 版现在能按同一规则读写凭据，且比 Rust 更严（0600）；但 Rust 侧的 0644 还没修。**

## 五、下一步

settings / search_history / import_report 的读写（同一套原子写规则），然后是 `db::list_cards`。

# 第二阶段第十一刀：邮箱账号表与去重账本（mail 第二批）迁到 Go

> 承接 ADR-0019。那一批只做配置校验与凭据；这一批把账号表、去重账本与同步游标迁过来。
> IMAP 会话本身仍未迁。

## 一、迁了什么

| 能力 | Go | 与 Rust 的关系 |
| --- | --- | --- |
| 表结构 | Open | 与 ensure_schema 逐条一致：mail_accounts / mail_imports / mail_rejected / mail_sync_state，含旧游标回填与部分索引 |
| 列账号 | ListAccounts | 按 created_at, id 排序；密码只说有没有 |
| 读账号 | GetAccount | 不存在返回 nil（不是错误） |
| 存账号 | SaveAccount | 空密码沿用已存；新账号或换 host/port/username 必须重输；换身份清空账本 |
| 删账号 | RemoveAccount | 删凭据与账号行，**保留**已导入素材与去重账本 |

## 二、两条容易做错的语义

### 2.1 换身份必须清空账本

IMAP 的 UID 只在同一个服务器、同一个文件夹、同一个 UIDVALIDITY 内唯一。
账号被改指到别的邮箱后，新邮箱可能复用同一对 (UIDVALIDITY, UID)，
旧账本会让**无关邮件被静默跳过**。所以 host / port / username / folder 任一变化都要清空
mail_imports、mail_rejected、mail_sync_state。

只改名字或同步间隔则**不动**账本——那不是换邮箱。

### 2.2 删账号不删账本

断开账号只删凭据与账号行。已导入的素材与账本保留：重新加回同一账号时不会重复导入，
「导入过什么」这段历史也不会凭空消失。

## 三、验证

| 用例 | 内容 |
| --- | --- |
| Go 4 项 | 存取往返与列表排序；空密码三种情形（新账号拒、同名沿用、换服务器拒）；换文件夹清空账本而改名不清；删账号保留账本并删凭据 |
| Go 写 → Rust 读 | Rust list_accounts 读出同一配置（名称/主机/端口/文件夹/封数）、has_password、rejected_count=1；Rust read_password 读回 Go 写的密码 |
| Rust 写 → Go 读 | Go ListAccounts 读出 Rust 写的账号配置与 sync_interval_minutes=0；Go ReadPassword 读回 Rust 写的密码 |

### 3.1 对拍抓到的两处

1. **Open 没建目录**：首次导出夹具时数据库打不开——Rust 的 open_db 会先 create_dir_all，Go 侧漏了。
2. **拒收统计口径**：Rust 的 rejected_count 按 (account_id, uid_validity) 关联，账号还没有 UIDVALIDITY 时统计必然为 0。
   夹具必须先把 UIDVALIDITY 写上，否则「Go 写了拒收记录、Rust 却数到 0」会被误判成 bug。
   这提醒一件事：**统计口径依赖关联键**，只看行数会得出错误结论。

## 四、还没做

| 项 | 现状 |
| --- | --- |
| IMAP 会话 | 完全没迁（只读约束、TLS 校验、超时预算都还在 Rust） |
| 邮件正文抽取与落素材 | 未迁 |
| 同步执行与进度 | 未迁 |
| 备份包里的邮箱数据 | 未迁 |
| 真实 IMAP 账号 | 一直未验 |

Go 版现在能存账号、能管凭据与账本，**仍然不能连邮箱、不能同步**。

## 五、下一步

IMAP 会话本身（最大一块，含只读约束与超时预算）。

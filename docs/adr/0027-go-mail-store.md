# 第二阶段第十八刀：同步存储层（去重账本）迁到 Go

> 承接 ADR-0026。上一批有完整的同步编排但缺 Store 实现，这一批补上，编排因此可以真正落库。

## 一、迁了什么

| 能力 | Go | 与 Rust 的关系 |
| --- | --- | --- |
| 读游标 | LoadCursor | UIDVALIDITY / last_uid / history_before；用 NullInt64 接可空列 |
| 对齐 bootstrap | AlignBootstrap | last_uid = boundary-1：边界那封还没处理，处理完自然会抬到它 |
| 已处理判定 | KnownUID | Retry 模式**不**把拒收当已处理——那正是要重试的对象 |
| 记拒收 | RecordRejected | 同键覆盖，保留最新原因 |
| 记导入 | RecordImported | 写账本 + **清掉该 UID 的拒收记录** |
| 同信去重 | ExistingMaterial | 按 Message-ID 查已有素材 |
| 推进游标 | AdvanceCursor | New 取 MAX、History 取 MIN、Retry 不动 |
| 完成/失败 | Finish / Fail / MarkAttempt | Finish 清空 last_error（写成 NULL） |

`var _ mailsync.Store = (*Store)(nil)` 让「接口实现完整」由编译器保证，而不是靠人眼核对。

## 二、游标为什么要单调

`AdvanceCursor` 用 `MAX(last_uid, uid)` 与 `MIN(history_before, uid)`，而不是直接赋值。

原因：处理是逐封提交的。如果中途重放、乱序，或某次给了更旧的 UID，直接赋值会让游标**倒退**——倒退意味着已经处理过的邮件会被再处理一遍，或者更糟：`history_before` 往上抬，边界越过未处理的邮件，那些邮件永久跳过且无报错。

对拍里专门测了这两条：给 New 一个更小的 UID（游标保持 150）、给 History 一个更大的 UID（边界保持 80）。

## 三、一个测试暴露的语义

`Finish` 之后我原本用 `string` 接 `last_error`，测试报 `converting NULL to string is unsupported`。

这不是 bug——**清空就是写成 NULL**，与 Rust 的 `last_error=NULL` 一致。测试改成 `sql.NullString` 并断言 `Valid == false`。

如果把「清空」实现成写空字符串，`last_error IS NULL` 的查询就查不到它，界面上会出现「明明没错误却显示上一次的错误」这类怪现象。

## 四、验证

| 用例 | 内容 |
| --- | --- |
| Go 7 项 | bootstrap 对齐；游标单调（New 不倒退、History 不上抬）；Retry 模式拒收不算已处理；导入后清拒收；同 Message-ID 跨 UID 复用素材且账本保留两行；Finish/Fail 与 last_error 置 NULL |
| 跨运行时对拍 | Rust `go_mail_ledger_parity` 读 Go 写的账本：UIDVALIDITY=7、last_uid=99（推进到 42 后仍 99）、去重引用 `mail-ledger`、拒收原因一致、同一条去重 SQL 查到同一素材 |

## 五、还没做

| 项 | 现状 |
| --- | --- |
| 接线 | **未做**。imap + mimex + mailimport + mailsync + mailstore 五个包都齐了，但没有一个把它们组装成可运行的同步入口 |
| 自动同步调度 | 未迁（sync_interval_minutes 到点触发） |
| 并发保护 | 未迁（Rust 用 ACCOUNT_LOCK 串行化） |
| 真实邮箱 | 未验 |

**Go 版现在五个包都齐了，但还不能跑一次真实同步**——缺接线。

## 六、下一步

接线：把 imap 的会话、mimex 的解析、mailimport 的映射写库、mailsync 的编排、mailstore 的账本组装成一条可执行的同步入口。

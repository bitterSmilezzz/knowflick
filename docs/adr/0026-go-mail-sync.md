# 第二阶段第十七刀：邮件同步编排迁到 Go

> 承接 ADR-0025。上一批能把一封邮件写进库；这一批是「跑一轮同步」这件事本身。

## 一、迁了什么

| 能力 | Go | 与 Rust 的关系 |
| --- | --- | --- |
| 三种模式 | ModeNew / ModeHistory / ModeRetry | 与 SyncMode 一一对应 |
| bootstrap | PlanSync | 库里没有 UIDVALIDITY 或不一致、或没有 history_before 时，先把游标对齐到「最近 N 封」边界，再按 New 处理 |
| 处理方向 | OrderForProcessing | New 升序（安全抬高 last_uid），History 降序（安全下移 history_before） |
| 单封隔离 | processUID | 超大或 MIME 坏了记进拒收并推进游标，**不让一封毁掉整轮** |
| 完成判定 | runInner 末尾 | 边界 <= 1 视为完成；否则再搜 1 封，识别空洞与被删 UID |
| 失败留痕 | Run | 出错先写 last_error 再返回，界面上能看到「上次为什么没成」 |

依赖以接口注入（`Fetcher` / `Store` / `Importer`），所以编排逻辑可以脱离网络与数据库测试。

## 二、为什么方向这件事值得单独对拍

游标是**单向推进**的。如果 History 用升序处理，每提交一封就把 `history_before` 往上抬——边界越过还没处理的邮件，那些邮件就永久跳过了，而且**不会有任何报错**。

所以对拍断言的是**处理顺序**（`history:12,history:11,history:10`），不是「取了这三个 UID」。

## 三、验证

| 用例 | 内容 |
| --- | --- |
| Go 8 项 | bootstrap 对齐（validity 写入、last_uid=boundary-1、按 New 处理）；History 降序；边界 <= 1 短路且不白跑搜索；超大与 MIME 坏各记一次拒收而其余照常导入；失败写 last_error；Retry 用拒收列表；已处理过的跳过 |
| 跨运行时对拍 | Rust `go_mail_sync_parity` 比对同一组响应的处理顺序与三项计数，**逐项一致** |

## 四、还没做

| 项 | 现状 |
| --- | --- |
| Store 的 SQL 实现 | **未迁**。接口定义好了，接 SQLite 的实现还没写（去重账本读写也在里面） |
| 与 IMAP 会话接线 | 未接。`Fetcher` 已由 imap 包提供大部分能力，但还没组装成可运行的同步入口 |
| 自动同步调度 | 未迁（sync_interval_minutes 到点触发那部分） |
| 并发保护 | 未迁（Rust 用 ACCOUNT_LOCK 串行化所有邮箱操作） |
| 真实邮箱 | 未验 |

**Go 版现在有完整的同步编排逻辑并已对拍，但还跑不起来**——缺 Store 的 SQL 实现与接线。

## 五、下一步

Store 的 SQLite 实现（含去重账本），然后把 imap + mimex + mailimport + mailsync 接成一条可执行的同步。

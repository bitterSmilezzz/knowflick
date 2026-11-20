# 第二阶段第十九刀：把五个包接成一条可执行的同步

> 承接 ADR-0027。imap / mimex / mailimport / mailsync / mailstore 五个包都齐了但没接线，这一批接线。

## 一、接线层做了什么

`mailrunner` 只做接线，不重复实现规则：

| 步骤 | 交给谁 |
| --- | --- |
| 建立 TLS 连接 | imap.Connect |
| 登录并只读打开文件夹 | imap.Session.LoginAndExamine |
| 决定这一轮取哪些 UID | mailsync.PlanSync |
| 逐封取信 | imap.Session.Fetch |
| 解析 MIME | mimex.Parse |
| 映射成素材 | mailimport.FromMail |
| 写库 | mailimport.SaveMaterial |
| 账本与游标 | mailstore |

接线层自己只负责「按什么顺序调用它们」。

## 二、一个必要的接口补齐

`mailsync` 需要知道当前 UIDVALIDITY（判断库里的游标还能不能用），但 imap 的会话原本没把它留下来。补上 `storedValidity` 字段与 `UIDValidity()` 方法。

这条不是为了让接口好看：**没有它，同步无法判断游标是否还有效**，UIDVALIDITY 变了却沿用旧游标会导致整批邮件被误判为「已处理」。

## 三、测试用的 TLS 根证书注入

端到端测试要连本地服务器，而本地服务器只能用自签名证书。第一版直接失败：`邮件 TLS 握手或证书校验失败`——**这是正确行为**。

解法是 `ConnectWithRoots(host, port, roots)`：生产调用 `Connect` 不传 roots（走系统根 + 主机名校验），测试传一个只含测试证书的池子。

关键是**没有「跳过校验」的开关**：客户端仍然完整校验证书链与主机名，只是信任锚多了一个。

验证方式：`TestConnectVerifiesCertificates` 仍然通过——不注入 roots 时自签名证书照样被拒。

## 四、验证

| 用例 | 内容 |
| --- | --- |
| 端到端 | 起一个最小 IMAP 服务器（TLS + LOGIN/EXAMINE/UID SEARCH/UID FETCH），跑完整同步：2 封邮件全部导入、素材标题与正文正确、账本 2 行、游标推进到 4 |
| 前置校验 | 没有密码时明确报错，不尝试连接 |
| TLS 未削弱 | `TestConnectVerifiesCertificates` 仍通过（不注入 roots 时自签名被拒） |

## 五、还没做

| 项 | 现状 |
| --- | --- |
| 自动同步调度 | 未迁（sync_interval_minutes 到点触发） |
| 并发保护 | 未迁（Rust 用 ACCOUNT_LOCK 串行化所有邮箱操作） |
| 与 UI 接线 | 未做。Go 预览界面还没有邮箱入口 |
| 真实邮箱 | **未验**。端到端用的是本地假服务器 |
| 备份包里的邮箱数据 | 未迁 |

**Go 版现在能对着一台真实 IMAP 服务器跑完整同步**，但只在假服务器上验证过，且没有调度、并发保护与界面入口。

## 六、下一步

自动同步调度与并发保护；然后是 Go 预览界面的邮箱入口。

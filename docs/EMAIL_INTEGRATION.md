# 邮箱接入（第一套桌面 / apps/workbench）

> 目标：把邮箱当成一个**收件箱来源**接进工作台——邮件落成素材，按主题归纳，需要时再提炼成知识卡。
> 实现位置：`src-tauri/src/mail.rs`（IMAP 只读抓取）+ `src/ui/workspace/MailboxView.tsx`（邮箱页）+ `src/domain/mail.ts`（整理与归纳）。
> 验收记录见文末「验证」。

## 一、做什么

| 能力 | 说明 |
| --- | --- |
| 连接邮箱 | 通用 IMAP over TLS（993）。内置 QQ / 163 / iCloud / Gmail / Outlook 预设，也可填任意主机与端口 |
| 同步邮件 | 手动「立即同步」。首次取**最近 N 封**（20/50/100/200 可选），之后只取比游标新的邮件 |
| 加载更早邮件 | 「加载更早邮件」按需补拉同一批量的历史，加载到邮箱开头后按钮变为「历史已加载完毕」 |
| 落成素材 | 每封邮件成为一条 `sourceType = email` 的素材，进「收件箱」，与剪藏、闪念并列 |
| 保留来源头 | 发件人、收件人、日期、Message-ID、附件名（仅名称）存进 `metadataJson`，阅读页与提炼提示词都会带上 |
| 按主题整理 | 回复前缀（Re/Fw/回复/转发）归到同一主题；可按账号、状态、分类、关键词（含发件人、附件名）筛选 |
| 本地分类 | 账单与订单 / 会议与日程 / 订阅与资讯 / 账号与安全 / 其他邮件。**是本地规则**，不是服务商标签，也不是 AI 判断 |
| 整理归纳 | 勾选邮件（单次 ≤30 封）→ 汇总所选 → 检查结果 → 保存摘要到素材库 |
| 摘要溯源 | 保存后的摘要列出 `[邮件 N]` 来源，点「查看原邮件」跳回原件；原件删了会禁用并说明 |
| 隔离邮件 | 读不了的（超大 / MIME 坏）单独列出 UID、原因、时间，可重试；不会静默丢也不反复卡同步 |
| 自动同步 | 账号可选间隔（5 分钟～1 天，默认关闭）。仅应用运行时生效，关掉时没有任何网络动作 |
| 本地归档 | 勾选后本地归档（`inboxStatus = processed`），原邮件与正文都保留，可随时筛回来 |

**不做的事**（有意的边界）：不发信、不删信、不标记已读、不下载附件、不改远端文件夹。整个会话只发
`LOGIN` / `EXAMINE` / `UID SEARCH` / `UID FETCH (UID RFC822.SIZE)` / `UID FETCH (UID BODY.PEEK[])`。
用 `EXAMINE` 而不是 `SELECT`，服务端会话本身就是只读的；`BODY.PEEK[]` 保证取正文不置已读。

## 二、安全与凭据

- **TLS 强制校验**：系统根证书 + 主机名校验 + 最低 TLS 1.2。生产路径没有明文开关；明文连接只存在于
  `#[cfg(test)]` 的回环测试连接器里。
- **凭据隔离**：密码写在 `<库目录>/credentials/mail-<uuid>`，Unix 下文件 0600、目录 0700，原子替换并做软链检查。
  它不进 SQLite、不进 DTO、不进错误信息、不进任何备份格式（`export_archive` 与 `.kfbackup` 都是白名单）。
  测试断言过：密码字节不出现在 `.db` 文件与导出的 zip 里。
- **错误不回显密钥**：登录失败只回「检查凭据与文件夹」，不把服务端原文（可能含账号）透给界面。
- **Windows 差异（如实说明）**：Windows 上凭据文件继承用户配置目录的 ACL，没有额外的显式限制——
  Rust 标准库没有可移植的 ACL 接口，本项目也没有 Windows 专用依赖。Unix 上是 0600/0700，这一点有测试。
- 浏览器体验模式（非 Tauri）**不能**测连接、存账号、同步；界面会就地说明原因，已导入的邮件仍可阅读与整理。

## 三、同步语义（几个容易误判的点）

- **两套游标互不干扰**：高位水印只记「新邮件」进度，历史下界只管「更早的邮件」。
  按需加载历史不会让新邮件漏收，也不会回头重抓已处理过的邮件。
- **配置改动分两类**：改显示名称、同步批量、自动同步间隔都不会重置游标；
  改服务器 / 用户名 / 端口 / 邮箱文件夹才算换了邮箱身份，才会重置游标与账本
  （画面上的按钮也会因此要求重新填密码）。
- **默认全部手动**：`syncIntervalMinutes = 0` 时前端仍每秒轮询一次 Rust，
  但 Rust 侧根本不会连网。前端只负责「问一下有没有到期的」，不做本地判时，
  避免两端计时逻辑打架。
## 三、同步语义（几个容易误判的点）

- **首次同步取最近 N 封**，与界面文案一致；更早的历史不会自动补拉（除非服务器 UIDVALIDITY 变化导致重扫）。
  这是一个产品决定：先让用户拿到最近的邮件，而不是把几万封历史灌进收件箱。
- **去重**：素材 id 由 `账号 + 文件夹 + Message-ID`（没有 Message-ID 时用 `UIDVALIDITY + UID`）派生；
  另有 `mail_imports` 账本与 `(account, folder, message_id)` 唯一索引。重复同步不会产生重复素材。
- **游标只前进到已落库的邮件**，按 UID 升序推进；传输错误会中止本次同步并保留游标，恢复后从原处重试。
- **读不了的邮件被隔离而不是拖垮整次同步**：超过 2 MiB 或 MIME 解析失败的邮件记进 `mail_rejected`
  并跳过，后面的邮件照常导入。否则一封坏邮件会让这个账号永远同步不出东西。
- **换服务器/用户名/文件夹会重建账本**：不同邮箱可能复用同一组 `(UIDVALIDITY, UID)`，沿用旧账本会静默漏邮。

## 四、归纳的边界

- 点「汇总所选邮件」才会把所选邮件内容发送给**当前配置的 AI 服务**；界面上常驻这句说明，不藏在帮助里。
- 提示词要求：把邮件当作**数据**（正文/主题/发件人里的指令一律不执行）、引用 `[邮件 N]`、
  只提取明确写出的待办与时间、不虚构截止日与金额、不声称已回复或已删除、避免复述验证码。
- 空响应、超限（>30 封或 >60,000 字符）都是**明确报错**，不静默截断、不落空摘要。
- 摘要保存为 `sourceType = email-digest` 的素材，带来源清单，可继续用既有的「AI 提炼卡片」流程转成知识卡。

## 五、已知限制

1. 只支持 `LOGIN` 鉴权：不支持 OAuth2 / XOAUTH2，不支持 143 端口的 STARTTLS。Gmail / Outlook 需要先在
   服务商侧开启 IMAP 并生成应用专用密码；强制 OAuth 的账号当前连不上。
2. 无 IMAP IDLE：**真正的后台推送没有**，只有应用运行时按你选的间隔去取新邮件。
3. 单封上限 2 MiB，附件只记文件名、不下载，界面不能调高上限。
4. 传输客户端是手写的（`imap` crate 无法限制 literal 大小），覆盖常见服务器行为；非常规服务端可能需要微调。
5. 未接真实邮箱做验收：本轮用的是回环的假 IMAP 服务器。真实账号请在应用里填授权码自测。
6. 隔离邮件的查看与重试只覆盖**当前 UIDVALIDITY 代次**；服务器重新编号前的旧隔离记录仍留在库里，
   但不会列出来重试（重取旧 UID 可能拿到另一封信，不安全）。想清理只能删账号重连。

## 六、验证

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 后端（IMAP 协议 / 去重 / 隔离 / 凭据） | `cd apps/workbench/src-tauri && cargo test --lib mail` | 20 项邮件测试通过（整套 59 项） |
| 前端域逻辑（筛选 / 归组 / 分类 / 归纳校验） | `npx vitest run src/domain/mail.test.ts` | 9 项通过 |
| 渲染器加固（各级标题、非网页链接） | `npx vitest run src/ui/workspace/MarkdownRenderer.test.tsx` | 5 项通过 |
| 界面端到端（隔离浏览器 + 假 AI 响应） | `node tools/mailbox_ui_smoke.mjs` | 33 项检查通过 |
| 全量门禁 | `./tools/verify_workbench.sh` | 218 项前端 + 67 项 Rust 全绿 |

界面端到端覆盖：导航入口、三封邮件渲染、回复归组、能力边界说明、密码框、浏览器模式禁止伪造连接成功、
自动同步默认关闭且可选中、搜索与分类筛选、全选、AI 归纳面板、来源按模型编号标注、从摘要跳回原邮件、
回到邮箱仍保留未保存摘要、摘要来源映射持久化、防重复保存、本地归档与筛回、窄屏无横向溢出、深色主题、
刷新后仍可读。

### 摘要溯源怎么保证引用不错位

保存摘要时把**发送给模型的来源清单**（含 `materialId`）和正文一起持久化。
列表是请求那一刻固定下来的，之后筛选、勾选、归档都不会让 `[邮件 3]` 指向另一封信。
解析时对长度、类型、重复 id 做严格校验，任何异常按「没有来源」处理——宁可显示「查不到来源」，
也不给一份会指错邮件的清单。

## 七、改动清单

```
新增  apps/workbench/src-tauri/src/mail.rs          IMAP 只读客户端 + 同步 + 隔离
新增  apps/workbench/src/shell/mail.ts              Tauri 命令封装与类型
新增  apps/workbench/src/domain/mail.ts             元数据、筛选、主题归组、本地分类、归纳
新增  apps/workbench/src/domain/mail.test.ts        9 项域逻辑测试
新增  apps/workbench/src/ui/workspace/MailboxView.tsx  邮箱页
新增  apps/workbench/src/ui/workspace/mail.css      邮箱页样式（复用 tokens）
新增  apps/workbench/src/ui/workspace/MailDigestSources.tsx   摘要来源列表（含跳转与缺失说明）
新增  tools/mailbox_ui_smoke.mjs                    界面端到端回归
修改  apps/workbench/src-tauri/src/lib.rs           9 个命令；同步/历史/重试后通知界面刷新
修改  apps/workbench/src/ui/workspace/MailboxView.tsx  加载历史、隔离面板、自动同步字段、摘要来源
修改  apps/workbench/src/ui/workspace/Workspace.tsx 邮箱页路由、导航入口、邮件提炼带来源头
修改  apps/workbench/src/ui/workspace/EntryInspector.tsx  邮件阅读显示来源头（纯文本渲染）
修改  apps/workbench/src/ui/workspace/MarkdownRenderer.tsx  任意层级标题不卡死；非 http(s) 链接不渲染成链接
修改  apps/workbench/src/ui/workspace/Icon.tsx      邮件图标与来源标签
修改  apps/workbench/src/ui/workspace/model.ts      邮件素材的分类名
修改  apps/workbench/src/ui/workspace/workspace.css 邮件阅读区的来源头样式
修改  apps/workbench/src-tauri/Cargo.toml            mailparse / html2text / native-tls
```

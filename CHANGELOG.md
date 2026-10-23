# 更新日志 (Changelog)

本项目所有重要版本更新均记录在此文档中。

格式规范参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，并遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

排序：按发布日期倒序，同一天的条目按端相邻排列。mac 与 android 是两条独立版本序列，版本号不跨端比较大小（规则见 [多端协作规范](docs/MULTI_PLATFORM.md)）。

## [Unreleased]

- 修复（收件箱里写着英文的 "note"）：素材的 `source_type` 决定界面上的来源标签，`META` 表里没有的类型会**原样显示英文内部名**。MCP 的 `add_material` 在没有链接时写 `source_type = "note"`，于是用户通过 Cursor 存进来的素材来源写着英文的 "note"——而应用内闪念写的是 `manual`（显示「随手灵感」），**同一个概念三种写法**。两条 MCP 路径改写 `manual`，`META` 补登 `note` 作旧数据兼容，并加守卫 `tools/check_source_labels.py`（扫代码找出所有会被写进的 `source_type`，逐个要求有中文标签——手写清单会漏，扫描不会）。
- 修复（断言「绿」不等于「在守东西」——这次是自己的新测试）：vitest 的 `expect(actual, message)` 后面**不接 matcher 时什么都不检查**，测试照样绿。写来源标签那条断言时漏了 `.toBe(true)`，于是「标签是英文 note」这个真实缺陷绿着过了。新增守卫 `tools/check_test_assertions.py`：所有 `expect(...)` 后面都必须带 matcher。
- 修复（外部 Agent 搜不到素材——同一份库，两个入口看到的不一样）：`search_knowledge` 只查 `fts_cards`，于是外部 Agent 问「上周那封讲 X 的邮件说了什么」搜不到，而用户在应用里搜得到——同一份知识库、不同入口看到的不一样，就不算统一记忆库。新增 `search_materials` 工具与 `knowflick://materials/{id}` 资源（读回正文全文与出处），命中结果带 `resourceUri`，片段截**命中处附近**而不是开头（长邮件命中在末尾时，原来给的是毫不相干的开场白）。素材检索判定以**当前素材内容**为准而非 FTS 索引（索引可能缺也可能旧，而 MCP 服务端不依赖桌面端启动跑 backfill），多词按「每个词都要出现」判定。`add_material` 同步 `fts_materials` 索引——否则 Agent 写进来的东西在应用里搜不到。
- 修复（收件箱里一直写着 "(No subject)"）：邮件同步进收件箱时，无主题的邮件落成 `"(No subject)"`、无正文的落成 `"(No readable text body)"`——收件箱条目**直接渲染** `e.title`，所以用户看到的就是这两个英文串。内容和错误消息的区别很关键：错误只在出错时出现，**内容是常态**。已改成中文并加 Rust 测试锁住（反向验证过），另加守卫 `tools/check_user_facing_content.py` 扫会落进用户数据的字段。
- 修复（半中半英：中文前缀后面跟着底层英文报错）：Rust 里 20 处 `format!("…{e}")` 直接把底层库（std/reqwest）的英文报错拼进用户可见的消息——「下载模型失败: error sending request for url …」。用户看懂了「下载模型失败」但不知道**为什么**、更不知道**下一步**。新增 `src-tauri/src/error_text.rs`，按关键词给出「原因 + 下一步」（连不上服务器 / 磁盘满 / 权限不足 / 证书问题…），原始英文保留在括号里供开发者定位。守卫加了一条：`format!("…{e}…")` 直接拼底层错误即算漏网（它自己抓出了我漏掉的 4 处）。
- 修复（前端把错误原样交给用户——14 处）：`setError(String(err))` 一点中文都没有，用户看到的是底层库抛的原始字符串，分散在 10 个文件 14 处。新增共享兜底 `apps/workbench/src/ui/workspace/userError.ts`（空错误/纯英文/中文三种情况都有中文说法），14 处全部改走它，并加守卫 `tools/check_frontend_error_text.py`。
- 修复（英文错误不直接透给用户）：`MailboxView` 的 `errorText()` 只做密钥脱敏、不翻译——Rust 侧就算全是中文，**万一**还有英文漏网也会原样显示。现在加一道兜底：消息里没有中文就换成「操作未完成：…（这是底层错误，请把这句话反馈给开发者）」，原始信息保留给开发者定位。已加 5 项前端测试并反向验证。
- 修复（Windows CI 上新测试自己先崩了）：`test_windows_console.py` 用 `subprocess(text=True)` 读子进程输出——Windows 上子进程输出是本地编码的字节，Python 按 cp1252 解，遇到中文抛 `UnicodeDecodeError`，测试自己先崩。改成收 bytes 再按 UTF-8 解（解不动退回 replace）。
- 修复（同一个 cp1252 坑踩了两次）：新加的检查脚本在 Windows CI 上又报 `UnicodeEncodeError`——根因是「每个脚本自己写一份 print 防护」，新脚本总会忘。抽成共享模块 `tools/windows_console.py`（`emit()`），三个检查脚本统一从它导入；再加一条回归 `tools/test_windows_console.py`，**所有会打印中文的检查脚本都必须在 cp1252 控制台下跑通**（本机用 `io.TextIOWrapper(encoding="cp1252")` 模拟，不用等 CI）。
- 修复（28 条英文错误直接显示给用户）：邮件模块里 24 条校验错误是英文的（`Invalid account email`、`Enter the password again when changing server or username`、`Mail server rejected the request` 等），前端的 `errorText()` 只做密钥脱敏、**不翻译**，于是英文原样显示——用户既看不懂也不知道下一步该做什么。全部改成中文并说清怎么办（不只是翻译字面）；另有 `http.rs` 3 条、`media.rs` 1 条，以及一条 `format!("Invalid account {field}")`（字段名本身也是英文）一并改掉。加守卫 `tools/check_rust_error_messages.py`（扫 `Err`/`anyhow!`/`bail!`/`format!` 里不含中文的消息），已进门禁与 CI，已反向验证。
- 修复（Windows CI 上新检查直接打红）：`check_tauri_permissions.py` 直接 print 中文，Windows 控制台默认 cp1252 → `UnicodeEncodeError` → 门禁红。改成按 UTF-8 写字节（与 `check_doc_consistency.py` 同一套做法），并在 cp1252 控制台下实测通过。
- 修复（整个邮箱功能在桌面端是坏的）：Tauri v2 的自定义命令要在三处对上号——`invoke_handler` 注册、`build.rs` 的 `AppManifest` 声明（决定生成哪些权限文件）、`capabilities/*.json` 授权。`build.rs` 只列了 46 个而注册了 59 个，差的 13 个正好是 **9 个 `mail_*`（整个邮箱功能）** + 语音附件读写 + 删产物 + 新加的 `db_library_signature`。没进 build.rs → 没有权限文件 → capability 里授权不了 → 前端调用被 ACL 拒绝，界面上冒英文的「! Command mail_list_accounts not allowed by ACL」。**浏览器冒烟测不到**（浏览器模式不走 Tauri），CI 与打包全绿，只有真机上用到邮箱才炸。已补齐三处，并加守卫 `tools/check_tauri_permissions.py` 静态核对一致性（已进门禁与 desktop CI），已反向验证。
- 修复（真机验证工具从来没跑起来过）：`real_app_pages.mjs` 的锁屏判据是 `raw.includes("ConsoleLocked")`——只看**键名**存在，而 `IOConsoleLocked` 键一直都在（值为 false 时表示没锁），于是**任何时候**都判成「锁屏」→ 永远 SKIP 且理由还是错的。改为按**值**判断后，真机逐页验证第一次真正跑起来（5 项全过）。另外「窗口不在屏幕」的真正原因是它不在当前 Space，要 `AXRaise` 才拽得过来。
- 修复（像素比对恒真，端到端断言是假通过）：真机像素比对原来用「整屏截图指纹变了」当「页面切换了」，把判定逻辑整个废掉也照样通过——整屏里有个浏览器一直在流式输出。改为只截窗口区域、且先**自证可信**：标题栏要有 KnowFlick 的红黄绿交通灯（新增 `tools/knowflick_window_probe.mjs`，纯 JS 解 PNG）、什么都不做时指纹必须稳定、且要对准会变的那一页（卡库页而不是收件箱页）、基线必须在写入之前采。修完后端到端真的通了（7 项）：外部 Agent 写卡 → 界面自动刷新，不用切页也不用重启。已反向验证（废掉刷新逻辑 → 断言立刻报「界面没有自动刷新」）。
- 补充验证（MCP 的五个工具逐个对着应用真正用的库验过）：`create_flash_card` 写入后 `version=1`/`is_deleted=0` 且 FTS 索引同步、用应用自己的中文前缀匹配式能搜到；`add_material` 写进 `materials` 表且 `inbox_status='inbox'`——它那句「已加入收件箱」是真的。此前 `mcp_smoke.mjs` 只检查了 `add_material` 存在，没真调过它。
- 修复（外部 Agent 写了卡，界面却看不见）：MCP server 是独立进程、直接写 SQLite，而界面只听两个信号——本应用命令派发的 DOM 事件与浏览器 localStorage 的 storage 事件——**两个都覆盖不到外部写入**，代码里也没有文件监听器（而 MCP server 的文档却写着「主窗口收到文件监听后自动刷新」，那套监听并不存在）。现在轮询库文件签名（修改时间+大小），变了就派发**已有的** `knowflick:library-changed`，复用现成刷新路径。Rust 与前端两侧都有测试，均已反向验证。真机端到端验证因本机窗口不在屏幕上（别的 Space）尚未完成，已如实记在 `SMOOTHNESS.md`；配套的 `tools/desktop_external_write_smoke.mjs` 会先用 `CGWindowList` 确认窗口在屏幕上、再自证截图指纹可信（什么都不写时指纹必须稳定），不满足就 SKIP——因为「截图指纹变了」根本不能证明界面刷新了（不做任何写入时指纹也一直在变）。它列在 `run_all_smokes.sh` 的 `DESKTOP_ONLY_SUITES`（真机专有，CI 与浏览器冒烟没有这个条件）。
- 修复（不可用的入口看起来还是可用的）：`aria-disabled` 没有浏览器的默认灰化（那来自 `:disabled`），实测「转写」的颜色与可用的「手写」完全相同、opacity 都是 1——看起来完全可用。补了 `aria-disabled` 的样式与悬停排除，并加断言锁住「不可用的入口必须比可用的淡」，已反向验证。
- 修复（灰掉的入口没人知道为什么）：语音转写插件默认关闭，顶栏「语音转写」与侧栏「转写」用 `disabled` + `title`，而**禁用按钮不接收焦点、不派发鼠标事件**——键盘用户 Tab 不到（实测 14 个控件里从没出现过它）、鼠标点了没反应，连 title 都看不到，界面上就多出一个没人知道为什么灰掉的入口。改用 `aria-disabled`：仍可聚焦，激活时说清原因与下一步（去设置里开启插件），焦点不丢。门禁断言改为锁行为（不可用 / 键盘可达 / 激活后解释），已反向验证。
- 修复（4 条证据指向实现文件，守不住任何东西）：证据表里「Embedding 错误回显密钥」「数据库损坏报错」「统计页没有入口」等 4 条登记指向的是实现文件，而守卫对实现文件只查「文件存在 + 标识在文件里」——那些标识只出现在实现里、任何测试里都没有，于是这 4 条检查永远不可能失败。当时缺陷确实有测试（Rust 的 `corrupt_db_is_reported_not_silently_recreated`、前端 `store.redact.test.ts`、界面冒烟的 `[data-page="stats"]`），只是登记表指错了地方。已改指真正断言行为的测试并加回归锁住。
- 修复（守卫自己会骗自己）：上一轮给「证据在 CI 上真会跑」加的判据用全文 grep，于是「把套件从执行列表删掉、只在注释里留个名字」和「路径写成 `- 'x'  # 备注`」两种改法都能让守卫报绿，而 CI 上其实已经不跑。改为结构化读取 `SUITES=(...)` 数组、容忍行尾注释，并把两处重复的路径解析抽成共享模块 `tools/workflow_paths.py`。新增 30 项回归（守卫 13 / 解析 11 / 触发 6），都做过反向验证。
- 修复（19 条界面回归证据在 CI 上是空转的）：证据守卫只检查浏览器冒烟**在不在本地列表里**，而 `run_all_smokes.sh` 缺 agent-browser 时 SKIP 并 exit 0——CI 上正好缺它，于是 19 条证据一条断言都不产生却仍算「已覆盖」（测验入口、统计页、AI 出卡链路、.eml 导入、复习闭环、产物可见性等）。现在 `workbench.yml` 新增 `browser-smokes` job，装 agent-browser 与浏览器二进制、起 Vite、逐套跑完 13 套；守卫改为核对「这套冒烟在不在 CI 的浏览器冒烟里」。反向验证过。
- 修复（CI 触发遗漏）：`tools/mcp-server.mjs`（MCP server 实现，被 smoke spawn 并断言）与 `.github/workflows/android.yml`（守卫的判断依据）都不在任何 workflow 的 paths 里——改它们不会触发 CI，证据被改弱时无人察觉。已补进 paths 并加守卫。
- 修复（Desktop CI 触发遗漏）：共享持久化模块虽已纳入桌面依赖与测试命令，却未纳入 push / PR 路径过滤。补齐 shared-data、根 Gradle 配置、wrapper、共享资产与图标、CI 切源脚本的触发路径；新增变更路径回归检查，在三平台构建前执行，保留 Android 专属页面不触发冻结桌面的边界。

- 修复（手写/语音面板键盘不可达）：这两个面板是手写 div，没接原生 `<dialog>` 的焦点陷阱与 Escape——实测打开后连按 12 次 Tab 焦点始终在侧栏，面板内按钮全部键盘不可达、Escape 也关不掉。新增 `useModalFocus`：打开时焦点移进面板、Tab 在面板内循环（模态遮住了底层，不循环会走到看不见的地方）、Escape 关闭、关闭后焦点归位。门禁新增对应断言并做了反向验证。
- 修复（Windows 档静默少跑）：Windows runner 默认 shell 是 PowerShell，`.sh` 脚本在它里面**既不报错也不执行**——步骤照样绿，wrapper 改写根本没发生，CI 继续用国内镜像。加 `shell: bash`；脚本每次都打印切换结果，靠这条日志才发现。
- 修复（CI 的 Gradle wrapper 一直撞国内镜像）：依赖源已按 `CI` 环境分流（官方源 / 本地阿里云镜像），但 wrapper 的 `distributionUrl` 是硬编码的，Gradle 不支持在那里读环境变量——唯独这一处没分流，CI runner 在美国却去撞国内镜像，2026-10-23 真因此挂过一次（镜像字节与官方校验和不符）。新增 `tools/ci_gradle_official_source.sh`，在 CI 里改写下载地址而**保持校验和不变**，完整性仍由 wrapper 保证。
- 修复（被告知「请用桌面客户端」却没地方去）：浏览器体验里录音落盘、导出 cards.json、全局快捷键、托盘、ASR 等都写着「桌面客户端可用」，但界面**没有一处给出路**——用户被卡住时看到的是一句指路的话，却不知道桌面客户端在哪。新增 `DesktopOnlyHint`：浏览器体验下给出可点的「下载桌面客户端」（指向公开仓库 Releases），桌面端不显示（本来就能用）。已接到录音保存失败与设置页两处。
- 测试（手写重绘）：手写笔记保存后阅读区到底画没画出笔迹，此前**一次都没被执行过**——存了却画不出来的话，用户看到的是空白画布，手写笔记等于白存。判据用像素（canvas 上必须有非透明像素），已反向验证。
- 测试（附件读回）：附件链路此前只验了 Rust 侧与库表往返，**前端「字节读回来原样变成 Blob」这一环从来没被执行过**——`EntryInspector` 的测试用服务端渲染，不跑 `useEffect`。把这段逻辑抽成纯函数（`ui/workspace/attachment.ts`）并补 7 项测试，四条断言都反向验证过。
- 测试（浏览器录音组件）：语音冒烟此前只验到「面板打开 / 准备录音 / 没有录音时不能保存」，**录音流程本身从未跑过**。现用 Chrome 的**合成麦克风输入**（`--use-fake-device-for-media-stream`）在无硬件、无麦克风权限的机器上跑完「开始录音 → 计时前进 → 停止 → 录音完成 → 可回放 → 可保存」；并用浏览器解码器确认录到的字节**能解出真实时长与采样率**（非零字节也可能损坏）。反向验证过：去掉合成输入参数、或把字节换成损坏数据，断言都会失败。**这只证明浏览器录音组件可用，不等于物理麦克风与桌面保存已验收。**
- 修复（重复 CTA 藏在不同措辞里）：侧栏的「记录 ⌘N」与中栏空态的「记录第一条」做的是同一件事（都打开记录面板），但后者让用户以为是两个不同入口。中栏改为文字引导，重复项由门禁按**动作**（而非文字）判定。
- 修复（失败提示上的「重新读取」误导）：同一套错误提示条用于读取、导入、转换、导出、恢复五类失败，但「重新读取」只对读取失败有意义。导入失败时用户点了只会重载库，还打断当前操作。现在只有读取失败才显示该按钮。
- 修复（按钮文案与行为不符）：空列表的「清空搜索」按钮实际同时清掉关键词**和标签筛选**，文案只说搜索。改为「清空搜索与标签」，并加断言锁住文案必须两样都提到。
- 修复（回环判定三端不一致）：同一份 `settings.json` 写着 `http://[::1]:11434/v1` 时，桌面端认它是本机（免密钥、允许 HTTP），安卓端不认（要密钥）。三处统一到同一口径（127.0.0.1 / localhost / IPv6 回环），IPv6 按八组语义解析，`::ffff:127.0.0.1` 这类映射写法不算回环。新增 `tools/check_loopback_parity.mjs`，同一批地址跑过 Rust 与 TypeScript 两套实现逐条比对，并接进门禁。
- 修复（本地模型请求被送进代理）：系统配了 `HTTP_PROXY` 时，本地模型（`127.0.0.1` / `[::1]`）的请求会被交给代理而不是本机服务，连接测试报「抓取失败」。改为**只有回环地址绕过代理**，外部地址照旧跟随系统代理（剪藏外站不受影响）；回环判定交给 `Ipv6Addr::is_loopback`，展开写法 `0:0:0:0:0:0:0:1` 同样识别。两条回归分别锁定「绕过范围精确」与「请求真的到达本机监听」，并在代理环境下反向验证。
- 修复（第一套本地模型连接）：IPv6 回环地址 `http://[::1]:端口` 原先被误判为需要 API 密钥，桌面 HTTP 校验也会拒绝。前端与 Rust 改为识别 URL 解析后的 `[::1]`；完整 IPv6 回环写法同样可用。增加连接测试→出卡的前端回归，以及聊天、Embedding、网页抓取三条真实 IPv6 回环 HTTP 请求验证；非回环 IPv6 和 `[::]` 仍按原策略拒绝。

- 修复（第一套桌面侧栏）：折叠的「应用」标题继承组标签的两端对齐，导致三角与文字分离约 137 CSS px；标题改为左对齐。浏览器回归断言测量实际文字位置，macOS 安装版截图复核通过。
- 更正（命令注册检查）：`db_list_stale_embedding_card_ids` 原本已在注册列表末项；旧扫描器漏掉无尾逗号的末项，误判缺失并引入重复注册。本次去掉重复项，扫描器补齐 TSX、单引号与重复项检查，七条隔离测试纳入门禁。此前“命令未注册导致索引中断”的结论撤回。

- 安全（凭据不再从界面、文件与控制台三处泄露）：连续三轮在**不同出口**发现同一类缺陷——服务端错误原文带着 API key 直接流向用户可见的地方。① AI 错误进**界面**（`API 返回 401：Incorrect API key provided: sk-…`）；② 导出包带走 `settings.json` 里遗留的密钥字段（界面写着「不含 API 密钥」而 `encodeSettings` 会把未知键原样带走，**备份包是用户会分享的文件**）；③ Embedding API 错误进**控制台**（用户报 bug 贴日志就带出去了）。三处按项目自己的原则对齐——邮箱侧早定了「错误不回显密钥」（`docs/EMAIL_INTEGRATION.md`）。新增 `docs/DATA_EGRESS.md` 列出 13 处出口逐个对照，并把它变成**会失败的契约**（`dataEgress.test.ts` 喂哨兵密钥跑所有导出路径）。Rust 侧用纯字符串扫描实现脱敏，**不引入 regex 依赖**。
- 修复（桌面端主线入口被挤出可视区）：真机窗口只有 728px 高，侧栏放不下时多出来的那行正好把「知识测验」推出可视区——**用户在浏览器里看到的是完整的，在真机上却找不到入口**。恢复 `17834ea` 定的四段约定（顺序 + 一级入口 ≤ 6），「应用」段改为可折叠且当前在应用页自动展开，「温故复习」留在折叠区外（每天都要用）。新增 `tools/screenshot_real_app.sh`（唤醒显示器 + 按窗口坐标裁剪）与 `tools/real_app_pages.mjs`（cliclick 真实点击 + **内容区像素比对**确认页面真的切换了）。
- 修复（`<details>` 折叠失效）：`.ws-nav-details { display: flex }` **覆盖了浏览器对 `<details>` 的默认隐藏行为**——「筛选」收起了，里面的「收藏」「已归档」却照样显示，还撑破侧栏（滚到底时最后一行被裁在容器外 39.9px）。补 `.ws-nav-details:not([open]) > *:not(summary) { display: none; }`。
- 功能（补上 ADR-0002 承诺但一直没做的两项）：**「测验」**（工作台此前只有复习，全库随机测验的 `buildQuiz` 没有任何入口，而安卓端 `DeckScreen` 里一直有「知识测验」）与**「统计」**（`db_get_stats` 早就在 Rust 侧实现并注册，前端从未调用、界面上也没有入口）。
- 功能（来源与导出）：支持导入 **`.eml` 邮件文件**（此前完全不支持，用户导出邮件后导不回来）；新增**批量导出选中内容**（复用整库导出的同一套生成逻辑）；桌面端可导出 **Anki 词表 `.tsv`**（安卓端本来就能导出）。
- 修复（解析与语义）：**压缩 PDF 之前解析出的是 PDF 源码**（真实世界的 PDF 几乎都用 FlateDecode，不解压就得到 `1.4 1 0 obj Type Catalog…`）；模型输出带 `[1]` 引用编号时解析**抛错**而模型其实返回了合法卡片；**浏览器不给 MIME 时 JPEG 被存成 `.png`**（内容与扩展名不符）；**归档素材被当成「讨厌这个来源」**而给发件人降权（处理完 ≠ 讨厌）；**恢复备份时静默丢弃空标题/空正文**的内容。
- 工具（把「已存在但没被运行」的东西接进验证）：`tools/taste_usability_gate.mjs` 与 13 套浏览器冒烟此前**只在本机手动跑**，界面退化不会被 CI 拦住；新增 `tools/run_all_smokes.sh` 一条命令跑完，并接进 `verify_workbench.sh`。新增 `docs/FIRST_VERSION_ACCEPTANCE.md`（九项交付物逐条对应到「有哪个测试证明它能用」）与「来源矩阵」「真实文件 fixture」两套回归。

- 修复（MCP / CLI 的默认卡库路径）：**它读的位置和 App 写的位置不是同一个**——`tools/knowflick-mcp/lib.mjs` 默认取 `<数据根>/cards.json`（那是已删除的 mac 端的布局），而两套 App 都读写 `<数据根>/store/cards.json`。按默认跑 `kf.mjs map` 会在一个过期的空文件上打转，看起来「Agent 查不到我的卡」。改为 `store/` 优先、根下只作兜底（老库仍在根下时能读到），**两处都没有时报错信息给的是现行位置**。新增一条用例钉住三种情形（两处都有 / 只有旧位置 / 都没有）；MCP 自测 23 → 24 项全绿。顺带修该目录 README 里重构前的旧绝对路径，以及「只覆盖 mac 端数据目录」这句已不成立的口径。
- 文档（补回遗漏）：根 `README.md` 补上 **MCP / CLI 入口**——重写 README 时漏掉了它，而它是活的（`android.yml` 在跑它的 24 项自测），且是「让 Agent 查你的卡库」这条用法的唯一入口。
- 测试（统计口径）：**统计的跨端一致性实测**——镜像 Kotlin `StatsCalculatorTest` 的六个用例（空数据全零；意图计数 4 已读 / 1 喜欢 / 2 跳过与喜欢率 0.25；取消收藏不改写 `swiped`、喜欢率不受影响；连续天数容忍「今天还没刷」的空档、断档两天归零；近 7 天趋势从旧到新且末位是今天；分类行按已读数排序）。TS 侧**六项全绿**。过程中撞到一处**命名差异（不是缺陷）**：Kotlin 叫 `dailyCounts`、TS 叫 `daily`——内部结构体名不需要一致（只有线格式需要），镜像测试比的是**语义**。
- 文档（README 与协作规范）：① 根 `README.md` 补回**当前版本**表（Android `android-v0.10.3` 已发布 / 第一套桌面 v0.1.0 / 冻结的 `:desktop` 的 `desktop-v0.1.0`）——重写时把这节丢了，读者看不出现在到哪个版本了；② 把十份活文档的**内部链接**过了一遍（按各自所在目录解析相对路径），查出 `docs/MULTI_PLATFORM.md` 有 **4 处**按仓库根视角写的 `.github/workflows/...`——在 `docs/` 下会解析成 `docs/.github/...`，**全部打不开**，已改为 `../.github/...`。剩下的唯一一处是 `CHANGELOG.md` 里指向 `macos.yml` 的链接：那是历史条目、描述当时的事实，而该文件已随 `apps/mac` 删除，**不改**。
- 测试（间隔重复契约）：**SM-2 的跨端行为实测一致**——ADR-0002 §3 写死了「SM-2 / FSRS 字段按现在的 Kotlin 规则解释，第一版不改算法」，而此前只有代码级逐行比对。镜像 Kotlin 的 `SpacedRepetitionEngineTest` 三个用例（第一次复习四档的 repetition / intervalDays / masteryLevel、第二次 hard 3 天 / good 6 天 / easy 8 天、第三次 6×2.5=15 天且再次遗忘打回起点并降低简易度），TS 侧**三项全绿**。即：同一个卡库在两套里算出的**到期日相同**，这是这条契约里最要紧的一条。
  **FSRS 那一路同轮补上**：镜像 Kotlin `FsrsEngineTest` 的四个**性质断言**（初次复习稳定性随评分递增、难度递减；可提取率按幂律衰减、稳定性天数处约 90%；连续成功会增长稳定性与间隔；遗忘会重置 repetition / intervalDays 并显著降低 stability），TS 侧**四项全绿**。至此间隔重复的两套算法（SM-2 与 FSRS）都有跨端实测。**未镜像**：Kotlin 的 `calculateInterval`（按目标留存率反推间隔）在 TS 侧没有对应 API。
- 验证（桌面发布通道的组装脚本）：`tools/assemble_desktop_release.sh` 是 `desktop-v*` tag 发布通道的**唯一实现**（`desktop.yml` 直接调它），此前只有 workbench 那份镜像脚本的空跑记录。这次用「假 DMG + 假 MSI + 假 DEB」空跑一遍，三条命名映射都对——**包括最关键的那条**：jpackage 因 macOS 要求 MAJOR>0 而产出的 `KnowFlick-1.0.0.dmg` 被改名成 `KnowFlick-0.1.0-macos.dmg`（对外统一用产品版本，否则下载者拿到名不副实的包且事后难察觉，正是脚本注释里点名的风险）；`SHA256SUMS.txt` 正常生成。三条守卫逐条验证：**版本不符 → exit 1**、**tag 前缀错 → exit 2**、**缺产物 → exit 1**。没有发现缺陷。
- 验证（冻结的 JVM 桌面宿主首次实跑）：`./gradlew :desktop:run` 起得来——窗口（`OWNER=MainKt`、标题 `KnowFlick`）与界面都出来了，**共享界面 `DeckScreen` 在桌面上真的渲染**（截图 OCR 到顶栏、空态「已刷完全部卡片」、「换一批已读知识重新探索」与底部「不喜欢 / 收藏 / 详情」），读数据目录正常（`store/` 为空 → 空态）。这同时是「[ADR-0001](docs/adr/0001-desktop-tri-platform-shared-kotlin.md) 落地的共享界面仍然活着、并且能跑」的实测证据——虽然 ADR-0002 把桌面第一套改成了 `apps/workbench`，这个模块在闭环跑通前仍按约定冻着不删。启动日志里的 `error messaging the mach port for IMKCFRunLoopWakeUpReliable` 是 macOS 输入法的常见无害告警；验证后主动终止（gradle 报 exit 143 = SIGTERM，符合预期）。
- 验证（Android 完整门禁首次在本机跑通）：`tools/build_android.sh` 是 `AGENTS.md` 列的 Android 验证入口——**单测 + Lint + R8 release + 签名与对齐校验**，而此前本机只跑过共享模块那一半。这次跑完整条，全部通过：**五个模块 382 项单测全绿**（`:app` 98 / `:domain` 219 / `:shared-data` 35 / `:shared-ui` 10 / `:desktop` 20，0 失败 0 错误 0 跳过）、**Lint 0 个 error**（33 warning + 2 information）、`assembleRelease` 经 `minifyReleaseWithR8` 与 `lintVitalRelease` 通过，产出 `dist/android/KnowFlick-0.10.3.apk`（5.0 MB，附 `sha256` 与 44 MB 的 `mapping.txt`）；`apksigner verify` 报 **APK Signature Scheme v2 = true**（CN=KnowFlick Android，RSA 3072），`zipalign -c` 通过。构建 3m29s（150 个 task，44 executed）。**没有发现新缺陷。**
- 文档（Windows 接入手册）：**按 ADR-0002 更新**——`docs/WINDOWS_ONBOARDING.md` 被 `AGENTS.md` 当作「环境事实」引用，但它还写着「只改 mac 端 Core」「mac 端任何验证都不能（无 Xcode），推给 CI 的 macOS workflow」「Windows 端开发（路线待定），定版后新建 `apps/win/`」「两台机器按端分活（mac / android / windows）」——这些都已作废。现在写准了：Windows 属于**第一套桌面**（`apps/workbench`，只要 Node 22+ 与 Rust，**不需要 JDK 与 SDK**），没有 `apps/win/`、也没有 `win-v*` tag，发布走 `workbench-v*`；任务表按今天存在的两套重列（含 `check_clip_parity.py`）；「这台 mac 的现状」换成实测事实（`JAVA_HOME` 不在全局 PATH、Node/Rust 可用、不再需要 Xcode）。文件头的「最后核对」日期同步。
- 清理（mac 退役收尾）：**删掉 `tools/sync_shared_assets.sh`**——它最后只剩「检测到 `apps/mac` 不存在就返回」这一个动作（跑它等于什么都不做），而共享底图现在三处都是直接引用（Android 走 Gradle `assets.srcDirs`、第一套桌面走 Vite `publicDir`、`:desktop` 走 classpath 资源），**不存在需要同步的副本**。同步清掉 `.gitignore` 里 mac 资源的两行忽略规则，`docs/MULTI_PLATFORM.md` 的「残留脚本」段改为只讲 `tools/test.sh`（它留着指路：打印正确的验证命令并以 1 退出）。
- 文档（图标美术源）：**写清「美术源不入 Git」**——`.gitignore` 一直忽略 `shared/icons/AppIcon.iconset/`，而 `AGENTS.md` 与两个 `README.md` 都写着「美术只有一份在 `shared/icons/`」，新 clone 的机器上其实**找不到它**（`tools/generate_app_icons.py` 会因找不到母版直接退出）。仓库分发的只有派生出的 `.icns` / `.ico` / `.png`；要改图标得先拿到原始美术。四处口径已改准。
- 工具与 CI：**CI 首跑风险排查 + 门禁收紧**——`workbench.yml` 与 `workbench-release.yml` 因为文件尚未提交，**从未在 CI 上跑过一次**，首跑最容易红的地方都在本地先查了一遍：`npm ci` 的 lock 同步性（`npm ci --dry-run` 通过，根依赖无缺失、无版本漂移）、workflow 引用的七个本地脚本是否都存在且有可执行位（全部满足）、`Cargo.lock` 与 `Cargo.toml` 是否同步（`cargo test --locked` 通过）。顺手把 `verify_workbench.sh` 里的 `cargo test` 改成 **`cargo test --locked`**：默认行为在 lock 过期时会静默改写 lock 再继续，CI 上完全看不出来；加上之后 lock 一漂移就红。
- 测试（剪藏抽取行为契约）：**表一致 ≠ 行为一致**——`tools/check_clip_parity.py` 守的是规则表（token 表、阈值、字符集窗口），而候选块怎么挑、节点按什么顺序丢，流程上仍可能分叉。新增一对镜像测试（`WebClipEngineCrossEndTest.kt` / `clipEngine.crossend.test.ts`），用同一份带导航、页眉、页脚、评论区与「扫码关注 / 版权所有」样例行干扰的中文文章，比**抽出来的正文**：标题、站点名、描述、`truncated` 与正文全文逐字符相同，干扰内容一律不进正文（TS 侧另加一条反向断言）。**两端全绿，Kotlin 侧一次通过。**
- 测试（导入合并契约）：**给 workbench 的 `mergeCard` 补上镜像测试**——Kotlin 侧 `CardStoreTest` 有四个 details 冲突用例与一条「合并必须对称」的断言，而 TypeScript 侧那份（注释写着「与 Kotlin `CardStore.mergeCard` 一致」）**一个测试都没有**。照 Kotlin 的用例镜像过来，同一份输入、同一串期望：双方都有 `editedAt` 时新者赢（即使更短）、任一方缺失时退回 v1「较长者」规则、`editedAt` 持平也退回较长者、合并后的 `editedAt` 取较新者，另加 a/b 互换相等的对称性断言。4 项全绿——两端对同一对卡片合出同一结果，**导入合并这条链没有分叉**（`restoreArchive` 走的就是 `mergeCard(local, raw)`）。
- 测试（ADR-0002 §3 契约）：**卡片线格式的跨端一致性实测**——「两套共享同一份 `cards.json`、拷过去就能打开，中间不经转换」这条硬契约，此前只有「读代码逐字段比对」一种证据，兜底规则一旦在某端漂移，用户的卡会在两端来回搬动时悄悄变形。新增一对镜像测试：`apps/android/.../CardJsonCrossEndTest.kt`（Kotlin）与 `apps/workbench/src/domain/card.crossend.test.ts`（TypeScript）——同一份输入、同一串期望，比的是**键排序后的输出字符串**。覆盖 5 个边界：最小卡、未知字段与空串/越界学科字段被丢弃、epoch 秒抬成毫秒再写 ISO、右划但缺 `isFavorite` 时回填收藏与收藏时间、未知 `source` 兜底 `seed`。**两端全绿，输出逐字节相同**。两个测试都落在既有测试套里（`:domain:jvmTest` / `npm test`），workflow 不用改。
- 验证（ADR-0002，第一套桌面）：**首次实跑记录**——此前 `apps/workbench` 的全部证据都是静态的（编译、71 项前端单测、Rust 单测、能出 DMG），而 ADR §2 的验收口径是运行时行为，这一环一直没验过。本轮补上：① **前端实测**（浏览器里注入假壳喂 3 张演示卡）——卡片显示分类 / 标题 / 摘要，`→` 划走后顶卡离堆且计数 `未看 3 张` → `2 张`、撤销按钮由灰变亮，`⌘Z` 撤销后回到 3 张，三张卡各取到不同底图（`/bg/tech.webp` 100 KB、`/bg/agent.webp` 12.7 KB、`/bg/algorithm.webp` 127 KB，均完成传输）；② **打包产物体检**——挂载 DMG 后 `.app` 能启动（进程存活、窗口已建、无新增崩溃报告），二进制内**全部 42 张底图**都在，`Contents/Resources` 只剩 `icon.icns`（删掉 `bundle.resources` 后不再有 `_up_/` 冗余），`Info.plist` 的版本与图标项正确。**仍未覆盖**：真实壳的 IPC 全链（本机文件、抓取、AI、凭据）需要带窗口的人工跑一遍。
  **续（同日）：真实壳的读链路已实测。** 启动 DMG 里的 `.app`，壳返回真实默认目录 `~/Library/Application Support/KnowFlick/store` 并渲染空态；往 `store/` 放两张探针卡后重启，界面渲染出卡片的分类 / 标题 / 摘要与「未看 2 张」计数——`load_store` → IPC → 前端解析 → 渲染这条链通了，且应用确实是**只读**的（探针卡的 `seenAt` / `swiped` 保持 null，`store/` 未被改动）。**仍未覆盖**：写路径（`save_cards` 的原子写与备份轮转）与抓取 / AI / 凭据——WebView 里的按钮不暴露给 AppleScript，点不动，只能人工跑。
  **续（同日）：写路径也实测了。** 按钮点不动，但**键盘事件不需要访问元素**——把窗口带到前台后发一个 `→`（key code 124），磁盘上立刻反映：那张卡的 `seenAt` / `swiped: right` / `isFavorite` / `favoritedAt` 全部写入（日期是 ISO8601），**`cards.backup.json` 同时出现，内容正是划卡前的上一版**。也就是 `save_cards` 的**原子写 + 一代备份轮转**与 Android 侧同一语义，从界面到磁盘这条链通了。**仍未覆盖**：抓取与 AI 请求（要先在输入框里打字给 URL / 配密钥，键盘方案到不了输入框）、凭据文件的读写。
  同日附一条**方法论陷阱**：`screencapture -l <windowID>` 在应用不是 frontmost 时**只截到窗口框、截不到内容**，我因此一度以为「有数据就白屏」；把窗口带到前台后内容完全正常。下次用这条路验证 GUI 时先激活窗口，别急着下「白屏」的结论。
- 文档（数据迁移）：README 的数据存储节补上**从已删除的 macOS 端搬数据**的做法——那一版把 `cards.json` / `settings.json` 放在数据目录**根下**，现在的两套都读 `store/` 子目录，移进 `store/` 即可（结构相同，不需转换）。这是实测出来的：本机根下留着旧的 `cards.json` / `settings.json`，而两套读的是 `store/`。
- 修复（Android）：**剪藏样板行过滤里有三个 token 从未生效**——`isJunkLine` 比对前先把整行 `lowercase()`，而 `JUNK_TOKENS` 里的 `APP下载` / `Cookie` / `JavaScript` 写成了大写，于是这三类样板行在 Android 侧一直当正文留着，而 workbench 侧（同一份表里是小写）能正确丢弃——所谓「逐条对齐的规则表」在这里是分叉的。改为小写，并加一条回归用例钉住「token 表必须全小写」这个不变量。顺带逐值复核了 DOM 清理表、候选块挑选、charset 顺序、链接过滤四处，其余逐条一致。
- 工具与 CI：**给剪藏规则表立跨端护栏**——新增 `tools/check_clip_parity.py`：把 Kotlin（`WebClipEngine.kt`）与 TypeScript（`clipEngine.ts`）的七张表与四个阈值逐项比对（有序表按序、集合表按集合），并额外要求 token 全小写；不一致即非零退出。接进 `android.yml` 与 `workbench.yml` 各跑一次，两边的路径过滤都补上了**对端的规则表文件**——改任意一端都会触发。上面那条 token 大小写的缺陷正是没有护栏才会发生，本脚本已用负向测试验证会红（把一条改回大写，报「只在 Kotlin / 只在 TS」两条差异）。顺带删掉 workbench 里那套**没有生产调用点**的第二份抽取实现（`ingest.clipText`，规则是旧的：只剥三个标签、只解四个实体），剪藏抽取从此只有 `clipEngine.ts` 一条路径。
  字符集嗅探窗口也一并收口：workbench 真正跑的字节解码在壳里（Rust），它的窗口原先写 4096，与 Kotlin / TS 两份的 1024 分叉——同一页若把 `<meta charset>` 放在 1024–4096 字节之间，两端会解出不同编码（中文站 GBK/Big5 首当其冲）。三处现在都提成同名常量 `META_SNIFF_BYTES = 1024`（HTML 规范要求编码声明完整落在文档前 1024 字节内），护栏逐值比对三处；Rust 侧新增一条用例钉住「窗口内认得、越界不认」。
- 清理（mac 退役收尾）：删除 `tools/migrate_panels.py`——它是 mac 时代把旧面板批量换成 Cutline 视觉语言的一次性脚本，硬编码了已不存在的绝对路径，且目标目录已随 `apps/mac` 删除。
- 运维（ADR-0002）：**mac 退役后的文档口径同步**——根 `README.md` 按两套重写（原先整篇是已删除的 mac 端说明书：SwiftUI 徽章、`apps/mac` 构建命令、Keychain 密钥、mac 目录树现全部作废），改为「第一套桌面（`apps/workbench`）+ Android」两套并列，并如实写明第一套的密钥是**未接系统钥匙串**的 0600 明文文件、AI 传输是**非流式**；`CONTEXT.md` 按删除后的现状逐节核对重写（19 节里 6 节降级为历史或改写归属，并更正「默认自定义分类 / 偏好解析走 resolve / 白名单 allCategoryNames」三条在代码里找不到落点的旧说法）；`docs/MULTI_PLATFORM.md`（130 增 79 删）改目录树、共享资产三处引用、发版 tag 序列（新增 `workbench-v*`、mac 的 `v*` 标明终止）、环境要求与图标美术源；`AGENTS.md`、`apps/android/README.md`、`apps/android/desktop/README.md`、`docs/windows-route/UI_EXTRACTION.md` 的过期表述同步；`tools/check_taxonomy.py` 与 `android.yml` 里「三处事实来源」的注释改为两处（Swift 那份已删）；`HelpSheet` 的「第一版暂未接入」补上原先漏掉的**学习地图**。
- 产品（ADR-0002，第一套桌面）：**导出补上 JSON**——`cards.json` 逐字另存（与 Android 侧同一份线格式），密钥不进导出；之前 `HelpSheet` 与 CHANGELOG 都写着「ZIP 或 JSON」而实现只有 ZIP，现在两侧一致。Rust 侧两条新用例钉住「逐字复制」与「空库导出 `[]`」。
  **这次没做**（逐条实测过，如实登记）：① ZIP 备份包仍不含 `manifest.json` / `README.txt`，`cards.json` 也是裸数组而非 Android 归档包的 v2 信封——**互导成立**（两边导入器都收裸数组与信封），但用 workbench 的包「全量覆盖」后墓碑表会与卡库不一致，等开局域网同步时再处理；② 测验算法档位写在共享 `settings.json` 的 `spacedAlgorithm` 键里，Android 不认识它（读时忽略、写时丢掉），所以「在桌面选 SM-2 / FSRS」不会被安卓继承；③ 详情页只读（只有收藏与外链），没有改卡删卡——ADR-0002 §2 只要求「卡库和详情」。
- 发布（ADR-0002，第一套桌面）：**三端安装包与 Release 通道**——`.github/workflows/workbench-release.yml`（tag `workbench-v*`）三台 runner 各出一档（DMG / MSI / DEB）、各自先过一遍 `verify_workbench.sh`，再由 `tools/assemble_workbench_release.sh` 统一命名、生成 `SHA256SUMS.txt` 并附到 Release；脚本可本地空跑，三条守卫（版本不符 / 缺产物 / tag 前缀错）已逐条验证。与冻结 JVM 桌面的 `desktop-v*` 是两条独立序列，产物名 `KnowFlick-Workbench-<版本>-<系统>.<扩展名>` 以示区分。
- 发布（ADR-0002，第一套桌面）：**安装包图标换成真图标，并删掉一份重复打包的底图**——`src-tauri/icons/` 由 Tauri 默认占位图改为从仓库唯一一份美术（`shared/icons/AppIcon.iconset/`）用 `tauri icon` 派生的 `.icns` / `.ico` / 各档 PNG；本机 DMG 出包实测 bundle 内 `icon.icns` 与派生源 SHA256 一致。同时删掉 `tauri.conf.json` 的 `bundle.resources`：底图已随 Vite `publicDir` 进 `dist/`（运行时按 `/bg/<key>.webp` 取），那份拷贝只会落在打包产物的 `_up_/` 前缀目录里、运行时不经过它——**DMG 13.96 → 11.64 MiB**。
- 桌面（ADR-0002，`apps/workbench`）：**第一套 Web + Tauri 工作台 v0.1**——侧栏学习闭环（剪藏 / 笔记 / AI 出卡、摄影底图刷卡、卡库与详情、测验 SM-2·FSRS、统计、导入导出 ZIP/JSON）；默认卡库路径与 frozen JVM 桌面一致（`<data_root>/store`）；`cards.json` / `settings.json` / `search_history.json` / `credentials/apiKey.credential` 与 Android 对齐；归档 `restoreArchive` 与 `ArchiveImportManager` 同合并语义；剪藏 / 主题 / 排序 / 统计等有 Vitest + Rust 单测；本地门禁 `./tools/verify_workbench.sh`，CI 见 `.github/workflows/workbench.yml`。
- 产品转向（规格见 [剪藏提炼复习设计规格](docs/CLIP_INGEST_DESIGN_2026-10.md)）：知识内容不再由 App 预置，改为「URL → AI 提炼知识点 → 复习」。
- macOS / Android：**移除预置知识库**——删除 `shared/assets/seed_cards.json`（214 张），两端启动不再播种、不再做「种子增量合并」，空库成为正常起点；`AppStore.isLoadingSeed` 随之更名为 `isLibraryLoading`。
- macOS / Android：来源开关收敛为 `enableAI` 一档，关闭 AI 只屏蔽 AI 生成卡，剪藏/导入与历史来源照常进堆（旧「全关则队列为空，含导入卡片」口径作废）；搜索来源筛选项「预置精选」改为「剪藏导入」。
- macOS：卡堆为空的界面文案区分两种空态——「还没有第一批知识」给出剪藏/导入入口，「今天的知识刷完了」才给重新探索；设置页移除「启用预置精选知识库」开关。
- 工具链与 CI：`sync_shared_assets.sh` 不再搬运种子卡并改为校验底图数量；`build_app.sh` 与两条 workflow 的产物校验从「种子卡数量/SHA」改为底图数量一致性；`tools/check_taxonomy.py` 的内容校验改为「给定路径存在才跑」。
- 文档：`README.md` 与 `CONTEXT.md` 中关于预置库、来源开关、存储回退与增量合并的口径同步更新。
- 跨平台（Windows 路线探针）：**Android 领域层迁入 KMP 模块 `:domain`**（`androidTarget` + `jvm` 双 target）——卡片模型、卡库状态机、学科与学习范围、统计、搜索、图谱、间隔重复、剪藏抽取共 19 文件 4149 行整体迁入，包名 `com.knowflick.app.domain` 不变，装配层 import 零改动；今后桌面端走同一个 `jvm` target 复用这份逻辑。结论见 [KMP 探针结果](docs/windows-route/KMP_PROBE_RESULT.md)。
- 跨平台（实测结论）：含 `java.time` / `java.util` 的文件落在手建的 `jvmAndAndroidMain` 中间源集——放进 `commonMain` 在双 JVM target 下虽能编译通过，但那是元数据编译被跳过的副作用，加非 JVM target 即失效，仓库因此把可移植边界画在源集上。
- 工具链与 CI：`tools/build_android.sh` 与 `android.yml` **显式点名 `:domain:jvmTest`**（领域层 171 项测试迁出 `:app` 后，不点名会静默少跑）；workflow 的测试汇总同时扫 `app/…/testDebugUnitTest/*.xml` 与 `domain/…/jvmTest/*.xml`；`tools/check_taxonomy.py` 的 Kotlin 学科表路径随迁。
- 构建（双机网络）：Gradle wrapper 改走华为云镜像并补官方 `distributionSha256Sum`（镜像损坏即校验失败），超时 10s→60s、重试 3 次；本地默认启用阿里云仓库，检测到 CI 环境变量时只用官方源。
- 验证口径：**领域层测试不再需要 Android SDK**——只需 JDK 17 即可 `./gradlew :domain:jvmTest`（171 项）；Android 装配层（`:app`）仍需要 SDK。
- 跨平台（CMP 工具链对齐实验，只读不改产品代码）：三条版本路线全部实测通过——冻结线（Kotlin 2.0.21 + CMP 1.7.3）、最小改动线（Kotlin 2.1.21 + CMP 1.8.2）、现代线（Kotlin 2.4.21 + CMP 1.12.1），每条都在桌面 JVM 上跑通「`:domain` 逻辑 + `@Serializable` 往返 + Compose 离屏渲染」。结论：`compose-bom:2025.06.00` 锁的 `androidx.compose.*` 正是 1.8.2，与 CMP 1.8.2 对应的 Jetpack 版本逐号相同，**推荐只升 Kotlin 到 2.1.21、BOM 与 AGP 不动**。见 [CMP 工具链对齐实验](docs/windows-route/CMP_TOOLCHAIN_ALIGNMENT.md)。
- 跨平台（实测结论）：**现代 Kotlin 能消费旧产物**——Kotlin 2.4.21 的桌面工程编译并运行 Kotlin 2.0.21 编译的 `:domain` jar 全部通过，因此「桌面端独立构建走现代版本、Android 端完全不动」这条路可行；Windows 目标（`desktop-jvm-windows-x64` / `skiko-awt-runtime-windows-x64`）可在 macOS 上编译，运行与 MSI 打包仍需 Windows 机器。
- 跨平台（硬约束实测）：Kotlin 元数据**只能向后读一个次版本**——Kotlin 2.0.21 最高读到 2.1.0（实测 2.4.21 产物被拒，报 `actual metadata version is 2.4.0, but the compiler version 2.0.0 can read versions up to 2.1.0`）。因此：Android 端停在 2.0.21 时可以共享由 Kotlin 2.1.x（即 CMP 1.8.2）编译的模块，但**现代 CMP（≥Kotlin 2.2）一旦参与共享 UI，Android 端就必须跟着升**。
- Android（工具链）：**Kotlin 2.0.21 → 2.1.21**——为桌面端铺路（CMP ≥1.8 的最低要求是 Kotlin ≥2.1.0），AGP 8.9.2 与 Compose BOM 2025.06.00 不动。全量验证：159 项 app 单测 + 171 项领域层测试全绿，Lint 无 error，R8 release 构建与 apksigner/zipalign 校验通过，仪器测试 APK 编译通过；Kotlin 2.0.21 时代那条「AGP 高于 KGP 已知上限」告警随之消失。运行时行为无变化（纯编译器版本升级）。见 [CMP 工具链对齐实验](docs/windows-route/CMP_TOOLCHAIN_ALIGNMENT.md)。
- 跨平台（新模块 `:desktop`）：**桌面宿主骨架**上线——Kotlin JVM + Compose Multiplatform 1.8.2，经 `implementation(project(":domain"))` 复用同一份领域逻辑（不是引 jar），离线组合渲染测试进 CI。`./gradlew :desktop:test` 与 `:desktop:run` **只需 JDK 17，不需要 Android SDK**（实测）。尚未实现：真实界面、卡库持久化、打包分发。骨架定位与「何时提升为 `apps/desktop/` 独立端」的取舍见 [模块说明](apps/android/desktop/README.md)。
- Android（库契约）：`:domain` 的 kotlinx-serialization 依赖由 `implementation` 改为 `api`——`KnowledgeCard.serializer()` / `Json.encodeToString` 属于公开 API，消费者（`:app`、`:desktop`）不该各写一遍同一行依赖。
- 架构（首个 ADR）：[ADR-0001 桌面三端与 Android 共用一份 Kotlin / Compose 代码](docs/adr/0001-desktop-tri-platform-shared-kotlin.md)——确定 **Windows / macOS / Linux + Android 四端共用一份实现**（`:domain` 逻辑 + `:shared-ui` 界面，各端只是薄宿主），并如实登记两条代价：mac 会出现 Swift 原生与 CMP 两套实现的并存期、平台专有能力需各写或用 expect/actual；Swift mac 端最终处置列为待决。
- 跨平台（新模块 `:shared-ui`）：**共享界面层起步**——`apps/android/shared-ui`（KMP + CMP 1.8.2，androidTarget + jvm）。首个迁移是把 app 模块的 `ui/Theme.kt`（4 套纸质主题 + `EditorialColor` 令牌，150 行）整体搬入，**24 个引用文件 import 零改动**（包名保持 `com.knowflick.app.ui`）；另加首个真正跨端的组件 `KnowledgeCardTeaser`。`:app` 与 `:desktop` 现在共用同一份主题与组件，桌面骨架已改用产品主题渲染共享卡片。验证：`:shared-ui:jvmTest` 2 项（令牌 + 无头渲染）+ `:desktop:test` 2 项 + app 159 项 + 领域层 171 项 = **334 项全绿**，Lint、R8 release 与签名校验通过。
- 跨平台（A 档界面平移）：**6 个界面文件 2365 行迁入 `:shared-ui`**——`QuizScreen`(833) 与 `LibraryScreen`(326) 两个整屏（参数是纯领域类型 + 回调，不依赖 ViewModel）、`AppIcons`(668)、`MarkdownTextRenderer`(297)、`LearningHeatmap`(214)、`CategoryStampColor`(27)；加上更早的主题与组件，`:shared-ui` 共 8 个生产文件 2578 行。**桌面宿主现在直接渲染 `LibraryScreen`**——与 Android 端同一份 Compose 代码，离屏渲染测试进 CI。包名保持原样，app 侧 import 零改动。
- 跨平台（迁移边界，实测）：① **系统返回必须外移宿主**——`androidx.activity.compose.BackHandler` 桌面不存在，CMP 1.8.2 的 `ui-desktop` 里只有内部 dispatcher 类，没有公开 `BackHandler`；改由 Android 宿主在调用点包一层（`MainActivity`）。② **多平台 Material 图标在 1.8+ 不存在**——JetBrains 的 `material-icons-*` 最后一次发布是 1.7.3，androidx 侧无 `-desktop` 变体（实测 404），故 `:shared-ui` 暂时钉 `material-icons-core:1.7.3` 并记为技术债（后续改为手写进 `AppIcons`）。
- 工具与文档：新增 `tools/classify_ui_portability.py`——按**平台信号 + 依赖闭包不动点**给界面分档（A 可直接搬 / B 被平台文件拖累 / C 自身带平台信号），可复现；结果与下一批计划见 [界面共享迁移](docs/windows-route/UI_EXTRACTION.md)。迁移前基线 A 27 文件 5196 行 / B 8 文件 2298 行 / C 36 文件 12941 行。
- 原则（第一原则落地）：[AGENTS.md](AGENTS.md) 顶部新增「**一套开发，多处发布**」——一份代码多处产出；引入第二份实现或把可共享代码按端分叉的改进一律回避；允许各端各写的只有平台边界（系统分享/通知、TTS、文件选择器、系统返回、资源读取），且必须收在 expect/actual 或宿主适配层。**由此判定**：[ADR-0001](docs/adr/0001-desktop-tri-platform-shared-kotlin.md) 里「Swift mac 端处置」不再是待决三选一，而是**收敛不并存**——`apps/mac` 冻结新增能力、只做维护，待共享端功能对等后退役；新功能只写一次，只落在 `:domain` / `:shared-ui`。
- 跨平台（多处发布）：**桌面端打通三系统安装包**——`:desktop` 声明 `targetFormats(Dmg, Msi, Deb)`，新增 [.github/workflows/desktop.yml](.github/workflows/desktop.yml)：**一份配置跑三台 runner**（jpackage 不支持交叉编译，必须各系统构建），各自出包后统一命名附到同一个 Release（tag `desktop-v*`，并附 `SHA256SUMS.txt`）；tag 版本与 `packageVersion` 不符会被硬校验拦下（与 macos.yml 同一条纪律）。该 workflow **刻意不装 Android SDK**，等于在 CI 上再证一次桌面端独立于 Android 工具链。本机实测 `:desktop:packageDmg` 出 65 MB DMG。
- 跨平台（打包约束，实测）：① **macOS 的包版本要求 MAJOR > 0**（Windows/Linux 用产品版本 `0.1.0` 正常出包，CI 实测）——用 `macOS { packageVersion = "1.0.0" }` 作打包器别名，对外一律用产品版本（附件统一改名）。② **Compose 打包的 JDK 厂商检查**只认 Temurin/Corretto/Zulu，开发机 Homebrew JDK 会被拒；`gradle.properties` 关掉检查仅为本地验证打包链路，**对外产物一律由 CI 用 Temurin 构建**。③ **安装器元数据必须纯 ASCII**：jpackage 用平台默认字符集读 `@argfile`，Windows runner 的 cp1252 遇到中文 `description` 直接抛 `Input length = 1`，MSI 构建失败——这条只有三系统 matrix 才抓得到，本地 macOS 打包完全看不到。
- 跨平台（三系统产物落地，CI 实测）：同一份代码在 CI 上产出三个原生安装包——`KnowFlick-0.1.0.msi`(57.7 MB) / `knowflick_0.1.0-1_amd64.deb`(53.9 MB) / `KnowFlick-1.0.0.dmg`(67.8 MB)，全程**未装 Android SDK**。
- 跨平台（新模块 `:shared-data`）：**持久化层共享，桌面端拿到真实卡库**——`apps/android/shared-data`（KMP）承载卡库 JSON 的原子写 / 备份轮转 / 损坏回退 / 持久化队列与 `AppModel`（4 文件 435 行 + 21 项随之迁来的测试）。平台边界只剩「目录从哪来」：Android 注入 `filesDir/store`（行为与磁盘结构不变），桌面注入 `~/Library/Application Support/KnowFlick/store`（mac）/ `%APPDATA%\KnowFlick\store`（Win）/ `$XDG_DATA_HOME/knowflick/store`（Linux）；目录以下四端共用同一份代码。**桌面端首次启动是空库**（预置库退役后的正常起点），界面与存储现在都是共享实现。
- 跨平台（迁移边界，实测）：**Kotlin 的 `internal` 按模块算**——类搬进共享模块后，宿主访问原先的 `internal` 成员直接编译不过（`AppModel.storage`、`CardPersistenceQueue` 各触发一批错误）。处理：该公开的公开并写明理由，不在共享模块里用转发方法堆间接。
- 工具：`tools/classify_ui_portability.py` 修掉第二个假信号——把 `java.io.File` 当成平台信号，导致整个 `data/` 持久化层被误判成不可搬（实际一行未改即可共享）。现在 A 档含义明确为「无需平台改造即可搬入共享模块，含 `java.*` 的落 `jvmAndAndroidMain`」；修正后 A/B/C = 21 文件 2877 行 / 5 文件 1883 行 / 33 文件 12362 行。
- 跨平台（平台动作，第一块）：**归档导入/导出共享，桌面端第一次能真正把卡片放进来**——`ArchiveImportManager`（ZIP/JSON 探测、预览构造、合并策略）、`CardArchiveEngine`、`CardExportEngine` 一并迁入 `:shared-data`；平台边界只剩「字节从哪来」：Android 走 SAF `Uri`（新增 `AndroidArchiveReader` 承担读字节），桌面走原生文件对话框（`DesktopFileDialogs`）。桌面端现在支持：选 `.zip`/`.json` 导入（MERGE 合并 + 落盘 + 界面刷新）、收藏导出 Markdown、整库导出 JSON 镜像；导出格式与解析逻辑两端跑的是同一份引擎。验证：`:shared-data:jvmTest` 27 项 + `:desktop:test` 7 项（含「导入后界面跟着更新」这条接线用例），全量 **343 项全绿**。
- 跨平台（平台动作，第二块）：**触觉与底图两条接缝落地，卡片视觉的前置条件打掉**——① `PlatformHaptics` + `rememberPlatformHaptics()`：Android 侧把原 `HapticFeedbackHelper`（API 29+ `VibrationEffect` 预设）整体搬进 `:shared-ui/androidMain`，**手感不变**；桌面 `jvmMain` 为 no-op。② `rememberBackgroundImage` / `PreloadBackgroundImage`：Android 保留 assets + `BitmapFactory` + `LruCache` 实现，桌面新增 classpath 资源 + Skia 解码 + 内存缓存；**图片来源仍是仓库根 `shared/assets`**（Android `assets.srcDirs`、桌面 `resources.srcDir`，同布局零副本），桌面已实测解出 `bg/ai.webp`。收益立刻可见：`ui/CardFace.kt` 从 B 档升到 A 档（分档 B 5→4、A 21/3117 行）。
- 跨平台（模型共享）：AI 会话模型 `CardChatMessage` / `CardChatSession` 迁入 `:domain`（40 行，仅依赖 UUID 与序列化）——它是详情页那条链上的第一块。
- 说明（未做的取舍）：`DetailScreen`(446) 的迁移**主动推迟**——它还渲染 `CardFollowUpChatSheet`(844) 与 `CardPosterExportSheet`(371)，串起来是一次 1600+ 行迁移；先把两条公共接缝做掉，后续每屏都少一道坎。
- 跨平台（能力对齐·测验）：**测验编排抽成共享的 `QuizCycle`，桌面端因此第一次拥有真实功能而不只是浏览**——原先这套编排（起一轮 / 下一轮剔除已评卡 / 弱项重测 / 评分驱动 SM-2 并落库）只写在 Android 的 ViewModel 里；抽到 `:domain` 后，Android ViewModel 改为委托，桌面宿主直接复用同一份编排 + 同一份 `QuizScreen`，入口放在**原生菜单栏**（学习 → 开始知识测验 / 只测今天到期）。行为由 7 项新表征测试钉住（`:domain:jvmTest`），桌面侧另有一条端到端用例走完「起一轮 → 评完 → 落库 → 退出」。
- 跨平台（实测修复）：**宿主的重组契约**——`CardStore` 与 `QuizSession` 都不是 Compose 状态，且评分只改动**同一个会话实例**的内部进度；桌面宿主最初只订阅了会话实例，于是「评分后界面停在第一张卡」——被端到端测试逮到。修法是版本驱动屏幕外面套 `key(state.version)`（与 Android `MainActivity` 的 `key(viewModel.version)` 同一手法），并写进 AGENTS 陷阱清单。
- 跨平台（能力对齐·统计）：**第三条接缝（日期）解锁并迁入 `StatsScreen`(825)，桌面端再添一个共享整屏**——`rememberLearningDay` 的 Android 实现保持原样（`DATE_CHANGED`/`TIME_CHANGED`/`TIMEZONE_CHANGED` 广播 + 回到前台 + 午夜定时；仅把 `ContextCompat.registerReceiver` 换成手写 API 33 分支，少引一个依赖），桌面实现改为 30 秒轮询（桌面没有日期变更广播）。桌面菜单栏新增「学习 → 学习统计」，统计页里的「今日到期」可直接跳进到期复习。至此**三个共享整屏（卡库 / 测验 / 统计）在桌面端全部可用**。
- 工具：`tools/classify_ui_portability.py` 修掉第三次漏检——**`BackHandler`**（Android 系统返回）此前不在平台信号清单里，而它常以全限定调用出现（`androidx.activity.compose.BackHandler { … }`，没有 import 也没有括号），于是 `StatsScreen` 被误判成「可直接搬」、搬进去才编译失败。教训已写进 [UI_EXTRACTION](docs/windows-route/UI_EXTRACTION.md)：分档只是筛子，**编译才是裁判**。修正后 A/B/C = 20 文件 2582 行 / 3 文件 777 行 / 31 文件 12593 行。
- 跨平台（能力对齐·AI 追问）：**聊天编排、面板与落盘全部共享，桌面端可用 AI 追问**——`ChatStateHolder`(199，会话流式编排) 与 `ChatSessionStorage`(146) 迁入 `:shared-data`，`CardFollowUpChatSheet`(843) 迁入 `:shared-ui`；桌面详情页现在有完整的「追问 → 流式回答 → 沉淀为新卡 → 导出 Markdown」，与 Android 同一份实现（连 `chat_sessions.json` 都是同一个文件）。
  顺带补上第六/第七条接缝与约定：**`LocalNotifier`**（宿主提供的轻量提示：Android = Toast，桌面 = 通知条，默认静默）+ 把面板里的 `Toast`/`BackHandler` 换成接缝。Android 侧用 `ProvideToastNotifier` 包根内容，用户可见行为与迁移前完全一致。
  **一条只有真跑起来才会露出的坑**：`ChatStateHolder` 写死了 `Dispatchers.Main`，Android 正常，但纯 JVM 里没有 Main 调度器 → `Module with the Main dispatcher had failed to initialize`；症状极具误导性——**回答内容已经流出来了，`isStreaming` 却永远不结束**。修法是把调度器变成构造参数（默认仍是 `Dispatchers.Main`，Android 行为不变），桌面注入自己的。已写进 AGENTS：共享代码不要硬编码 `Dispatchers.Main`/`IO`、系统时钟、默认时区。
  另修一处**测试隔离**隐患：会话存储原先默认指向开发机真实数据目录（凭据那次踩过同一个坑），改为可注入，测试全部走临时目录。
  验证：全量 **366 项全绿**（app 106 + 领域层 209 + `:shared-data` 27 + `:shared-ui` 6 + 桌面 18），桌面新增用例：假服务器流式 → 断言增量拼进回答 → 导出 Markdown → **换存储实例读回会话**。
- 跨平台（导入预览共享 + 一道分层选择题）：**`ImportRestoreDialog`(288) 迁入共享层，桌面端导入改为「先预览、再确认」**——与 Android 同一份对话框、同一份 `ArchiveImportManager`；预览阶段**不写库**，用户选定恢复策略（增量合并 / 全量覆盖）后才应用。桌面端此前是「选文件即导入」，现在两端交互一致。
  迁移撞见一个分层问题并做了明确取舍：对话框要的 `ArchivePreview` / `RestoreStrategy` 原本定义在 `:shared-data`，而 `:shared-ui` **只依赖 `:domain`**（UI 不依赖持久化层，分层是刻意的）。两种解法——让 UI 依赖数据层（为一个对话框破分层，之后会顺手用更多持久化类型）、或把**描述类型**移到 `:domain`（只动 5 个引用点，类型零 IO，引擎仍留在 `:shared-data`）。选了后者，判据写进 [UI_EXTRACTION §7.3](docs/windows-route/UI_EXTRACTION.md)：**类型属于哪一层看它描述什么，而不是看谁最先用到它**。
  验证：全量 **365 项全绿**（app 106 + 领域层 209 + `:shared-data` 27 + `:shared-ui` 6 + 桌面 17），桌面新增用例：探测 → 断言对话框出现且**卡库还没变** → 确认后按策略恢复。
- 跨平台（能力对齐·学习地图）：**又一个整屏进共享层，桌面端可用**——`LearningMapScreen`(407) 迁入 `:shared-ui`。它此前只被 `LocalContext`（触觉/音效）与 `BackHandler` 挡住，两个接缝都已就位，所以这次几乎是平移；学习范围状态本来就在共享 `CardStore.studyScope`，桌面端接上后卡堆立刻受范围约束。
  **顺带查实一条既有行为（未擅自改动）**：学习范围**不落盘**——`:shared-data` 从未序列化 `studyScope`，Android 侧同样如此（重启后范围丢失）。这不是迁移引入的回归，属既有产品行为，已记为待决项；桌面用例的断言因此改成真实契约（内存语义 + 卡堆过滤），不假定它会持久化。
  验证：全量 **364 项全绿**（app 106 + 领域层 209 + `:shared-data` 27 + `:shared-ui` 6 + 桌面 16）。
- 跨平台（返回接缝 · 全局搜索）：**`PlatformBackHandler` 接缝替掉「宿主外移」，并借此迁入最大的一个弹层**——`SearchSheet`(942) 迁入 `:shared-ui`。
  约定演进值得记一笔：此前每迁一个屏都要在宿主调用点再包一层 `BackHandler`（「外移宿主」），代价是**一个屏的返回语义被拆到两个文件里**、宿主越写越厚、且每迁新屏都要记得改宿主。补上 `PlatformBackHandler(enabled)` 接缝（Android actual = activity 的 `BackHandler`，桌面 no-op，与触觉/音效同一形态）后，五处宿主包装与上一波引入的 `onOverlayVisibilityChanged` 回调**全部删除**——详情页的「浮层展开时让位」判断也回收到屏内一行。
  桌面端随之新增全局搜索：检索走共享 `KnowledgeSearchEngine`，历史落共享 `CardStorage`，弹层是与 Android 同一份 `SearchSheet`（菜单栏「全局搜索…」+ 刷卡页搜索按钮）。
  另一条**实测教训**：`ui/graph/KnowledgeGraphScreen.kt`(833) 分档理由是 `LocalContext`，换上触觉/音效接缝后看似可搬，编译才发现它用 **`android.graphics.Paint` 量文字**（全限定写法、无 import）——「自己开画布 + 用平台绘图 API」的界面不是接缝能解决的，要么改写成 `TextMeasurer`/`DrawScope`，要么留在各端。分档工具补了「全限定 Android 调用」检测，并把这条写进 AGENTS。
  验证：全量 **363 项全绿**（app 106 + 领域层 209 + `:shared-data` 27 + `:shared-ui` 6 + 桌面 15）。
- 跨平台（能力对齐·AI 服务）：**AI 层整体迁入 `:domain`，桌面端从「没有 AI」变成可用**——`AiService`(497，OkHttp + SSE 流式解析)、`AiTextUtils`、`AiPayloadParser`、`AiObjectScanner`、`CardChatInsightDeriver` 与 `net/OkHttpAwait` 一并迁入，**连同 5 个 MockWebServer 测试**（`AiServiceChatTest` / `AiServiceGenerateTest` / `AiServiceUtilsTest` / `CardChatInsightDeriverTest` / `AiProviderPresetsTest`）——网络层的真实覆盖从此也归共享模块。
  桌面端因此新增两个**真实可用**的能力：刷卡页的「AI 生成新知识」（生成的卡经共享 `CardStore.addCards(insertAtTop=true)` 置顶插入）与设置页的「测试连接」；密钥来自上一波的桌面凭据文件，设置来自共享 `settings.json`。校验与提示文案与 Android 同口径（未配置 / 未填 Key / 网络错误各自可辨认）。
  实现上有一处刻意的 API 取舍：`AiService` 的**公开构造器不暴露 `OkHttpClient`**（内部构造器用 `internal`，测试用），否则 OkHttp 就得从 `implementation` 提升为 `api`，让 `:shared-ui`／`:shared-data` 这些根本不需要网络的消费者也被迫把网络库挂上类路径。另按既有铁律处理了跨模块 `internal`：`net/OkHttpAwait.executeCancellable` 被 `:app` 的 WebClipFetcher／RemoteSpeechClient 使用，故改为公开并写明理由。
  验证：全量 **362 项全绿**（app 106 + 领域层 209 + `:shared-data` 27 + `:shared-ui` 6 + 桌面 14）——测试总数不变而分布上移，正是「测试跟着代码走」的结果；桌面新增 AI 全链路用例（假服务器 + 轮询到生成结束 + 断言置顶插入）。
- 跨平台（能力对齐·设置页）：**最后一个大屏迁入共享层，桌面端设置可用且设置可跨端互通**——`SettingsScreen`(534) 迁 `:shared-ui`，它依赖的三个模型（`AiSettings`、`AiProviderPresets`、`SpeechSettings`）迁 `:domain` 的 commonMain（纯 Kotlin + 序列化，零平台依赖）。收益不只是「多一个屏」：**设置文件的线格式现在跨端同一份**，桌面改的主题/音效/AI 配置写的就是 Android 读的那份 `settings.json`。
  桌面侧新增 `DesktopCredentialStore`（数据目录下 0600 权限的凭据文件，位于独立的 `credentials/` 目录）：这是明确的平台边界（Android 用 Keystore），且**如实告知强度**——`credentialsEncrypted = false` 会触发设置页的「已降级为明文存储」提示，用户必须知情；未接 OS 钥匙串是有意的取舍，单列一项。
  新增用例钉住一条**安全不变式**：保存密钥后，遍历卡库目录的每个文件确认密钥**没有**出现在凭据目录之外（`settings.json` 只允许非敏感字段），并校验凭据文件权限恰为 `rw-------`（Windows 无 POSIX 视图时自动跳过该断言）。另有一条用例验证「换实例从磁盘读回设置与密钥」。
  验证：全量 **361 项全绿**（app 132 + 领域层 183 + `:shared-data` 27 + `:shared-ui` 6 + 桌面 13）。
- 发布（三端安装包图标）：**一份美术，三端格式，且「忘了生成」会在打包时立刻失败**——新增 `tools/generate_app_icons.py`：从唯一美术源（`apps/mac/Resources/AppIcon.iconset`）派生 `shared/icons/` 下的 `.icns`（macOS，经 `iconutil`）、`.ico`（Windows，含 16/24/32/48/64/128/256 七档）、`.png`（Linux，512）；`--check` 供无 diff 可看的二进制产物做存在性校验。打包任务依赖 `:desktop:verifyAppIcons`，图标缺失时直接失败并给出生成命令，而不是静默套上 jpackage 默认图标。**实测**：本机 `:desktop:packageDmg` 出包后，bundle 内 `Contents/Resources/KnowFlick.icns` 与共享产物 **SHA256 逐字节一致**。
- 发布（附件组装可本地空跑）：`tools/assemble_desktop_release.sh` 成为 tag 发布通道的**唯一实现**（workflow 直接调它，不在 YAML 里再抄一遍）：校验 tag 与 `packageVersion` 一致 → 把 jpackage 原名（`KnowFlick-1.0.0.dmg`，macOS 的 MAJOR>0 别名）统一成产品版本名 → 生成 `SHA256SUMS.txt` → 可选发布。本机用「真实 DMG + 两个占位 msi/deb」空跑通过，并逐条验证三个守卫（版本不符 / 缺产物 / tag 前缀错）。顺带把校验和工具做成 `sha256sum` 与 `shasum` 两栖——原来只用 `shasum`，而 Ubuntu runner 默认是 `sha256sum`。
- 文档（修正一处写反的事实）：**`paths` 过滤对 tag 推送不生效**——GitHub 官方文档原话 "Path filters are not evaluated for pushes of tags"。仓库旧文档写的是「paths 对 tag 同样生效，所以 tag 要打在含桌面改动的提交上」，会误导人白挑提交；已连同 workflow 头部注释一起改正并附出处。
- 陷阱（实测）：**Gradle 的任务输入校验先于任何 `doFirst` 执行**——想在「任务输入缺失」时给友好提示，`doFirst` 里守不住（图标缺失时打包任务在动作执行前就因输入校验失败）；正确形态是独立校验任务 + `dependsOn`。已写进 AGENTS。
- 跨平台（能力对齐·刷卡主页）：**桌面首页改成刷卡页，与 Android 一致——五个集成整屏全部可用**——`DeckScreen`(1051) 与 `CardFace`(281) 迁入 `:shared-ui`。两处平台面各有对应手法：
  - **音效接缝** `PlatformSounds`（滑纸 / 翻卡 / 掌握提示 / 点击）：Android 侧包住原 `AudioEffectHelper`（`AudioTrack` 合成音，行为不变），桌面 no-op；
  - **公共 API 替换**：`LocalConfiguration.screenWidthDp`（Android 专有）→ `LocalWindowInfo.containerSize`（CMP 公共，同为像素口径）；
  - **宿主槽位再扩两处**：桌面微件（`AppWidgetManager`）与海报导出面板改由宿主注入——桌面不传，菜单项与面板**自然不出现**。连同上一波的聊天/海报 Sheet，累计省下 1215+ 行平台专属代码的搬运。
  导航对齐：桌面菜单栏「刷卡（主页）/ 收藏阁 / 学习统计 / 知识测验 / 只测今天到期 / 退出测验」。
  验证：全量 **360 项全绿**，桌面新增用例 `deckIsTheHomeScreen`（首页=刷卡页、收藏阁为显式目的地、可回主页）。
- 跨平台（能力对齐·详情页）：**桌面端能点卡片看正文了，四个共享整屏齐活**——`DetailScreen`(446) 迁入 `:shared-ui`。做法上有两点比「抽 expect/actual」更轻：
  - **公共 API 直接消解平台依赖**：外链改用 CMP 的 `LocalUriHandler`（Android 自动走 `Intent`、桌面走系统浏览器）、触觉改用上一波的 `PlatformHaptics`——共享屏里**一行平台代码都不需要**；
  - **宿主槽位**：聊天 Sheet(844) 与海报 Sheet(371) 由宿主以 `chatSheet` / `posterSheet` 传入（`null` = 该端没这个能力），共享屏只管「何时显示」。因此迁详情页**没有连带搬那 1215 行**；配套把「浮层展开时系统返回让位给浮层」改成 `onOverlayVisibilityChanged` 通知宿主，由宿主的 `BackHandler(enabled = …)` 决定。
  「延伸阅读」的推荐打分也从 Android 调用点抽进 `:domain`（`RelatedCards`，5 项表征测试）——否则桌面详情页就得重写一遍。
  验证：全量 **359 项全绿**，桌面新增用例走完「卡库 → 详情 → 收藏落盘 → 返回」。

## [v0.2.0] - 2026-10-02

- macOS：优化学习工作台、统计与搜索的内容层级、字阶、对比度和窄窗口布局；减少装饰性光晕、重复信息与动效。
- macOS：侧栏收起后 logo 与展开按钮共用位置；图标悬停提供标题及操作说明，点击或移出后隐藏。
- macOS：学习计划跨日、时区变化和唤醒后刷新；缓存复习排程及统计聚合，修复统计图溢出和搜索旧结果提交问题。
- macOS：卡片与设置保存告警独立保留，修复成功保存卡片时误清设置写入错误。详见 [发布记录](docs/MAC_RELEASE_0.2.0.md)。

## [android-v0.10.3] - 2026-10-02

- Android：收藏与历史筛选补充选中语义和触控尺寸，浅色主题提高主色对比度并统一 Material 容器配色。
- Android：学习计划与统计按日期、时区更新，修复热力图连续天数被 35 天窗口截断及当天未活动时归零的问题。
- Android：缓存计划排程、统一掌握度取整，媒体入口改为弱引用持有语音控制器；versionCode 升至 23。详见 [发布记录](docs/ANDROID_RELEASE_0.10.3.md)。

## [v0.1.0] - 2026-09-29

- macOS：**版本序列切换**——自本版起 mac 改用 pre-1.0 序列，如实反映「mac 尚非正规产品」的定位；`v4.6.0` 为 4.x 序列末版，历史 tag/Release 全部保留（说明见 [多端协作规范](docs/MULTI_PLATFORM.md)）。
- macOS：界面 Cutline 迁移收官——收藏 / 统计单一路由化（旧面板功能平移进侧栏页：分类筛选、搜索、导出、艾宾浩斯概览、7 天预测、分类下钻；收藏阁 / 学习统计 / 历史记录的菜单与 menubar 入口一律导航侧栏目的地，`FavoritesView` / `StatsView` 归档）；测验与听书控制台原生化（档位 / 语速 / 音调 / 翻卡停顿 / 睡眠定时五组分段胶囊，测验流程、档位反推、滑块与快捷键逻辑原样）；全仓琥珀主色语义归位选中蓝（AI 徽章与入口、错误警告、犹豫想起评级保留琥珀），导入笔记 sheet 选择器溢出修复、主按钮条件配色。
- macOS：刷卡卡片恢复整张分类摄影底图（多阶暗化 scrim + 白字排版，Cutline 结构不变），收藏卡片补缩略图——照片是产品个性；侧栏品牌标改用真实 App 图标（与 Dock 一致），折叠态撞图标去重，修正迁移脚本误换的 genetics 图标。
- macOS：性能——消除侧栏每帧重建 LearningPlan（×2）、工作台每次求值重建、统计页一次渲染重建 5+ 次的三处热点（改为按卡库变化缓存 / 单次计算下发），历史页时间格式化器改静态单例；实测冷启动 2.1s、浏览多页后内存 17MB。

## [v4.6.0] - 2026-09-28

- macOS：学习地图上线（P2 主线 UI 的 mac 侧补齐）——侧栏新增「学习地图」：学科 → 分支 → 难度三级选择器，分支卡支持「专学这条支线」（按 orderKey 顺序推进）与「加入混合」，另有整学科按难度选的阶梯芯片；范围生效时接管卡堆的分类维度（偏好分类让位），刷卡页顶栏显示范围徽标与剩余张数、一键退出；范围只在本次会话内生效。`StudyScope` / `StudyMap` 纯逻辑入 Core，与 Android `StudyScope.kt` 逐条对齐，11 个新用例。详见 [macOS 发布记录](docs/MAC_RELEASE_4.6.0.md)。

## [v4.5.0] - 2026-09-28

- macOS：界面改版——刷卡主视图迁移到新的 Cutline 风 Insight 体系（浮动侧栏外壳 + 深色 surface 卡片 + 1pt 描边，刷卡手势 / 飞出层 / 全部模态路由与快捷键 1:1 保留），卡片面恢复朗读胶囊按键；学习工作台 Cutline 原生化（无衬线字阶 + 选中蓝，交互原样保留）；收藏 / 历史 / 统计换 Cutline 化框架，全部面板完成视觉 token 迁移；旧 `CardView` / `CardDeckView` / `CardSheenOverlay` 归档至 `Views/_archived/`。详见 [macOS 发布记录](docs/MAC_RELEASE_4.5.0.md)。
- macOS：`Package.swift` 将 `Views/_archived` 排除出编译目标；打包脚本支持固定开发签名身份（`KNOWFLICK_CODESIGN_IDENTITY` 或自签名 "KnowFlick Dev"），避免 adhoc 签名变动导致每次启动重复请求钥匙串授权。

## [android-v0.10.2] - 2026-09-25

- Android：AI 与语音凭据的保存、删除移至 IO 协程执行；保留同步落盘结果提示，避免 Keystore 加密与文件同步阻塞界面线程。versionCode 升至 22。详见 [Android 发布记录](docs/ANDROID_RELEASE_0.10.2.md)。

## [v4.4.4] - 2026-09-25

- macOS：剪藏卡片现在会同时去掉 AI 返回的原始提交网址和规范网址重复项，规范来源链接仍置顶。

## [android-v0.10.1] - 2026-09-25

- Android：剪藏卡片现在会同时去掉 AI 返回的原始提交网址和规范网址重复项，规范来源链接仍置顶；versionCode 升至 21。

## [v4.4.3] - 2026-09-24

- macOS：新增网页剪藏入口，先预览抓取正文，再由用户发起 AI 提炼；确认后以导入卡片保留原文链接并可置顶入堆。详见 [macOS 发布记录](docs/MAC_RELEASE_4.4.3.md)。

## [v4.4.2] - 2026-09-24

- macOS：网页剪藏改为流式限量读取，最多保留 4 MB 正文并在超限后取消抓取，避免大响应先完整进入内存。详见 [macOS 发布记录](docs/MAC_RELEASE_4.4.2.md)。

## [v4.4.1] - 2026-09-24

- macOS：系统发来的显式暂停现在只暂停朗读；播放/暂停切换指令仍按当前状态切换，重复暂停不会意外恢复播放。详见 [macOS 发布记录](docs/MAC_RELEASE_4.4.1.md)。

## [v4.4.0] - 2026-09-23

- macOS：听书状态显示在系统控制中心，媒体键与触控栏可播放、暂停、切换卡片及前后跳转 10 秒。
- 修复朗读引擎与播放状态短暂不一致时，暂停或恢复未更新界面与控制中心状态的问题。详见 [macOS 发布记录](docs/MAC_RELEASE_4.4.0.md)。

## [v4.3.0] - 2026-09-22

- macOS：统一学科契约与图谱分片缓存；新增听书控制台、四档预设、睡眠定时与淡出。
- 汇总同步、纸质主题、搜索历史、AI 追问沉淀、错题复盘与学习统计改进。
- 本地 MCP/CLI：知识检索与学习路径、人工确认暂存、卡库自动刷新、并发写保护；修复检索权重、中文分词与输入校验。
- 网页剪藏内核已完成，macOS 界面入口未接入。详见 [macOS 发布记录](docs/MAC_RELEASE_4.3.0.md)。

## [android-v0.10.0] - 2026-09-22

- 新增学科知识地图与学习范围，优化星图缓存、分片与手势渲染。
- 新增网页分享剪藏与正文预览，经用户确认后由 AI 提炼卡片。
- 听书新增四档预设与睡前淡出；汇总生成、搜索、追问、错题复盘与同步改进。
- versionCode 升至 20，保留已有分类、收藏与复习数据。详见 [Android 发布记录](docs/ANDROID_RELEASE_0.10.0.md)。

## [android-v0.9.1] - 2026-09-20

### Android & macOS：双端渲染性能深度优化与功能同构落地

- **安卓端主卡堆 120 FPS 满帧丝滑优化**：
  - 重构 `CardFace.kt` 与 `DeckScreen.kt`：引入 `swipeProgressProvider: (() -> Float)?`，将高频手势位移、3D 轴心微倾角（`rotationY` / `rotationZ`）以及意图印章（♥ 收藏 / ✕ 略过）全部移入 Draw 阶段的 `graphicsLayer { ... }` 内部延迟读取；
  - 拖拽卡片时 Composable 树完全不发生重组（Zero Recomposition），彻底根治卡顿掉帧，满血 120 FPS 硬件层渲染。
- **知识全景星图引力拓扑极速瘦身（冗余边减少 96.4%）**：
  - 重构 `KnowledgeGraphEngine.kt`：利用倒排索引寻找公共关键词候选卡片，按关联系数降序排序后限制保留最强的前 2 条精炼引力线，彻底消除 $O(N^2)$ 连线爆炸；
  - 连线总数从 11,748 条狂降至 419 条（减少 96.4%），单帧绘制耗时由 >100ms 降至 <2ms。
  - `KnowledgeGraphScreen.kt` 引入视口剔除（Frustum Culling）与 LOD（缩放 < 0.75 时自动略过非高亮文字绘制），大图缩放与平移漫游无掉帧。
- **系统状态异步化与主线程零阻塞**：
  - `AudioEffectHelper.kt` 中 `isSystemMuted` 涉及 IPC `ringerMode` 调用，全部移入单线程后台 Executor 异步轮询，避免触摸事件阻塞主线程。
- **macOS 桌面端功能完全同构落地**：
  - **局域网 P2P 极速同步**：落地 `SyncServer`（基于原生 BSD Socket 监听 8998 端口）与 `SyncClient`（支持 RFC1918 私有网段校验），生成 6 位随机安全配对码，与 Android 端完全互通，提供 `SyncSheetView.swift` 交互面板。
  - **4 款纸质人文主题**：落地宣纸白、复古羊皮纸、晨雾冷灰、暖曜黑主题色板与渐变底色，设置页提供 4 款主题可视化切换网格。
  - **16-bit PCM 拟真物理音效**：落地 `AudioEffectManager.swift`，纯 Swift 内存程序化合成 WAV 波形，严格遵循 Swift 6 并发安全与 `@MainActor` 隔离。
- **全量自动化测试 100% 绿灯**：
  - macOS 端 35 组测试套件、242 项测试全部通过（包含 `SyncServiceTests`）；
  - Android 端 28 组测试套件、140+ 项测试全部通过。

## [android-v0.9.0] - 2026-09-20

### Android：全景知识星图、拟真物理音效、纸质人文主题与局域网极速同步

- **交互式全景知识星图（Interactive Knowledge Graph）**：
  - 新增 `KnowledgeGraphEngine` 领域引擎：基于学科倒排索引、关键词 Jaccard 相似度与跨学科引力亲和力算法，将数百张离线卡片聚类映射为星宿拓扑网络。
  - 新增 `KnowledgeGraphScreen` 全景画布：支持双指平滑缩放、双向拖拽漫游、学科分类过滤横滑胶囊与全局检索。
  - 动态连线引力场：展示学科内强关联与跨学科交汇引力光索；节点点击呈现双层同心光环，底部弹出即时知识微卡片预览，支持一键置顶进入卡堆或跳转详情。
- **拟真物理音效系统（Procedural Soundscapes & Audio FX）**：
  - 新增 `AudioEffectHelper`：基于纯 Kotlin 内存 16-bit PCM 波形实时合成，0 外部音频文件引入（**0 KB APK 资源开销**）。
  - 精准模拟四类触感音效：粉红噪声纸张滑动沙沙声（`playPaperSlide`）、卡片利落翻折脆响（`playCardFlip`）、双音和谐五度泛音掌握音（`playMasteryChime`）、微机械点击反馈（`playClick`）。
  - 完美遵循系统免打扰/静音模式，在「AI 服务设置」提供可视化开关。
- **纸质人文视觉主题体系（Paper Theme System）**：
  - 新增 4 款精调纸质底色色板：**宣纸白**（`#FAF9F6` 温暖米白）、**复古羊皮纸**（`#F5EEDC` 古籍典雅书卷黄）、**晨雾冷灰**（`#F0F2F5` 宁静现代排版灰）、**暖曜黑**（`#121215` 柔和深邃护眼暗色），外加自适应「跟随系统」。
  - 采用 1px 微发丝边框与全平微结构托盘，在「AI 服务设置」提供可视化色板卡片实时切换与持久化。
- **局域网端对端无感同步（LAN P2P Zero-Cloud Sync）**：
  - 基于纯 Java 标准库 `ServerSocket` 实现轻量高效内置 HTTP 传输服务，支持 6 位动态配对码安全鉴权与自动发现。
  - 支持局域网/热点端对端双向无感增量合并：智能比对最新版本、合并收藏阁与历史足迹，并自动进行 SM-2 / FSRS 记忆排程状态对齐。
  - 顶部与菜单集成「局域网极速同步…」优雅半屏抽屉面板（`SyncSheet`），支持一键复制本机 IP 与一键双向合并。
- **工程质量与全量自动化验证**：
  - 新增 28 个自动化测试套件（覆盖图拓扑、P2P 协议、主题切换与 UI 导航），140+ 单元测试 100% 绿灯全通。
  - 正式签名 APK（`app-release.apk`）大小仅 5.1 MB，体积零膨胀。

## [android-v0.8.9] - 2026-09-19

### Android：多角度深度体验打磨 — 3D触感动效、系统媒体播控、LaTeX排版、FSRS自适应算法与打卡热力图

- **分级触觉震感与 3D 轴心视差倾角动效（Haptics & 3D Parallax）**：
  - 引入 `HapticFeedbackHelper`，实现 `tick`（按压抓取）、`click`（越过判定阈值）、`success`（掌握/右划双振）、`warning`（跳过/左划双振）四档精细物理反馈。
  - 卡片滑动引入真实 3D 轴心微倾角（`rotationY = tiltY`，`cameraDistance = 16f * density`），结合弹簧阻尼调优，呈现温润生动的物理纸牌视差质感。
- **系统原生媒体播控与锁屏中心（MediaSession & Foreground Service）**：
  - 新增 `SpeechPlaybackService` 前台媒体服务，集成系统级 `MediaSession` 与 `Notification.MediaStyle`。
  - 支持 Android 13+ / 14 / 15 大图波浪纹媒体通知面板，锁屏与通知栏支持切卡、上一张与播放/暂停原生控制。
- **高性能富文本排版与 LaTeX 科学公式引擎（MarkdownTextRenderer）**：
  - 纯 Kotlin / Compose 轻量高效解析，支持粗体、斜体、代码块、引用块及列表项。
  - 自动转换 LaTeX 科学数学符号（如希腊字母、$\pm$、$\times$、$\approx$、$\rightarrow$ 等）与上下标（$x^2 \rightarrow x²$, $H_2O \rightarrow H₂O$），主卡面与详情页排版专业度大幅跃升。
- **FSRS 4.5 自适应认知排程算法与 35 天活跃度热力图（FSRS & Activity Heatmap）**：
  - 集成现代间隔重复记忆前沿算法 FSRS 4.5（稳定性 $S$、难度 $D$ 与可提取率 $R$ 三维模型），根据 90% 目标留存率动态计算最优复习间隔。
  - `SpacedRepetitionEngine` 支持 SM-2 与 FSRS 双算法引擎动态双向热切换，完美兼容历史数据。
  - 学习统计中心新增 GitHub 风格 35 天（5 周）学习打卡活跃度日历热力图，提供 5 阶微彩图谱直观展现连续打卡习惯。
- **Compose 性能与编译器重组优化**：
  - 核心领域模型 `Card` 标注 `@androidx.compose.runtime.Immutable`，向 Compose 编译器声明不可变契约，杜绝滑动过程中的无效重组与内存抖动。

## [android-v0.8.8] - 2026-09-19

### Android：SM-2 智能复习系统、扁平化人文设计、全文检索与全功能伴学矩阵

- **核心 SM-2 记忆模型引擎（SpacedRepetitionEngine）**：
  - 支持四档精准评估（`AGAIN 重来`、`HARD 较难`、`GOOD 良好`、`EASY 容易`），与测验（Quiz）及手势划卡无缝互通。
  - 动态间隔计算模型（第1次 1天，第2次 3/6天，后续按简易度因子 $I \times EF$ 幂律扩展，重来复位并施加惩罚系数）。
  - 基于艾宾浩斯遗忘曲线的可提取率预测模型：$R(t) = \exp(-0.10536 \cdot t / I)$，直观反映记忆留存衰减。
  - 提供即时动态间隔天数预告能力（`previewNextIntervals`）。
- **主刷卡流专属复习卡堆模式（Review Deck Mode）**：
  - 顶栏智能复习入口：当存在到期/逾期卡片时，顶栏优雅展示琥珀色「• 复习 N」徽标，支持一键切换。
  - 沉浸式复习顶栏：进入复习模式后自动收拢为「专属复习卡堆 (N)」与「退出复习」轻量胶囊，顶栏布局重新解耦，彻底杜绝小屏文本折行与截断。
  - 卡片顶部记忆留存率芯片：实时展示「🧠 留存 X% · Y天间隔」。
  - 底部四档 SM-2 即时自评按键：针对当前卡片动态预览「重来 1天」、「较难 1天」、「良好 1天」、「容易 2天」等具体下一次间隔，一键触达。
  - 左右划卡手势联动：左划等同于「重来」，右划等同于「良好」。
  - 圆满复习达成祝贺面板（ReviewCelebrationCard）：本轮到期卡片全部刷完后展示达成卡与强化张数总结，支持一键无缝返回常规卡堆。
- **安卓 UI 深度扁平化美化（Flat Minimalist & Editorial UI）**：
  - 温润纸白（`#FAF9F6`）与暖曜黑（`#121215`）双模基底，彻底剔除厚重 3D 阴影与沉闷黑渐变。
  - 4 阶通透摄影微遮罩（`0.14f -> 0.28f -> 0.58f -> 0.80f`），通透保留摄影高光并衬托文字。
  - 1px 极细微结构发丝边框（Hairline borders），规范贯穿卡片、胶囊、弹窗与输入框。
  - 低饱和淡雅微彩系统（Muted Pastels）：鼠尾草绿、绯红玫粉、冰川灰蓝平托盘与胶囊。
  - 学习统计中心（StatsScreen）消除硬编码深色，自适应深浅色，三色掌握度微彩卡与排程预测柱状图。
  - AI 服务设置与伴学追问面板全面扁平化，发丝边框与主题色彩深度统一。
- **全局全文检索与智能标签多维筛选系统（Search & Multi-Filter）**：
  - 支持拼音全拼与声母模糊检索（如 `zzx` 检索中子星），彻底消除拼音与正文噪声误匹配。
  - 来源与状态多维过滤（全部/精选/AI/收藏/足迹/待探索）与学科横向滑动分类 Chip。
- **知识库离线归档与全量备份恢复系统（Backup & Restore）**：
  - 支持 JSON / Markdown / ZIP 全量离线归档导出，支持全量、收藏、历史三维范围。
  - 支持导入恢复对话框与冲突合并。
- **基于 Jetpack Glance 的桌面每日卡片微件（AppWidget）**：
  - 支持小号与中号微件，定时轮播每日精选知识，点击一键唤醒 App 并定位卡片。
- **全功能离线语音朗读控制台与 Mini Player 悬浮播控条**：
  - 毫秒级定位拖拽、语速语调微调、磨耳朵翻卡停顿间隔与睡眠定时器。
- **知识卡片分享海报与长图导出系统（CardPoster）**：
  - 典雅画报风与文艺拍立得风双模实时光栅化渲染，内置二维码与精选背景。
- **卡片 AI 伴学深度追问与流式对话面板（CardFollowUpChat）**：
  - 4 组启发式引导词（💡/🔍/⚡/❓），流式打字光标效果、朗读回答与一键复制。
- 详见 [发布记录](docs/ANDROID_RELEASE_0.8.8.md)。

## [android-v0.8.7] - 2026-09-17

### Android：手势误检测与准确度重构、UI 美化与微交互升级

- **手势误检测与准确度系统化重构**：
  - 印章安全死区由 8dp（~0.08）扩大至 28%（约 35dp+），杜绝手持晃动与轻微按压时印章瞬时闪烁；在 `[0.28f, 0.80f]` 区间平滑渐变展开，`>0.80f` 稳固实心显示。
  - 主轴横向锁定（Horizontal Dominance Guard）：引入 `|dx| > |dy| * 1.20f` 判定，只有横向绝对占优时才激活滑动意图与底卡透出，纵向阅览与斜向滑动强制屏蔽印章并平滑吸附回中，彻底消除纵滑误划走卡片。
  - 纵向物理阻尼（Vertical Damping）：卡片纵向位移增加 `0.35f` 阻尼约束，手感扎实跟手，释放平滑吸附回中。
  - 引入 `VelocityTracker` 速度辅助支持 Fling：水平甩动速度 `>= 600dp/s` 且水平主导时支持利落甩卡，兼顾防误触与敏捷度。
  - 补充 2 项端到端手势防误判回归测试（纵向下划卡片不切、纵向斜划卡片不误切），模拟器仪器测试 31 项全绿。
- **UI 质感美化与微交互动效升级**：
  - 卡片滑动意图动态印章反馈（Swipe Intent Stamp）：左右拖拽伴随 `±12°` 倾斜与 `0.85 -> 1.0` 缩放，精确校准边距防裁切。
  - 卡片微光渐变边框（`White 25% -> White 8%`）与 `20.dp` 柔和圆角，大标题文本微阴影，分类标签采用磨砂玻璃胶囊。
  - 底部操作栏弹簧缩放交互，收藏按键心跳脉冲反馈（`1.0 -> 1.26 -> 1.0`）。
  - 知识库页面一体化嵌入式双胶囊分段条（Segmented Tabs），提升空态和卡片条目质感。
- 详见 [发布记录](docs/ANDROID_RELEASE_0.8.7.md)。

## [v4.2.1] - 2026-09-16

### macOS：Core 层缺陷修复、星图性能优化与 AppStore 拆分

- 「换一批新知识」从「把整个卡堆标记为已看」改为「只跳当前顶卡」（对齐 Android 行为）——此前一次点击会把全部待刷卡写入历史（实测 216 张卡全进历史、卡堆清空），污染连续天数与趋势统计。
- 星图构图从 O(n²) 两两比较改为倒排索引交集 + 内容签名缓存：216 张卡库实测 7.77s → 0.47s（约 16 倍），边集输出与朴素口径逐条一致。
- 修复 AI 流式生成在正文出现游离 `}` 后扫描器深度失同步、导致后续合法卡片全部扫不出的问题。
- 修复「数据加载未完成即退出」写出的空卡片数组被误判为损坏文件的问题：载入侧改为「解码成功即有效」，落盘侧增加启动期守卫（该守卫原先保护的真实丢库路径仍由备份恢复覆盖）。
- 撤销插回、全局搜索置顶、导入置顶三条路径统一收敛到 `DeckDeriver` 的防重插回入口，杜绝置顶后与相邻卡片撞图。
- 追问会话打开改为进程内缓存 + 后台队列异步校正，长会话不再在主线程同步全量读盘。
- AppStore 拆分（878 → 617 行）：抽出 `PersistenceCoordinator`（持久化编排）、`DeckDeriver`（卡堆派生纯函数）、`ChatSessionStore`（聊天编排）、`SettingsStore`（凭据事务）；对外 API 与成员名保持不变，Core 测试 175 → 239 项。

### macOS：视图层交互、文案与性能修复

- 星图检索框此前无任何效果——检索现在会真正过滤/压暗节点，热区与渲染共用同一可见判据（灰节点不再可点）。
- 磨耳朵「下一张」等系统跳过不再飞出绿色「感兴趣」章，改为中性「已跳过」标记，与 skip 不计喜好的统计口径一致。
- 设置页「停止播放」接入完整停止逻辑（此前只停磨耳朵、不停常规朗读）。
- 收藏阁：导出菜单空库时禁用并给出提示；日期显示改用收藏时间口径（与排序一致）；测验入口提示改为与真实题源一致。
- 导入预览解析过程中禁用「重新解析 / 确认导入」，杜绝连点导入上一轮结果。
- 海报系统分享失败补 toast 与窗口回退（此前静默失败）。
- 全局搜索复用 AppStore 搜索引擎（拼音缓存不再每次开窗重建）；设置页语音列表改为打开时取一次；统计页日期格式化器提为静态复用。
- 历史页区分「导入笔记」来源；帮助面板补齐 ⇧⌘I / ⇧⌘E / ⌘R；统计页标题改为与内容一致的「分类浏览与感兴趣分布」。

## [android-v0.8.6] - 2026-09-16

### Android 底图多图池、撤销功能与缺陷修复

- 修复底图映射与防重排布脱钩（P0 用户可见缺陷）：排布侧与渲染侧原先使用两套不相交的 key 空间（`bg0..41` vs 语义名），`minDistance=5` 防重对真实底图完全失效；且已知分类整体折叠到单张底图（冷知识 160 张全用 `study`）。现已移植 macOS 的领域多图池解析器（4 池 42 图 + 56 条关键词规则 + 哈希兜底），实测 214 张种子卡：冷知识 160 张从 1 种图 → 34 种，全局 6 种 → 38 种 key。同步修正两端哈希取模的有符号/无符号不等价问题，保证同一张卡在两端映射到同一张底图。
- 图池长度不再硬编码 `% 42`；新增资产护栏测试（`assets/bg/*.webp` 与键清单严格一一对应，增删底图会在 JVM 测试阶段失败而非运行时静默变形）。
- 补「撤销上一张」：顶栏 ⋮ 菜单入口；`undoLastSwipe` 改为快照还原，不再误清收藏（与 macOS 的收藏/喜好解耦契约对齐）。
- 测验选题 `due` 双算与 O(n²) 成员判断集合化，消除大卡库点「知识测验」的主线程卡顿风险。
- 设置页在 Keystore 不可用时显示降级提示（此前静默回退明文存储）；备份规则排除凭据文件，并经 `bmgr` 端到端实测（有规则：凭据不进备份集、卡片完整恢复；对照组：密文被恢复到主密钥缺失的新环境、无法解密而静默降级——缺陷链实测确认）。
- 背景图缓存去全局锁、上限随堆缩放；远程语音改 `prepareAsync()`；划卡阈值由硬编码像素改 dp，跨设备手感一致。
- Lint 警告 8 → 5：`commit()` 保留并注明原因（返回值驱动设置页成功/失败提示）；`security-crypto` 升级至 1.1.0（API 已弃用，迁移 DataStore/Tink 登记为技术债）；`lifecycle` 升级经实测被 lint 检测器崩溃阻断，记录后留给工具链升级。
- 完整回归：96 项 JVM 测试（+19）、29 项 Android 15 ARM64 模拟器测试（+1）、0 错误 Lint；baseline profile 重采（17530 → 17802 条）并重新构建 Release。详见 [发布记录](docs/ANDROID_RELEASE_0.8.6.md)。

## [android-v0.8.5] - 2026-09-15

### Android 滑卡渲染与性能路径修复

- 卡堆最深层只绘制露出的轻量背板，并在后台预解码即将出现的图片，减少每次滑动同时绘制三张全屏图片、渐变和文字的 GPU 压力；当前卡与下一张卡仍保持完整内容，切换时直接命中图片缓存。旧卡退场由 220ms 缩到 180ms，并在前半程完成淡出，避免切换后上一张长时间盖住新内容。
- 修复 baseline profile 采集器错误使用带包名前缀的 Compose 资源 ID、把图标说明当文本查找且允许静默跳过的问题；采集现在强制覆盖启动、连续滑卡和收藏阁，找不到节点会直接失败。
- 新 profile 的应用规则由 528 条增至 750 条，明确包含 `CardStore.swipe`、118 条 `DeckScreen` 规则及此前为 0 的 73 条 `LibraryScreen` 规则。
- 收藏 Markdown 与 JSON 归档的序列化移到 IO 线程，大卡库导出不再占用主线程。
- 完整回归通过 77 项 JVM 测试、28 项 Android 15 ARM64 模拟器测试和 0 错误 Lint；0.8.4 覆盖升级验证保留收藏与历史。详见 [发布记录](docs/ANDROID_RELEASE_0.8.5.md)。

## [v4.2.0] - 2026-09-14

### 仓库结构：多端布局

为 Windows 与浏览器插件端的加入做准备，仓库从「mac 占根目录」调整为「apps/ 各端 + shared/ 共享」。

- mac 端移入 `apps/mac`，android 端移入 `apps/android`；构建产物统一收敛到根 `dist/`。
- 种子卡与 42 张分类底图提取到 `shared/assets` 作为唯一事实来源。迁移前两端各存一份副本，逐字节比对确认完全一致后删除重复项。
- mac 侧由 `tools/sync_shared_assets.sh` 把共享资产同步进 SwiftPM 资源目录（不用符号链接：跨 target 的软链在 SwiftPM 下不可靠），android 侧用 `assets.srcDirs` 指向共享目录。
- 底图统一为 WebP：mac 端 `NSImage` 与 ImageIO 缩略解码两条路径均已实测可解，android 端包体因此减少约一半。
- 新增 [多端协作规范](docs/MULTI_PLATFORM.md)：分支模型（短特性分支 + main 汇总）、按端前缀的 tag 约定与发版检查清单。

此变更不涉及各端功能，android 的 77 项 JVM 单测、28 项仪器测试与 Lint 均通过，release 产物内资源确认来自 `shared/`；mac 的 `KnowFlickCore` 构建通过且 resource bundle 内 214 张种子卡与 42 张底图完整。

### macOS：修复打包产物启动即崩（长期缺陷）

`build_app.sh` 打出的 `KnowFlick.app` 双击启动即崩溃，报
`Fatal error: could not load resource bundle`。**已发布的 v3.2.0 同样受影响**——
Release 上的 `KnowFlick.app.zip` 与本地 9-11 产物字节相同（sha256
`b9dab505…`），下载后启动即崩，崩溃栈落在
`AppStore.loadSeedCards() → NSBundle.module`。

根因是 SwiftPM 生成的 `resource_bundle_accessor` 在不同工具链下候选路径不同：

| 工具链 | 候选路径 | `Contents/Resources` 布局 |
| --- | --- | --- |
| CommandLineTools 27 | `Bundle.main.resourceURL` → `bundleURL` | 能找到 |
| Xcode 26.3 | `Bundle.main.bundleURL` → 编译期 `.build` 路径 | **找不到，直接 fatalError** |

资源 bundle 的位置不能改：放到 `.app` 根目录虽能被 Xcode 产物找到，却会破坏代码签名
（实测 `unsealed contents present in the bundle root`，`codesign --verify` 失败）。
因此改为在 `CoreResources` 里自行按候选列表查找，两个工具链的产物都能命中。

同时补上启动自检：`build_app.sh` 与 CI 都会实跑一次二进制，出现该致命错误即判失败——
这个缺陷此前能长期潜伏，正是因为编译、签名、资源复制全部通过，只有真正启动才暴露。

新增 macOS 云端构建 [workflow](.github/workflows/macos.yml)：公开仓库的 macOS runner 免费且自带
完整 Xcode，可绕开本机缺 Xcode 的限制；推 `v*` tag 时自动构建并把 zip 与校验和附到 Release。

首个通过的云端构建：[run 34826959715](https://github.com/bitterSmilezzz/knowflick/actions/runs/34826959715)
——173 项测试通过、产物签名有效、资源完整（214 张种子卡 + 42 张底图）、实际启动并持续运行。

### 版本号整理：两端版本序列分离

mac 端的版本号曾被 Android 开发借用：`v4.1.1`–`v4.1.8` 这 8 条记录的内容其实都是
Android 里程碑（M1–M7），对应的 tag 是 `android-v0.1.0`–`v0.7.0`。为免与 mac 自身版本混淆，
这 8 条已更名为对应的 android 版本号，CHANGELOG 中 android 序列现为
`android-v0.1.0` → `android-v0.8.4` 连续排列。

mac 端版本号自 **4.2.0** 起继续（`AppVersion.swift`），与 Android 端互不相干。
两端的版本规则见 [多端协作规范](docs/MULTI_PLATFORM.md)。

### 两端云端构建

新增 [Android workflow](.github/workflows/android.yml)：在 Linux runner 上跑 77 项 JVM 单测与
Lint，产出 debug APK 并校验包内资源来自 `shared/assets`（种子卡 + 42 张底图）。
正式发布用的 release 签名包需 keystore 与 `signing.properties`，属敏感凭据，待通过
GitHub Secrets 注入后再启用，避免把 debug 包误当发布产物。

两个 workflow 的 action 一并升级到 Node.js 24 版本（checkout v7、setup-java v6、
cache v6、upload-artifact v7、setup-android v4），消除 runner 的弃用警告。

### 测试与工具

- 新增底图解码回归测试：逐个解码全部 42 张 WebP 并要求取到真实像素，另确认缩略解码
  确实按最大边长下采样，防止「不全量解压原图」的优化悄悄失效。mac 端测试增至 175 项。
- `tools/test.sh` 新增 `--core-only`：本机只有 CommandLineTools 时也能跑全部 175 项
  Core 测试（执行文件依赖 SwiftUI 宏，只有完整 Xcode 才有）。同时修掉两个缺陷：
  Swift Testing 宏插件路径缺失导致的间歇性构建失败、缺宏插件时抛 487 行错误的现象。
- 新增 `tools/lint_shell_vars.sh`：`$VAR` 紧跟全角标点时 bash 会把该字符首字节并入变量名，
  只在 UTF-8 locale 的 bash 下触发，本地极易漏过。已接入两个 workflow。

## [android-v0.8.4] - 2026-09-14

### Android 失效链修复与包体优化

- 修复刷完卡片后点「重新探索全部卡片」界面不刷新的问题：卡堆改为显式数据参数，用列表内容驱动重组；此前 `version` 参数在 DeckScreen 内从未被读取，整表重置会被 Compose 跳过（模拟器 5/5 复现，修复后 release 包 3/3 通过）。
- 归档恢复改为按字段合并，内容取归档、学习状态取本机，避免导入旧归档清空收藏或把已浏览卡放回卡堆；匹配过程改用哈希索引，消除大归档在主线程的 O(n×m) 比较。
- `onPause` 的 flush 改为等待落盘完成（上限 400ms），防止退到后台被系统回收时丢失最后一批改动。
- AI 与语音客户端补整体呼叫超时；分享文件改用唯一文件名，语音临时文件按卡片命名，避免覆盖正在被读取的内容。
- 背景图由 JPEG 转为 WebP 并提高解码尺寸：发布包从 7.88 MiB 降到 3.95 MiB（−49.9%），顶卡不再因降采样而发虚，图片缓存上限提升到 32 MiB。
- 移除 material-icons-extended 全量图标依赖，自绘必需的 4 个图标，debug dex 由 42.2 MB 降到 29.1 MB。
- 接入 baseline profile，生成 15052 条规则（其中 528 条为应用自身类，此前为 0 条）。
- 完整回归通过 77 项 JVM 测试、28 项 Android 15 模拟器测试、0 错误 Lint；0.8.3 覆盖升级保留收藏与历史。详见 [发布记录](docs/ANDROID_RELEASE_0.8.4.md)。

## [android-v0.8.3] - 2026-09-14

### Android 卡片滑动流畅度修复

- 卡片拖动改为逐帧直接跟随手指，只在未达到切换阈值时使用弹簧回弹，消除输入与画面之间的滞后。
- 滑动时底层卡随进度抬升；松手后新顶卡立即显示在飞出卡下方，旧卡使用 220ms 快速退场，避免切换后回显上一张内容。
- 卡片组合状态按卡片 ID 固定，飞出层优先复用内存背景图，避免列表换位复用旧状态或图片异步加载闪灰。
- 新增跟手帧与切换可见性回归测试；完整回归通过 76 项 JVM 测试和 28 项 Android 15 模拟器测试，0 失败、0 跳过。
- Android 版本更新为 0.8.3 / 11，沿用既有发布签名，0.8.2 覆盖升级保留收藏与历史数据。详见 [修复记录](docs/ANDROID_RELEASE_0.8.3.md)。

> 状态：源码从未提交到 git——无 tag、无 Release，只留下本地签名 APK（见 [多端现状报告](docs/STATUS_2026-09-14.md) 第八节）。

## [android-v0.8.2] - 2026-09-14

### Android 模拟环境稳定性修复

- 修复屏幕重建后测验卡翻面丢失、连接测试永久停留在“测试中”、详情参考链接无法点击，以及窄屏、横屏和软键盘下的设置页遮挡问题。
- JSON 归档导入现在完整恢复来源、收藏、浏览和学习进度；新增卡保留归档 ID，已有卡按 ID 或标题安全合并，并拒绝空标题和超大文件。
- 卡片与设置改用原子写入和串行后台队列，移除 `onPause` 主线程阻塞；导入、分享文件生成和远程请求可取消，停止语音后不再发生延迟播放。
- 本地 AI／语音服务不再携带残留云端密钥；修正 DeepSeek 默认地址与模型、自定义服务密钥规则、服务商域名识别和本地回环地址判断。
- JSON、Markdown 与 Anki 导出改为带临时读取权限的真实文件分享；测验在完整卡池耗尽前不再跨轮重复；User-Agent 使用实际安装版本。
- 完整回归通过 76 项 JVM 测试和 26 项 Android 15 模拟器测试；Lint 无错误，签名、ZIP 对齐、冷启动及 0.8.1 覆盖升级验证通过。
- Android 版本更新为 0.8.2 / 10，沿用既有发布签名。详见 [修复记录](docs/ANDROID_RELEASE_0.8.2.md)。

> 状态：源码从未提交到 git——无 tag、无 Release，只留下本地签名 APK（见 [多端现状报告](docs/STATUS_2026-09-14.md) 第八节）。

## [android-v0.8.1] - 2026-09-13

### Android 导航与触摸修复

- 顶卡接入点击打开详情，保留拖拽刷卡；历史卡片接入详情回调。
- 从收藏或历史进入详情后返回原知识库页面，保存标签、筛选和列表滚动状态。
- 保存当前页面、详情卡片 ID 和返回目标，修复屏幕旋转／Activity 重建后跳回卡堆。
- 详情按 ID 与状态版本读取最新卡片，避免持有旧卡片快照。
- 新增 4 项真实触摸与 Activity 重建回归测试，修复前全部失败，修复后全部通过；完整回归为 65 项 JVM + 18 项设备测试。
- Android 版本更新为 0.8.1 / 9，沿用 0.8.0 发布签名。详见 [修复记录](docs/ANDROID_RELEASE_0.8.1.md)。

> 状态：源码从未提交到 git——无 tag、无 Release，只留下本地签名 APK（见 [多端现状报告](docs/STATUS_2026-09-14.md) 第八节）。

## [android-v0.8.0] - 2026-09-13

### Android APK 交付与稳定性优化

- 修复刷卡、收藏和 JSON 导入未统一触发保存的问题；卡片快照通过串行 IO 队列写入，离开前台前排空最新操作，AI 结果回到主线程更新。
- 图片解码移到后台，缓存限制为 12 MiB；刷卡动画由状态变化驱动，移除空闲轮询。
- 适配 Android 15 系统安全区域，修复状态栏遮住顶栏的实际触摸问题；标题使用弹性宽度，保证 320dp 窄屏保留全部操作按钮。
- Android 包版本更新为 0.8.0 / 8，启用 R8 与资源压缩、独立发布签名及一键构建校验脚本，输出 APK、SHA-256 和 mapping。签名私钥不入仓库。
- 测试与安装记录见 [Android 0.8.0 交付报告](docs/ANDROID_RELEASE_0.8.0.md)。本轮交付本地可安装 APK，未上传应用商店。

> 状态：源码从未提交到 git——无 tag、无 Release，只留下本地签名 APK（见 [多端现状报告](docs/STATUS_2026-09-14.md) 第八节）。

## [android-v0.7.0] - 2026-09-12

### Android M7：凭据持久化加固与知识测验（安卓开发 · 里程碑 7）

- **凭据持久化（修复真实缺陷）**：API Key 与语音密钥此前只存内存、重启即丢；改用 `EncryptedSharedPreferences`（Android Keystore AES256 主密钥加密），Keystore 异常时回退普通存储并标记降级不静默丢数据；新增设备级测试验证跨实例（模拟重启）读写与「JSON 设置文件永不含密钥明文」护栏。
- **知识测验（主动回忆）**：`QuizSession` 纯逻辑（到期复习优先 → 收藏 → 历史 → 其余补齐；单轮 10 张；同一张卡本轮只评一次守卫；随机源可注入以便确定性测试）+ Compose 测验屏（380ms 3D 翻面、三档自评按钮翻面后才可用、进度条、完成总结页与「再测一组」）。
- **记账口径与 macOS 一致**：三档自评（没想起来/犹豫想起/熟练掌握 → masteryLevel 0/1/2）经 `recordQuizResult` 写回卡片池，复习次数与熟练度计入而**不写浏览状态**（已刷/连续天数不受污染）；到期队列随评分刷新。
- **验证**：65 项 JVM 测试 + 10 项模拟器 instrumented 测试全绿；模拟器实测完整测验轮次（10/10 → 总结「掌握 10」）与评分回写统计页「已掌握 10」。


## [android-v0.6.0] - 2026-09-12

### Android M6：语音三通道、磨耳朵连续播报与设备级验证（安卓开发 · 里程碑 6）

- **语音三通道**：系统 TTS（默认）/ 云端 HTTPS `/v1/audio/speech` / 本地回环网关（免密）；通道决策收敛到 `SpeechChannelPolicy`（云端强制 HTTPS + 密钥、本地限定 127.0.0.1/localhost、裸域名补 /v1 且保留自定义前缀）；远程失败自动回退系统语音并提示原因。
- **磨耳朵连续模式**：卡片播完 → 间隔 → 系统跳过当前卡并自动播报下一张（与 macOS `onAmbientAdvanceRequest` 同语义）；无卡时自动收束退出。
- **设备测试抓到并修复 3 个真问题**：① Android 9+ 明文策略拦截本地网关——新增 network security config 仅对回环地址放行，其余强制 HTTPS；② 详情页内容滚动层压在顶栏之上导致朗读/收藏按钮看得见点不动——层级顺序调整；③ 顶栏图标增至 5 个在 320dp 屏挤掉「设置」——统计与设置收纳进「更多」菜单，顶栏收敛为 4 项。
- **验证手段升级**：新增两条设备级端到端语音测试（设备内 MockWebServer 扮演 Kokoro 网关）——详情朗读「POST → WAV → MediaPlayer 播放」与磨耳朵「播完自动推进到下一张并再次合成」均在模拟器上断言通过；另以 adb reverse + 本机 mock 服务实测连续 3 次真实合成请求与播放态 UI。
- **验证**：58 项 JVM 测试 + 8 项模拟器 instrumented 测试全绿；Release APK（17.3MB）构建通过。


## [android-v0.5.0] - 2026-09-12

### Android M5：知识库（收藏阁 + 历史足迹）、导入导出与语音朗读（安卓开发 · 里程碑 5）

- **知识库屏**：收藏阁与历史足迹双段合一——收藏阁按收藏时间倒序（取消收藏入口在详情页）、历史足迹按浏览时间倒序并支持按意图筛选（全部/感兴趣/不喜欢）；顶栏提供收藏 Markdown 分享、JSON 归档分享与文件导入。
- **导入导出与 macOS 同格式**：JSON 归档走 cards.json 同构线格式（含 UUID/复习进度/意图）；逐卡挽救解码 + 归一化标题去重；导入卡强制 imported 来源并清空浏览状态（不覆盖学习历史口径一致）；单文件 Markdown 导出目录 card-N 锚点与正文一致、来源三分支；Anki TSV。
- **语音朗读（系统 TTS 通道）**：详情页顶栏朗读按钮（播放/停止切换、状态着色），卡片全文（标题+分段）播报；云端 /audio/speech 与本地网关通道后续接入（复用同一 UI）。
- **验证**：51 项 JVM 测试 + 模拟器 instrumented 5 项全绿；模拟器实测知识库屏真实数据渲染（收藏 2 · 历史 1 · 收藏时间戳）。


## [android-v0.4.0] - 2026-09-12

### Android M4：AI 生成、设置页与 16 服务商预设（安卓开发 · 里程碑 4）

- **AI 服务层**：OpenAI 兼容客户端（OkHttp 流式 + 字节级增量对象扫描，够数即停）、endpoint 拼接口径与 macOS 一致（保留自定义前缀、裸域名补 /v1）、429/5xx 指数退避重试（退避可注入）、非 2xx 错误体提取服务端 message、近重复抑制（归一化标题 + bigram Jaccard > 0.35）与 ≥80 字门槛、超 6 张自动分批衔接跨批排除口径。
- **16 档服务商预设移植**：三分组（在线 13 / 本地 2 / 自定义 1），id 唯一、defaultModel ∈ models、免密约定（Ollama/本地网关）、`match()` 域名反查与端口误判防护——一致性测试与 macOS 同语义。
- **设置页落地**：分组预设 chips（FlowRow 自动换行）+ Base URL/模型/密钥三字段 + 测试连通性（进度态与结果着色）+ 保存配置；密钥与 JSON 设置分置（CredentialStore 接口 + 内存替身，Keystore 版后续接入）。
- **生成入口**：卡堆顶栏 AI 生成按钮（加载态 + 完成提示「已生成 N 张新知识 ✓」，未配置时提示先去设置）；ViewModel 承接生成链路与节流落盘。
- **验证**：51 项 JVM 测试（新增 AI 预设/解析/生成/重试 11 项）+ 模拟器 instrumented 5 项全绿；模拟器实测设置页全量渲染与 FlowRow 换行。


## [android-v0.3.0] - 2026-09-12

### Android 视觉精修：布局密度与字号对齐 Mac 端（安卓开发 · 里程碑 3）

- **卡堆 z 序缺陷修复**：卡堆层次变换的索引此前被直接当作深度（asReversed 后的索引），导致最深的卡全尺寸渲染、分类图章呈阶梯状外漏；修正为按真实堆叠位置计算变换，层次外露收敛为 Mac 风格的轻微边缘（scale 0.028/层、下沉 24dp/层）。
- **字号密度整体收敛**（对齐 Mac 端的精致度）：卡面大标题 30→24sp、摘要 15→13sp、印章/AI 徽章 11→10sp；详情页标题 32→24sp、正文 15→13.5sp；统计页指标格 30→24sp、标签 12→10.5sp；顶栏标题 19→17sp；意图按钮 56/62→48/54dp、标签 11→10sp；各屏内边距同步收紧（26→20dp）。
- **验证**：模拟器实机截图对比确认（卡堆/详情/统计三屏密度协调、图章阶梯消除、划卡后统计实时联动 1 已刷·100%·连续 1 天）；45 项自动化测试全绿。


## [android-v0.2.1] - 2026-09-12

### Android 测试基建四层补齐与真机缺陷修复（安卓开发 · 里程碑 2.5）

- **四层测试体系落地**：JVM 单元测试（38 项）+ **Robolectric**（2 项：assets 种子库 214 张全量加载、42 图池 key 全覆盖）+ **模拟器 instrumented 测试**（5 项 Compose UI 测试：顶栏语义、顶卡渲染、右划推进、详情打开、收藏切换）+ 模拟器实机跑通并截图验证（卡堆/详情/统计/返回/真实划卡手势）。
- **模拟器环境**：emulator + android-35 google_apis arm64-v8a 镜像安装，`knowflick-test` AVD 创建（HVF 硬件加速）；instrumentation 显式指定 `androidx.test.runner.AndroidJUnitRunner`（AGP 默认落成了旧版 runner 导致 0 测试被发现）。
- **实机测试发现并修复 3 个真实缺陷**：① `BackgroundImageCache` 在 `asImageBitmap` 后 recycle 底层位图导致划卡时 Canvas 崩溃；② 拖拽出界路径未挂飞出层（新顶卡带残留位移出现）；③ 系统返回键在详情/统计页直接退出应用（补 BackHandler 与屏内导航一致）。
- **手势模型重构**：输入追踪（同步 rawDrag）与渲染动画（弹簧追赶）解耦，松手判定读取同步位移，消除「动画未追上输入」竞态；划卡阈值对齐 macOS 85pt 口径（≈220px@2.6x）。
- **验证**：45 项自动化测试全绿（40 JVM + 5 instrumented）；模拟器实测零崩溃。


## [android-v0.2.0] - 2026-09-12

### Android M2：Compose 刷卡主界面（安卓开发 · 里程碑 2）

- **卡堆界面**：3 张可见卡堆（缩放/下沉层次）、拖拽划走（阈值 260px 预警触觉 + 300px 飞出、旋转与回弹弹簧）、飞出层独立动画（划走的卡片从底层剥离独立飞离淡出，底层平滑就位——与 macOS FlyingCardOverlay 同构）、底部意图按钮（不喜欢/收藏/详情）与「换一批」（skip 语义不计喜好）。
- **卡面视觉**：assets 摄影底图降采样缓存（RGB_565 + inSampleSize）、多阶非线性暗化遮罩、衬线黑体大标题、分类印章与 AI 生成徽章——对齐 macOS Dark Editorial 视觉结构。
- **详情页**：整页底图 + 渐变、正文双换行分段、延伸阅读列表、收藏切换、AI 提示条。
- **统计页**：已刷/感兴趣率/连续天数/已掌握四格 + 近 7 天趋势柱（今日高亮）+ 分类双轨条形行。
- **架构**：`AppModel`（存储 + 种子增量合并）与 `KnowFlickViewModel`（350ms 节流持久化、onPause flush）分离；`ThemeKey` 分类别名映射与 macOS CategoryTheme 对齐，未知名确定性哈希兜底。
- **验证**：38 项 JVM 测试全绿；Debug APK 装配成功。真机/模拟器实测待后续（本机无连接设备）。


## [android-v0.1.0] - 2026-09-12

### Android M1：可编译工程与领域核心移植（安卓开发 · 里程碑 1）

- **工程落地**：`android/` 新增 Kotlin 2.0 + Jetpack Compose + AGP 8.7 的可编译工程（minSdk 26 / targetSdk 35），含 Gradle wrapper 与 `.gitignore`；种子库（214 张）与 42 张摄影底图随包进入 assets。
- **领域核心移植**（与 macOS 逐语义对齐）：`KnowledgeCard`（收藏/喜好解耦、缺失字段回填）、`CategoryRegistry`（别名白名单语义）、`StatsCalculator`（意图计数/连续天数/7 日趋势）、`LearningPlan`（次日复习 + 1/3/7 间隔）、`CardStore`（来源开关四组合、偏好耗尽回退+撤销、卡堆保序、防重排布、测验记账）、`CardStorage`（主文件 + 备份轮转 + 损坏标记快路径）。
- **线格式对齐**：JSON 与 Swift Codable 逐字段一致（ISO8601 秒级、CamelCase、旧数据 isFavorite 从右划回填、未知来源兜底 seed、毫秒级/epoch 数字日期宽容解码）；FNV-1a 哈希与 macOS 端跨平台锚点一致。
- **测试**：38 项 JVM 测试全绿（JSON 往返/宽松解码、分类解析、统计边界、状态机承诺、存储轮转/损坏恢复、学习计划间隔）；Debug APK（16.3MB）装配成功。


## [v4.1.0] - 2026-09-12

### 第二阶段收官（二十轮优化续作 · 第 25 轮）

- **总结文档更新**：`docs/OPTIMIZATION_ROUNDS.md` 增补第二阶段（R21–R25）记录——分批生成、全包 Swift 6、组件归位、交叉复审修复，以及 CHANGELOG 污染事故与测试段错误根因的完整复盘。
- **全量回归**：测试 / 全新 Release 构建（零警告）/ 应用打包三重验证通过。
- **两阶段累计**：v3.2.0 → v4.1.0 共 26 个版本；测试 141 → 173 项；72 项审计发现全部闭环。
- **勘误**：v4.0.2 发布时代码内版本常量未同步递增（仍为 4.0.1，tag 名正确但 User-Agent/关于页显示滞后），本版修正为 4.1.0。



_进行中的变更将在下一版本发布时归档于此。_

## [v4.0.1] - 2026-09-12

### 共享组件归位与样式统一（二十轮优化续作 · 第 23 轮）

- **设计系统归位**：`PressableButtonStyle` 从 CardDeckView 底部迁至 `ThemeTokens.swift`（17 个文件 90 处使用的全应用基础样式，归属设计系统文件）。
- **弹窗返回/关闭统一组件**：新增 `GlassIconButton`（32×32 玻璃圆底图标按钮），收藏阁/历史/测验三处同形态按钮迁移复用；帮助页与统计页为胶囊文字按钮（不同形态族），保持原样。
- **测试与验证**：173 项 / 25 个 suite 全绿。

## [v4.0.0] - 2026-09-12

### 全包 Swift 6 严格并发（二十轮优化续作 · 第 22 轮）

- **应用层迁移完成**：`KnowFlick` 可执行目标同样迁至 `swiftLanguageMode(.v6)`——整个 Package（核心 + 应用 + 测试）现在全部运行于 Swift 6 严格并发，实际迁移面远小于预估（仅 2 处修复）。
- **触觉反馈隔离**：`HapticFeedbackHelper` 整体 `@MainActor` 隔离（状态仅在手势回调主线程读写），替代单例旁路豁免。
- **事件监视器豁免**：星图滚轮捕获层的 monitor 句柄标注 `nonisolated(unsafe)`（`NSEvent.removeMonitor` 线程安全，deinit 摘除为合法跨隔离访问）。
- **验证**：173 项 / 25 个 suite 全绿；Release 构建零警告。

## [v3.9.1] - 2026-09-12

### 批量生成分批请求与测试基建（二十轮优化续作 · 第 21 轮）

- **批量生成分批请求**：单次 AI 请求产出上限收敛为 6 张（约 900 token/张 × max_tokens 封顶 8192 的安全上限）；更大数量自动分批连续请求，每批把前批产出纳入标题/近重复排除口径，杜绝跨批重复。
- **重试退避可注入**：`AIService` 新增 `retryBaseDelay`（默认 1s），聊天 500 错误用例从 3.2s 退避等待降至毫秒级。
- **测试替身稳定性**：定位并修复长期偶发的测试进程段错误——根因是单测内真实驱动系统 TextToSpeech 引擎，拆解期异步回调悬空引用（objc_retain 崩溃报告定位）；语音服务新增测试替身开关。
- **测试与验证**：新增分批生成传输测试（count=7 → 2 请求 2 卡），173 项 / 25 个 suite 全绿。

## [v3.9.0] - 2026-09-11

### 二十轮优化收官（二十轮优化 · 第 20 轮）

- **优化总结文档**：新增 `docs/OPTIMIZATION_ROUNDS.md`——完整记录 v3.2.1 → v3.9.0 共 20 轮的主题、产出、72 项审计发现的闭环情况、关键架构改进与后续建议。
- **全量回归验证**：Swift 测试 / Release 构建 / 应用打包三重验证全部通过。
- **指标**：测试 141 → 172 项、suite 20 → 25 个；核心层运行于 Swift 6 严格并发；主线程同步 IO 与 O(n²) 热路径全部消除。

## [v3.8.1] - 2026-09-11

### 全量交叉复审与回归修复（二十轮优化 · 第 19 轮）

双 agent 交叉复审 v3.2.1 → v3.8.0 全部改动（核心层 + UI 层），修复确认的回归：

- **P1 · 聊天清除→重开竞态**：新增内存墓碑机制——清除在后台 FIFO 执行期间，openChat 以内存状态为准；仅非空会话写入可摘除墓碑。新增竞态回归测试，并补强原清除测试中的空洞断言。
- **P2 · 刷卡飞出回调兜底**：动画完成回调在极端时序下可能不触发；新增 1 秒超时强制回收。
- **P2 · 切后台设置保存失败静默**：persistImmediately 的设置写入失败现走持久化告警。
- **P3 集中修复**：星图滚轮监视器放行纯横向滚动；取消返回部分结果的节点半径口径对齐；导出失败提示延长至 5 秒；receiveSaveResult 排版还原。
- **评估后接受**：导出 Markdown 的字节级空行变化（语义不变）；工作台跨零点计数延迟刷新；日期解析 per-call formatter 开销。

## [v3.8.0] - 2026-09-11

### KnowFlickCore Swift 6 严格并发迁移（二十轮优化 · 第 18 轮）

- **语言模式升级**：`KnowFlickCore` 与测试目标迁移至 Swift 6 严格并发（`swiftLanguageMode(.v6)`）；应用层按计划维持 v5，分阶段控制改造面。
- **静态可变状态显式豁免**：`CardThemeResolver.keyCache` 与 `KnowledgeGraphEngine.keywordCache` 标注 `nonisolated(unsafe)` 并注明 NSLock 锁纪律。
- **Sendable 收口**：`AIService` 标记为 `Sendable`；语音服务对 AVFoundation 采用 `@preconcurrency` 导入。
- **签名断言稳定化**：JSON 导出 throws 签名断言由运行期元类型比较改为编译期目标类型赋值。

## [v3.7.2] - 2026-09-11

### UI 与算法打磨（二十轮优化 · 第 17 轮）

- **海报期号确定性**：卡片海报「№ 期号」由每进程随机种子的 `hashValue` 改为 FNV 确定性哈希。
- **到期排序降本**：学习计划到期队列先预计算到期时间再排序，消除比较器内重复日历运算。
- **测验选题降本**：`generateQuizCards` 的收藏/历史排除判定由嵌套线性扫描改为 Set 命中。
- **测验进度保护**：宿主重建视图身份时不再静默重置答题进度。
- **刷卡动画收口**：飞出卡清理由硬编码延时改为 `withAnimation(completion:)` 回调。
- **文件面板回退统一**：新增 `PanelPresenter`，四处面板在无 key 窗口时回退为普通模态打开。
- **工作台周期重算移除**：移除包裹整页的 60 秒 TimelineView。
- **评估后保留**：拖拽 `drawingGroup` 渲染分组与玻璃材质存在冲突风险，评估后不做。

## [v3.7.1] - 2026-09-11

### 工具链验证与口径收尾（二十轮优化 · 第 16 轮）

- **图标链路端到端验证**：build_icon → iconutil → verify_icon 全链路以临时目录实测通过。
- **README 质量检查扩充**：补充图标链路与课程导入脚本的自检命令；注明测试计数口径为 `@Test` 声明数（参数化用例运行时展开）。
- **导入脚本注释**：明确 `MAX_HEADLINE_LEN` 仅约束新增卡片（历史种子存在 52 字标题，不追溯）。

## [v3.7.0] - 2026-09-11

### 文档全面对齐（二十轮优化 · 第 15 轮）

- **README 快捷键表重写**：与 HelpView 面板及 v3.1.1 原生菜单逐项对齐——补齐 ⌘F / ⌘K / ⌘G / ⌘B / ⌘S / ⌘P / ⇧⌘P / ⌘J / ⌘, 等，按「系统菜单 / 刷卡界面 / 详情页 / 测验面板」四个作用域分表。
- **README 徽章纠偏**：Swift 5.9 → 6.0（Package.swift 为 swift-tools-version 6.0，语言模式 v5），消除三处口径矛盾。
- **CONTEXT.md 领域词汇更新**：修正「受控 21 类（未知兜底科技）」的过期描述；图池数量改为实际值（15/15/10/8，共 42 张）；防重算法条目改为现名 `arrangeWithMinDistance` 并条件化「严格 0 撞图」措辞。
- **README 数据存储表**：补 `cards.backup.json` 与 `chat_sessions.json` 两行。
- **README 项目结构树**：补 CONTEXT.md、tools/、docs/、android/、assets/ 条目。

## [v3.6.2] - 2026-09-11

### 构建链路与仓库卫生（二十轮优化 · 第 14 轮）

- **图标打包闭环**：`tools/build_icon.swift` 末尾自动调用 `iconutil` 生成 ICNS（此前是漏掉的手工步骤，icns 与 iconset 可能脱节），失败即硬性退出。
- **打包脚本健壮性**：`build_app.sh` 增加失败清理——组装中途退出时删除半成品 `dist/KnowFlick.app`，不再留下表面完整的残缺产物；移除与资源硬校验重复的二次 seed 检查。
- **导入脚本校验前移**：`import_lessons.py` 字段校验移到写盘之前（此前断言失败时输出文件已被改写）；未知学科前缀显式报错并指明映射来源，替代隐晦 KeyError。
- **测试脚本引导**：`tools/test.sh` 在 xcode-select 未配置时给出安装指引。
- **文档时效声明**：docs/ 下 5 份历史评审文档头部统一加入「快照基线声明」；`android/README` 标注当前为契约占位、无可编译工程。
- **CHANGELOG 规范**：新增 `[Unreleased]` 段落，对齐 Keep a Changelog。
- **验证**：图标逐像素校验通过；测试全绿；Release 打包验证通过。

## [v3.6.1] - 2026-09-11

### 死代码清理（二十轮优化 · 第 13 轮）

- **语音服务**：删除无调用方的 `speakTerm`（含两分支完全相同的死分支）与 `SpeechSynthesizerService.shared` 单例（AppStore 自建实例为唯一正路，避免旁路单例绕过设置）；`CardView` 的语音服务默认值改为必传参数（两个调用点均已显式传入 store 服务，行为不变）。
- **主题解析**：删除无调用的兼容包装 `interleavedAndDeduplicated`。
- **存储层**：删除吞错误的非抛版包装 `saveSettings` / `saveChatSession` / `clearChatSession`，存储错误一律走 Throwing 通道暴露。
- **视图层**：详情页语音服务回退从旁路单例改为显式实例；收藏阁重复的 `.fixedSize` 修饰符清理。
- **测试与验证**：171 项 / 25 个 suite 全绿；Release 构建通过。

## [v3.6.0] - 2026-09-11

### 深浅色适配与视觉一致性（二十轮优化 · 第 12 轮）

- **详情页音频条浅色修复**：播放栏语速胶囊、重播按钮、分句标签此前用白 6–8% 底色，浅色模式下完全隐形；统一替换为语义化 `glassSurface`/`glassBorder` 动态色。
- **生成进度指示**：卡堆「生成新卡中」进度圈由固定白色改为琥珀强调色，浅色玻璃胶囊中清晰可见。
- **聊天页语义色**：错误横幅与停止按钮由裸 `.red` 改为 `EditorialColor.dislikeRed`，与应用语义色体系对齐；聊天窗口改为 minWidth/minHeight 弹性尺寸，与其余弹窗一致。
- **测验排版**：移除正文中的 💭 emoji，保持人文画报排版纯度。
- **按钮按压方向**：设置页保存按钮按压由放大 1.02 统一为全应用一致的缩小 0.97。
- **扫光去重**：「换一批新知识」（顶栏与菜单两个入口）不再手动触发扫光，统一由顶卡变化 onChange 驱动，消除同事件双触发导致扫光被重启。
- **测试与验证**：171 项 / 25 个 suite 全绿；Release 构建通过。

## [v3.5.2] - 2026-09-11

### 可访问性专项（二十轮优化 · 第 11 轮）

- **搜索结果行 VoiceOver 可激活**：结果行由 `onTapGesture` 改为真正的 Button 语义（VoiceOver 可聚焦、可回车激活），并补齐合并标签（标题 + 分类 + 命中字段）与操作提示；「追问 ⌘J」小按钮补 accessibilityLabel。
- **图标按钮语音标签**：卡堆顶栏 iconButton/roundButton、详情页关闭与左右导航按钮统一补齐 accessibilityLabel（复用既有 .help 文案，单一来源）。
- **测验快捷键决策**：保留 Space/Return 翻卡（闪卡应用通行做法，测验为全屏遮罩无文本输入焦点冲突），后续如收到误触发反馈再引入焦点守卫。
- **测试与验证**：171 项 / 25 个 suite 全绿；Release 构建通过。

## [v3.5.1] - 2026-09-11

### 图谱与防重排布性能（二十轮优化 · 第 10 轮）

- **星图取消语义修复**：`buildGraph` 被取消时不再丢弃全部工作返回空图，改为返回已建节点与累计边（连接度一致）——快速开关星图不再闪现空星图。
- **防重排布降本**：`arrangeWithMinDistance` 候选摘除由 `remove(at:)` O(n) 改为 swap-remove O(1)，千卡库全量重排省去数万次数组搬移；排布性质（同图间隔 ≥5）不变并有测试护栏。
- **主题键缓存修剪**：`CardThemeResolver.keyCache` 随卡库重算按存活卡片集合裁剪，已删除卡片的条目不再永久驻留。
- **拼音缓存软驱逐**：搜索拼音缓存满载时驱逐约一半（保留热条目）而非全清，输入高峰后不再冷启动全量重算。
- **星图重绘降本**：节点字典（nodeMap）由每次 Canvas 重绘（含 hover 进出）重建改为加载后一次性预计算。
- **死代码清理**：移除 AppStore 上主线程 O(n²) 的同步 `getKnowledgeGraphData` 包装（无调用方，视图已直连引擎后台计算）。
- **测试与验证**：171 项 / 25 个 suite 全绿；Release 构建通过。

## [v3.5.0] - 2026-09-11

### AI 服务增强（二十轮优化 · 第 9 轮）

- **追问聊天重试**：与生成路径同级——首个增量到达前遇 429/5xx 自动重试（指数退避，至多 3 次尝试）；已产出内容后不再重来，避免用户看到重复回答。
- **服务端错误透出**：非 2xx 时读取响应体提取 `error.message`（上限 600 字符），用户看到「配额不足/模型不存在」等真实原因，而非「API 返回 500：」空串；生成与聊天两条链路同时生效。
- **流式解析降本**：新增 `IncrementalObjectScanner` 字节级增量扫描器——记录扫描位置与状态机，每个 SSE delta 只扫新增字节，消除原「每 delta 全量重扫已解码对象」的 O(n²)；`scanObjects` 公共 API 保持不变并由同一实现驱动。
- **服务商匹配表驱动**：`AIProviderPreset.match` 由 16 层强制解包 if-else 链改为规则表 + 兜底查找，消除全部 `!`；本地端口识别改为冒号前缀（`:11434`/`:31415`），远程 URL 中恰好含这些数字不再被误判为本地服务。
- **max_tokens 封顶**：动态计算值封顶 8192，兼容多数服务商单次输出上限，超大生成数量不再触发服务端 400/截断。
- **测试与验证**：新增 429 重试传输测试、错误体透出断言、增量扫描切片一致性（含转义引号）与端口误判回归，171 项 / 25 个 suite 全绿。

## [v3.4.2] - 2026-09-11

### 持久化与启动性能（二十轮优化 · 第 8 轮）

- **切后台不再主线程写盘**：`scenePhase` 变化改用新增的 `persistImmediately()`——取消节流并立即在后台队列落盘，主线程零阻塞（此前每次 Cmd-Tab 都同步执行全量 JSON 编码 + 写盘，随卡库增长必然掉帧）；真正退出仍由 `shutdown()` 同步收口。
- **启动链路后台化**：`bootstrap` 的卡片解码、种子库解码（338KB JSON）与设置读取移至后台线程后一次回主线程；卡片与设置改为单次赋值，消除逐字段变更触发的 didSet → 全量重算风暴（原先至少 7 次全量重算降为 2 次）。
- **聊天落盘异步化**：会话写入/清除移入后台串行队列（与卡片写入同一 FIFO 通道），流式回答结束、切卡、清空历史不再在主线程做全文件解码重写；错误仍回主线程提示。
- **备份轮转降本**：常态下备份直接轮转上一版主文件字节（零解码开销）；仅当加载期发现过损坏时才解码校验，杜绝把坏字节转进备份的同时省去每次落盘的全量 JSON decode。
- **导入去重重算**：`importCards` 移除与 didSet 重复的显式全量重算。
- **测试与验证**：聊天相关测试改为轮询断言匹配异步落盘语义，168 项 / 25 个 suite 全绿；Release 构建通过。

## [v3.4.1] - 2026-09-11

### 导入导出健壮性（二十轮优化 · 第 7 轮）

- **JSON 导入容错**：日期解码兼容毫秒级 ISO8601（外部工具常见）与数字时间戳；数组导入改为逐卡挽救——单张坏卡不再拖垮整个文件；删除从未生效的「宽松解码器」死代码。
- **收藏导出统一**：`exportFavoritesMarkdown` 与通用导出共用 `CardExportEngine` 渲染管线——目录锚点此前全部失效（headline 推导 vs 正文 card-N 锚点）现修复；来源标注补齐「导入卡」分支；收藏时间改用 `favoritedAt`（与收藏阁排序口径一致）。
- **导出性能**：Markdown 拼接由 `md +=` O(n²) 改为数组 join O(n)，大库导出不再线性放大 CPU/内存。
- **导入标题口径**：Markdown 列表项元数据（如「- **收藏时间**：…」）不再被误抓为卡片标题。
- **种子合并口径统一**：增量种子合并改用 `normalizeHeadline` 归一化比较，用户改过标点/大小写的种子卡不会被重复灌入。
- **测试与验证**：新增 3 项回归（毫秒日期+逐卡挽救、列表元数据不误抓、锚点/来源/收藏时间口径），168 项 / 25 个 suite 全绿。

## [v3.4.0] - 2026-09-11

### 设置语义统一与 Toast 组件化（二十轮优化 · 第 6 轮）

- **设置页保存语义统一**：外观选择不再即时落盘，与其余 18 项配置一样点击「保存配置」统一生效——「放弃修改并关闭」承诺首次真正可兑现。
- **轻量设置变更通道**：新增 `AppStore.applySettingsChange`——外观循环、磨耳朵语速等高频开关改为内存即时生效 + 后台 350ms 节流落盘，点击不再同步执行钥匙串读写阻塞主线程；`flushPersistence` 同步收口待写的设置。
- **分类提示与连接状态分离**：「分类已存在」不再显示成红色「连接测试失败」，改为分类卡片内的独立琥珀色提示。
- **Toast 组件化**：6 套独立 Toast 实现统一为 `EditorialToast + ToastCenter`（success/failure/neutral 三态、并发安全自动消失、可手动关闭）；导出失败的提示此前永不自动消失，现已修复；设置页保存提示时长对齐组件默认。
- **测试与验证**：新增轻量变更通道测试（即时生效 + 落盘 + 零钥匙串触碰），166 项 / 25 个 suite 全绿；Release 构建通过。

## [v3.3.2] - 2026-09-11

### 测试加固 B：传输、并发与语音防线（二十轮优化 · 第 5 轮）

- **追问聊天全链路传输测试**：为 `AppStore` 增加 `AIService` 注入口，经 URLProtocol 替身驱动真实流式链路——增量拼装、会话落盘、空占位清理、500 错误透出全部自动化覆盖；SSE 解析器补 delta/message/[DONE]/keep-alive 四类样例测试。
- **持久化并发契约测试**：连续快速变更后落盘必为最新快照、旧写入不复活，锚定串行队列 + revision 核对语义。
- **磨耳朵推进回调测试**：模拟系统合成器「播放完成」delegate，验证自动推进请求触发一次、空队列自动收束退出磨耳朵。
- **图谱评分带测试**：同领域深化 / 交叉学科碰撞 / 概念共鸣（jaccard ≥ 0.04）/ 无关联四档判据各有归属。
- **测验守卫测试重写**：原测试在测试内复刻守卫逻辑（恒真命题），改为锚定 `recordQuizResult` 的真实 store 契约（每次提交累计、熟练度覆盖、未知卡静默），明确 View 层守卫与 store 层记账的分工。
- **测试规模**：165 项 / 25 个 suite 全绿（连续两轮稳定复现）。

## [v3.3.1] - 2026-09-11

### 测试加固 A：承诺级行为防线（二十轮优化 · 第 4 轮）

- **防重排布算法测试**：为 README 强承诺的 `arrangeWithMinDistance` 建立性质测试——204 张六学科混合池同 key 间隔 ≥5 恒成立、全同 key 退化优雅降级、空池/单卡/minDistance 为 0 或负数不崩溃、首卡避开上次顶卡；同步锚定 42 键映射与 FNV-1a 参考向量（防止关键词表改动悄悄改变全库配图）。
- **种子增量合并回归**：覆盖 README 承诺的「新版本种子自动合并」——空库全量播种 214 张；老用户卡库中已浏览/收藏的旧种子卡与导入卡数据完整保留，新种子追加至 215 张。
- **服务商预设一致性测试**：16 档预设唯一 id、默认模型在模型列表内、免密约定（Ollama/本地网关）与 HTTPS/本地回环约束、`match()` 对每个预设 baseURL 反查回自身、未知 URL 兜底自定义。
- **测试规模**：159 项 / 23 个 suite 全绿（新增 3 个测试文件）。

## [v3.3.0] - 2026-09-11

### 知识星图交互补全与快捷键所有权（二十轮优化 · 第 3 轮）

- **星图滚轮缩放落地**：此前提示「滚轮缩放」但功能从未实现；新增星图窗口局部滚轮事件捕获层，向上滚动放大、向下缩小（平滑系数适配触控板与滚轮），其他窗口滚轮行为不受影响。
- **星图捏合缩放**：新增触控板捏合（MagnificationGesture）实时缩放，与拖拽平移手势并存，缩放范围与 ± 按钮一致（60%–220%）。
- **星图空格重置**：「重置视野」按钮接入空格快捷键，提示文案与实际能力对齐（拖拽平移 · 滚轮/捏合缩放）。
- **快捷键所有权治理**：历史足迹页 Esc 改为「最上层优先」语义——详情浮层打开时先收起详情再返回卡堆，与收藏阁行为统一；复核 ⌘S/⌘J 冲突均为独立窗口 sheet 模型天然隔离，无需额外处理。
- **测试与验证**：144 项 / 20 个 suite 全绿；Release 构建通过。

## [v3.2.2] - 2026-09-11

### 「输入即卡顿」链路性能优化（二十轮优化 · 第 2 轮）

- **全局搜索异步防抖**：搜索结果改为 120ms 防抖后台计算（引擎线程安全，结果回主线程），消除此前每次按键在 body 中重复执行 3 遍全量检索 + 全库拼音转换的主线程阻塞。
- **收藏阁派生快照**：`store.favorites` 由每次访问全库 filter+sort 的计算属性改为随卡库变更刷新的存储快照，收藏阁搜索输入不再放大重复计算。
- **列表视觉规格轻量化**：新增 `CategoryTheme.visualSpec`（仅图标/主色/领域代号），收藏阁、历史、统计、设置、学习工作台、搜索结果的行渲染不再同步解码 900px 摄影底图，滚动路径零图片 IO。
- **相关卡关键词缓存**：`KnowledgeGraphEngine.extractKeywords` 按内容哈希缓存（线程安全、4096 容量），详情页相关灵感脉络与星图构建对全池的反复关键词提取降为 O(1) 命中。
- **测试与验证**：新增关键词内容变更追踪与 32 并发安全回归，144 项 / 20 个 suite 全绿；Release 打包验证通过。

## [v3.2.1] - 2026-09-11

### 关键缺陷修复与版本单一来源（二十轮优化 · 第 1 轮）

- **详情页「下一张」失效修复**：从卡堆顶卡进入详情页时，「下一张」按钮此前永远无效（当前卡即顶卡，守卫条件恒假）；现改为以系统跳过语义刷过当前卡并前进到下一张，与领域语义一致。
- **追问聊天渲染修复**：AI 回复此前经 `LocalizedStringKey` 渲染，含 `%` 的回答会被本地化格式化截断错乱；改为纯文本渲染。
- **导出线程安全修复**：`CardExportEngine` 的静态 `DateFormatter` 非线程安全，后台并发导出（Markdown/Obsidian）可能产生错乱输出；改为每次调用局部创建。
- **设置保存一致性强化**：`saveSettings` 提交顺序调整为「钥匙串写入 → JSON 落盘 → 内存提交」，任一步失败内存保持旧值，并尽力回滚钥匙串写入，杜绝「新密钥配旧配置」的跨启动错位。
- **版本单一来源**：新增 `KnowFlickCore/Support/AppVersion.swift`，Info.plist（build_app.sh 自动提取）、User-Agent 与设置页关于信息统一引用，消除三处硬编码漂移；`build_app.sh` 版本解析失败时硬性退出。
- **测试与验证**：新增设置落盘失败回滚钥匙串的回归测试，142 项 / 20 个 suite 全绿；Release 打包验证通过。

## [v3.2.0] - 2026-09-11

### 学习工作台稳定性、可读性与 AI 服务连接体验

- **设置与连通性反馈**：测试连接期间显示进行中状态，并明确展示成功或失败原因；状态更新固定在主线程，避免设置页出现静默无反馈。
- **OpenCode Go 适配**：请求自动附带稳定的 `x-opencode-session` Session ID 和 KnowFlick User-Agent，兼容 OpenCode Go 的路由与提示缓存要求。
- **持久化可靠性**：设置与会话写入失败提供可见错误；损坏文件自动隔离并保留现场，目录冲突等真实写入失败继续向用户报告。
- **统计与搜索性能**：统计聚合改为单次遍历；拼音搜索增加有界线程安全缓存，降低重复搜索开销。
- **导入边界保护**：笔记导入在解析前限制为 32MB，避免超大文件占用过多内存。
- **辅助功能**：补齐搜索、语音播放器、卡片返回等关键控件的 VoiceOver 标签与状态描述。
- **测试与验证**：Swift 测试扩展至 141 项 / 20 个 suite，覆盖 OpenCode Go Session ID、连通性传输、持久化失败和导入边界；Release 构建与图标资源校验通过。

## [v3.1.1] - 2026-09-09

### 系统原生菜单与全局快捷键体系、语音健壮性与交互精进 (Native Menu Bar, Speech Resilience & UX Polish)
- **macOS 原生菜单栏与全局全键盘体系 (`MacCommands`)**：
  - **系统菜单深度集成**：将全局搜索 (`⌘F`)、撤销滑卡 (`⌘Z`)、偏好设置 (`⌘,`)、知识测验 (`⌘K`)、知识星图 (`⌘G`)、收藏阁 (`⌘B`)、卡片朗读 (`⌘P`)、磨耳朵伴读 (`⇧⌘P`)、向卡片追问 (`⌘J`)、生成新卡 (`⌘N`) 完整接入 macOS 系统原生菜单栏；
  - **模态窗口保护机制**：当弹窗（设置、测验、搜索等）处于打开状态时，系统级菜单动作自动禁用，杜绝在输入框中打字时意外触发背景卡片翻转或刷卡；
  - **搜索置顶快捷键修复**：修复 `GlobalSearchModalView` 中 `⌘⏎`（Command + Return）直接将选中卡片插队置顶至卡堆顶层的物理快捷键分发。
- **语音服务稳定性与优雅降级 (`SpeechSynthesizerService` / `RemoteSpeechClient`)**：
  - **远程语音暂停/取消竞态修复**：解决网络语音生成中无法及时暂停以及下一分段忽略暂停的问题，停止操作即时取消后台任务；
  - **降级参数继承与发音人探测优化**：云端或本地 TTS 失败自动回退系统语音时，完整继承试听所选语速与音色，移除按文本包含“粤语”字样强制切方言的粗暴规则；
  - **卡片详情自动朗读开关打通**：在偏好设置开启详情自动朗读后，进入详情页自动开始播报，已有同卡播放或磨耳朵模式下不产生重复冲突；
  - **多配置密钥安全生命周期**：清空或删除语音配置时，自动从 macOS Keychain 物理清除对应条目，并引入 `CredentialStore` 协议实现单元测试无副作用隔离。
- **排版可读性与视觉对比度精修**：
  - **卡片详情顶栏对比度强化**：详情页顶部浮动按钮（收藏、分享、朗读、关闭）统一固定高对比度白色文字与图标，彻底解决浅色模式下的反差不足；
  - **超长标题自适应换行**：统计分类标签、帮助页说明与全文搜索结果标题支持自适应无损换行，消除小窗口下的截断；
  - **应用图标完整性自动化验证**：引入 `tools/verify_icon.swift`，在构建前逐像素校验 ICNS 各阶分辨率与母版 PNG 的一致性。
- **全量测试套件扩张**：
  - 新增凭据存储、语音控制状态机、远程语音传输替身测试，13 个测试套件共 92 项测试 100% 绿灯。

---

## [v3.1.0] - 2026-09-09

### 全局智能搜索、去 AI 味工艺图标与可读性演进 (Global Smart Search, De-AI Editorial Icon & Readability)
- **全局智能搜索与全文检索系统 (`KnowledgeSearchEngine` / `GlobalSearchModalView`)**：
  - **Spotlight / Raycast 沉浸式命令浮层**：全局快捷键 `⌘F` 瞬时唤起聚焦，支持按分类胶囊（经济学、认知心理学等）与来源维度（全部、AI 生成、经典预置）多维过滤；
  - **拼音全拼与首字母模糊匹配**：基于 macOS 原生 `CFStringTransform` 构建拼音引擎，支持汉字直搜、全拼搜索（如输入 `zulin` 匹配“租赁”）以及拼音首字母检索（如输入 `xzl` 匹配“新租赁准则”）；
  - **动态权重相关性排序**：卡片观点与标题最高权重，其次为分类与深入剖析正文，优先展示最关键观点；
  - **关键词变色高亮与上下文摘要截取**：正文长内容自动定位至关键词命中位置，提取上下文形成智能摘要片段并高亮命中词；
  - **全键盘流畅导航闭环**：支持 `↑↓` 快速切卡、`⏎` 直接打开卡片详情页、`⌘⏎` 将该卡片置顶至主卡堆刷卡队列、`⌘J` 直接发起追问、`Esc` 平滑关闭；
  - **空搜索态 AI 卡片生成联动**：当搜索无结果时，支持一键依据搜索词触发 AI 在线生成全新知识卡片。
- **人文工艺级去 AI 化应用图标重构**：
  - **告别千篇一律的 AI 科技蓝紫渐变**：回归实体经典精装书刊质感，采用烫金雕刻衬线字母「K」、肌理细腻的米白天然棉纸与深褐装帧织物底托，配以朱砂红缎带书签；
  - **macOS 标准 10 阶 ICNS 资产生成与规范修正**：使用 `swift tools/build_icon.swift` 与 `/usr/bin/iconutil` 构建全尺寸标准 `AppIcon.icns`，修复 `Info.plist` 中 `CFBundleIconFile` 指向问题，确保 macOS Dock、启动台和关于窗口均呈现最高品质。
- **顶栏交互人机工程学精进 (`CardDeckView`)**：
  - **高频功能直接触达**：在主界面顶栏保留高频核心的「🔍 搜索 ⌘F」胶囊与「🎧 磨耳朵」快捷状态，将次高频与系统级功能整合进折叠菜单，保持极简呼吸感；
  - **空状态卡片探索闭环**：卡片刷完或过滤耗尽时，空状态视图提供「重新探索全部卡片」与「搜索知识库 ⌘F」重置入口，彻底消除死胡同。
- **架构健壮性与语音引擎演进**：
  - **语音多后端支持 (`RemoteSpeechClient` / `SpeechSettingsEditor`)**：支持系统原生离线语音、兼容 OpenAI `/v1/audio/speech` 的云端与本地自建 TTS 服务（如 Kokoro/CosyVoice 网关），提供多套配置并自动回退；
  - **Keychain 密钥硬件隔离**：API Key 统一由硬件级 macOS Keychain 保管，杜绝明文落盘风险；
  - **全量跨架构单元测试保障**：新增 9 项全文/拼音搜索引擎单元测试，10 个测试套件共 79 项测试 100% 绿灯通过。

---

## [v3.0.0] - 2026-09-08

### AI 智能对话伴学与「向卡片追问」系统 (AI Card Chat & In-depth Follow-up Companion)
- **卡片专属多轮流式对话引擎 (`AIService.streamCardChat`)**：
  - **知识上下文精准感知**：自动将当前知识卡片的学科分类、观点标题、内容摘要、深入剖析全文与来源偏好组装为系统认知底座，确保导师回答高度贴合卡片本身；
  - **毫秒级 SSE 流式打字响应**：全双工逐字流式打字渲染，配备呼吸态光标 (`▋`) 与生成中实时中止能力；
  - **启发式切入点预设**：内置 4 组经典启发式追问灵感气泡（生活比喻解释底层原理、工业与现实反转应用、交叉学科深层碰撞、科学发现争议与历史迭代），一键即刻开聊。
- **沉浸式卡片伴学追问面板 (`CardFollowUpChatView`)**：
  - **优雅人文画报风排版**：用户气泡与 AI 导师气泡差异化光晕设计，支持 Markdown 格式排版、强调文字与长文本多行输入自适应；
  - **语音发音联动 (TTS Integration)**：AI 导师的每一句解答均可直接点击「朗读此回答」，无缝调度设备端神经发音人进行声学朗读；
  - **一键剪贴板复制**：提供极简拷贝按钮，随手复制金句与洞察；
  - **会话清空与安全机制**：提供二次确认的清空对话操作，并配备完善的网络超时与错误提示条。
- **本地专属对话历史沉淀与持久化 (`Storage`)**：
  - 会话自动以卡片 UUID 为锚点持久化落盘至沙盒 `chat_sessions.json`，离开或重启应用后重访卡片详情，历史思辨记录完整再现。
- **全链路入口打通与全键盘交互体系**：
  - **卡片详情页 (`DetailView`)**：顶部工具栏新增 `sparkles`「AI 追问」按钮（快捷键 `⌘J`）；正文下方与延伸阅读之间嵌入「向卡片追问」卡片胶囊，无缝激发探索欲；
  - **主界面卡片 (`CardDeckView`)**：卡片右键上下文菜单新增「向卡片追问 (AI 伴学) ⌘J」；主界面全局支持 `⌘J` 直接向当前顶卡发起追问；
  - **快捷键面板 (`HelpView`)**：收录 `⌘J` 知识追问指令。

---

## [v2.9.0] - 2026-09-08

### 智能发音与语音播报系统 (Smart TTS & Ambient Audio Narration)
- **零依赖原生高品质发音引擎 (`SpeechSynthesizerService`)**：
  - **基于 Apple 原生 `AVFoundation.AVSpeechSynthesizer` 深度封装**：完全运行于设备端，零云端 API 依赖、零网络延时，支持多语种智能探测（中文普通话、粤语、英语、日语）；
  - **动态四档倍速调节**：支持 0.75x、1.0x（原速）、1.25x 与 1.5x 多档平滑变速；
  - **自适应段落拆解与自然气口停顿**：将标题、核心观点、学术深入剖析精准拆分为自然断句单元，并在不同语意转折间配置呼吸级缓冲间隔；
  - **生词音标与专有名词精听**：支持独立生词与概念音标发音播放（`speakTerm`），为外语与专有名词提供标准声学回放。
- **灵动岛风格毛玻璃悬浮播放器 (`AmbientAudioPlayerBar`)**：
  - **动态声浪波形柱 (`AudioWaveformBars`)**：基于 SwiftUI `TimelineView` 驱动的 5 柱动态跳跃声浪波形，随播放状态自适应律动与平滑收拢；
  - **全功能悬浮操控控制台**：直观展示播放状态徽标、当前卡片微缩标题、进度百分比、上一首/播放暂停/下一首、快捷变速切换与一键关闭；
  - **平滑进入退出过渡**：采用 `.spring` 弹性物理位移与毛玻璃渐变蒙版，常驻屏幕下方却不遮挡卡片滑动核心视野。
- **磨耳朵连续自动伴读模式 (Ambient Narration)**：
  - **全自动卡片巡航**：播放完当前卡片内容后，经过设定的缓冲间隔（1~5秒可选）自动推进到下一张卡片并平滑切歌朗读，真正解放双手与双眼；
  - **全局快捷键与顶栏入口**：顶栏新增耳机按键（快捷键 `⌘P` 播放/暂停，`⌥P` 启闭磨耳朵连续伴读）；主卡片顶栏右侧新增磨砂语音发音胶囊，一键即听当前卡片观点。
- **卡片详情页沉浸式声学播放栏 (`DetailView`)**：
  - **正文上方集成声学播放条**：配备平滑交互式进度条、大号播放/暂停按钮、分档倍速下拉选单与一键重播；
  - **顶部操作栏朗读入口**：与收藏、分享并列，按 `⌘P` 即可一键朗读完整深入剖析。
- **系统设置新增「语音与磨耳朵」控制卡片 (`SettingsView`)**：
  - **精细化语速滑块**：支持 0.5x ~ 1.8x 无级调节；
  - **个性化系统配音选择器**：自动枚举并列出系统已安装的高品质神经发音人（如 Tingting、Sinji、Samantha 等），支持一键声学试听；
  - **磨耳朵换卡缓冲间隔调节**：支持 1 秒至 5 秒自定义间隙；
  - **详情页自动朗读开关**：进入详情页时可自适应开启全文朗读。

---

## [v2.8.0] - 2026-09-08

### 知识星图与语义关联链系统 (Knowledge Graph & Connected Cards)
- **卡片详情页「相关灵感脉络」 (`DetailView`)**：
  - **知识网状联想推荐**：在卡片正文与延伸阅读末尾，实时根据语义特征与学科亲和力算法精准匹配 2~3 张最具启发性的关联卡片；
  - **四阶关联徽章指引**：明确标注 `atom 同领域深化`、`sparkles 交叉学科碰撞`、`link 核心概念共鸣` 与 `wand.and.stars 灵感偶遇`，展示简明推荐理由；
  - **沉浸式穿透连续探索**：点击关联卡片即可原地丝滑切换至新卡片详情，保留完整阅读栈。
- **全景交互知识星图 (`KnowledgeGraphView`)**：
  - **深空星宿拓扑画布**：知识卡片化身为浩瀚宇宙中的璀璨星宿，依据学科主题色聚类为绚丽星云，由半透明星座引力线编织出学科网络；
  - **动态引力线与悬停聚焦**：鼠标悬浮星宿即刻点亮其专属关联网络与引力光纤，微暗淡无关节点；
  - **星宿悬浮名片 (Preview Card)**：点击星宿弹出该知识的学科胶囊、微缩标题、观点摘要与「查看完整卡片」直达入口；
  - **视口自由操控与学科筛选**：支持平移拖拽、60%~220% 滚轮缩放、一键视野复位，配备学科横向滚动筛选胶囊与毫秒级搜索框。
- **语义关联与学科亲和力计算引擎 (`KnowledgeGraphEngine`)**：
  - **中文多阶 N-Gram 与全量分词提取**：针对卡片标题、观点与正文细节提取核心知识关键词；
  - **跨学科双向亲和矩阵**：构建物理、天文、数学、化学、生物、脑科学、心理、哲学、历史、AI、编程等数十种交叉学科双向亲和力加权网络。
- **快捷键与全局导航体系完善**：
  - 主界面顶部导航栏新增星图按钮，支持全局快捷键 `⌘G` 一键呼出「全景知识星图」；
  - 主卡片右键上下文菜单新增「在全景星图中探索 ⌘G」；
  - 快捷键面板 (`HelpView`) 收录 `⌘G` 导航指令。

---

## [v2.7.0] - 2026-09-08

### 沉浸式知识测验与记忆卡片系统 (Flashcard Quiz & Active Recall)
- **主动回忆与 3D 拟真翻卡 (`QuizCardView`)**：
  - **主动回忆正面试题 (Active Recall Prompt)**：根据已收藏卡片或历史卡片提取生成测验题，正面展示学科徽章、标题大字及引导提示，倒逼大脑主动提取记忆；
  - **3D 景深翻转动效 (3D Perspective Flip)**：点击或按快捷键（`空格` / `⏎`）触发平滑的 3D 轴向翻转，背向即时揭晓核心观点、深入解读与学术机制。
- **艾宾浩斯记忆模型与自评系统 (`AppStore.QuizRating`)**：
  - **三阶记忆评级反馈**：
    - 🔴 **没想起来 (`⌘1`)**：完全遗忘，重置掌握度并在弱项池中重点强化；
    - 🟡 **犹豫想起 (`⌘2`)**：模糊再认，保持学习中状态；
    - 🟢 **熟练掌握 (`⌘3`)**：清晰提取，提升掌握等级并累积复习记录。
  - **向后兼容模型扩展**：卡片模型安全扩展 `reviewCount`、`masteryLevel` 与 `lastReviewedAt` 字段，提供安全的 `Codable` 降级容错。
- **成就结算与弱项强化看板 (`QuizView`)**：
  - **记忆留存率进度环 (Retention Rate Gauge)**：动态平滑渲染综合记忆留存率甜甜圈环，多维度展示熟练、犹豫与待强化的统计分布；
  - **针对性重测弱项**：支持一键重新提取本轮测验中未掌握与犹豫的题目进行靶向强化。
- **全端入口与全键盘盲操支持**：
  - 主界面顶部导航栏新增测验图标，支持全局快捷键 `⌘Q` 一键开测；卡片右键菜单支持开启该学科专项测验；
  - 知识收藏阁 (`FavoritesView`) 顶栏支持一键按当前筛选学科发起专属分类测验；
  - 快捷键面板 (`HelpView`) 完整收录测验盲操快捷键。
- **经典手工纯棉纸卡与烫金凸版应用图标 (`AppIcon`)**：
  - 替换为温润人文、去 AI 塑料感的纯棉纸毛边与烫金凸版 K 典雅图标，配备 macOS 标准圆角与物理环境投影。

---

## [v2.6.0] - 2026-09-08

### 专属知识收藏阁与 Markdown 笔记导出系统 (Knowledge Favorites & Markdown Notebook Export)
- **独立专属书签库与学科聚合 (`FavoritesView`)**：
  - **沉浸式双列卡片展台 (Masonry Card Gallery)**：展示所有标星/右划感兴趣的心仪卡片，清晰呈现学科徽章、来源标签、收藏时间与观点摘要。
  - **42 学科动态分类胶囊与即时检索**：支持按学科领域横向滚动过滤，统计各领域收藏数量；配备毫秒级全文模糊搜索框，即时检索标题、观点与正文细节。
  - **全链路快捷收藏交互**：在卡片详情页 (`DetailView`) 顶部新增专属心形收藏按钮（快捷键 `⌘D`），卡片网格支持一键取消收藏或快捷生成海报。
- **Obsidian / Notion 兼容 Markdown 知识笔记导出 (`AppStore.exportFavoritesMarkdown`)**：
  - **标准化 YAML Frontmatter**：包含 `title`, `date`, `total_cards`, `tags: [knowflick, knowledge, study-notes]`, 完美适配 Obsidian、Logseq、Notion 等主流知识库管理工具。
  - **智能锚点与双向目录索引 (TOC)**：自动生成多级目录与卡片书签锚点，方便在长文档中快速跳读与交叉检索。
  - **双通道导出流程**：支持快捷键 `⌘⇧C` 一键复制整本或筛选后的 Markdown 笔记至系统剪贴板，支持快捷键 `⌘⇧S` 调起原生 `NSSavePanel` 导出独立 `.md` 文件。
- **快捷键与全局导航体系完善**：
  - 主界面顶部导航栏新增书签按钮，支持全局快捷键 `⌘B` 秒级直达「知识收藏阁」。
  - 快捷键帮助面板 (`HelpView`) 同步更新 `⌘B` 与 `⌘D` 等盲操快捷键指引。

---

## [v2.5.0] - 2026-09-08

### 知识卡片画报分享与海报导出系统 (Card Poster Export & Share System)
- **画报风与拍立得双排版渲染 (`CardPosterRenderer`)**：
  - **画报风 (Editorial Magazine)**：540×760 pt 优雅杂志长图比例，搭载学科藏书印章徽标、高清背景摄影羽化过渡、大号衬线金句标题、双引号设计感摘要金句、深度细节摘录与 KnowFlick 出版物防伪认证印章。
  - **拍立得风 (Polaroid Snapshot)**：520×680 pt 复古象牙米白相纸与内凹相框排版，文艺留白与极简签名日期。
- **高清光栅化与多通道导出能力 (`PosterExportManager`)**：
  - **Retina 2x 高清离屏渲染**：采用 `ImageRenderer` 生成 1080×1520 超清无损 PNG 图像，色彩饱和清晰。
  - **一键写入剪贴板 (`NSPasteboard`)**：支持快捷键 `⌘C` 直接复制图片数据，随时可在微信、飞书、Notion、Discord、邮件中 ⌘V 粘贴发送。
  - **保存为本地 PNG (`NSSavePanel`)**：支持快捷键 `⌘S` 调起原生保存窗口，安全无损落盘。
  - **macOS 原生系统分享 (`NSSharingServicePicker`)**：支持通过 AirDrop 隔空投送、备忘录、信息等系统应用快速分享。
- **全链路交互集成与快捷盲操 (`CardPosterExportSheet`)**：
  - 卡片详情页 (`DetailView`)：顶部新增「分享海报」按钮，支持快捷键 `⌘S` 唤起。
  - 主卡片堆 (`CardDeckView`)：支持 `⌘S` 快捷导出当前顶部卡片，支持右键卡片呼出上下文菜单一键生成海报。
  - 历史足迹 (`HistoryView`)：支持右键任意历史卡片或点击卡片直接生成分享海报。
  - 导出成功后弹出半透明微拟物灵动 Toast 反馈与机械触觉振动。

---

## [v2.4.0] - 2026-09-07

### 视觉与动效精雕：卡片扫光、出版物印章与多阶触觉 (Editorial Polish & Motion Dynamics)
- **卡片入场高光扫光与 3D 物理高光反射 (`CardSheenOverlay`)**：
  - 新卡入场/切换及刷新时，卡片表面掠过一道 135° 斜角高光微光带（0.68s 优雅微衰减，纯 GPU 线性平移，零 CPU 额外重绘）。
  - 拖拽卡片交互时，高光微层随卡片 3D 俯仰倾角（Pitch & Roll）自然产生反向高光反射移动，增强高级纸面覆膜质感。
  - 完全非交互隔离（`.allowsHitTesting(false)`），杜绝任何手势冲突。
- **全领域出版物藏书印章徽标 (Editorial Collection Stamps)**：
  - 扩展 `CategoryTheme` 为全套 42 个学科领域配置专属 SF Symbol 图标与大写领域代码（如物理 `PHY`/原子、人工智能 `AI`/闪烁、会计 `ACC`/凭证、数学 `MATH`/函数、Rust `RUST`/双齿轮等）。
  - 卡片左上角与详情页顶栏分类标签升级为出版物收藏印章徽标：微图标 + 分类中文 + 分隔圆点 + 领域缩写代码，配合细描边与印泥微光，呈现深厚学术与出版物杂志质感。
- **浅色画报三层复合漫反射软阴影 (Layered Diffusion Shadows)**：
  - 浅色模式下采用三层复合阴影体系：4pt 近距接触阴影 + 22pt 漫反射中景阴影 + 40pt 广域柔和扩散阴影。
  - 消除普通单层生硬阴影，在零 CPU 噪点开销的前提下完美衬托卡片纸感立体层次。
- **触控板三段精密机械感触觉反馈 (Multi-Stage Haptics)**：
  - 触控板在「24pt 起步轻阻尼 → 85pt 滑动判定阈值段 → 甩出确认 / 磁吸回弹」呈现三段精密机械反馈。
  - 全程保持静音（静默无破音），提供极具确定感的物理操控反馈。

---

## [v2.3.1] - 2026-09-07

### 修复顶栏功能按钮被卡片隐形命中区遮挡与多弹窗路由统一 (Top Bar Hit Testing & Unified Sheet Router)
- **修复顶栏所有按钮误触卡片详情的根因**：
  - 核心根因 1：`CardView` 背景大图此前采用 `aspectRatio(contentMode: .fill)` 未被 `GeometryReader` 物理限定与 `.clipped()` 裁切，导致 1000×1450 大图隐形布局与命中区向上外溢 300+ 像素，盖住了右上角工具栏。
  - 核心根因 2：`clipShape` 仅裁切渲染像素而不裁切手势交互区，缺乏 `.contentShape()` 约束。
  - 核心根因 3：卡片层使用了局部 `zIndex`，在层深上压过了未设 `zIndex` 的顶栏。
  - **彻底修复**：
    - `CardView` 背景层通过 `GeometryReader` 严格绑定父容器尺寸并加 `.clipped()`，杜绝任何图元溢出。
    - `CardView` 与 `stackedCard` 全面补全 `.contentShape(RoundedRectangle(...))`，手势响应范围被严格锁定在卡片圆角矩形内。
    - 为 `topBar` 与 `bottomBar` 显式声明 `.zIndex(100)`，确保工具栏按钮永远处于最高响应层级。
- **全局统一单一模态路由（ActiveSheet 架构收敛）**：
  - 将此前残留独立的卡片详情弹窗（`selectedCard`）完全并入 `ActiveSheet` 统一状态枚举（新增 `case detail(KnowledgeCard)`）。
  - 全局仅保留唯一根级 `.sheet(item: $activeSheet)`，彻底杜绝 macOS SwiftUI 多个 `.sheet` 挂载点在窗口层产生绑定串扰与冲突。

---

## [v2.3.0] - 2026-09-07

### 新增外观模式：深色模式、浅色模式与跟随系统 (Appearance Modes)
- **三档外观模式全覆盖（跟随系统 / 深色模式 / 浅色模式）**：
  - 核心状态层新增 `AppearanceMode` 枚举（`system`、`dark`、`light`），支持通过 `store.settings.appearance` 全局动态控制与持久化落盘（无缝向后兼容旧版 `settings.json`）。
  - 根视图动态挂载 `.preferredColorScheme(store.settings.appearance.colorScheme)`，系统标题栏、窗口底板与各级浮层全局统一变色。
- **浅色画报风深度适配（Light Editorial Mode）**：
  - 将 `EditorialColor` 升级为具备 macOS 原生动态感知的双态设计系统：
    - **画布底色**：浅色模式下呈现温润米白与浅灰画报渐变（`#F8F9FA` ~ `#EEF1F5`）。
    - **文字层级**：深墨黑主标题（`#111216`）与中灰衬线副标题，对比度高、长时间阅读舒适不刺眼。
    - **磨砂玻璃与控件**：自适应高质感半透明白板底色与微描边，各操作按钮与悬浮卡片层次分明。
    - **摄影卡片视觉保持**：卡片正面保留高清摄影底图与动态非线性遮罩，标题与摘要专属使用高通透明亮文字（`cardTextPrimary`），在浅色背景下宛若高级印刷杂志卡片浮于桌面。
- **42 档分类色温浅色自适应环境光（Adaptive Ambient Light）**：
  - `CategoryTheme` 升级为动态双态环境光：在深色模式下保持暗夜微光，在浅色模式下自动为 42 个学科分类萃取专属低饱和水彩纸质光晕，使主窗口随着卡片切换流动出雅致灵动的色彩律动。
- **双入口灵活切换体验**：
  - **主界面顶栏快捷按钮**：顶栏新增外观切换图标按钮（`circle.righthalf.filled` / `moon.fill` / `sun.max.fill`），单次点击无感轮换，即点即切。
  - **偏好设置专区卡片**：设置页新增「外观模式」卡片，直观呈现 3 档分段卡片按钮与当前模式标注，支持精准选择与即时预览。
- **全量模态浮层色彩自适应**：
  - 详情页（`DetailView`）、学习统计（`StatsView`）、历史记录（`HistoryView`）、帮助说明（`HelpView`）全面移除硬编码深色限制，自适应完美适配深浅双模态。

---

## [v2.2.0] - 2026-09-07

### 视觉底图库扩充与绝对防重算法升级 (Image Expansion & Strict Deduplication)
- **扩充至 42 张暗黑杂志风摄影底图（翻倍扩容）**：
  - 新增 21 张精选暗黑摄影底图（分辨率统一规整为 1000×1450）：`quantum` (量子)、`relativity` (相对论)、`optics` (光学)、`spacecraft` (航天深空)、`ocean` (深海)、`meteorology` (气象气候)、`geology` (地质矿物)、`genetics` (遗传基因)、`ecology` (生态环境)、`robotics` (机器人)、`security` (信息安全)、`crypto` (区块链加密)、`database` (数据库与存储)、`network` (分布式网络)、`compiler` (编译器系统)、`economy` (宏观经济)、`philosophy` (哲学思辨)、`sociology` (社会学)、`music` (音乐与声波)、`cognitive` (认知心智)、`agent` (自主智能体)。
  - 彻底改变此前 214 张卡片争抢 21 张图、单图复用高达 30+ 次的视觉疲劳感。
- **严格同图距离排布算法（Min-Distance Greedy Layout）**：
  - 构建贪心队列排布算法：全局卡堆按确定性盐值哈希交织后，严格保证任意两张相同背景图卡片之间**相隔至少 5 张以上卡片**（数学实测 214 张全量卡片最小同图间距为 5~6 张，0 间距违规）。
  - **屏幕可见三叠卡（visibleStack 3 张）100% 底图各异**，顶卡与垫底卡绝不撞图。
- **划卡平滑出队与无碰撞队列保持（Zero Shuffling on Swipe）**：
  - 修复此前每次划卡触发全量卡片重新打散导致垫底卡猝然跳变的逻辑盲区：划卡时仅移除已阅卡片，100% 完整保留预先排好的无碰撞队列顺序；后台 AI 生成新卡时平滑追加至队尾；撤销划卡时精准恢复至栈顶。
- **背景图缓存容量翻倍**：
  - `BackgroundImageCache` 活跃缓存上限从 12 张扩充至 24 张，确保 42 张底图在高频快速滑动浏览时即时响应，零解码等待与卡顿。

---

## [v2.1.3] - 2026-09-07

### 性能极致调优与流畅度修复 (Performance & Smoothness)
- **卡堆与历史队列常驻缓存（O(1) 瞬时访问）**：
  - 此前 `store.deck` 和 `store.history` 为动态计算属性，卡片拖拽或悬浮每刷新一帧，单帧内会被反复调用 5 次以上，触发上百次 214 张卡片全量哈希排序与关键字匹配，导致拖拽时主线程 CPU 飙至 100%。
  - 改为响应式常驻存储属性（`deck` 与 `history`），仅在卡片划走、撤销或设置变更等真正需要变更时才执行单次重新计算，使拖拽与渲染帧率开销降至 0。
- **卡片视觉主题解析锁缓存（Theme Key Cache）**：
  - 为 `CardThemeResolver.resolveKey(for:)` 增加线程安全字典缓存，单张卡片仅计算一次主题键，消除反复正则与关键词匹配。
- **剔除高频全屏动态随机噪点（NoiseOverlay）**：
  - 移除了每帧通过 Canvas 随机绘制 2200 处随机点的 NoiseOverlay。全屏动态噪点不仅空耗主线程算力，更严重破坏了远程桌面/投屏（Screen Sharing、VNC、RDP、ToDesk）的视频差分帧编码，导致远程画面高频丢帧甚至卡死。移除后底色渐变干净轻盈，远程推流极度丝滑。
- **渲染图层与手势轻量化**：
  - 移除卡片拖拽时的重型 3D 透视变换（`rotation3DEffect`），保留自然流畅的高性能 2D 物理偏航旋转。
  - 移除卡片背景内的 `GeometryReader` 布局递归，避免拖拽位移过程中反复触发父子组件布局计算。
  - 优化卡片外阴影模糊半径（从 36px 收敛至优雅的 18px），大幅降低 WindowServer 多重离屏高斯模糊合成负载。

---

## [v2.1.2] - 2026-09-07

### 优化与修复 (Fixed & Improved)
- **划卡过渡零重复（Zero Transition Duplicate）**：
  - 修复划卡交互中的跨步视觉盲区：此前 `deck` 仅对卡堆内部相邻去重，每次划卡后卡堆动态重算，新卡堆第 0 张卡未能避开上一张刚划走的卡片，导致连续划动时产生视觉撞图。
  - `AppStore.deck` 与 `CardThemeResolver` 引入 `avoidingTopKey` 机制：将 `history.first` 刚刚划走的卡片主题图元显式传入去重算法，严格保证新出现的顶卡与刚划走的卡片底图绝对不同，跨步划卡过渡撞图率彻底归零。
  - 优化「投资理财」与「AI 开发」专属图元池映射，进一步平衡资产、会计、算法与系统等摄影图元分布。

---

## [v2.1.1] - 2026-09-07

### 优化与修复 (Fixed & Improved)
- **彻底根治刷卡背景图重复（零相邻重复 Zero Adjacent Duplicate）**：
  - **领域关联多图池（Thematic Multi-Image Pools）**：打破单一分类固定映射单一图片的局限，构建计算机与 AI、商业财会金融、自然宇宙科学、人文心智四大领域多图池（每个池 6~8 张专属高清摄影底图），使中级会计、AI Agent、投资理财等单分类内部也能张张不同、各美其美。
  - **细化语义关键词全覆盖**：细化 AI Agent（ReAct、幂等、护栏、记忆、人在回路）、AI 开发（余弦相似度、Prompt 回归测试、流式、微调、Function Calling）、中级会计（试算平衡、借贷记账、FIFO 计价）、投资理财（债券、定投心理、复利掌控）等子领域的专属图元映射。
  - **确定性学科交错打散（Deterministic Salted Interleaving）**：通过稳定无状态的哈希打散算法，解构种子库中同类学科连续成堆排布的问题，杜绝学科连续刷出。
  - **双向相邻防重安全扫描（Anti-Consecutive Duplicate Filter）**：待刷卡堆 `deck` 构建时执行双向防重扫描与位置安全交换，不仅严格保证连续两张卡片背景绝不撞图（0 连续重复），更兼顾可见卡片栈（visibleStack 3 张）的视觉多元呈现。
- **架构重构与单点真实源**：
  - 在 `KnowFlickCore` 中新增 `CardThemeResolver`，将图元解析、交织打散与防重算法统一在核心层维护，`CategoryTheme` 升级为 O(1) 字典查找，视图层与状态层对卡片背景映射 100% 同步。

---

## [v2.1.0] - 2026-09-07

### 新增 (Added)
- **全面扩充 AI 服务商预设（共 16 档，清晰划分为「在线 API 服务」与「本地部署运行」）**：
  - **在线 API 服务**：`DeepSeek (官方)`、`硅基流动 (SiliconFlow)`、`Kimi (月之暗面)`、`智谱 GLM / BigModel`、`阿里云百炼 (通义千问)`、`OpenCode Go`、`基元律动 (TokenRhythm)`、`小米 MiMo (Xiaomi)`、`LongCat (长猫科技)`、`蚂蚁百灵 (AntDigital)`、`NVIDIA NIM`、`AMD 开发者平台 (Token Factory)`、`OpenAI (官方)`。
  - **本地部署运行**：`Ollama (本地私有)`、`本地代理网关 (:31415)`（自动识别无需 API Key）。
  - **自定义**：`自定义服务商`。
  - 偏好设置中的服务商预设菜单按 Section 分组清晰展示，选择预设自动补全官方端点与推荐模型，API Key 始终由用户手工填写，并受 macOS 原生钥匙串安全保护。
- **千卡千面摄影背景智能映射与环境光流转**：
  - 基于 21 个学科领域关键词（物理、天文、生物、化学、历史、心理、脑科学、AI、算法、架构、Rust 等）做标题与摘要语义智能识别，直达专属精选摄影底图与强调色温。
  - 无命中关键词时按标题稳定哈希在 21 张底图中均匀分散，彻底解决「冷知识」分类下背景千篇一律的问题。
  - 主窗口环境暗化光晕（Ambient Glow）与当前卡片及划卡飞出动画实时深度联动。
- **种子库增量自动同步**：
  - 应用启动时自动比对标题，将内置扩充的 214 张种子知识卡无缝增量导入用户卡库，老用户无需手动清理重装即可刷到最新内容。
- **卡库状态与重置探索**：
  - 设置页新增「知识库状态」卡片，清晰呈现总卡数与待探索进度，支持一键重置卡堆重新体验全部知识卡。
- **版本号与更新说明入口**：
  - 设置面板底部展示版本号与 GitHub 更新链接。

### 修复与优化 (Changed & Fixed)
- 优化 `CategoryTheme` 缓存与 Swift 6 MainActor 并发隔离警告。
- 更新 `build_app.sh` 版本号至 `2.1.0`。
- 更新 `README.md` 与 `CONTEXT.md` 领域术语表。

---

## [v2.0.0] - 2026-09-06

### 新增 (Added)
- **暗色人文画报设计系统 (Dark Editorial)**：
  - 核心字模采用 macOS 原生宋体（Songti SC Black）与高透气衬线体正文排版。
  - 多阶非线性动态遮罩（DynamicScrim），消除复杂背景对文字的视觉干扰。
- **原生应用图标 (AppIcon.icns)**：
  - 黑曜石磨砂底盘与琥珀金「K」卡片交叠，完美契合 macOS Sonoma / Sequoia 超椭圆原生规范。
- **触觉与 3D 动力学 (Haptics)**：
  - 引入 macOS 触控板实体震动反馈（达判定阈值震动、松手磁吸回弹震动、划出确认震动）。
  - 手势 1:1 跟手响应与 3D 俯仰透视动效。
- **解耦式悬浮飞出层 (FlyingCardOverlay)**：
  - 划卡瞬间将卡片移入顶层独立渲染层，底层新卡平稳承接，彻底根治划卡瞬跳与换卡背景闪烁。
- **单一入口模态路由 (ActiveSheet)**：
  - 统一调度设置、统计、历史、快捷键弹窗，彻底根治 macOS SwiftUI 多 `.sheet` 冲突与失效。
- **五大核心视图重构**：
  - `CardView`、`DetailView`、`StatsView`、`HistoryView`、`SettingsView` 全面升级画报化质感。

---

## [v1.6.0] - 2026-09-06

### 新增 (Added)
- **自定义领域知识分类体系**：
  - 定位从「冷知识卡」全面扩展为「领域知识卡」。
  - 设置页支持自定义分类增删改（名称 + 内容方向描述）。
  - 默认预置 AI、AI 开发、AI Agent、中级会计、投资理财等领域分类。
  - 内置种子知识库扩充至 214 张。
- **AI 定制生成**：
  - Prompt 动态注入各分类的内容方向描述，支持多领域卡片生成。

---

## [v1.5.0] - 2026-09-06

### 新增 (Added)
- **信息来源配置**：
  - 支持分别开关「预置精选库」与「AI 生成内容」。
  - 支持配置 AI 优先引用的权威信源站点。
- **AI 内容标记**：
  - AI 生成的卡片支持在正面与详情页显示专属标记徽章，可自由开关。

---

## [v1.4.0] - 2026-09-06

### 新增 (Added)
- **偏好分类过滤与自动回退**：偏好分类优先展示，耗尽后自动回退全量。
- **存储性能优化**：引入 350ms 节流合并与 Task.detached 后台写盘。
- **近 7 天学习趋势柱状图**。
- **快捷键帮助浮层 (`⌘?`)**。

---

## [v1.3.0] - 2026-09-05

### 新增 (Added)
- **学习统计面板 (StatsView)**：
  - 呈现已刷卡片数、感兴趣率、连续学习天数、分类偏好条形图。

---

## [v1.2.0] - 2026-09-04

### 新增 (Added)
- 知识库扩容至 77 张。
- 性能与内存健壮性优化。

---

## [v1.1.0] - 2026-09-04

### 新增 (Added)
- UI 重设计：引入 21 套精选科学人文摄影背景图与衬线排版。

---

## [v1.0.0] - 2026-09-04

### 新增 (Added)
- KnowFlick 首个公开版本：macOS 卡片式知识应用，支持左右滑卡、详情展开、浏览历史与 DeepSeek AI 知识卡生成。

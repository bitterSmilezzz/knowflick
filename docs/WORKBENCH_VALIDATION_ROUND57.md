# Round 57 验证记录

## IPv6 回环地址识别

用户把本地模型地址填成 `http://[::1]:11434/v1` 且不填密钥时，连接测试在发出请求前
就报「未配置 API Key」。WHATWG URL 与 Rust URL 的主机名都保留方括号 `[::1]`，
代码却比较 `::1`，因此前端把本机模型当成公网服务，Rust 也拒绝本机 HTTP。

修复范围只限主机名比较：`requiresKey`、`assertFetchableUrl` 与 Rust `validate_url`
改为识别规范化后的 `[::1]`。完整写法 `0:0:0:0:0:0:0:1` 同样规范化到此值；
普通 IPv6 地址与 `[::]` 不因此获得本机豁免。

先复现再修：

| 检查 | 修复前 | 修复后 |
| --- | --- | --- |
| 前端 `assertFetchableUrl` 接受 IPv6 回环 | 失败（抛「只有本机地址可以用 HTTP」） | 通过 |
| 前端 `requiresKey` 不给回环地址要密钥 | 失败（返回 true） | 通过 |
| 前端 `probeConnection` 空密钥连接回环 | 抛「未配置 API Key」 | 发出请求并解析响应 |
| Rust `validate_url` 接受 IPv6 回环 | 失败 | 通过 |

回归证据：

- 前端 `aiChat.test.ts` 走真实 `probeConnection`、`askModel`、`completeChat`，
  只替换网络响应，断言请求地址、请求体参数、**无 Authorization 头**与实际解析出的
  知识卡；公网地址在**发请求前**仍被拒绝（请求次数不变）。
- 前端 `ingest.boundaries.test.ts` 覆盖 `[::1]`、完整 IPv6 回环写法，
  以及非回环 IPv6 与 `[::]` 仍被拒绝。
- Rust 在临时 `[::1]:0` 服务上实际完成**聊天、Embedding、网页抓取**三种请求，
  断言请求行与响应内容，并确认三条请求都不带 Authorization。

这条 Rust 用例第一次运行时失败在测试夹具上：macOS 接受的连接仍是非阻塞模式，
读取请求时提前返回 `WouldBlock`（os error 35）。这是测试环境问题，不是产品缺陷，
把连接切回阻塞读取后通过。

## 本机安装与真机窗口

macOS 安装版已重建并安装（DMG 24.01 MiB），应用进程启动成功。

**真机逐页验证未完成**：本次会话停在 macOS 登录界面，应用主窗口无法抬起，
`tools/real_app_pages.mjs` 报「SKIP 应用没有打开的窗口」。已确认这是环境限制而非
脚本缺陷——System Events 报告该进程窗口数为 0，且 `tauri.conf.json` 把主窗口设为
`"visible": false`，正常路径是从托盘菜单打开。**SKIP 不等于通过**，该项仍待补。

## 代理环境下的本地模型请求（只读复核发现）

复核代理报告新加的 IPv6 用例在代理环境下失败。查下去确认**不只是用例问题**：
系统配了 `HTTP_PROXY` 时，reqwest 把所有请求交给代理，本地模型的请求因此到不了
本机服务，用户看到的是「抓取失败」而不知道原因。

修复按目标地址选客户端：只有回环绕过代理，外部地址照旧跟随系统代理。
回环判定用 `Ipv6Addr::is_loopback`，展开写法 `0:0:0:0:0:0:0:1` 同样识别。

| 验证 | 结果 |
| --- | --- |
| 默认环境跑 http 模块 12 项 | 全过 |
| 清空 `NO_PROXY` 并设 `HTTP_PROXY` 后跑同样 12 项 | 全过 |
| 移除代理绕过后重跑（反向验证） | 两条行为用例失败 |
| 恢复绕过后重跑 | 全过 |

排查中的一个坑：本机 `NO_PROXY` 本来就含 `::1`，最初的复现**看不到**问题，
必须显式清空 `NO_PROXY` 才暴露——验证环境与用户环境不一定相同。

## 本机门禁

前端 382 项通过（62 个测试文件），Rust 88 项通过、3 项忽略（共 91 条声明），
检查器自身 7 项隔离测试通过，13 套浏览器冒烟通过，`verify_workbench.sh` 退出码 0。

## 跨平台状态

`91d5384` 的三平台打包 job（macOS DMG / Linux DEB / Windows MSI）全部成功，
Android 与冻结桌面 workflow 成功。普通 Workbench 门禁在记录时仍在运行。
上一轮 `bf7463e` 的普通 Workbench run 最终为 cancelled，未取得成功结论。

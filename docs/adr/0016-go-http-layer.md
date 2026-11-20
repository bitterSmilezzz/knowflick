# 第二阶段第七刀：HTTP 层（http.rs）迁到 Go

> 按 ADR-0007 顺序迁 `http`。这一层看着只是「发请求」，真正的价值在三条**安全口径**上，迁的时候必须一条不落地保留。

## 一、保留的三条口径

| 口径 | 为什么 | Go 实现 |
| --- | --- | --- |
| 只接受 https；http 仅限本机回环 | 明文传输外部地址会泄露内容 | `ValidateURL`：`http` 且非回环直接拒 |
| URL 里不能带账号密码 | 凭据会随日志/错误信息泄露 | `parsed.User != nil` 即拒 |
| 回环直连、外部走系统代理 | 本地模型服务走代理只会 502；外部站点需要用户代理 | `NewClient`：回环时 `transport.Proxy = nil` |

另加一条与 Rust 对齐的：**跟随跳转后再校验最终地址**（`CheckRedirect` 每次重新 `ValidateURL`，最多 5 次）。

## 二、迁了什么

| 能力 | Go |
| --- | --- |
| 剪藏抓取 | `FetchClip`：4 MiB 上限、User-Agent、最终地址校验 |
| 聊天补全 | `ChatComplete`：Bearer 鉴权、错误响应先 `RedactSecrets` |
| WebDAV 上传 | `WebDAVPut`：Basic 鉴权、120 秒超时、不跟随跳转 |
| 密钥脱敏 | `RedactSecrets`：常见前缀（`sk-`/`ghp_`/`AKIA` 等）与 ≥32 位高熵串 |
| 字符集解码 | `decodeBody`：Content-Type 的 charset → meta 标签 → UTF-8 兜底，走 `x/text` 的 `htmlindex` |

### 字符集这条是补回来的

我第一版把 `decodeBody` 写成直接 `string(body)`，并在注释里说「复杂编码留给后续」。这是**错的取舍**：中文站点大量仍用 GBK，只按 UTF-8 读会得到乱码正文——而剪藏是产品主入口之一。补上 `x/text` 后实测 GBK 字节 `D6 D0 CE C4` 正确解出「中文」。

## 三、验证

| 用例 | 内容 |
| --- | --- |
| `TestValidateURLRules` | 4 条合法（含 `http://[::1]:9000`）与 5 条非法（含带凭据、`ftp://`、空串） |
| `TestLoopbackBypassesProxyAndOthersDoNot` | `localhost`/`127.0.0.1`/`::1`/展开写法为回环；`example.com`/`192.168.1.1`/`10.0.0.1` 不是 |
| `TestFetchClipDecodesAndCaps` | 本地 httptest 服务：UA 正确、正文与最终地址正确 |
| `TestFetchClipRejectsNonLoopbackHTTP` | `http://example.com` 被拒 |
| `TestRedactSecrets` | `sk-` 前缀与长 token 被替换，普通文本不被改动 |
| `TestWebDAVPutSendsBasicAuthAndBody` | 方法/正文/Content-Type/Basic 鉴权都对，返回 201 |
| `TestDecodeBodyHandlesGBK` | 头部 charset 与 meta 标签两条路径都能解 GBK；无声明时按 UTF-8 原样透传；未知编码原样 |
| `go_http_url_parity`（Rust） | 同一份 9 条地址列表，Rust `validate_url` 与 Go `ValidateURL` 结论逐条一致 |

## 四、还没做

- `request_embeddings`（向量请求）尚未迁——它与 `embed` 模块一起做更合适；
- 剪藏的正文抽取（HTML → 纯文本）本轮没做，Go 侧只返回原始响应文本；
- 超时与重试策略只对齐了主要几个，没有逐项核对；
- Windows / Linux 与 `.app` 签名。

## 五、下一步

`embed`（含 `request_embeddings`）→ `mail` → `asr`。

# 第二阶段第十四刀：MIME 正文抽取迁到 Go

> 承接 ADR-0022。Go 侧已能取回原始邮件字节；这一批把它变成可读文本。

## 一、迁了什么

| 规则 | Go 实现 | 与 Rust 的关系 |
| --- | --- | --- |
| multipart/alternative 优先 text/plain | bodyText | 纯文本为空才退到其它部分 |
| 附件只留文件名 | bodyText | 不下载、不解码；最多 128 个，名长 512 |
| HTML 本地转纯文本 | htmlToText | 去 script/style、解常见实体、按块换行；绝不抓远程资源 |
| 去掉强调标记 | stripMarkdownEmphasis | 与 Rust 同：转换器会留 `**`，正文按纯文本显示 |
| 嵌套上限 32 层 | bodyText | 超限直接报错，不递归到栈溢出 |
| 正文上限 512 KiB | capped | 按 UTF-8 边界截断并去 NUL |
| RFC 2047 头解码 | decodeHeader | 中文主题必须解，否则原样显示编码串 |

## 二、对拍抓到的真差距

第一版把主题原样输出成 `=?utf-8?B?5rWL6K+V5Li76aKY?=`。

Rust 用 mailparse，它**默认解码 RFC 2047**；Go 的 `net/mail` 只拆头不解码。
补上 `mime.WordDecoder` 后输出「测试主题」，与 Rust 一致。

这条差距只有对拍能发现——Go 侧自己的测试是绿的，因为我把「原样输出」当成了期望。

## 三、验证

| 用例 | 内容 |
| --- | --- |
| Go 9 项 | 纯文本正文与头；alternative 优先纯文本；纯文本为空时退到 HTML；附件只记名且字节不进正文；HTML 去 script/style 并解实体；层数守卫（未超限不误报）；UTF-8 边界截断与去 NUL |
| 跨运行时对拍 | Rust `go_mime_parity` 用同一封 .eml 比对主题、Message-ID 与正文选择，**三项一致** |

## 四、还没做

| 项 | 现状 |
| --- | --- |

| 更完整的 HTML → 文本 | Go 版是手写的轻量转换，不处理表格/列表嵌套/预格式；Rust 用 html2text |
| 落素材与去重写入 | 未迁 |
| 同步执行与进度 | 未迁 |
| 真实邮箱邮件 | 未验（一直缺凭据） |

**Go 版现在能把原始邮件解析成主题/发件人/正文/附件名**，字符集已覆盖 GBK 等常见中文编码；复杂 HTML 的排版仍会丢。

## 五、字符集也一并补上了

`decodeCharset` 原本按 UTF-8 直通，这一轮补了 `x/text` 的 `htmlindex`：
GBK 字节 D6 D0 CE C4 正确解出「中文」，未知编码原样透传。
不留「已知会乱码」的路径——中文邮件大量仍用 GBK，那是主场景而不是边角。

## 六、下一步

字符集解码（复用 httpx 已有的 `x/text` 能力）；然后是落素材与同步执行。

# 隐私与数据说明

KnowFlick 是**本地优先**的桌面应用：默认不注册账号、不做云端同步、不内置遥测或崩溃上报。
本文按 **0.9.0-rc1** 的实现写；每条结论都能在代码里找到对应位置。

## 数据存在哪里

应用有**两个概念**：**数据根目录**（`data_root`，放模型与配置）和**资料库**（一个 SQLite 库文件及其旁邻文件）。
资料库可以在界面里重新选择（`选择 KnowFlick 资料库`），所以下面同时给出「默认位置」与「实际位置」两栏。

| 内容 | 默认位置（数据根目录） | 说明 |
| --- | --- | --- |
| 数据根目录 | macOS：`~/Library/Application Support/KnowFlick`；Windows：`%APPDATA%\KnowFlick`；Linux：`$XDG_DATA_HOME/KnowFlick`，未设时 `~/.local/share/KnowFlick` | 由 `internal/dataroot` 决定，可用环境变量 `KNOWFLICK_DEBUG_DATA_ROOT` 覆盖（仅用于隔离测试） |
| 资料库（SQLite） | 默认 `<数据根目录>/store/knowflick.db` | 首次启动自动创建；界面里显示的资料库名与路径以「打开资料库」对话框的显示为准 |
| 附件 / 手写 / 录音 | `<资料库目录>/media/{audio,image,ink}/` | 库内相对路径（如 `media/ink/xxx.png`） |
| 卡片轮转 | `cards.json`、`cards.backup.json`、`cards.backup.2.json`（三代轮转） | 与资料库同目录 |
| 设置 | `settings.json`（另有 `settings.backup.json`、`settings.backup.2.json`） | 与资料库同目录 |
| 语音模型权重 | `<数据根目录>/models/ggml-{tiny,base,small}.bin` | 用户在设置里点「下载模型」才会下载 |
| 本地语义模型缓存 | `<数据根目录>/models/fastembed/` | 目录里有 `.onnx` 才算已下载 |

### 凭据文件（明文，不进 SQLite）

凭据有**两套路径规则**，容易混淆，实测如下：

| 凭据 | 实际路径 | 权限 |
| --- | --- | --- |
| AI 接口密钥 | `<数据根目录>/credentials/apiKey.credential` | 文件 0600、目录 0700 |
| WebDAV 应用密码 | `<数据根目录>/credentials/webdav.credential` | 文件 0600、目录 0700 |
| 邮箱密码 | `<资料库目录>/credentials/mail-<uuid>` | 文件 0600、目录 0700 |

前两条在**数据根目录**下（因为默认库目录名是 `store`，凭据被刻意放在它的**父目录**里，避免整库被替换时密钥一起消失）；
邮箱密码在**资料库目录**里。两者都在 Unix 系上收紧到「仅本人可读」，Windows 上靠用户目录 ACL。

系统钥匙串**没有**接入：这些是磁盘上的明文文件，权限收紧但**不是**系统级加密存储。

卸载应用**不会**删除数据根目录与资料库；需要删除时请手动移除上述目录。

## 什么时候会联网

应用**没有**任何自带的服务器、账号或遥测端点。以下是全部会发出的网络请求，以及它们的触发条件：

| 场景 | 发往哪里 | 什么时候发生 | 带了什么 |
| --- | --- | --- | --- |
| AI 对话 / 出卡 / 向量 | 用户在设置里填的 `baseURL`（OpenAI 兼容、Ollama、自建服务等） | 用户触发相应功能时 | 请求体（提示词、素材、卡片文本）+ API 密钥 |
| 剪藏：从链接抓正文 | 用户给的链接所在站点 | 用户点「从链接抓取正文」 | 只发 GET，不带 Cookie；HTTP 只允许本机回环地址 |
| 剪藏：GitHub / 哔哩哔哩 | `api.github.com`、`raw.githubusercontent.com`、`api.bilibili.com` | 剪藏 GitHub 仓库或 B 站视频时 | 公开仓库 / 视频的公开信息 |
| 订阅源（RSS / GitHub / 技术榜） | 用户添加的订阅地址 | **每 60 秒检查一次**，到期的订阅自动抓取（自动抓取在桌面端默认开启） | 订阅地址本身 |
| 邮箱（IMAP） | 用户填的 IMAP 服务器 | 用户点同步时；或开启「自动同步」的账号按其间隔（5–1440 分钟）后台同步 | 用户名与密码（仅做 LOGIN 认证） |
| WebDAV 备份 | 用户填的 WebDAV 地址 | 用户点「备份到 WebDAV…」时 | 备份包字节 + 用户名/密码；上传主对象与 `.sha256` 校验文件 |
| 语音模型下载 | `huggingface.co`（`ggerganov/whisper.cpp` 权重） | 用户点「下载模型」时 | 只下载，不上传任何内容 |

关于 IMAP：**只读**。客户端只发 `LOGIN`、`EXAMINE`、`UID SEARCH`、`UID FETCH BODY.PEEK[]`，
写类命令（`STORE` / `DELETE` / `EXPUNGE` / `COPY` / `APPEND` / `MOVE` 等）在协议层被拒绝，
因此导入邮件**不会**在服务器上标记已读或改动邮箱内容。

关于 WebDAV：**只上传不删除**。上传采用「主对象 + 同名 `.sha256` 校验文件」两个 PUT，目标已有同名对象时按 `-01`、`-02` 退让，
不会删除云端旧对象；这是**单向备份**，不是双向同步。

关于代理：非回环地址的请求会**跟随系统代理设置**（`http.DefaultTransport` 的代理行为），回环地址直连。

应用**没有**内建遥测、崩溃上报、广告或账号登录。**更新也是手动**：没有自动更新器，
新版本从 [GitHub Releases](https://github.com/bitterSmilezzz/knowflick/releases/latest) 手动下载。

## 备份与导出里的凭据

应用内的导出与备份**不会带走凭据文件**，也不会带走设置里残留的密钥字段：

- `.kfbackup` 备份包的条目是白名单（`cards.json`、`materials.json`、`settings.json`、`artifacts.json`、`notes.json`、
  `knowledge_bases.json`，以及按版本追加的 r4 / 笔记修订 / 订阅 / 邮箱 / 复习历史 / 搜索历史 / 回收站条目，外加 `media/**` 附件）。
  `credentials/` 目录不在其中，读取备份包时若出现白名单外的条目会直接判为「备份包含不支持的条目」。
- 包内的 `settings.json` 会先剥掉密钥类字段（键名含 `apiKey`/`api_key`/`api-key`/`token`/`secret`/`password`/`passwd`/`credential`/`auth`）。
- `credentials/` 目录下的三个凭据文件与 `settings.json` 里的密钥都在本机，**不进 SQLite、不进任何导出格式**。
- 因此备份包可以复制到其它设备，但恢复后需要**重新填写**邮箱密码与 WebDAV 应用密码；AI 接口密钥也需要重新填写。

需要提醒的是：备份包包含你的**内容**（素材正文、笔记、卡片、附件），
包里的**设置**部分可能含服务器地址、用户名等配置，分享给别人前请自行判断。
订阅地址若带查询参数或片段，导入备份时会被排除（见设置页说明）。

## 数据删除与可携带

- 单条内容可在应用内删除；删除的条目进入**回收站**（`deleted_records.json` 记录墓碑），可从回收站恢复。
- 全量数据：删除资料库目录即删除。先导出一份备份可保留可恢复副本。
- 导出格式：`.kfbackup`（完整备份包，ZIP 容器）、Markdown 知识库（Obsidian 友好的 ZIP）、
  Anki 词表（`.tsv`）、`cards.json`（给安卓端用）、单篇笔记 Markdown。均不锁定在应用内。
- **完全删除**本机数据还需额外处理三处：`<数据根目录>/credentials/`（密钥）、
  `<数据根目录>/models/`（下载的语音与语义模型），以及 WebDAV 上的备份对象——**云端副本需要你自己去删**。

## 联系与变更

隐私相关变更会记录在 [CHANGELOG](../CHANGELOG.md)；发布记录里列明新增的联网场景。
数据出口的逐条清单见 [DATA_EGRESS](DATA_EGRESS.md)。

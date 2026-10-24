# 笔记与采集能力调研：来源、编辑、移动平板与邮件

检索日：2026-10-24（Asia/Shanghai）。用途：为 KnowFlick 的「笔记来源 → 知识整理 → 知识应用」产品重规划提供依据。本文件是调研与建议，不是已经实现的功能清单，也不变更现有 ADR。

## 1. 范围与结论

本轮选取 12 个代表产品：Obsidian、Notion、OneNote、Joplin、Evernote、Apple Notes、Logseq、Anytype、AFFiNE、思源笔记、Readwise Reader、Zotero；另补充 Goodnotes 与 Notability 的手写和录音模式。它们分别代表文件型笔记、块编辑器、自由画布、多模态收件箱、本地知识管理、阅读标注和文献管理。**这不是全市场穷举，不能据此声称已覆盖所有笔记软件或所有功能。**

证据只取自产品官方帮助、官方发布记录、官方开源仓库和协议标准。检索结果中的第三方教程、社区用户经验未作为产品能力承诺。官方文档能证明厂商声明，不能代替真实设备、真实账户和导入样本的兼容性验收。没有核实的事项在文末单列。

核心判断：

- 应统一的是内容、来源信息和处理流程。网页、灵感、语音、会议、邮件、文件和第三方笔记先进入同一收件箱，再整理、建立知识关联并应用；不应要求每个来源对应一个一级页面。
- 「市面功能不减少」可以作为长期需求池，不能解释成首版同时实现全部编辑器、全部邮箱和全部双向同步。基础产品要能独立跑通，复杂功能按模块加载、逐个验收。
- 先提供可靠的文件迁入、系统分享和主动剪藏，再做有限范围的持续采集。开放 API、文件导入和同产品多设备同步，均不能直接宣传为跨软件双向同步。
- 保存原件和来源，比立即把所有材料变成纯文本更基础。图片、PDF、音频和手写的可搜索文字应是可重建的派生数据；转写、摘要、知识卡和问答应能回到原始位置。
- 手机侧应以快速采集和回看为先，平板以手写与阅读批注为先，电脑以整理、长文、检索与批处理为先。功能共享不要求每端采用相同布局。

以下建议均是本轮调研后对 KnowFlick 的推论，不表示竞争产品采用同一架构。

## 2. 连接方式必须在产品里说清楚

### 直接编辑

用户在 KnowFlick 新建或修改自身笔记，KnowFlick 管理正文与版本。如果未来允许直接打开用户指定的 Markdown 文件夹，应明确这是修改原文件；不能把复制导入的笔记和原文件编辑混成一个操作。

### 一次性导入

读取某个时间点的导出文件，生成 KnowFlick 副本。来源之后变化，不代表副本会更新；副本的编辑也不写回来源。Obsidian Importer、Notion 的导入器、Evernote ENEX、Joplin 导入与 Anytype 导入导出均可作为这类迁移交互的参考。[Obsidian Importer](https://community.obsidian.md/plugins/obsidian-importer)、[Notion 导入](https://www.notion.com/help/import-data-into-notion)、[Joplin 导入导出](https://joplinapp.org/help/apps/import_export/)、[Anytype 导入导出](https://doc.anytype.io/anytype/data/import-and-export.md)

### 持续单向采集

KnowFlick 定期或按用户操作读取来源的新内容与新版本；来源仍由原软件管理。本地批注和应用产物单独保留。需要来源 ID、版本标记、游标、幂等去重、失败重试和暂停入口。不能把「每次导入一个新副本」称为增量同步。Gmail 的 history 和 Microsoft Graph 的 delta 证明提供商有增量读取机制，但 KnowFlick 仍须自己完成连接器。[Gmail 同步指南](https://developers.google.com/workspace/gmail/api/guides/sync)、[Graph 消息增量查询](https://learn.microsoft.com/en-us/graph/delta-query-messages)

### 本产品多设备同步

将 KnowFlick 自己的数据在用户设备之间复制并处理冲突，和把外部笔记软件接进来是两项不同能力。Joplin 支持多种同步目标，是自带存储服务与自备服务可以分开的参考。[Joplin 同步](https://joplinapp.org/help/apps/sync/)

### 有限双向同步

双方都能写入对方时，必须限定软件、对象、字段、附件、删除传播、权限、版本及冲突规则。仅有 API、WebDAV、可导出 Markdown 或浏览器插件，不足以证明已有双向同步。首版不承诺「所有笔记软件实时双向互通」。

在连接器卡片上直接显示「文件导入」「持续读取」「会修改来源」「本设备可用」「需要桌面客户端」等真实状态；未实现的连接器显示规划状态，不能显示为已经支持。

## 3. 能力目录：用统一内容模型容纳多来源

建议需求池按下列能力分组，避免按厂商堆叠按钮：

1. **即时采集**：全局快捷键、菜单栏或托盘、应用内新建、桌面快捷入口；手机的系统分享、快捷操作和离线草稿；用户可选的灵感浮窗。任何入口先能保存，分类和 AI 处理稍后进行。
2. **网页与阅读**：网址、选区、正文、页面快照、图片、原始链接、作者与采集时间；文章、RSS、电子书与 PDF 的阅读位置、高亮和批注；登录页面从用户主动操作的浏览器取内容，不承诺后台绕过网站权限。
3. **编辑与组织**：基本富文本与 Markdown 快捷输入、标题、列表、任务、代码、表格、图片、附件、自动保存、撤销、历史版本和回收站；文件夹或笔记本、标签、链接、反链、收藏、搜索与保存的筛选视图。复杂数据库、公式和无限画布属于可扩展能力。
4. **多模态笔记**：拍照、扫描、图片 OCR、音频录制与上传、视频附件、手写笔迹、PDF 批注。原件、识别文本和用户修订文本保持关联。
5. **会议**：录音或录音导入、时间戳转写、检索、人工校正、可追溯的摘要与行动项；再考虑系统声音、说话人区分、日历关联和在线会议工具适配。
6. **迁入**：Markdown/TXT/HTML/PDF/DOCX 等通用文件与带附件的压缩包；ENEX 等厂商格式；逐家增加可复跑的导入适配器与损失报告。
7. **持续来源**：邮箱、文件夹、RSS 和受支持的外部 API。用户选择范围，查看上次成功时间，暂停或撤销；不能默认读取所有来源。
8. **迁出与恢复**：内容可读的开放格式导出、原始附件、来源和关系清单、完整备份与恢复；「备份」不能只导出渲染后的 PDF。

## 4. 代表产品证据与可采用模式

### 4.1 Obsidian：文件可携带、核心与扩展分层

- 笔记的主要格式是 Markdown，可直接把文件或目录放入 vault；官方 Importer 可转换多种其他软件的导出内容，属于迁入，不自动构成持续联动。[Markdown 导入](https://obsidian.md/help/import/markdown)、[Importer](https://community.obsidian.md/plugins/obsidian-importer)
- 官方 Web Clipper 将网页内容保存到本地 vault；官方音频录制核心插件保存录音文件并嵌入当前笔记。核心插件可按需启停，覆盖链接、属性视图、每日笔记、检索、Canvas 等能力。[Web Clipper](https://obsidian.md/help/web-clipper)、[音频录制](https://obsidian.md/help/plugins/audio-recorder)、[核心插件](https://obsidian.md/help/plugins)
- **采用模式**：默认功能小而完整，低频能力按需出现；原始附件与正文分开管理，导入和后续编辑有明确边界。KnowFlick 不应照搬所有插件到内置主界面。

### 4.2 Notion：内容与视图分开，复杂能力渐进展开

- 官方导入器接受文本、Markdown、DOCX、CSV、HTML、PDF、ZIP 等；导入在电脑和网页端提供。文档明确记录格式、结构及兼容限制，值得借鉴其导入预检和进度呈现。[官方导入说明](https://www.notion.com/help/import-data-into-notion)
- Web Clipper 可把网页放入页面或数据库并保留原网址；其帮助文档没有承诺能接收任意手机应用里的内容。[Web Clipper 帮助](https://www.notion.com/en-gb/help/web-clipper)
- 当前 Notion 桌面和移动应用支持指定页面离线；网页端不提供同等能力，数据库离线范围也有限，不能继续用「Notion 完全不能离线」作为比较结论。[离线页面](https://www.notion.com/en-gb/help/use-pages-offline)
- AI Meeting Notes 支持录音转写和摘要，桌面系统声音、网页麦克风与手机麦克风的范围不同，且存在套餐与平台要求。[会议笔记](https://www.notion.com/en-gb/help/ai-meeting-notes)
- **采用模式**：同一内容在列表、项目等场景复用；重要属性平时收起，编辑时出现。借鉴操作层级，不把团队工作流和数据库搭建器一起塞进基础版。

### 4.3 OneNote：自由输入与时间关联，但迁移有平台限制

- OneNote 提供网页剪藏与语音听写；转写功能可将录音与做笔记时的墨迹相联系。[网页剪藏](https://support.microsoft.com/en-us/onenote/getting-started-with-the-onenote-web-clipper)、[听写](https://support.microsoft.com/en-us/onenote/dictate-your-notes-in-onenote)、[录音转写](https://support.microsoft.com/en-us/word/transcribe-your-recordings?ad=us&rs=en-us&ui=en-us)
- 官方网页笔记本导出仅适用于个人 OneDrive，工作或学校 OneDrive 与 SharePoint 不适用；官方页面也已把原网页导入功能标为弃用。不能对所有 OneNote 账户承诺同一迁移路径。[笔记本导出及限制](https://support.microsoft.com/en-us/onenote/export-and-import-onenote-notebooks)
- **采用模式**：多模态素材可围绕一页组织，录音回放能定位笔记上下文。复杂手写排版迁移时保留原件，转换失败允许以 PDF 或附件兜底，不能声称完全还原。

### 4.4 Joplin：离线基础产品与自选同步目标

- Joplin 把离线可用、笔记本、标签、检索和 Markdown 作为基础；官方支持 Windows、macOS、Linux、Android、iOS，并提供网页剪藏。[产品帮助](https://joplinapp.org/help/)
- 同步目标包括 Nextcloud、S3、WebDAV、Dropbox、OneDrive、本地文件系统及自家服务，说明本地功能与服务选择可分层。[同步目标](https://joplinapp.org/help/apps/sync/)
- ENEX 导入有识别数据、复杂样式和跨笔记链接还原限制；文档提供 Markdown/HTML 等迁入和 JEX 备份方案。手写在移动端内置、桌面可通过插件提供。[导入导出](https://joplinapp.org/help/apps/import_export/)、[绘图工具](https://joplinapp.org/help/apps/drawing_tool/)
- **采用模式**：基础本地可用，用户自带存储；导入损失坦诚可见；插件增强不影响核心内容可读。

### 4.5 Evernote：多来源收件箱与邮件转入

- 官方 Web Clipper 覆盖网页、图片、选区与部分邮件场景；邮件转入使用用户专属接收地址，手动或规则转发后创建笔记。这是转入机制，不等于完整邮箱持续读取或双向同步。[Web Clipper](https://help.evernote.com/hc/en-us/articles/209125877-Evernote-Web-Clipper-Quick-Start-Guide)、[邮件转入](https://help.evernote.com/hc/en-us/articles/209005347-Save-emails-into-Evernote)
- 当前桌面端支持 ENEX/HTML 导出；官方迁入说明区分「转换成可编辑笔记」与「文件作为附件」，并指出手机不提供同等导入入口。[导出](https://help.evernote.com/hc/en-us/articles/209005557-Export-Notes-and-Notebooks-as-ENEX-or-HTML)、[导入](https://help.evernote.com/hc/en-us/articles/208314308-Import-content-from-other-apps-into-Evernote)
- **采用模式**：统一入口与灵活的后续分类；但 KnowFlick 当前不提供自有云邮箱，不能直接照搬「发送到 KnowFlick 地址」而忽略邮件接收服务器的运营依赖。

### 4.6 Apple Notes：低摩擦采集与移动平板入口

- iPad 的 Quick Note、Apple Pencil 手写、扫描、照片与音频，把来源入口放在用户当前任务附近；官方也说明功能因地区和语言而异。[iPad Notes](https://support.apple.com/en-euro/guide/ipad/ipadfeea407c/27/ipados/27)
- 当前 Mac Notes 可导入 Markdown、TXT、RTF、RTFD、HTML、ENEX，导出 PDF 或 Markdown。它是可用的文件迁移路径，不能由此推断存在可让第三方任意读写全部 Apple Notes 的通用公开接口。[Mac 导入导出](https://support.apple.com/guide/notes/import-export-and-print-notes-not201900c07/mac)
- **采用模式**：先记下来，再整理；在上下文菜单或附件按钮展开少量操作。平板要保留笔迹，不能只用 OCR 文本替代原始手写。

### 4.7 Logseq：从日志和链接进入知识组织

- 官方文档覆盖日志、页面/块引用、反链、属性、查询、PDF 高亮、媒体嵌入、白板和闪卡，证明笔记与学习应用可以串联。[官方文档](https://docs.logseq.com/)
- 需区分文件图与数据库图。当前官方仓库将 DB 版标为 beta，新移动应用和 RTC 同步为 alpha，不能把旧 Markdown 工作流和新数据库图的能力混写成一套稳定承诺。[官方仓库当前状态](https://github.com/logseq/logseq)
- **采用模式**：每日记录和块引用可以作为渐进整理的入口；任务、链接和学习卡不必创建相互独立的内容副本。复杂查询与图谱放在二级视图。

### 4.8 Anytype：对象、关系与本地接口

- 官方文档按对象、类型、属性、查询和集合组织能力；导入导出在桌面提供，导出可包括关联对象与媒体，但也列出成员、聊天等不能完整导出的边界。[文档目录](https://doc.anytype.io/anytype/llms.txt)、[导入导出](https://doc.anytype.io/anytype/data/import-and-export.md)
- 官方 Local API 运行于桌面 localhost，可离线访问并创建、编辑、查询对象，具有可管理、可撤销的 API key。**这是接口能力证据，不是 KnowFlick 已经接通 Anytype 的证据。**[Local API](https://doc.anytype.io/anytype/features/integrations/local-api)
- **采用模式**：知识关系和来源是内容的一等信息；给其他工具的访问需要有单独的连接与撤销入口。首版保持笔记操作直观，不要求用户先学习对象建模。

### 4.9 AFFiNE：文档与画布共用内容，移动端做取舍

- 官方下载页说明桌面可离线读写文档、数据库与白板，移动端主要面向随身采集与回看，桌面仍是功能最完整的体验。[平台能力说明](https://affine.pro/download)
- 官方支持自托管；2026 年 7 月发布记录列出 OneNote、Obsidian、Bear 和 Notion 导入器及移动录音、编辑改进。这些发布项不等于格式无损或跨软件持续同步。[自托管](https://affine.pro/self-host)、[2026 年 7 月发布记录](https://affine.pro/blog/whats-new-july-update-2026)
- **采用模式**：同一份资料可有文档和视觉组织方式；模块按设备能力开放。KnowFlick 的白板应复用笔记引用，不维护第二套互不关联的材料。

### 4.10 思源笔记：块引用、学习与开放导出

- 官方仓库列有块级引用、双向链接、Markdown 所见即所得、网页剪藏、PDF 批注链接、数据库、闪卡、OCR、API 和扩展市场。[官方 README](https://github.com/siyuan-note/siyuan/blob/master/README.md)
- 本地功能和第三方存储服务分开；官方定价页列出第三方 S3、WebDAV 同步与备份接口，且标明额外条件及兼容限制，不能将其简单描述成「所有 WebDAV 免费可用」。[官方功能边界](https://b3log.org/siyuan/pricing.html)
- **采用模式**：笔记、引用与学习卡相互关联；给用户带附件的开放导出。KnowFlick 的功能与授权策略由自身 MIT 项目定位决定，不能推定其他项目同为 MIT 或可直接复制实现。

### 4.11 Readwise Reader：把来源、阅读、提炼分成阶段

- Reader 聚合文章、邮件订阅、EPUB、PDF、视频等，并提供移动分享、浏览器扩展、RSS、标注与筛选；其资料会进入 Readwise 的整理和回顾流程。[Reader 官方说明](https://docs.readwise.io/reader)
- 邮件订阅通过专属地址接收或用户邮箱规则转发；有进入资料库与订阅流的不同地址。这不是访问用户整个邮箱，也不代表能修改源邮件。[邮件订阅机制](https://docs.readwise.io/reader/docs/faqs/email-newsletters)
- **采用模式**：待处理收件箱、阅读进度、摘录和长期资料分层；「收到」与「值得进入个人知识」是不同状态，避免每条邮件、视频字幕和临时灵感都直接进入所有问答。

### 4.12 Zotero：原件、结构化元数据与可定位引用

- Zotero Connector 把网页和文献连同结构化书目信息存入资料库；本地客户端与保存到在线资料库是不同路径。[Connector](https://www.zotero.org/support/connector)
- 内置阅读器可把 PDF 批注加入笔记，保留回到原 PDF 页的链接和引用；内置批注存于数据库，要让外部 PDF 阅读器看到需导出含批注的文件。[PDF 阅读器与笔记](https://www.zotero.org/support/pdf_reader)
- **采用模式**：原件、批注、笔记、引用和应用成果建立可追溯关系；AI 证据也应能定位到页码、段落或时间点，而不只给文件标题。

### 4.13 补充：Goodnotes 与 Notability 的手写、录音模式

- Goodnotes 可录音并回放与录音同步的笔迹；部分回放模式只在 iOS/macOS 的笔记本可用。导出 PDF 不保留录音，包含音频的备份需使用其原生格式。[录音与回放](https://support.goodnotes.com/hc/en-us/articles/7352688559631-Add-Audio-Recordings-to-your-documents)、[录音备份](https://support.goodnotes.com/hc/en-us/articles/7352773502351-Back-up-documents-with-Audio-Recordings)
- Notability 的录音可关联批注并通过笔记位置跳转播放；当前官方转写帮助明确列有地区限制，不能把此类能力看成跨地区、跨端天然可用。[录音关联笔记](https://support.gingerlabs.com/en-us/articles/16300122-recording-and-playing-audio)、[转写限制](https://support.gingerlabs.com/en-us/articles/16300075-audio-transcripts)
- **采用模式**：手写原始笔迹和音频时间关系值得进入长期模型；专业墨迹体验、笔迹与录音完整回放属于专项工程，后置实现并不从需求池删除。

## 5. 邮件接入：提供商能力与 KnowFlick 产品边界

### 5.1 先区分三种用户需求

1. **保存这一封**：用户分享、拖入 EML、导入 MBOX 或主动剪藏，得到本地材料。最适合作为第一批邮件入口。
2. **持续收集某类邮件**：选定标签、文件夹、发送人或时间范围，定期单向读取。适合资料订阅、项目资料和周期报告；用户能预览将读入的范围。
3. **把 KnowFlick 当邮箱客户端**：收发、回复、已读状态、归档、移动、删除、文件夹及标签双向同步。这是独立产品复杂度，本轮建议后置，不以「邮箱接入」名义隐含承诺。

### 5.2 Gmail

- Gmail API 访问用户数据需要 OAuth。读取正文所需的 `gmail.readonly` 属于 restricted scope；`gmail.metadata` 不包含正文，不能用于完整知识采集。官方要求公开应用完成相应验证，并说明受限数据如被存储于服务器或经服务器传输，会涉及安全评估要求。开源或本地存储不自动免除所有授权与发布要求，应按最终实现核实适用规则。[Gmail scope 分类与验证](https://developers.google.com/workspace/gmail/api/auth/scopes)
- Gmail 的 IMAP/POP/SMTP 支持 OAuth；一般协议访问使用 `https://mail.google.com/` scope，不能把换成 IMAP 视为绕开授权或缩小权限的方法。[Gmail XOAUTH2](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol)
- 官方增量读取依赖 history；过期游标可能返回 404，需要重新进行限定范围的全量读取。[Gmail 同步](https://developers.google.com/workspace/gmail/api/guides/sync)
- **建议**：优先独立的 Gmail API 只读连接器；支持选择范围、暂停和断开。自定义 OAuth 应用配置可作为高级选项，但不能成为普通用户首屏唯一用法；公开发行前做真实账户与审核验证。

### 5.3 Outlook / Microsoft 365

- Microsoft Graph 可经授权访问个人或组织账户邮件；委托 `Mail.Read` 支持读取登录用户邮箱，个人 Microsoft 账户也可授权。它与无需登录用户、面向组织邮箱的应用权限不同；组织策略可能影响最终可用性。[邮件 API 概览](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview?view=graph-rest-1.0)、[权限参考](https://learn.microsoft.com/graph/permissions-reference)
- Graph v1.0 的消息 delta 按文件夹跟踪新增、修改与删除，不是一个覆盖所有文件夹的万能游标。官方也提供 Microsoft 365 与 Outlook.com 的 IMAP/POP/SMTP OAuth 流程。[消息 delta](https://learn.microsoft.com/en-us/graph/delta-query-messages)、[协议 OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth/)
- **建议**：优先 Graph 委托只读；个人账户、企业账户分别验收。首版不要要求租户管理员授予全组织邮箱权限，也不申请发送与写入权限来完成资料读取。

### 5.4 QQ 邮箱

- QQ 官方帮助明确：第三方客户端的 POP3/IMAP/SMTP 等服务使用专用授权码；用户需先开启服务并生成授权码，在客户端密码框输入。授权码可在网页和手机端管理、失效；修改账号密码会导致旧授权码过期。[QQ 官方授权码帮助](https://help.mail.qq.com/detail/106/985)
- **建议**：提供带 QQ 预设的 IMAP 只读采集器，凭据保存在系统安全存储；界面明确要求「授权码」而非 QQ 登录密码。能启用 IMAP，不代表已获得自动化读取全部邮箱的产品授权，仍需用户选择采集范围。本轮未核实到适合 KnowFlick 的公开 QQ 邮箱 OAuth 接入契约，不作承诺。

### 5.5 网易 163 / 126 / yeah 等

- 本轮尝试访问网易官方帮助首页及具体 FAQ，但检索工具无法取得内容；官方域名检索也未返回足够证据。**因此不把第三方教程中的授权码路径、端口、IMAP ID、限流规则或 OAuth 支持写成已经官方核实的当前事实。**[待核实的网易官方帮助入口](https://help.mail.163.com/)
- **候选实现**：IMAP 采集框架加网易提供商配置，客户端授权方式及兼容处理必须由最新官方说明与测试账户共同确认。163、126、yeah、个人 VIP 与企业邮不能仅因同属网易而合并承诺。
- **发布门槛**：获取官方可访问说明，验证开启服务、授权码生成/撤销、文件夹列举、中文与附件、增量读取、断线恢复；完成之前在产品状态中标为「待验证」，不可宣传为全系列已支持。

### 5.6 IMAP、SMTP 与通用邮箱的真实边界

- IMAP 可读取也可修改状态；协议提供只读的 `EXAMINE` 与不隐式设置已读的 `BODY.PEEK`。因此采集器要在命令层验证不改已读、不移动、不删除，不能只靠界面写一个「只读」。SMTP 是邮件传输协议，不是读取邮箱所必需。[IMAP 标准](https://www.rfc-editor.org/rfc/rfc9051.html)、[SMTP 标准](https://www.rfc-editor.org/rfc/rfc5321.html)
- **建议**：通用 IMAP 是高级选项，提供服务器、TLS、端口、认证方式和有限范围测试；OAuth 与授权码按提供商处理。不要求用户配置 SMTP 来导入笔记；发送邮件是未来另一个明确能力。
- 有能力持续读取，仍需处理 UID/UIDVALIDITY、断线、来源移位、重复消息、HTML 净化与附件。产品统一保存来源标识和原始 MIME；收到远程删除事件时保留已收藏资料并标记来源状态，不能默认连带删除用户的笔记和知识成果。
- Readwise/Evernote 的转发到专属地址模式依赖对外接收邮件的服务。KnowFlick 当前本地标品应先做文件/分享入口或读取用户自有的专用邮箱文件夹；自托管接收服务可以成为后续可选模块。

## 6. 第三方笔记接入顺序与验收口径

### 第一批：通用文件与明确的导出路径

建议先做 Markdown/TXT/HTML、PDF、DOCX 和附件目录；ENEX 作为第一批厂商导入器。Obsidian/Logseq 的文件、Notion 的导出包、Apple Notes 的 Markdown、Joplin 的 Markdown/HTML 等，分别以实际样本建适配器。不能把不同方言全部归为「Markdown 无损」。

统一导入流程：选择来源 → 选择范围 → 预检与示例预览 → 导入 → 结果回执。回执必须包含笔记数、附件数、跳过项、损失项和失败项；用户可取消、重试，并能从导入批次定位与撤回新产生的内容。

最低保留信息：来源产品、来源 ID 或原始路径、原始标题、原创建/修改时间、采集时间、来源链接、附件、原件摘要指纹、导入器版本。使用内容指纹避免同一附件多份存储，来源关系可以有多条；相似但不完全相同的笔记只提出合并建议，不自动删掉原件。

### 第二批：按需安装的连接器

手机/平板先接系统分享和文件选择；不读取其他应用的私有目录。随后选择有明确需求的本地 API、邮箱或文件夹做单向增量。每个连接器单独声明：支持平台、来源版本、读取范围、认证方式、附件范围、是否需要原应用在线、暂停/撤销方式以及最后一次成功时间。

### 第三批：专用复杂格式与有限写回

OneNote 自由布局、复杂 Notion 数据库、Apple 锁定笔记、手写原生格式、块 ID/嵌入、知识图谱和厂商专有附件，都可能要求专项转换。默认保留原件、生成可读预览并报告不支持项；只在验证明确、用户需要的场景提供写回，不推广成通用双向同步。

## 7. 可直接进入产品规划的取舍

### 核心必须完整

本地创建和自动保存、统一收件箱、网页与文件导入、基本编辑、附件、搜索、分类、链接、来源回看、导出与恢复；既有学习卡、刷卡、测验和统计继续作为知识应用保留。每条材料能够从来源进入知识整理，再进入至少一种可验证的应用。

### 适合独立模块

录音与转写、OCR、邮件连接器、厂商导入器、手写/PDF 批注、自选同步存储、全文与语义索引、图谱/白板和外部工具接口。只有启用后才下载模型或启动后台任务；处理状态和失败应可见，停用模块不丢原始材料。

### 需要后置但保留在需求池

全市场格式完全兼容、通用跨软件双向同步、多人实时协作、无限画布与全能数据库、专业笔迹引擎、全平台系统音频、在线会议机器人、全邮箱客户端、全自动个人画像与跨软件自动执行。这些能力需要独立设计和验收，不能作为让基础闭环延期的捆绑条件。

### 交互建议

一级导航只呈现用户正在做的事，例如收集、笔记/知识、应用；连接器、导入格式和后台任务进设置或二级面板。新建入口保留文字优先的单一输入区，图片、附件、录音、手写按需展开。桌面支持键盘、批量处理与并排阅读；手机强调单手采集；平板强调笔迹、批注和阅读。此处是设计方向，最终导航名称应与总产品方案一起定稿。

## 8. 未核实事项与后续验证

- 本轮未穷举市场，也未测试任何产品的所有套餐、浏览器、操作系统、地区和语言组合；不作「全功能完全兼容」判断。
- 163/126/yeah 官方当前授权与协议细节尚未取得可读一手证据；QQ 邮箱公开 OAuth 契约未核实。
- OneNote 的账户与系统导出限制已查到，但未实际导出混合手写/录音的大型笔记本；Notion、ENEX、Markdown 方言和附件兼容性需样本验收。
- Logseq DB 版与旧文件图不能共用未经验证的导入假设。Anytype/AFFiNE 的开放接口、发布记录不能替代 KnowFlick 连接器的实现和测试。
- 会议转写的中文准确率、多人/混合语言表现、说话人识别、断网续录和长音频资源消耗均未实测；不可沿用营销文案作质量目标。
- Apple iPad、Goodnotes 和 Notability 是模式参考，不表示 KnowFlick 当前决定恢复 iOS 或建立新平台框架；平台路线需在产品方案和 ADR 中另行明确。

建议后续用一组公开或自制的固定样本验收：普通文本、中文与公式、表格、代码、相互链接、重复标题、图片、扫描 PDF、加密/损坏文件、短录音、长录音与带附件邮件。每个连接器记录可保留信息、会降级信息、无法读取信息和可重试失败；有证据后再标记为正式支持。

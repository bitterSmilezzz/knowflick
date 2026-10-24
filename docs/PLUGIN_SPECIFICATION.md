# 插件架构与沙箱规范 · 模块化第二大脑

> 状态：**已定稿（2026-10-18）**
> 策略：**插件架构先行，官方插件先跑，第三方生态后开**（D20）。
> 关联： [ADR-0003](adr/0003-desktop-second-brain-architecture.md) · [PRODUCT_REDIRECT_2026-10-18.md](PRODUCT_REDIRECT_2026-10-18.md)

---

## 1. 架构目标与设计原则

为实现用户提出的「模块化、可按需启用功能、全开时也必须低内存低 CPU 占用、不能臃肿」，插件系统遵循三大原则：

1. **进程隔离与故障域收敛**：重型或外部插件运行在独立子进程中（Node/QuickJS/WASM），插件发生 Panic、OOM 或死循环绝不拖死主应用界面。
2. **声明式清单与细粒度权限（Least Privilege）**：插件必须通过 `plugin.json` 显式声明所需权限（网络、剪贴板、文件、知识库读写），宿主根据清单执行越权拦截。
3. **零开销禁用（Zero-overhead when disabled）**：关闭的插件不加载任何代码、不注册后台监听、不分配内存。

---

## 2. 插件清单定义（`plugin.json`）

清单格式融合 VS Code 的贡献点（Contributes）与 Raycast 的偏好声明（Preferences）：

```json
{
  "$schema": "https://knowflick.app/schemas/plugin-v1.json",
  "id": "official-review-fsrs",
  "name": "温故知新（FSRS 间隔复习）",
  "version": "1.0.0",
  "description": "基于 FSRS 算法的滑动刷卡与记忆测验模块，助力核心知识点背诵与复习",
  "author": "KnowFlick Official",
  "icon": "icon.svg",
  "type": "official",
  "entry": "dist/index.js",
  "permissions": [
    "storage:cards:read",
    "storage:cards:write",
    "ui:views:register"
  ],
  "preferences": [
    {
      "name": "algorithm",
      "type": "select",
      "title": "记忆算法",
      "default": "fsrs",
      "options": [
        { "label": "FSRS 现代算法", "value": "fsrs" },
        { "label": "SM-2 传统算法", "value": "sm2" }
      ]
    },
    {
      "name": "dailyTarget",
      "type": "number",
      "title": "每日复习目标卡数",
      "default": 20
    }
  ],
  "contributes": {
    "views": [
      {
        "id": "review-deck",
        "title": "温故知新",
        "icon": "sparkles",
        "location": "sidebar"
      }
    ],
    "commands": [
      {
        "id": "start-daily-quiz",
        "title": "开始今日复习",
        "shortcut": "CommandOrControl+Shift+R"
      }
    ]
  }
}
```

---

## 3. 权限模型（Permission Capabilities）

插件只能调用其清单中显式申请的 Capabilities：

| 权限标识 | 权限含义 | 拦截策略 |
|---|---|---|
| `network:fetch` | 允许发起外网 HTTP(S) 请求（如爬虫、抓取） | 宿主代理网络栈，禁止私自打开原始 TCP Socket |
| `clipboard:read` | 允许读取系统剪贴板（如快速抓取链接） | 仅在用户主动触发或全局胶囊聚焦时开放 |
| `fs:read_temp` | 允许读取用户拖入的临时文件 | 只能读取 dialog 选中的文件路径，无权遍历用户主目录 |
| `storage:materials:write` | 允许往素材层（Layer 1）追加内容 | 只能写入 `materials` 表 |
| `storage:cards:read` | 允许检索和读取原子知识卡（Layer 2） | 遵循只读查询限制 |
| `storage:cards:write` | 允许增删改知识卡或更新复习状态 | 受事务与审计时间戳护航 |
| `ai:transform` | 允许调用主程序配置的大模型进行文本加工 | 受全局 Token 预算节流约束 |

---

## 4. 官方内置插件矩阵（第一阶段）

在 M1–M4 阶段，所有功能解耦为 5 个官方内置插件：

| 插件 ID | 插件名称 | 默认状态 | 资源硬预算 | 核心能力 |
|---|---|---|---|---|
| `official-inbox-sniff` | 多平台智能链接嗅探器 | **开启** | 空载 0 MB，运行 <30 MB | 针对 GitHub API、B站视频公开接口、微信/通用文章进行正文提取 |
| `official-doc-extractor` | 本地文档大纲与切片解析器 | **开启** | 空载 0 MB，解析时 <50 MB | Markdown / TXT / DOCX / PDF 纯文本与标题树本地提取 |
| `official-review-fsrs` | 温故知新（滑动刷卡与测验） | **关闭（一键开启）** | 禁用时 0 MB，开启时 <20 MB | 原 Tinder 划卡、SM-2/FSRS 算法、测验统计 |
| `official-speech-asr` | 本地语音转文字（Whisper） | **关闭（按需下载）** | 禁用时 0 MB，推理时 <600 MB | 基于 whisper.cpp，纯本地离线口述与灵感录入 |
| `official-cognitive-brief` | 认知简报与知识周报 | **开启** | 仅按周触发，无常驻内存 | 聚合新收知识点、分析关注趋势、挑出旧内容温故 |

---

## 5. 资源硬预算与健康度指标

为兑现「全开也能保证高性能、低占用」的承诺，设立以下硬指标门禁：

1. **空载内存基线**：主程序启动且仅加载核心工作台时，内存常驻 $\le 80\text{ MB}$（macOS / Windows 测试）；
2. **冷启动时间**：从点击图标到三栏界面渲染完成并可交互，$\le 400\text{ ms}$；
3. **插件加载时间**：单个插件激活耗时 $\le 50\text{ ms}$；
4. **检索响应延迟**：万条知识卡下，全文+向量 RRF 混合搜索首屏返回 $\le 30\text{ ms}$。

---

## 6. 对外协议集成：MCP（Model Context Protocol）暴露

插件层向外部 Agent 生态提供标准的 MCP Server（基于 stdio 或 loopback SSE）：
- **Resources**: `knowflick://cards/{id}`、`knowflick://materials/{id}`
- **Tools**:
  - `search_knowledge(query: string, limit: number)`
  - `create_flash_card(headline: string, summary: string, details: string, tags: string[])`
  - `get_weekly_briefing(week_offset: number)`

这使得用户无论使用 Claude Code、Cursor 还是 DeepSeek Harness，都能将此软件作为他们个人的统一外部记忆库调用。

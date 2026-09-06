# KnowFlick

<div align="center">

**macOS 冷知识卡片应用 — 打开即学，左右划卡**

[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-black?logo=apple&logoColor=white)](https://github.com/bitterSmilezzz/knowflick)
[![Swift](https://img.shields.io/badge/Swift-5.9-orange?logo=swift&logoColor=white)](https://github.com/bitterSmilezzz/knowflick)
[![SwiftUI](https://img.shields.io/badge/SwiftUI-%E5%8E%9F%E7%94%9F-blue?logo=swift&logoColor=white)](https://github.com/bitterSmilezzz/knowflick)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/bitterSmilezzz/knowflick?include_prereleases&logo=github)](https://github.com/bitterSmilezzz/knowflick/releases)

<img src="assets/screenshot.png" width="720" alt="KnowFlick 截图"/>

</div>

---

KnowFlick 是一个用 SwiftUI 编写的 macOS 桌面应用（最低支持 macOS 14），采用「卡片 + 手势」的方式快速刷冷知识：每次随机展示一张知识卡片，左划/右划跳过或标记，按 `⏎` 展开详情和来源链接，历史记录自动保留。卡片不足时可选接入 AI（DeepSeek 等 OpenAI 兼容端点）自动生成新卡。

## 功能

- **随机刷卡**：从本地卡片库随机抽取，左右划快速浏览
- **详情 + 链接**：按 `⏎` 展开详情、查看来源链接；详情页内可连续刷卡（点操作自动切下一张，`←`/`→` 直接切换）
- **历史记录**：自动保存浏览历史，随时回看（支持按感兴趣/不喜欢筛选）
- **撤销**：`⌘Z` 撤销上一张卡片
- **AI 生成**：卡片不足时，用 DeepSeek 等模型自动补充新卡（可选，需配置 API key）；流式生成、够数即停，自动做分类规范化与近重复去重
- **来源配置**：设置页可分别开关「预置精选库」与「AI 生成内容」两种信息来源，并配置 AI 引用站点偏好（生成内容与检索链接都优先这些站点）
- **AI 内容标记**：AI 生成的卡片在正面显示橙色徽章、详情页显示核实提示条，可一键关闭
- **偏好过滤**：设置里从 21 个分类多选偏好，刷卡队列优先偏好分类，刷完自动回退其他分类
- **学习统计**：已刷/感兴趣率/连续天数 + 分类分布 + 近 7 天趋势

## 键盘快捷键

| 快捷键 | 功能 |
| --- | --- |
| `←` / `→` | 左右划卡（上一张 / 下一张） |
| `⏎` | 展开 / 关闭详情 |
| `⌘Z` | 撤销上一张 |
| `⌘N` | 生成一张新卡（需配置 AI） |
| `Esc` | 关闭详情 / 历史 / 设置 |
| `⌘?` | 快捷键帮助 |

详情页内：

| 快捷键 | 功能 |
| --- | --- |
| `←` / `→` | 切换上一张 / 下一张详情 |
| `⏎` / `Esc` | 关闭详情 |
| `⌘Z` | 撤销上一张 |

## 下载安装

从 [Releases](https://github.com/bitterSmilezzz/knowflick/releases) 页面下载最新 `KnowFlick.app.zip`，解压后拖入「应用程序」即可。

> 提示：未签名应用首次打开时，若被 Gatekeeper 拦截，请在「系统设置 → 隐私与安全性」中点击「仍要打开」；或执行 `xattr -dr com.apple.quarantine /Applications/KnowFlick.app`。

## 构建与运行

### 直接运行（开发）

```bash
cd KnowFlick
swift run
```

### 打包成 .app

```bash
cd KnowFlick
./build_app.sh
```

脚本会执行 `swift build -c release`，并把可执行文件、`Info.plist` 和资源 bundle 手工组装为 `dist/KnowFlick.app`（无需 Xcode 工程）。

### 安装使用

- 双击 `dist/KnowFlick.app` 直接运行；或
- 把它拖到 `/Applications` 后从「启动台」/「应用程序」打开

## AI 配置（可选）

在应用内点击「设置」（齿轮按钮，主界面右上角）填写：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| Base URL | OpenAI 兼容端点地址 | `https://api.deepseek.com` |
| Model | 模型名称 | `deepseek-chat` |
| API Key | 密钥（仅保存在钥匙串） | — |

- 默认配置为 DeepSeek；也可以填任意 OpenAI 兼容端点（如 OpenRouter、本地 Ollama 等）的 `base_url` 与模型名
- **API key 不会写入本地配置文件**，只存入 macOS 钥匙串（Keychain），base_url 与 model 存于 UserDefaults
- 设置界面中可开启/关闭「卡片不足时自动生成」，**从 21 个分类多选偏好分类**（AI 生成会优先偏好分类，刷卡队列也会优先推送），并分别控制「预置精选库 / AI 生成内容」两种信息来源与 AI 引用站点偏好

## 数据存储

| 内容 | 位置 |
| --- | --- |
| 卡片数据（含历史） | `~/Library/Application Support/KnowFlick/cards.json` |
| AI 设置（base_url / model） | `UserDefaults`（`com.knowflick.app`） |
| AI 密钥 | macOS 钥匙串（Keychain） |

内置种子知识库（160 张）随 app 打包在资源 bundle 中（`Contents/Resources/KnowFlick_KnowFlickCore.bundle/seed_cards.json`），覆盖 21 个分类：通识（物理/生物/天文/数学/化学/历史/心理/脑科学/语言/科技/生活/地理）+ 技术向（AI/算法/数据结构/架构/Rust/Python/编程）+ 备考向（中级会计/学习方法）。

卡片背景图来自 [Unsplash](https://unsplash.com)（Unsplash License，可免费商用），已做压暗与底部渐变处理以保证文字可读性。

## 项目结构

```
KnowFlick/
├── Package.swift            # SwiftPM 清单（macOS 14+）
├── build_app.sh             # 打包脚本 → dist/KnowFlick.app
├── Sources/KnowFlick/
│   ├── KnowFlickApp.swift   # 应用入口
│   ├── Models/              # 卡片 / AI 设置模型
│   ├── Services/            # AI 服务、钥匙串存取
│   ├── Stores/              # 应用状态、卡片存储
│   ├── Views/               # 刷卡、详情、历史、设置界面
│   └── Resources/           # seed_cards.json（种子卡数据）
└── dist/KnowFlick.app       # 打包产物（由 build_app.sh 生成）
```

## 技术说明

- 纯 SwiftPM 工程，无 Xcode 工程文件；`swift build -c release` 即可编译
- 双 target 结构：`KnowFlickCore`（模型/服务/存储/统计，可测试）+ `KnowFlick`（App 入口与视图）+ `KnowFlickCoreTests`
- 使用 `Bundle.module` 加载内置资源（seed_cards.json），背景图经 ImageIO 降采样解码缓存
- 目标平台：macOS 14.0+（Apple Silicon / Intel 均可）

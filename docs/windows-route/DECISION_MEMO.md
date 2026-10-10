# Windows 端路线调研备忘（2026-10-10）

> 双机并行 agent 开发的配套调研。两份完整报告：
> [资源占用 × 复用度对比](RESOURCE-REPORT.md)（含一手实测与来源标注）· [CMP 抽取可行性](CMP-FEASIBILITY.md)（逐文件纯度与工作量）。
> 本文件只记**结论与决策树**，细节看两份报告。

## 背景

用户两条硬约束：**① 跨平台一次开发多端同步**（越少重复工作越好）；**② 性能与资源占用要求高**（不能占过多 CPU/内存）。

现状：`apps/mac`（Swift/SwiftUI，完整）· `apps/android`（Kotlin/Compose，完整）· Windows 端未启动。
**关键不对称**：mac 端是 Swift，CMP 永远覆盖不到——任何非 Swift 路线都是「CMP 双端 + Swift 单端」的 2+1 结构。

## 三条路线核心事实

| | A · Compose Multiplatform | B · Avalonia | C · 本地 Web + 常驻 |
|---|---|---|---|
| 与 Android 代码复用 | **62% 代码用 `androidx.compose.*`**（同包名不动的 15,520 行，其中 10,376 行可直接进 commonMain） | 零（XAML ≠ Compose） | 零（Web UI），但同步协议纯 HTTP 可直接实现 |
| 空载内存 | ~108 MB（空窗口）+ JVM 默认堆 25% 物理内存陷阱需显式 `-Xmx` | ~140 MB（idle，社区单点） | **边际 23–46 MB**（用户已开浏览器时，实测 Bun 空载 25.9 MB） |
| 中等负载峰值 | 616–695 MB（JVM）；GraalVM Native+PGO 可到 269 MB 但**不受官方支持** | ~260 MB | 无权威数据 |
| 手机/其他端 | iOS Stable、Web Beta（本次 Windows 用不到） | 可出移动端但要求重写 Android 端 | 手机浏览器**无法写本地磁盘**（只读入口，功能倒退） |
| 工具链风险 | **中高**：Kotlin 2.0.21 ↔ CMP 1.7.3 ↔ Compose BOM 2025.06.00 三方不对齐（CMP 1.8+ 要求 Kotlin ≥2.1） | 低（.NET 8 SDK，但国内镜像最弱） | 低（Node/Bun + npm 镜像成熟） |
| MSI/产物构建 | **只能在 Windows 机器上构建**（jpackage 不支持交叉编译） | mac 可交叉编译出 Windows 产物（已实测 84.9 MB） | 无需安装包，起服务即用 |

## 工作量粗估（CMP 路线，单人）

| 档位 | 内容 | 人日 |
|---|---|---|
| **只抽 domain 共享模块**（探针） | 新建 KMP 模块（androidTarget + jvm）+ domain 4141 行搬迁 + 平台抽象基础（路径/凭据） | **8–14** |
| CMP 全量首版（砍微件/海报） | + UI 共享化（约 10 文件 5064 行可直接搬，HARD 12 文件平台调用点密度低）+ Windows 装配 + 打包 | **22–35** |
| CMP 全量完整 | 含 TTS/SAPI 通道、海报渲染、CI | 30–52 |

domain 层事实：19 文件 4141 行 **零 `android.*` import、零 coroutines、零反向依赖**（持久化由装配方注入）——可直接进 commonMain，唯一待实测：双 JVM target 下 `java.time`/`java.util` 是否放行（官方文档说 JVM+Android 不共享 source set，但 androidx 自己在用；退路：换 kotlinx-datetime，约 25 处调用）。

## 决策树

```text
要 Windows 端吗？
├─ 不要 → 本备忘关闭，双机工作流已就绪（AGENTS.md）
└─ 要
   ├─ 接受「Windows UI 与 Android 不共享」？ → 路线 B/C（资源更省但等于第三个 App）
   └─ 要复用 Android 代码
      ├─ 先做 domain 探针（8-14 人日，验证工具链与 java.* 放行）→ 推荐
      │   └─ 探针成功 → 再决定全量 CMP（+14-21 人日）还是仅 domain 共享 + 另写 UI
      └─ 直接全量 CMP（30-52 人日，工具链风险前置）
```

## 已知需拍板项（第二轮弹窗）

1. **Windows 路线定版**：CMP 全量 / domain 探针先行 / 换 B・C / 暂缓。
2. 若 CMP：**工具链对齐策略**（保 Kotlin 2.0.21 降 BOM vs 升 Kotlin 2.1+/2.2+ 保 BOM）。
3. （后续）Windows 机器到位时间，决定探针在哪台机器做。

## 附：本次调研的两处事实修正

- 本机**有** JDK 17（Homebrew `openjdk@17`），`java` 命令不在 PATH 是配置问题非缺 JDK——两份报告初稿的「无 JDK」判断已修正。
- 社区流传的「Tauri 省 5 倍内存」是测量口径错误（漏算 WebKit 进程树）；同机 benchmark 诚实口径下 Tauri ≈ WebView 系浏览器。RESOURCE-REPORT §1.4 保留两种口径对比。

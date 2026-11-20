# 第二阶段第九刀：语音转写（asr）迁到 Go

> 迁 asr.rs。这是 ADR-0006 标为「最大风险」的模块——Go 侧没有成熟的 whisper 绑定。
> 阶段 0 验证了外部进程路线，这一刀把它完整实现并对拍。

## 一、路线选择

| 方案 | 结论 |
| --- | --- |
| cgo 包 whisper.cpp | **不选**：把 C++ 编译链搬回来，CMAKE_ASM_COMPILER 那类问题原样带回，还让编译变慢——正好抵消迁移收益 |
| 依赖 ardanlabs/bucky（26 star） | **不选**：API 稳定性无人兜底 |
| 外部进程 whisper-cli | **选它**：whisper.cpp 在 brew 里是 bottled 预编译的，编译期依赖为零 |

## 二、迁了什么

| 能力 | Go | 与 Rust 的关系 |
| --- | --- | --- |
| 模型目录 | ModelsDir / ModelPath | data_root/models，同 Rust |
| 模型目录表 | Catalog | tiny/base/small 三个名字、文件名、期望字节数逐条一致 |
| 安装状态 | ModelStatus | 文件非空即算装了；期望字节数只用于展示进度 |
| 下载 | Download | 流式 + 进度回调 + .part 再改名；失败删 .part，不留半截假模型 |
| WAV 解析 | ReadWAVMonoF32 | 只认 16-bit PCM，位深不符直接报错（不猜） |
| 转写 | Transcribe | 调 whisper-cli，返回文本、音频时长、耗时、模型名 |

下载走 httpx.ValidateURL 与 httpx.NewClient，因此自动继承上一轮的三条口径（https/回环、无凭据、回环绕代理）。

## 三、验证

### 3.1 Go 6 项用例

目录表与 Rust 逐条一致、非空文件才算装了、未知模型报错、WAV 解码（0/0.5/-1/0.25 四个采样点）、
非 WAV 与 24-bit 被拒、下载写 .part 后改名且进度被回调、外部 http 被拒且不留 .part。

### 3.2 端到端（真实模型）

transcript 为 Hello this is a test of speech recognition.，audioMs=3301，elapsedMs=4057。
用 tiny 模型（77 MB）与系统 TTS 合成的 16 kHz WAV。

### 3.3 跨实现路线对拍

同一段音频、同一个模型，两条**完全独立**的路线：

- Rust：whisper-rs 静态链接进宿主；
- Go：外部 whisper-cli 进程。

两者给出**完全相同的文字**。cargo test go_asr_matches_rust_transcript -- --ignored 通过。
这条断言的意义是：**换实现路线没有改变转写结果**——不是「Go 也能跑」，是「Go 跑出来和原来一样」。

## 四、还没做

| 项 | 现状 |
| --- | --- |
| 非 WAV 音频转换 | **没迁**。Rust 在 macOS 上用 afconvert 转 16 kHz 单声道；Go 侧目前只接受 WAV |
| 模型下载镜像回退 | 没做。直连 HuggingFace 会 Connection reset，实测 hf-mirror.com 可用（阶段 0 记录） |
| 真实麦克风录音 | 未验（一直缺） |
| 大模型耗时 | 只测 tiny |
| 插件开关与 0 MB 内存约束 | 未迁 |

**非 WAV 转换这条要单独说**：afconvert 是 macOS 专有。迁到 Go 后如果要支持 Windows/Linux，
需要换 FFmpeg 之类的跨平台方案，这是新工作而不是平移。

## 五、下一步

mail（最大的剩余模块，2265 行）；三端打包与签名在阶段 3。

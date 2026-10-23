//! 本地语音转文字（official-speech-asr 插件的引擎层）。
//!
//! 设计取舍：
//! - 用 `whisper-rs`（whisper.cpp 的 Rust 绑定）静态链进宿主。**不做常驻进程**：
//!   插件关闭时这里不会被调用，运行时内存为零（满足 PLUGIN_SPECIFICATION §5 的
//!   「禁用时 0 MB」）。
//! - 模型不随包分发（约 GB 级），按需下载到 `<data_root>/models/`，与库文件分开
//!   存放，删库不会顺带删模型。
//! - 解码只做 WAV（16-bit PCM）。其它格式在 macOS 上走系统自带的 `afconvert`
//!   转成 16 kHz 单声道 WAV；转不了就明确报错，不假装成功。

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

/// 可下载的模型目录。名字直接对应 HuggingFace 上的 ggml 权重文件名。
pub const MODEL_CATALOG: &[(&str, &str, u64)] = &[
    ("tiny", "ggml-tiny.bin", 77_700_000),
    ("base", "ggml-base.bin", 147_900_000),
    ("small", "ggml-small.bin", 487_600_000),
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AsrModelStatus {
    pub model: String,
    pub installed: bool,
    pub path: Option<String>,
    pub size_bytes: u64,
    pub expected_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub text: String,
    /// 音频时长（毫秒）
    pub audio_ms: u64,
    /// 转写耗时（毫秒）
    pub elapsed_ms: u64,
    pub model: String,
}

pub fn models_dir(data_root: &Path) -> PathBuf {
    data_root.join("models")
}

fn model_file_name(model: &str) -> Result<&'static str, String> {
    MODEL_CATALOG
        .iter()
        .find(|(name, _, _)| *name == model)
        .map(|(_, file, _)| *file)
        .ok_or_else(|| format!("未知的语音模型: {model}"))
}

pub fn model_status(data_root: &Path, model: &str) -> Result<AsrModelStatus, String> {
    let file = model_file_name(model)?;
    let expected = MODEL_CATALOG
        .iter()
        .find(|(name, _, _)| *name == model)
        .map(|(_, _, size)| *size)
        .unwrap_or(0);
    let path = models_dir(data_root).join(file);
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    // 只要文件存在且非空就算装了；大小与目录里的期望值只用于展示进度。
    let installed = size_bytes > 0;
    Ok(AsrModelStatus {
        model: model.to_string(),
        installed,
        path: if installed { Some(path.to_string_lossy().to_string()) } else { None },
        size_bytes,
        expected_bytes: expected,
    })
}

pub fn model_download_url(model: &str) -> Result<String, String> {
    let file = model_file_name(model)?;
    Ok(format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}"
    ))
}

/// 把 URL 流式下到 `target`，先写 `.part` 再改名。
///
/// 抽成独立函数是为了能脱离 Tauri 测：命令层只负责转进度事件。
/// 失败时删除 `.part`，避免留下一个「文件存在但内容是半截」的假模型。
pub async fn download_to_path<F>(
    url: &str,
    target: &Path,
    mut on_progress: F,
) -> Result<u64, String>
where
    F: FnMut(u64, u64),
{
    use std::io::Write;

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| crate::error_text::explain("创建模型目录失败", &e))?;
    }
    let partial = target.with_extension("part");
    let _ = std::fs::remove_file(&partial);

    // 回环地址必须直连，判据与 http.rs 的其余请求同一套（`client_for`）。
    // 这台机器可能开着系统代理（公司网络、Clash…），而代理对 127.0.0.1 的
    // 请求常常直接回 502——本地模型服务明明起着，下载却失败（实测）。
    let parsed =
        reqwest::Url::parse(url).map_err(|e| crate::error_text::explain("模型地址无效", &e))?;
    let client = crate::http::client_for(&parsed, std::time::Duration::from_secs(600), None)?;
    let response = client
        .get(parsed.as_str())
        .header("User-Agent", "KnowFlick/0.1")
        .send()
        .await
        .map_err(|e| crate::error_text::explain("下载模型失败", &e))?;
    if !response.status().is_success() {
        return Err(format!("下载模型失败: HTTP {}", response.status().as_u16()));
    }
    let total = response.content_length().unwrap_or(0);

    let mut file = std::fs::File::create(&partial).map_err(|e| crate::error_text::explain("写入模型失败", &e))?;
    let mut downloaded: u64 = 0;
    let mut response = response;
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if let Err(e) = file.write_all(&chunk) {
                    drop(file);
                    let _ = std::fs::remove_file(&partial);
                    return Err(crate::error_text::explain("写入模型失败", &e));
                }
                downloaded += chunk.len() as u64;
                on_progress(downloaded, total);
            }
            Ok(None) => break,
            Err(e) => {
                drop(file);
                let _ = std::fs::remove_file(&partial);
                return Err(crate::error_text::explain("下载中断", &e));
            }
        }
    }
    file.flush().map_err(|e| crate::error_text::explain("写入模型失败", &e))?;
    drop(file);

    std::fs::rename(&partial, target).map_err(|e| crate::error_text::explain("保存模型失败", &e))?;
    Ok(downloaded)
}

pub fn model_path(data_root: &Path, model: &str) -> Result<PathBuf, String> {
    Ok(models_dir(data_root).join(model_file_name(model)?))
}

/// 把任意音频转成 16 kHz 单声道 WAV。已是 WAV 就原样返回。
pub fn to_wav_16k_mono(input: &Path) -> Result<PathBuf, String> {
    let is_wav = input
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("wav"))
        .unwrap_or(false);
    if is_wav {
        return Ok(input.to_path_buf());
    }

    if cfg!(target_os = "macos") {
        let out = std::env::temp_dir().join(format!("knowflick-asr-{}.wav", uuid::Uuid::new_v4()));
        let status = Command::new("afconvert")
            .arg("-f")
            .arg("WAVE")
            .arg("-d")
            .arg("LEI16@16000")
            .arg("-c")
            .arg("1")
            .arg(input)
            .arg(&out)
            .status()
            .map_err(|e| crate::error_text::explain("调用系统 afconvert 失败", &e))?;
        if !status.success() {
            return Err("系统无法转换这段音频（支持 WAV；macOS 上其它格式经 afconvert 转换）".to_string());
        }
        return Ok(out);
    }

    Err("非 WAV 音频需要先转成 16 kHz 单声道 WAV（当前平台没有内置转换器）".to_string())
}

/// 解析 WAV 的 `data` 块成 f32 采样。只认 16-bit PCM：
/// 别的位深直接报错，避免拿错解释的数据喂给模型得出乱码文本。
pub fn read_wav_mono_f32(path: &Path) -> Result<Vec<f32>, String> {
    let bytes = std::fs::read(path).map_err(|e| crate::error_text::explain("读取音频失败", &e))?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("不是合法的 WAV 文件".to_string());
    }

    let mut pos = 12usize;
    let mut bits_per_sample = 0u16;
    let mut data_range: Option<(usize, usize)> = None;

    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let len = u32::from_le_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]]) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= bytes.len() {
            bits_per_sample = u16::from_le_bytes([bytes[body + 14], bytes[body + 15]]);
        } else if id == b"data" {
            let end = (body + len).min(bytes.len());
            data_range = Some((body, end));
            break;
        }
        pos = body + len + (len % 2);
    }

    let (start, end) = data_range.ok_or_else(|| "WAV 缺少 data 块".to_string())?;
    if bits_per_sample != 16 {
        return Err(format!("只支持 16-bit PCM 的 WAV（当前 {bits_per_sample}-bit）"));
    }

    let mut out = Vec::with_capacity((end - start) / 2);
    for chunk in bytes[start..end].chunks_exact(2) {
        out.push(i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0);
    }
    Ok(out)
}

/// 真正跑一次转写。调用方负责确认模型已下载与插件已启用。
pub fn transcribe(model_path: &Path, wav_path: &Path) -> Result<TranscriptionResult, String> {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    if !model_path.exists() {
        return Err(format!("语音模型不存在：{}", model_path.display()));
    }

    let samples = read_wav_mono_f32(wav_path)?;
    if samples.is_empty() {
        return Err("音频里没有可用采样".to_string());
    }
    let audio_ms = (samples.len() as u64) * 1000 / 16_000;

    let ctx = WhisperContext::new_with_params(
        model_path.to_string_lossy().as_ref(),
        WhisperContextParameters::default(),
    )
    .map_err(|e| crate::error_text::explain("加载语音模型失败", &e))?;
    let mut state = ctx.create_state().map_err(|e| crate::error_text::explain("初始化推理状态失败", &e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("auto"));
    // whisper 对中文默认倾向输出繁体；给一句简体中文的初始提示能明显纠正，
    // 这是 whisper.cpp 社区常用的做法，比在结果上做字形转换可靠。
    params.set_initial_prompt("以下是普通话的句子，请使用简体中文输出。");
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_translate(false);

    let started = std::time::Instant::now();
    state
        .full(params, &samples)
        .map_err(|e| crate::error_text::explain("转写失败", &e))?;

    let count = state.full_n_segments();
    let mut text = String::new();
    for i in 0..count {
        if let Some(segment) = state.get_segment(i) {
            if let Ok(part) = segment.to_str() {
                text.push_str(part);
            }
        }
    }

    let model_name = model_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("whisper")
        .trim_start_matches("ggml-")
        .to_string();

    Ok(TranscriptionResult {
        text: text.trim().to_string(),
        audio_ms,
        elapsed_ms: started.elapsed().as_millis() as u64,
        model: model_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_test_wav(path: &Path, samples: &[i16], rate: u32, bits: u16) {
        let data_len = (samples.len() * 2) as u32;
        let byte_rate = rate * 1 * (bits as u32 / 8);
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes()); // PCM
        out.extend_from_slice(&1u16.to_le_bytes()); // mono
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&byte_rate.to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes()); // block align
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            out.extend_from_slice(&s.to_le_bytes());
        }
        std::fs::write(path, out).unwrap();
    }

    #[test]
    fn reads_16bit_pcm_wav() {
        let path = std::env::temp_dir().join(format!("kf-asr-{}.wav", uuid::Uuid::new_v4()));
        write_test_wav(&path, &[0, 16384, -16384, 32767], 16000, 16);
        let samples = read_wav_mono_f32(&path).unwrap();
        assert_eq!(samples.len(), 4);
        assert!((samples[0] - 0.0).abs() < 1e-6);
        assert!((samples[1] - 0.5).abs() < 1e-3);
        assert!((samples[2] + 0.5).abs() < 1e-3);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_non_wav_and_wrong_bit_depth() {
        let bogus = std::env::temp_dir().join(format!("kf-asr-{}.wav", uuid::Uuid::new_v4()));
        std::fs::write(&bogus, b"not a wav at all").unwrap();
        assert!(read_wav_mono_f32(&bogus).unwrap_err().contains("不是合法的 WAV"));
        let _ = std::fs::remove_file(&bogus);

        let deep = std::env::temp_dir().join(format!("kf-asr-{}.wav", uuid::Uuid::new_v4()));
        write_test_wav(&deep, &[0, 0], 16000, 24);
        assert!(read_wav_mono_f32(&deep).unwrap_err().contains("16-bit"));
        let _ = std::fs::remove_file(&deep);
    }

    #[test]
    fn model_catalog_and_status() {
        assert_eq!(model_file_name("tiny").unwrap(), "ggml-tiny.bin");
        assert!(model_file_name("gigantic").is_err());

        let dir = std::env::temp_dir().join(format!("kf-models-{}", uuid::Uuid::new_v4()));
        let status = model_status(&dir, "tiny").unwrap();
        assert!(!status.installed);
        assert_eq!(status.size_bytes, 0);
        assert_eq!(status.path, None);

        std::fs::create_dir_all(models_dir(&dir)).unwrap();
        std::fs::write(models_dir(&dir).join("ggml-tiny.bin"), b"pretend-model").unwrap();
        let after = model_status(&dir, "tiny").unwrap();
        assert!(after.installed);
        assert!(after.path.unwrap().ends_with("ggml-tiny.bin"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 等一条连接，但**不能无限等**：超时返回 `None`。
    ///
    /// 为什么不用裸 `accept()`：本机开着系统代理时，下载请求会绕去代理
    /// （实测回 502），本地 listener 根本收不到连接——裸 `accept()` 会永久
    /// 挂住，把整个测试套件拖死（实测卡了 24 分钟）。写法与 `http.rs` 里
    /// 回环测试的 accept 一致。
    fn accept_within(
        listener: &std::net::TcpListener,
        timeout: std::time::Duration,
    ) -> Option<std::net::TcpStream> {
        let deadline = std::time::Instant::now() + timeout;
        listener.set_nonblocking(true).unwrap();
        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    // BSD 系（含 macOS）的 accept 会把非阻塞标记一起继承过来。
                    stream.set_nonblocking(false).ok();
                    return Some(stream);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if std::time::Instant::now() >= deadline {
                        return None;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(e) => panic!("accept 失败：{e}"),
            }
        }
    }

    /// 起一个只服务一次的本地 HTTP 服务，用真实 socket 验证下载 → .part → 改名。
    fn serve_once(body: &'static [u8]) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let Some(mut stream) = accept_within(&listener, std::time::Duration::from_secs(10)) else {
                return;
            };
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/octet-stream\r\n\r\n",
                body.len()
            );
            stream.write_all(header.as_bytes()).unwrap();
            stream.write_all(body).unwrap();
            stream.flush().unwrap();
        });
        (format!("http://127.0.0.1:{port}/model.bin"), handle)
    }

    #[test]
    fn download_to_path_writes_file_via_part_and_reports_progress() {
        static BODY: &[u8] = b"pretend whisper weights, 40 bytes long....";
        let (url, handle) = serve_once(BODY);
        let dir = std::env::temp_dir().join(format!("kf-dl-{}", uuid::Uuid::new_v4()));
        let target = dir.join("ggml-tiny.bin");

        let mut seen: Vec<(u64, u64)> = Vec::new();
        let downloaded = tauri::async_runtime::block_on(download_to_path(&url, &target, |done, total| {
            seen.push((done, total));
        }))
        .unwrap();
        handle.join().unwrap();

        assert_eq!(downloaded, BODY.len() as u64);
        assert_eq!(std::fs::read(&target).unwrap(), BODY);
        assert!(!target.with_extension("part").exists(), ".part 必须被改名掉");
        assert!(!seen.is_empty(), "至少要上报一次进度");
        assert_eq!(seen.last().unwrap().0, BODY.len() as u64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn download_to_path_leaves_no_partial_file_on_http_error() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let Some(mut stream) = accept_within(&listener, std::time::Duration::from_secs(10)) else {
                return;
            };
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            stream
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
            stream.flush().unwrap();
        });

        let dir = std::env::temp_dir().join(format!("kf-dl-{}", uuid::Uuid::new_v4()));
        let target = dir.join("ggml-tiny.bin");
        let err = tauri::async_runtime::block_on(download_to_path(
            &format!("http://127.0.0.1:{port}/model.bin"),
            &target,
            |_, _| {},
        ))
        .unwrap_err();
        handle.join().unwrap();

        assert!(err.contains("404"), "错误里要带上 HTTP 状态: {err}");
        assert!(!target.exists(), "失败不该留下目标文件");
        assert!(!target.with_extension("part").exists(), "失败不该留下 .part");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 真模型真音频的端到端转写。默认 `#[ignore]`：CI 没有模型权重。
    ///
    /// 本地跑法：
    ///   KNOWFLICK_ASR_MODEL=/path/ggml-tiny.bin KNOWFLICK_ASR_WAV=/path/16k-mono.wav \
    ///     cargo test -- --ignored transcribes_real_audio
    #[test]
    #[ignore]
    fn transcribes_real_audio_with_real_model() {
        let model = std::env::var("KNOWFLICK_ASR_MODEL").expect("需要 KNOWFLICK_ASR_MODEL 指向 ggml 模型");
        let wav = std::env::var("KNOWFLICK_ASR_WAV").expect("需要 KNOWFLICK_ASR_WAV 指向 16k 单声道 wav");
        let result = transcribe(std::path::Path::new(&model), std::path::Path::new(&wav)).unwrap();
        println!(
            "转写结果: {:?}（音频 {} ms，耗时 {} ms）",
            result.text, result.audio_ms, result.elapsed_ms
        );
        assert!(!result.text.trim().is_empty(), "转写结果不该为空");
        assert!(result.audio_ms > 0);

        // 非 WAV 也要走通：macOS 上由系统 afconvert 转成 16k 单声道
        if let Ok(non_wav) = std::env::var("KNOWFLICK_ASR_NON_WAV") {
            let converted = to_wav_16k_mono(std::path::Path::new(&non_wav)).unwrap();
            assert_ne!(converted.to_string_lossy(), non_wav, "非 WAV 应该被转换过");
            let via_afconvert = transcribe(std::path::Path::new(&model), &converted).unwrap();
            println!("非 WAV 转写: {:?}", via_afconvert.text);
            assert!(!via_afconvert.text.trim().is_empty());
            let _ = std::fs::remove_file(&converted);
        }
    }

    #[test]
    fn download_urls_point_at_huggingface() {
        let url = model_download_url("base").unwrap();
        assert!(url.starts_with("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"));
        assert!(url.ends_with("ggml-base.bin"));
        assert!(model_download_url("nope").is_err());
    }
}

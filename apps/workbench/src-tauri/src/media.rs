//! Local media for notes: recorded audio and handwritten ink.
//!
//! Contract:
//! - Files live under `<library>/media/<kind>/<uuid>.<ext>` and are only ever
//!   written there. Names are generated, never taken from the caller.
//! - Size is capped per kind; the payload is written atomically and read back
//!   with the same size, so a half-written recording is never referenced.
//! - Only the app's own directory is served; the path returned to the UI is
//!   relative to the library, so a moved library keeps working.
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Recorded audio: a few minutes of speech is well under this.
pub const MAX_AUDIO: usize = 64 * 1024 * 1024;
/// Ink strokes are vector JSON; this is generous but still bounded.
pub const MAX_INK: usize = 8 * 1024 * 1024;
/// Screenshots and photos pasted into the library.
pub const MAX_IMAGE: usize = 16 * 1024 * 1024;

/// IPC 上的附件字节走 base64 字符串。
///
/// 以前 `Vec<u8>` 会被 JSON 序列化成**数字数组**：5 MB 录音变成 ~18 MB 的
/// `[123,10,...]` 文本，两侧再各花几十毫秒逐个数字解析——附件越多
/// （备份导出要读**全部**附件）放大越狠。base64 只放大 1.33 倍，
/// serde 对字符串是 memcpy 级的。这也是 Tauri 官方文档给的建议
/// （Android 上 raw payload 不可用时「用 base64，仍比数字数组高效」）。
pub fn encode_b64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

/// 解不开的 base64 是 IPC 契约被破坏，不是用户操作问题——但消息仍要说人话。
pub fn decode_b64(text: &str) -> Result<Vec<u8>, String> {
    BASE64.decode(text).map_err(|_| "附件数据无效，无法解码".to_string())
}

fn kind_dir(dir: &Path, kind: &str) -> Result<PathBuf, String> {
    let folder = match kind {
        "audio" => "audio",
        "ink" => "ink",
        "image" => "image",
        _ => return Err("不支持的附件类型".into()),
    };
    Ok(dir.join("media").join(folder))
}

fn extension(kind: &str, mime: &str) -> Result<&'static str, String> {
    match (kind, mime) {
        // MediaRecorder produces WebM/Opus in Chromium, MP4/AAC in Safari.
        ("audio", "audio/webm") => Ok("webm"),
        ("audio", "audio/ogg") => Ok("ogg"),
        ("audio", "audio/mp4") => Ok("m4a"),
        ("audio", "audio/wav") | ("audio", "audio/x-wav") => Ok("wav"),
        ("ink", "application/json") => Ok("json"),
        ("image", "image/png") => Ok("png"),
        ("image", "image/jpeg") => Ok("jpg"),
        ("image", "image/webp") => Ok("webp"),
        ("image", "image/gif") => Ok("gif"),
        ("image", "image/heic") => Ok("heic"),
        _ => Err("不支持的附件类型".into()),
    }
}

/// Writes one note attachment and returns its path relative to the library.
pub fn save_media(dir: &Path, kind: &str, mime: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = extension(kind, mime)?;
    let limit = match kind {
        "audio" => MAX_AUDIO,
        "image" => MAX_IMAGE,
        _ => MAX_INK,
    };
    if bytes.is_empty() {
        return Err("没有内容可保存：录音或笔迹是空的".into());
    }
    if bytes.len() > limit {
        return Err(format!("附件超过 {} MB 上限", limit / 1024 / 1024));
    }
    let folder = kind_dir(dir, kind)?;
    fs::create_dir_all(&folder).map_err(|_| "Cannot create the media folder".to_string())?;
    let name = format!("{}.{ext}", uuid::Uuid::new_v4());
    let target = folder.join(&name);
    let temp = folder.join(format!(".{name}.part"));
    let outcome = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, &target)
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(&temp);
        return Err("无法写入附件".into());
    }
    // Read back the exact size: a truncated write must not be referenced.
    let written = fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    if written != bytes.len() as u64 {
        let _ = fs::remove_file(&target);
        return Err("附件没有写完整，已丢弃这次写入".into());
    }
    Ok(format!("media/{}/{name}", kind_dir(dir, kind)?
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("audio")))
}

/// Reads back an attachment, refusing anything that escapes the media folder.
pub fn read_media(dir: &Path, relative: &str) -> Result<Vec<u8>, String> {
    let path = safe_media_path(dir, relative)?;
    let meta = fs::metadata(&path).map_err(|_| "Attachment not found".to_string())?;
    if meta.len() > MAX_AUDIO as u64 {
        return Err("附件过大，无法读取".into());
    }
    fs::read(&path).map_err(|_| "Cannot read the attachment".to_string())
}

/// Resolves a stored relative path and rejects traversal or absolute paths.
fn safe_media_path(dir: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() || relative.starts_with('/') || relative.contains('\\') {
        return Err("附件路径无效".into());
    }
    let mut resolved = dir.to_path_buf();
    for part in relative.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err("附件路径无效".into());
        }
        resolved.push(part);
    }
    // The final component must stay inside <library>/media.
    let media_root = dir.join("media");
    if !resolved.starts_with(&media_root) {
        return Err("附件路径无效".into());
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("knowflick-media-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// IPC 契约：字节 ↔ base64 必须无损往返（含空串与全 256 个字节值）。
    #[test]
    fn b64_round_trips_losslessly() {
        let all_bytes: Vec<u8> = (0..=255u8).collect();
        for payload in [Vec::new(), vec![0u8], all_bytes, b"fake webm bytes".to_vec()] {
            let encoded = encode_b64(&payload);
            assert_eq!(decode_b64(&encoded).expect("decode"), payload);
        }
    }

    /// 解不开的 base64 要报中文错误（这条消息会落到界面上）。
    #[test]
    fn b64_decode_rejects_garbage_with_a_chinese_message() {
        let err = decode_b64("这不是 base64!!!").expect_err("该报错");
        assert!(err.contains("附件数据无效"), "{err}");
    }

    #[test]
    fn saves_audio_and_reads_it_back() {
        let dir = temp_dir("audio");
        let payload = b"fake webm bytes";
        let rel = save_media(&dir, "audio", "audio/webm", payload).expect("save");
        assert!(rel.starts_with("media/audio/"), "{rel}");
        assert!(rel.ends_with(".webm"), "{rel}");
        assert_eq!(read_media(&dir, &rel).expect("read"), payload);
    }

    #[test]
    fn saves_ink_as_json() {
        let dir = temp_dir("ink");
        let rel = save_media(&dir, "ink", "application/json", br#"{"strokes":[]}"#).expect("save");
        assert!(rel.starts_with("media/ink/") && rel.ends_with(".json"));
        assert_eq!(read_media(&dir, &rel).expect("read"), br#"{"strokes":[]}"#);
    }

    #[test]
    fn saves_images_with_an_allowed_extension() {
        let dir = temp_dir("image");
        let rel = save_media(&dir, "image", "image/png", b"\x89PNG").expect("save");
        assert!(rel.starts_with("media/image/") && rel.ends_with(".png"), "{rel}");
        assert_eq!(read_media(&dir, &rel).expect("read"), b"\x89PNG");
        // A non-image MIME under the image kind must still be refused.
        assert!(save_media(&dir, "image", "application/pdf", b"x").is_err());
    }

    #[test]
    fn rejects_unknown_kind_and_type() {
        let dir = temp_dir("bad");
        assert!(save_media(&dir, "video", "video/mp4", b"x").is_err());
        assert!(save_media(&dir, "audio", "image/png", b"x").is_err());
        assert!(save_media(&dir, "audio", "audio/webm", b"").is_err());
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let dir = temp_dir("traversal");
        for bad in ["../secret", "/etc/passwd", "media/../../x", "media/audio/../../x", "media\\audio\\x"] {
            assert!(read_media(&dir, bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn refuses_oversized_payload() {
        let dir = temp_dir("big");
        let huge = vec![0u8; MAX_INK + 1];
        assert!(save_media(&dir, "ink", "application/json", &huge).is_err());
    }

    #[test]
    fn a_saved_file_is_never_left_as_a_partial() {
        let dir = temp_dir("atomic");
        save_media(&dir, "audio", "audio/wav", b"RIFF").expect("save");
        let audio = dir.join("media").join("audio");
        let leftovers: Vec<_> = fs::read_dir(&audio)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".part"))
            .collect();
        assert!(leftovers.is_empty(), "a .part file must not survive a successful save");
    }
}

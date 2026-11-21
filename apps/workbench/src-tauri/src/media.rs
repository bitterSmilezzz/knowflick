//! Local media for notes: recorded audio and handwritten ink.
//!
//! Contract:
//! - Files live under `<library>/media/<kind>/<uuid>.<ext>` and are only ever
//!   written there. New attachments get generated names; backup restores retain
//!   validated names so links in note bodies remain valid.
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

/// Restore an archive path without overwriting an existing attachment. A hard
/// link publishes a fully synced temporary file atomically and never replaces a
/// destination that appeared concurrently.
pub fn restore_media(dir: &Path, relative: &str, bytes: &[u8]) -> Result<String, String> {
    let parts: Vec<_> = relative.split('/').collect();
    if parts.len() != 3 || parts[0] != "media" ||
        !matches!(parts[1], "audio" | "image" | "ink") ||
        parts[2].is_empty() || matches!(parts[2], "." | "..") ||
        !parts[2].bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')) {
        return Err("备份附件路径无效".into());
    }
    let ext = parts[2].rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let allowed = match parts[1] {
        "audio" => matches!(ext.as_str(), "webm" | "ogg" | "m4a" | "wav"),
        "image" => matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "heic" | "heif"),
        "ink" => ext == "json",
        _ => false,
    };
    if !allowed { return Err("备份附件类型与路径不匹配".into()); }
    let limit = match parts[1] { "audio" => MAX_AUDIO, "image" => MAX_IMAGE, _ => MAX_INK };
    if bytes.is_empty() || bytes.len() > limit { return Err("备份附件为空或超过大小上限".into()); }
    let root = dir.join("media");
    let folder = root.join(parts[1]);
    fs::create_dir_all(dir).map_err(|_| "无法创建备份附件目录".to_string())?;
    for path in [&root, &folder] {
        if let Err(error) = fs::create_dir(path) {
            if error.kind() != std::io::ErrorKind::AlreadyExists { return Err("无法创建备份附件目录".into()); }
        }
        let meta = fs::symlink_metadata(path).map_err(|_| "无法检查备份附件目录".to_string())?;
        if meta.file_type().is_symlink() || !meta.is_dir() { return Err("备份附件目录无效或为符号链接".into()); }
    }
    let target = folder.join(parts[2]);
    let existing_matches = || -> Result<bool, String> {
        match fs::symlink_metadata(&target) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || !meta.is_file() { return Err("本地附件路径不是普通文件，未覆盖".into()); }
                if meta.len() != bytes.len() as u64 { return Err("本地同路径附件内容不同，未覆盖".into()); }
                let existing = fs::read(&target).map_err(|_| "无法读取已有附件，未覆盖".to_string())?;
                if existing != bytes { return Err("本地同路径附件内容不同，未覆盖".into()); }
                Ok(true)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err("无法检查已有附件，未覆盖".into()),
        }
    };
    if existing_matches()? { return Ok(relative.to_owned()); }
    let temp = folder.join(format!(".{}.part", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)
            .map_err(|_| "无法暂存备份附件".to_string())?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| "无法写入备份附件".to_string())?;
        match fs::hard_link(&temp, &target) {
            Ok(()) => Ok(()),
            Err(_) if existing_matches()? => Ok(()),
            Err(_) => Err("无法安全放置备份附件".into()),
        }
    })();
    let _ = fs::remove_file(&temp);
    result?;
    Ok(relative.to_owned())
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


    /// Go 写、Rust 读：附件字节必须逐字节一致，路径必须是相对库目录。
    #[test]
    #[ignore = "requires the media fixture written by Go"]
    fn go_media_round_trip() {
        use std::env;
        let dir = env::var_os("KF_GO_MEDIA_FIXTURE").expect("set KF_GO_MEDIA_FIXTURE");
        let dir = std::path::PathBuf::from(dir);
        let relative = fs::read_to_string(dir.join("relative.txt")).unwrap();
        let bytes = read_media(&dir, &relative).unwrap();
        let expected: Vec<u8> = (0..=255u8).collect();
        assert_eq!(bytes, expected, "Go 写入的附件读回不一致");
        assert!(read_media(&dir, "../relative.txt").is_err(), "路径穿越未被拒绝");


        // 恢复保持原路径：Go 恢复的附件必须能由 Rust 按同一相对路径读回。
        if let Some(restore_dir) = env::var_os("KF_GO_RESTORE_FIXTURE") {
	let restore_dir = std::path::PathBuf::from(restore_dir);
	let rel = "media/image/fixed-restore.png";
	let bytes = read_media(&restore_dir, rel).unwrap();
	assert_eq!(bytes, b"go-restored-payload");
	// 同路径不同内容：Rust 也必须拒绝覆盖。
	assert!(restore_media(&restore_dir, rel, b"different").is_err());
	assert_eq!(read_media(&restore_dir, rel).unwrap(), b"go-restored-payload");
        }
        // 反向：Rust 写一份，给 Go 读回。
        save_media(&dir, "image", "image/png", b"rust-cross-runtime-media").unwrap();
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
    fn restore_preserves_path_bytes_and_rejects_conflicts_without_overwriting() {
        let dir = temp_dir("restore");
        let path = "media/image/original.png";
        assert_eq!(restore_media(&dir, path, b"image").unwrap(), path);
        assert_eq!(restore_media(&dir, path, b"image").unwrap(), path);
        assert!(restore_media(&dir, path, b"other").unwrap_err().contains("未覆盖"));
        assert_eq!(read_media(&dir, path).unwrap(), b"image");
        assert_eq!(fs::read_dir(dir.join("media/image")).unwrap().count(), 1);
        for bad in ["../outside", "media/audio/../bad.webm", "media/image/x.webm", "media/image/a/b.png", "media/image/.png/"] {
            assert!(restore_media(&dir, bad, b"x").is_err(), "{bad}");
        }
        assert!(restore_media(&dir, "media/ink/big.json", &vec![0; MAX_INK + 1]).is_err());
    }

    #[test]
    fn concurrent_restore_never_replaces_a_different_attachment() {
        let dir = temp_dir("restore-race");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = [b"first".to_vec(), b"other".to_vec()].into_iter().map(|bytes| {
            let dir = dir.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || { barrier.wait(); restore_media(&dir, "media/audio/a.webm", &bytes) })
        }).collect();
        let outcomes: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        let content = read_media(&dir, "media/audio/a.webm").unwrap();
        assert!(content == b"first" || content == b"other");
        assert_eq!(fs::read_dir(dir.join("media/audio")).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn restore_rejects_symlinks_for_files_and_directories() {
        use std::os::unix::fs::symlink;
        let dir = temp_dir("restore-symlink");
        let outside = temp_dir("restore-outside");
        symlink(&outside, dir.join("media")).unwrap();
        assert!(restore_media(&dir, "media/image/a.png", b"data").is_err());
        assert!(!outside.join("image").exists());
        fs::remove_file(dir.join("media")).unwrap();
        fs::create_dir_all(dir.join("media/image")).unwrap();
        fs::write(outside.join("target.png"), b"original").unwrap();
        symlink(outside.join("target.png"), dir.join("media/image/a.png")).unwrap();
        assert!(restore_media(&dir, "media/image/a.png", b"data").is_err());
        assert_eq!(fs::read(outside.join("target.png")).unwrap(), b"original");
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

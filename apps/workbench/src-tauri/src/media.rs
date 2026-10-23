//! Local media for notes: recorded audio and handwritten ink.
//!
//! Contract:
//! - Files live under `<library>/media/<kind>/<uuid>.<ext>` and are only ever
//!   written there. Names are generated, never taken from the caller.
//! - Size is capped per kind; the payload is written atomically and read back
//!   with the same size, so a half-written recording is never referenced.
//! - Only the app's own directory is served; the path returned to the UI is
//!   relative to the library, so a moved library keeps working.
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Recorded audio: a few minutes of speech is well under this.
pub const MAX_AUDIO: usize = 64 * 1024 * 1024;
/// Ink strokes are vector JSON; this is generous but still bounded.
pub const MAX_INK: usize = 8 * 1024 * 1024;
/// Screenshots and photos pasted into the library.
pub const MAX_IMAGE: usize = 16 * 1024 * 1024;

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

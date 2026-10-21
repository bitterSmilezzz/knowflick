use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const MAX_ARCHIVE_BYTES: usize = 50 * 1024 * 1024;

#[derive(Debug)]
pub struct ArchivePayload {
    pub cards: String,
    pub settings: Option<String>,
}

/// 卡库目录里的三份卡片文件和设置。密钥不在这里。
#[derive(Debug)]
pub struct LibraryFiles {
    pub cards: Option<String>,
    pub backup: Option<String>,
    pub backup2: Option<String>,
    pub settings: Option<String>,
    pub search_history: Option<String>,
}

/// 与 JVM 桌面 `DesktopPaths.dataRoot()` 同口径（mac / Windows / Linux 各用系统惯例目录）。
pub fn data_root() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    if let Some(home) = home {
        if cfg!(target_os = "macos") {
            return home.join("Library/Application Support/KnowFlick");
        }
        if cfg!(target_os = "windows") {
            let app_data = std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("AppData/Roaming"));
            return app_data.join("KnowFlick");
        }
        let xdg = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share"));
        return xdg.join("KnowFlick");
    }
    PathBuf::from(".").join("KnowFlick")
}

/// 卡库在 `<data_root>/store`，与 Android `filesDir/store`、frozen `:desktop` 一致。
pub fn default_library_dir() -> PathBuf {
    data_root().join("store")
}

/// 密钥在 `<data_root>/credentials/apiKey.credential`（库目录名为 `store` 时从父目录取 credentials）。
pub fn credentials_file(library_dir: &Path) -> PathBuf {
    if library_dir.file_name().and_then(|name| name.to_str()) == Some("store") {
        library_dir
            .parent()
            .unwrap_or(library_dir)
            .join("credentials")
            .join("apiKey.credential")
    } else {
        library_dir.join("credentials").join("apiKey.credential")
    }
}

pub fn read_library(dir: &Path) -> Result<LibraryFiles, String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    Ok(LibraryFiles {
        cards: read_optional(&dir.join("cards.json"))?,
        backup: read_optional(&dir.join("cards.backup.json"))?,
        backup2: read_optional(&dir.join("cards.backup.2.json"))?,
        settings: read_optional(&dir.join("settings.json"))?,
        search_history: read_optional(&dir.join("search_history.json"))?,
    })
}

pub fn save_search_history(dir: &Path, text: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    atomic_write(&dir.join("search_history.json"), text.as_bytes())
}

fn is_zip(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4b
}

pub fn read_archive_file(path: &Path) -> Result<ArchivePayload, String> {
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "归档文件大小超过 {} MiB 限制",
            MAX_ARCHIVE_BYTES / 1024 / 1024
        ));
    }
    if is_zip(&bytes) {
        return read_archive_zip(&bytes[..]);
    }
    let text = String::from_utf8(bytes).map_err(|_| "归档不是有效的 UTF-8 文本".to_string())?;
    if text.trim().is_empty() {
        return Err("所选文件中未检测到有效的 KnowFlick 卡片数据".to_string());
    }
    Ok(ArchivePayload {
        cards: text,
        settings: None,
    })
}

fn read_archive_zip(bytes: &[u8]) -> Result<ArchivePayload, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|err| format!("ZIP 解析失败: {err}"))?;
    let mut cards: Option<String> = None;
    let mut settings: Option<String> = None;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|err| err.to_string())?;
        let name = entry.name().to_ascii_lowercase();
        let mut body = Vec::new();
        entry.read_to_end(&mut body).map_err(|err| err.to_string())?;
        let text = String::from_utf8(body).map_err(|_| format!("{} 不是 UTF-8", entry.name()))?;
        if name == "cards.json" || name.ends_with("/cards.json") {
            cards = Some(text);
        } else if name == "settings.json" || name.ends_with("/settings.json") {
            settings = Some(text);
        }
    }
    let cards = cards.ok_or_else(|| "ZIP 中未找到 cards.json".to_string())?;
    if cards.trim().is_empty() {
        return Err("所选文件中未检测到有效的 KnowFlick 卡片数据".to_string());
    }
    Ok(ArchivePayload { cards, settings })
}

pub fn save_cards(dir: &Path, text: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let main = dir.join("cards.json");
    let backup = dir.join("cards.backup.json");
    let backup2 = dir.join("cards.backup.2.json");
    if backup.exists() {
        if backup2.exists() {
            fs::remove_file(&backup2).map_err(|err| format!("清理二代备份失败: {err}"))?;
        }
        fs::rename(&backup, &backup2).map_err(|err| format!("备份轮转失败: {err}"))?;
    }
    if main.exists() {
        fs::copy(&main, &backup).map_err(|err| format!("写入备份失败: {err}"))?;
    }
    atomic_write(&main, text.as_bytes())
}

pub fn save_settings(dir: &Path, text: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    atomic_write(&dir.join("settings.json"), text.as_bytes())
}

pub fn read_api_key(dir: &Path) -> Result<String, String> {
    let path = credentials_file(dir);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(err.to_string()),
    }
}

pub fn write_api_key(dir: &Path, value: &str) -> Result<(), String> {
    let path = credentials_file(dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    atomic_write(&path, value.as_bytes())?;
    restrict_to_owner(&path);
    Ok(())
}

pub fn export_archive(dir: &Path, dest: &Path) -> Result<(), String> {
    let cards = read_cards_json_text(dir)?;
    let settings = read_optional(&dir.join("settings.json"))?.unwrap_or_else(|| "{}".to_string());
    let bytes = zip_store(&[
        ("cards.json", cards.as_bytes()),
        ("settings.json", settings.as_bytes()),
    ]);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    atomic_write(dest, &bytes)
}

/// 只导出卡片数据本身：裸数组，与 Android 的 `cards.json` 同一份线格式。
/// 与 `export_archive` 并列而非替代——ZIP 备份包带 settings（合并恢复学习进度用），
/// JSON 只带卡；ADR-0002 §3 那条「拷过去就能打开」的契约说的正是这份 `cards.json`。
pub fn export_cards_json(dir: &Path, dest: &Path) -> Result<(), String> {
    let cards = read_cards_json_text(dir)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    atomic_write(dest, cards.as_bytes())
}

/// 读出与 Android `cards.json` 同一份线格式的卡片正文。
///
/// 卡片现在存在 SQLite 里，`cards.json` 只是迁移前的旧文件。所以优先从
/// SQLite 导出；库里没有卡片时再退回旧文件（未迁移的库仍能导出）。
/// 之前这里只读 `cards.json`，而工作台早已不写那个文件——导出的永远是 `[]`，
/// ADR-0002 §3「两套共享同一份 cards.json，拷过去就能打开」在桌面端是断的。
pub fn read_cards_json_text(dir: &Path) -> Result<String, String> {
    let db_path = dir.join("knowflick.db");
    if db_path.exists() {
        let conn = crate::db::open_db(&db_path).map_err(|e| e.to_string())?;
        let cards = crate::db::list_cards(&conn, 100_000, 0).map_err(|e| e.to_string())?;
        if !cards.is_empty() {
            return serde_json::to_string(&cards).map_err(|e| e.to_string());
        }
    }
    Ok(read_optional(&dir.join("cards.json"))?.unwrap_or_else(|| "[]".to_string()))
}

fn zip_store(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let name_bytes = name.as_bytes();
        let offset = out.len() as u32;
        let crc = crc32(data);
        out.extend_from_slice(&0x04034b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(data);
        central.extend_from_slice(&0x02014b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u32.to_le_bytes());
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name_bytes);
    }
    let central_start = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x06054b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&central_start.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}
fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&tmp).map_err(|err| err.to_string())?;
        file.write_all(data).map_err(|err| err.to_string())?;
        file.sync_all().map_err(|err| err.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|err| err.to_string())
}

fn restrict_to_owner(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_cards_json_reads_from_sqlite_not_only_the_legacy_file() {
        // 卡片现在存在 SQLite 里，`cards.json` 只是迁移前的旧文件。
        // 导出若只读那个文件，工作台用户拿到的永远是空数组——
        // ADR-0002 §3「两套共享同一份 cards.json，拷过去就能打开」在桌面端是断的。
        let dir = temp_dir("export-from-sqlite");
        let db_path = dir.join("knowflick.db");
        let conn = crate::db::open_db(&db_path).unwrap();
        let card = crate::db::KnowledgeCardDto {
            id: "card-x".to_string(),
            material_id: None,
            category: "计算机".to_string(),
            headline: "跨端契约卡".to_string(),
            summary: "摘要".to_string(),
            details: "正文".to_string(),
            links: vec![],
            tags: vec![],
            source: "imported".to_string(),
            created_at: 1,
            edited_at: None,
            seen_at: None,
            swiped: None,
            is_favorite: false,
            favorited_at: None,
            review_count: 0,
            mastery_level: 0,
            last_reviewed_at: None,
            repetition: 0,
            interval_days: 0.0,
            ease_factor: 2.5,
            stability: 0.0,
            difficulty: 0.0,
            subject: None,
            branch: None,
            level: None,
            track: None,
            order_key: None,
            prereq: vec![],
        };
        crate::db::upsert_card(&conn, &card).unwrap();

        let text = read_cards_json_text(&dir).unwrap();
        assert!(text.contains("跨端契约卡"), "导出应包含 SQLite 里的卡片：{text}");
        assert!(text.trim_start().starts_with('['), "应是裸数组线格式：{text}");
    }

    #[test]
    fn export_cards_json_falls_back_to_legacy_file() {
        let dir = temp_dir("export-legacy");
        fs::write(dir.join("cards.json"), "[{\"id\":\"legacy\"}]").unwrap();
        let text = read_cards_json_text(&dir).unwrap();
        assert!(text.contains("legacy"), "未迁移的库仍应能从旧文件导出：{text}");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("knowflick-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn default_library_uses_store_subdirectory() {
        let dir = default_library_dir();
        assert_eq!(dir.file_name().and_then(|name| name.to_str()), Some("store"));
        let root = data_root();
        assert!(root.ends_with("KnowFlick"));
    }

    #[test]
    fn backup_rotates_previous_main_file() {
        let dir = temp_dir("backup");
        save_cards(&dir, "[{\"id\":\"a\"}]").unwrap();
        save_cards(&dir, "[{\"id\":\"b\"}]").unwrap();
        save_cards(&dir, "[{\"id\":\"c\"}]").unwrap();
        assert_eq!(fs::read_to_string(dir.join("cards.json")).unwrap(), "[{\"id\":\"c\"}]");
        assert_eq!(
            fs::read_to_string(dir.join("cards.backup.json")).unwrap(),
            "[{\"id\":\"b\"}]"
        );
        assert_eq!(
            fs::read_to_string(dir.join("cards.backup.2.json")).unwrap(),
            "[{\"id\":\"a\"}]"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn store_named_store_keeps_key_beside_it() {
        let root = temp_dir("credentials");
        let store = root.join("store");
        fs::create_dir_all(&store).unwrap();
        write_api_key(&store, "secret").unwrap();
        let key_path = root.join("credentials").join("apiKey.credential");
        assert_eq!(fs::read_to_string(&key_path).unwrap(), "secret");
        assert!(!store.join("credentials").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_contains_cards_and_settings_but_not_the_key() {
        let dir = temp_dir("export");
        fs::write(dir.join("cards.json"), "[{\"id\":\"a\"}]").unwrap();
        fs::write(dir.join("settings.json"), "{\"model\":\"m\"}").unwrap();
        write_api_key(&dir, "secret").unwrap();
        let dest = dir.join("out.zip");
        export_archive(&dir, &dest).unwrap();
        let bytes = fs::read(&dest).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("cards.json"));
        assert!(text.contains("settings.json"));
        assert!(text.contains("{\\\"id\\\":\\\"a\\\"}") || text.contains("{\"id\":\"a\"}"));
        assert!(!text.contains("secret"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_json_copies_cards_verbatim_and_leaves_the_key_behind() {
        let dir = temp_dir("export-json");
        let raw = "[{\"id\":\"a\",\"headline\":\"h\"}]";
        fs::write(dir.join("cards.json"), raw).unwrap();
        write_api_key(&dir, "secret").unwrap();
        let dest = dir.join("cards-export.json");
        export_cards_json(&dir, &dest).unwrap();
        let written = fs::read_to_string(&dest).unwrap();
        assert_eq!(written, raw, "JSON 导出的就是 cards.json 本身，逐字不改写");
        assert!(!written.contains("secret"), "密钥不进 JSON 导出");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_json_falls_back_to_an_empty_array() {
        let dir = temp_dir("export-json-empty");
        let dest = dir.join("out.json");
        export_cards_json(&dir, &dest).unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap(), "[]");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_archive_extracts_workbench_zip() {
        let dir = temp_dir("read-zip");
        fs::write(dir.join("cards.json"), "[{\"id\":\"a\",\"category\":\"c\",\"headline\":\"h\",\"summary\":\"s\",\"details\":\"d\"}]").unwrap();
        fs::write(dir.join("settings.json"), "{\"model\":\"m\"}").unwrap();
        let zip_path = dir.join("pack.zip");
        export_archive(&dir, &zip_path).unwrap();
        let payload = read_archive_file(&zip_path).unwrap();
        assert!(payload.cards.contains("\"id\":\"a\""));
        assert_eq!(payload.settings.as_deref(), Some("{\"model\":\"m\"}"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_history_round_trips_as_json_array() {
        let dir = temp_dir("search-history");
        save_search_history(&dir, "[\"量子\",\"熵\"]").unwrap();
        let files = read_library(&dir).unwrap();
        assert_eq!(files.search_history.as_deref(), Some("[\"量子\",\"熵\"]"));
        let _ = fs::remove_dir_all(&dir);
    }
}

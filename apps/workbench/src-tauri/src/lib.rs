mod http;
mod store;

use std::path::PathBuf;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoreSnapshot {
    dir: String,
    cards: Option<String>,
    backup: Option<String>,
    backup2: Option<String>,
    settings: Option<String>,
    search_history: Option<String>,
}

fn library_dir(dir: Option<String>) -> PathBuf {
    dir.map(PathBuf::from).unwrap_or_else(store::default_library_dir)
}

#[tauri::command]
fn load_store(dir: Option<String>) -> Result<StoreSnapshot, String> {
    let path = library_dir(dir);
    let files = store::read_library(&path)?;
    Ok(StoreSnapshot {
        dir: path.to_string_lossy().to_string(),
        cards: files.cards,
        backup: files.backup,
        backup2: files.backup2,
        settings: files.settings,
        search_history: files.search_history,
    })
}

#[tauri::command]
fn save_cards(dir: String, text: String) -> Result<(), String> {
    store::save_cards(PathBuf::from(dir).as_path(), &text)
}

#[tauri::command]
fn save_settings(dir: String, text: String) -> Result<(), String> {
    store::save_settings(PathBuf::from(dir).as_path(), &text)
}

#[tauri::command]
fn save_search_history(dir: String, text: String) -> Result<(), String> {
    store::save_search_history(PathBuf::from(dir).as_path(), &text)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchivePayloadDto {
    cards: String,
    settings: Option<String>,
}

#[tauri::command]
fn read_archive(path: String) -> Result<ArchivePayloadDto, String> {
    let payload = store::read_archive_file(PathBuf::from(path).as_path())?;
    Ok(ArchivePayloadDto {
        cards: payload.cards,
        settings: payload.settings,
    })
}

#[tauri::command]
fn read_api_key(dir: String) -> Result<String, String> {
    store::read_api_key(PathBuf::from(dir).as_path())
}

#[tauri::command]
fn write_api_key(dir: String, value: String) -> Result<(), String> {
    store::write_api_key(PathBuf::from(dir).as_path(), &value)
}

#[tauri::command]
fn export_archive(dir: String, dest: String) -> Result<(), String> {
    store::export_archive(PathBuf::from(dir).as_path(), PathBuf::from(dest).as_path())
}

#[tauri::command]
fn export_cards_json(dir: String, dest: String) -> Result<(), String> {
    store::export_cards_json(PathBuf::from(dir).as_path(), PathBuf::from(dest).as_path())
}

#[tauri::command]
async fn fetch_clip(url: String) -> Result<ClipPayload, String> {
    let page = http::fetch_clip(&url).await?;
    Ok(ClipPayload { text: page.text, final_url: page.final_url })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipPayload {
    text: String,
    final_url: String,
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let file = std::fs::File::open(&path).map_err(|err| err.to_string())?;
    let length = file.metadata().map_err(|err| err.to_string())?.len();
    if length > 32 * 1024 * 1024 {
        return Err("文件超过 32 MiB".to_string());
    }
    std::fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[tauri::command]
async fn complete_chat(endpoint: String, api_key: String, body: String) -> Result<String, String> {
    http::complete_chat(&endpoint, &api_key, body).await
}

fn http_url_for_open(raw: &str) -> Result<&str, String> {
    let trimmed = raw.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("只支持 http/https 链接".to_string());
    }
    Ok(trimmed)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let trimmed = http_url_for_open(&url)?;
    open::that(trimmed).map_err(|err| err.to_string())
}

#[cfg(test)]
mod open_url_tests {
    use super::http_url_for_open;

    #[test]
    fn accepts_http_and_https() {
        assert_eq!(http_url_for_open("https://example.com/a").unwrap(), "https://example.com/a");
        assert_eq!(http_url_for_open("  http://a.test  ").unwrap(), "http://a.test");
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(http_url_for_open("javascript:alert(1)").is_err());
        assert!(http_url_for_open("file:///etc/passwd").is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_store,
            save_cards,
            save_settings,
            save_search_history,
            read_archive,
            read_api_key,
            write_api_key,
            export_archive,
            export_cards_json,
            fetch_clip,
            read_text_file,
            complete_chat,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running KnowFlick");
}

pub mod db;
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

#[tauri::command]
fn db_load_cards(dir: Option<String>, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<db::KnowledgeCardDto>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;

    // 检查是否需要自动从 cards.json 迁移
    let legacy_json_path = path.join("cards.json");
    if legacy_json_path.exists() {
        if let Ok(stats) = db::get_db_stats(&conn) {
            if stats.total_cards == 0 {
                if let Ok(text) = std::fs::read_to_string(&legacy_json_path) {
                    let _ = db::migrate_legacy_cards_json(&conn, &text);
                }
            }
        }
    }

    db::list_cards(&conn, limit.unwrap_or(200), offset.unwrap_or(0)).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_upsert_card(dir: Option<String>, card: db::KnowledgeCardDto) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::upsert_card(&conn, &card).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_card(dir: Option<String>, id: String) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::delete_card(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_search_cards_fts(dir: Option<String>, query: String, limit: Option<i64>) -> Result<Vec<db::KnowledgeCardDto>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::search_cards_fts(&conn, &query, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_material(dir: Option<String>, material: db::RawMaterialDto) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::save_material(&conn, &material).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_materials(dir: Option<String>, inbox_only: Option<bool>, limit: Option<i64>) -> Result<Vec<db::RawMaterialDto>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::list_materials(&conn, inbox_only.unwrap_or(true), limit.unwrap_or(100)).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_material_status(dir: Option<String>, id: String, status: String) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::update_material_status(&conn, &id, &status).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_stats(dir: Option<String>) -> Result<db::DbStatsDto, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::get_db_stats(&conn).map_err(|e| e.to_string())
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
            open_url,
            db_load_cards,
            db_upsert_card,
            db_delete_card,
            db_search_cards_fts,
            db_save_material,
            db_list_materials,
            db_update_material_status,
            db_get_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running KnowFlick");
}

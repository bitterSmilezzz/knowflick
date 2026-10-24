mod error_text;
mod asr;
pub mod db;
mod embed;
mod http;
mod mail;
mod media;
mod notes;
mod store;

use std::io::Read;
use std::path::PathBuf;

use serde::Serialize;
use sha2::{Digest, Sha256};

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
    db::resolve_library_dir(dir.as_deref())
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
    let path = db::resolve_library_dir(Some(&dir));
    store::save_cards(path.as_path(), &text)
}

#[tauri::command]
fn save_settings(dir: String, text: String) -> Result<(), String> {
    let path = db::resolve_library_dir(Some(&dir));
    store::save_settings(path.as_path(), &text)
}

#[tauri::command]
fn save_search_history(dir: String, text: String) -> Result<(), String> {
    let path = db::resolve_library_dir(Some(&dir));
    store::save_search_history(path.as_path(), &text)
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
    let path = db::resolve_library_dir(Some(&dir));
    store::read_api_key(path.as_path())
}

#[tauri::command]
fn write_api_key(dir: String, value: String) -> Result<(), String> {
    let path = db::resolve_library_dir(Some(&dir));
    store::write_api_key(path.as_path(), &value)
}

#[tauri::command]
fn export_archive(dir: String, dest: String) -> Result<(), String> {
    let path = db::resolve_library_dir(Some(&dir));
    store::export_archive(path.as_path(), PathBuf::from(dest).as_path())
}

#[tauri::command]
fn export_cards_json(dir: String, dest: String) -> Result<(), String> {
    let path = db::resolve_library_dir(Some(&dir));
    store::export_cards_json(path.as_path(), PathBuf::from(dest).as_path())
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

// 附件字节走 base64 而不是 `Vec<u8>`：后者会被 JSON 序列化成数字数组，
// 5 MB 录音放大成 ~18 MB 文本、两侧逐数字解析；备份导出要读全部附件，
// 放大跟着库一起长。base64 只放大 1.33 倍（理由与实测见 media.rs）。
#[tauri::command]
fn save_media(dir: Option<String>, kind: String, mime: String, data_b64: String) -> Result<String, String> {
    let path = library_dir(dir);
    let bytes = media::decode_b64(&data_b64)?;
    media::save_media(&path, &kind, &mime, &bytes)
}

#[tauri::command]
fn read_media(dir: Option<String>, relative: String) -> Result<String, String> {
    let path = library_dir(dir);
    Ok(media::encode_b64(&media::read_media(&path, &relative)?))
}

#[tauri::command]
async fn mail_list_accounts(dir: Option<String>) -> Result<Vec<mail::MailAccount>, String> {
    let path = library_dir(dir);
    tauri::async_runtime::spawn_blocking(move || mail::list_accounts(&path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mail_save_account(dir: Option<String>, config: mail::MailAccountConfig, password: String) -> Result<mail::MailAccount, String> {
    let path = library_dir(dir);
    tauri::async_runtime::spawn_blocking(move || mail::save_account(&path, config, &password)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mail_test_account(dir: Option<String>, config: mail::MailAccountConfig, password: String) -> Result<serde_json::Value, String> {
    let path = library_dir(dir);
    tauri::async_runtime::spawn_blocking(move || {
        let summary = mail::test_account(&path, config, &password)?;
        Ok(serde_json::json!({ "message": format!("连接成功：{}，共 {} 封邮件", summary.folder, summary.message_count) }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mail_remove_account(dir: Option<String>, id: String) -> Result<(), String> {
    let path = library_dir(dir);
    tauri::async_runtime::spawn_blocking(move || mail::remove_account(&path, &id)).await.map_err(|e| e.to_string())?
}

/// Tells the web layer that the library changed.
///
/// The UI listens to a DOM `CustomEvent` (see `Workspace`), so a Tauri event
/// alone is not enough: `db_save_material` dispatches the DOM event too, and
/// every new mutation path must do the same or the view silently goes stale.
fn notify_library_changed(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let _ = app.emit("knowflick:library-changed", ());
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.emit("knowflick:library-changed", ());
        let _ = main_win.eval("window.dispatchEvent(new CustomEvent('knowflick:library-changed'))");
    }
}

/// 库目录的「修改签名」——用来发现**外部进程**写进来的改动。
///
/// 为什么需要：界面刷新只有两个信号——`knowflick:library-changed`（DOM 事件，
/// 由本应用的 Tauri 命令派发）与 `storage`（浏览器 localStorage 跨标签页）。
/// 而 MCP server（`tools/mcp-server.mjs`）是**独立进程**，它直接写 SQLite：
/// 两个信号都收不到，界面会一直停在旧状态，用户得重启或切页才看得到新卡片。
///
/// 这里由界面做**轮询比对**，一旦发现外部改动就派发已有的
/// `knowflick:library-changed`——复用现成的刷新路径。不引入文件监听依赖：
/// 轮询 2 秒一次的开销远小于多一个 crate 与它的跨平台坑。
///
/// 签名取**内容指纹**，不是修改时间：Linux 上 inode 时间戳取自 coarse clock，
/// 粒度是 1/HZ（HZ=250 时约 4ms），而一次 SQLite 写入（含 WAL 回检）常常只要
/// 2~3ms——两次不同的写入会得到**同一个** mtime，签名不变，外部改动就被漏掉。
/// 实测：`signature_changes_when_the_database_is_touched` 在 ubuntu runner 上偶发
/// 失败，`before`/`after` 的 mtime 与大小逐字节相同（那个测试全程只跑了 2ms）；
/// macOS 的 APFS 时间戳是 ns 精度，本机复现不出来，所以别用「本地是绿的」判断。
///
/// 代价是每次轮询都要把库读一遍：库以文本为主，几十 MB 哈希一次约几十毫秒，
/// 相对 2 秒的间隔可以接受。命令走 `spawn_blocking`，不占 UI 线程。
#[tauri::command]
async fn db_library_signature(dir: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || library_signature(dir))
        .await
        .map_err(|e| e.to_string())?
}

/// 签名的实际算法。单独抽出来，测试才能直接调（命令版是 async 的）。
fn library_signature(dir: Option<String>) -> Result<String, String> {
    let path = library_dir(dir);
    let mut parts: Vec<String> = Vec::new();
    for name in ["knowflick.db", "cards.json", "settings.json"] {
        let file = path.join(name);
        match content_fingerprint(&file) {
            Ok(fingerprint) => parts.push(format!("{}:{}", name, fingerprint)),
            Err(_) => parts.push(format!("{}:-", name)),
        }
    }
    Ok(parts.join("|"))
}

/// 内容指纹：SHA-256 的前 8 字节。128 位里取一半，碰撞概率可以忽略，
/// 签名也还能保持可读（完整哈希太长，排查时看不出任何信息）。
///
/// 分块流式读，不一次性读进内存——库可能有几十上百 MB。
fn content_fingerprint(file: &std::path::Path) -> std::io::Result<String> {
    let mut handle = std::fs::File::open(file)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let read = handle.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    let digest = hasher.finalize();
    let mut head = [0u8; 8];
    head.copy_from_slice(&digest[..8]);
    Ok(format!("{:016x}", u64::from_be_bytes(head)))
}

#[tauri::command]
async fn mail_sync_account(app: tauri::AppHandle, dir: Option<String>, id: String) -> Result<mail::MailSyncResult, String> {
    let path = library_dir(dir);
    let result = tauri::async_runtime::spawn_blocking(move || mail::sync_account(&path, &id)).await.map_err(|e| e.to_string())?;
    // A later message can fail after earlier messages committed. Nothing else
    // refreshes the view on failure, so notify regardless of the outcome.
    notify_library_changed(&app);
    result
}

#[tauri::command]
async fn mail_sync_history(app: tauri::AppHandle, dir: Option<String>, id: String) -> Result<mail::MailSyncResult, String> {
    let path = library_dir(dir);
    let result = tauri::async_runtime::spawn_blocking(move || mail::sync_history(&path, &id)).await.map_err(|e| e.to_string())?;
    notify_library_changed(&app);
    result
}

#[tauri::command]
async fn mail_list_rejected(dir: Option<String>, id: String) -> Result<Vec<mail::RejectedMail>, String> {
    let path = library_dir(dir);
    tauri::async_runtime::spawn_blocking(move || mail::list_rejected(&path, &id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mail_retry_rejected(app: tauri::AppHandle, dir: Option<String>, id: String) -> Result<mail::MailSyncResult, String> {
    let path = library_dir(dir);
    let result = tauri::async_runtime::spawn_blocking(move || mail::retry_rejected(&path, &id)).await.map_err(|e| e.to_string())?;
    notify_library_changed(&app);
    result
}

#[tauri::command]
async fn mail_sync_due_accounts(app: tauri::AppHandle, dir: Option<String>) -> Result<Vec<mail::MailSyncOutcome>, String> {
    let path = library_dir(dir);
    let result = tauri::async_runtime::spawn_blocking(move || mail::sync_due_accounts(&path)).await.map_err(|e| e.to_string())?;
    if result.as_ref().is_ok_and(|outcomes| !outcomes.is_empty()) {
        notify_library_changed(&app);
    }
    result
}

#[tauri::command]
fn db_load_cards(dir: Option<String>, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<db::KnowledgeCardDto>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;

    // 检查是否需要自动从 cards.json 迁移
    let legacy_json_path = path.join("cards.json");
    if legacy_json_path.exists() {
        if !db::has_migrated_legacy_cards(&conn) && db::is_cards_table_empty(&conn) {
            let text = std::fs::read_to_string(&legacy_json_path)
                .map_err(|e| crate::error_text::explain("读取旧卡库失败，原文件未改动", &e))?;
            db::migrate_legacy_cards_json(&conn, &text)
                .map_err(|e| crate::error_text::explain("迁移旧卡库失败，原文件未改动", &e))?;
        }
    }

    let eff_limit = limit.unwrap_or(-1);
    let eff_offset = offset.unwrap_or(0);
    db::list_cards(&conn, eff_limit, eff_offset).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_replace_cards(dir: Option<String>, cards: Vec<db::KnowledgeCardDto>) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let mut conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::replace_cards(&mut conn, &cards).map_err(|e| e.to_string())
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
fn db_save_material(app: tauri::AppHandle, dir: Option<String>, material: db::RawMaterialDto) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::save_material(&conn, &material).map_err(|e| e.to_string())?;

    notify_library_changed(&app);
    Ok(())
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

// ---------- 笔记与知识库（R1，契约 docs/NOTES_MODEL.md）----------

#[tauri::command]
fn note_upsert(app: tauri::AppHandle, dir: Option<String>, note: notes::NoteDto, base_revision: i64) -> Result<notes::NoteSaveOutcome, String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let outcome = notes::note_upsert(&conn, &note, base_revision, now).map_err(|e| match e {
        notes::NoteSaveError::Conflict { current_revision } => {
            format!("内容已在别处更新（当前修订 {current_revision}），请刷新后重试，不要直接覆盖")
        }
        // rusqlite 的原始错误是英文（"disk I/O error"）——静态守卫扫不到透传，
        // 但用户会在「保存失败：…」里看到它。explain_text 按关键词给出
        // 中文原因与下一步（R1 退出门槛：磁盘写失败要有可解释的结果）。
        notes::NoteSaveError::Db(err) => crate::error_text::explain_text("笔记保存失败", &err.to_string()),
    })?;
    notify_library_changed(&app);
    Ok(outcome)
}

#[tauri::command]
fn note_ensure_from_material(app: tauri::AppHandle, dir: Option<String>, material_id: String) -> Result<notes::NoteSaveOutcome, String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let outcome = notes::note_ensure_from_material(&conn, &material_id, now)
        .map_err(|e| crate::error_text::explain_text("转为笔记失败", &e))?;
    notify_library_changed(&app);
    Ok(outcome)
}

#[tauri::command]
fn note_get(dir: Option<String>, id: String) -> Result<Option<notes::NoteDto>, String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    notes::note_get(&conn, &id).map_err(|e| crate::error_text::explain_text("读取笔记失败", &e.to_string()))
}

#[tauri::command]
fn note_list(dir: Option<String>, include_deleted: Option<bool>, limit: Option<i64>) -> Result<Vec<notes::NoteDto>, String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    notes::note_list(&conn, include_deleted.unwrap_or(false), limit.unwrap_or(500)).map_err(|e| crate::error_text::explain_text("读取笔记列表失败", &e.to_string()))
}

#[tauri::command]
fn note_delete(app: tauri::AppHandle, dir: Option<String>, id: String) -> Result<bool, String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let deleted = notes::note_delete(&conn, &id, now).map_err(|e| crate::error_text::explain_text("移入回收站失败", &e.to_string()))?;
    notify_library_changed(&app);
    Ok(deleted)
}

#[tauri::command]
fn note_restore(app: tauri::AppHandle, dir: Option<String>, id: String) -> Result<bool, String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    let restored = notes::note_restore(&conn, &id).map_err(|e| crate::error_text::explain_text("恢复笔记失败", &e.to_string()))?;
    notify_library_changed(&app);
    Ok(restored)
}

#[tauri::command]
fn note_search(dir: Option<String>, query: String, kb_id: Option<String>, limit: Option<i64>) -> Result<Vec<notes::NoteDto>, String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    notes::search_notes(&conn, &query, kb_id.as_deref(), limit.unwrap_or(50)).map_err(|e| crate::error_text::explain_text("搜索笔记失败", &e.to_string()))
}

#[tauri::command]
fn kb_create(app: tauri::AppHandle, dir: Option<String>, id: String, name: String, description: Option<String>) -> Result<(), String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    notes::kb_create(&conn, &id, &name, description.as_deref().unwrap_or(""), now)?;
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
fn kb_list(dir: Option<String>) -> Result<Vec<notes::KnowledgeBaseDto>, String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    notes::kb_list(&conn).map_err(|e| crate::error_text::explain_text("读取知识库列表失败", &e.to_string()))
}

#[tauri::command]
fn kb_add_note(app: tauri::AppHandle, dir: Option<String>, kb_id: String, note_id: String) -> Result<(), String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    notes::kb_add_note(&conn, &kb_id, &note_id, now)?;
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
fn kb_membership(dir: Option<String>) -> Result<std::collections::HashMap<String, i64>, String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    notes::kb_membership_map(&conn).map_err(|e| crate::error_text::explain_text("读取知识库成员失败", &e.to_string()))
}

#[tauri::command]
fn kb_remove_note(app: tauri::AppHandle, dir: Option<String>, kb_id: String, note_id: String) -> Result<(), String> {
    let path = library_dir(dir);
    let conn = db::open_db(&path.join("knowflick.db")).map_err(|e| e.to_string())?;
    notes::kb_remove_note(&conn, &kb_id, &note_id).map_err(|e| crate::error_text::explain_text("移出知识库失败", &e.to_string()))?;
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
fn db_save_artifact(dir: Option<String>, artifact: db::ArtifactDto) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::save_artifact(&conn, &artifact).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_artifact(dir: Option<String>, id: String) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::delete_artifact(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_artifacts(dir: Option<String>, limit: Option<i64>) -> Result<Vec<db::ArtifactDto>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::list_artifacts(&conn, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_card_embedding(dir: Option<String>, card_id: String, embedding: Vec<f32>) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::save_card_embedding(&conn, &card_id, &embedding).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_search_cards_vector(
    dir: Option<String>,
    query_embedding: Vec<f32>,
    limit: Option<usize>,
) -> Result<Vec<(db::KnowledgeCardDto, f32)>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::search_cards_vector(&conn, &query_embedding, limit.unwrap_or(10)).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_search_cards_hybrid(
    dir: Option<String>,
    query_text: String,
    query_embedding: Option<Vec<f32>>,
    limit: Option<usize>,
) -> Result<Vec<db::KnowledgeCardDto>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::search_cards_hybrid(
        &conn,
        &query_text,
        query_embedding.as_deref(),
        limit.unwrap_or(10),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_unembedded_card_ids(dir: Option<String>, limit: Option<i64>) -> Result<Vec<String>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::list_unembedded_card_ids(&conn, limit.unwrap_or(100)).map_err(|e| e.to_string())
}

#[tauri::command]
fn local_embed_status() -> embed::LocalEmbedStatus {
    embed::status(&store::data_root())
}

/// 下载并预热本地语义模型。会真的跑一次推理，确保「下载完成」等于「能用」。
#[tauri::command]
async fn local_embed_warm_up() -> Result<embed::LocalEmbedStatus, String> {
    let root = store::data_root();
    tauri::async_runtime::spawn_blocking(move || embed::warm_up(&root))
        .await
        .map_err(|e| crate::error_text::explain("本地语义模型预热失败", &e))?
}

#[tauri::command]
async fn local_embed(texts: Vec<String>, is_query: Option<bool>) -> Result<Vec<Vec<f32>>, String> {
    let root = store::data_root();
    let is_query = is_query.unwrap_or(false);
    // 检索路径不允许顺手下载模型：没下载就返回错误，由界面提示去设置里下。
    tauri::async_runtime::spawn_blocking(move || embed::embed(&root, texts, is_query, false))
        .await
        .map_err(|e| crate::error_text::explain("本地嵌入任务失败", &e))?
}

#[derive(serde::Deserialize)]
pub struct EmbeddingBatchItemV2 {
    pub card_id: String,
    pub embedding: Vec<f32>,
}

#[tauri::command]
fn db_list_stale_embedding_card_ids(dir: Option<String>, dim: i64, limit: Option<i64>) -> Result<Vec<String>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::list_stale_embedding_card_ids(&conn, dim, limit.unwrap_or(100)).map_err(|e| e.to_string())
}

#[tauri::command]
fn asr_model_status(model: Option<String>) -> Result<asr::AsrModelStatus, String> {
    asr::model_status(&store::data_root(), model.as_deref().unwrap_or("small"))
}

/// 下载语音模型到 `<data_root>/models/`。进度通过 `knowflick:asr-progress` 事件推给界面。
#[tauri::command]
async fn asr_download_model(app: tauri::AppHandle, model: String) -> Result<asr::AsrModelStatus, String> {
    use tauri::Emitter;

    let url = asr::model_download_url(&model)?;
    let target = asr::model_path(&store::data_root(), &model)?;

    // 每 2 MB 或每跨过一个百分位推一次，避免刷爆事件队列
    let mut last_emitted: u64 = 0;
    let downloaded = asr::download_to_path(&url, &target, |done, total| {
        let step = done - last_emitted >= 2 * 1024 * 1024;
        let pct_step = total > 0 && (done * 100 / total) > (last_emitted * 100 / last_emitted.max(1));
        if step || pct_step || done == total {
            last_emitted = done;
            let _ = app.emit(
                "knowflick:asr-progress",
                serde_json::json!({ "model": model, "downloaded": done, "total": total }),
            );
        }
    })
    .await?;

    let _ = app.emit(
        "knowflick:asr-progress",
        serde_json::json!({ "model": model, "downloaded": downloaded, "total": downloaded, "done": true }),
    );

    asr::model_status(&store::data_root(), &model)
}

#[tauri::command]
fn asr_transcribe(model: Option<String>, path: String) -> Result<asr::TranscriptionResult, String> {
    let model = model.unwrap_or_else(|| "small".to_string());
    let root = store::data_root();
    let status = asr::model_status(&root, &model)?;
    if !status.installed {
        return Err(format!("语音模型 {model} 尚未下载，请先在设置里下载模型"));
    }
    let model_path = asr::model_path(&root, &model)?;
    let source = std::path::Path::new(&path);
    if !source.exists() {
        return Err(format!("音频文件不存在: {path}"));
    }
    let wav = asr::to_wav_16k_mono(source)?;
    let result = asr::transcribe(&model_path, &wav);
    // 只有我们自己造的临时 wav 才删，用户的原始文件不动
    if wav != source {
        let _ = std::fs::remove_file(&wav);
    }
    result
}

#[tauri::command]
fn db_list_subscriptions(dir: Option<String>) -> Result<Vec<db::SubscriptionDto>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::list_subscriptions(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_subscription(dir: Option<String>, subscription: db::SubscriptionDto) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::save_subscription(&conn, &subscription).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_mark_subscription_polled(dir: Option<String>, id: String, polled_at: i64) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::mark_subscription_polled(&conn, &id, polled_at).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_subscription(dir: Option<String>, id: String) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::delete_subscription(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_search_materials_fts(dir: Option<String>, query: String, limit: Option<i64>) -> Result<Vec<db::RawMaterialDto>, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    // 不在这里补索引：补齐是一次全表 LEFT JOIN 扫描，放在每次按键的检索里会把
    // 输入延迟拖成库规模相关的。索引同步由 save_material 负责，老库升级走
    // db_backfill_material_fts（应用启动时调一次）。
    db::search_materials_fts(&conn, &query, limit.unwrap_or(60)).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_backfill_material_fts(dir: Option<String>) -> Result<usize, String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    db::backfill_material_fts(&conn).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
pub struct CardEmbeddingBatchItem {
    pub card_id: String,
    pub embedding: Vec<f32>,
}

#[tauri::command]
fn db_save_card_embeddings_batch(
    dir: Option<String>,
    items: Vec<CardEmbeddingBatchItem>,
) -> Result<(), String> {
    let path = library_dir(dir);
    let db_path = path.join("knowflick.db");
    let mut conn = db::open_db(&db_path).map_err(|e| e.to_string())?;
    let pairs: Vec<(String, Vec<f32>)> = items.into_iter().map(|it| (it.card_id, it.embedding)).collect();
    db::save_card_embeddings_batch(&mut conn, &pairs).map_err(|e| e.to_string())
}

#[tauri::command]
async fn request_embeddings(
    endpoint: String,
    api_key: String,
    model: String,
    input: Vec<String>,
) -> Result<Vec<Vec<f32>>, String> {
    http::request_embeddings(&endpoint, &api_key, &model, input).await
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

/// Native menu bar (macOS app menu / Windows menu strip).
///
/// Menu items only *emit* intent to the web layer ("menu://capture" etc.); the
/// workspace owns the actual state, so the menu never duplicates UI logic.
/// Shortcuts shown here are the labels users expect; the matching accelerators
/// are also handled in the web layer (`⌘/Ctrl+N`, `⌘/Ctrl+K`, `⌃⌘S`).
fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let app_menu = Submenu::with_items(
        app,
        "KnowFlick",
        true,
        &[
            &MenuItem::with_id(app, "about", "关于 KnowFlick", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("隐藏 KnowFlick"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("退出 KnowFlick"))?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &MenuItem::with_id(app, "capture", "记录一件闪念", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "capsule", "呼出闪念胶囊", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "import", "导入文件…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "export", "导出备份…", true, Some("CmdOrCtrl+Shift+E"))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &MenuItem::with_id(app, "find", "搜索知识库", true, Some("CmdOrCtrl+K"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "显示",
        true,
        &[
            &MenuItem::with_id(app, "toggle-nav", "显示/隐藏导航栏", true, Some("Ctrl+Cmd+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "inbox", "收件箱", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "library", "全部知识", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "favorites", "收藏", true, Some("CmdOrCtrl+3"))?,
            &MenuItem::with_id(app, "archive", "已归档", true, Some("CmdOrCtrl+4"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "设置", true, Some("CmdOrCtrl+,"))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu])
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub shortcut: String,
    pub registered: bool,
    pub error: Option<String>,
}

#[tauri::command]
fn get_shortcut_status(state: tauri::State<ShortcutStatus>) -> ShortcutStatus {
    state.inner().clone()
}

#[tauri::command]
fn hide_capsule(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("quick-capture") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn toggle_capsule(app: tauri::AppHandle) {
    toggle_capsule_window(&app);
}

fn show_capsule_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::{Emitter, Manager};
    if let Some(w) = app.get_webview_window("quick-capture") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("knowflick:capsule-open", ());
        let _ = app.emit("knowflick:capsule-open", ());
        let _ = w.eval("window.dispatchEvent(new CustomEvent('knowflick:capsule-open'))");
    }
}

fn toggle_capsule_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("quick-capture") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_capsule_window(app);
        }
    }
}

fn platform_capture_tray_label(registered: bool) -> &'static str {
    if registered {
        if cfg!(target_os = "macos") {
            "快速闪念 (⌥Space)"
        } else {
            "快速闪念 (Alt+Space)"
        }
    } else {
        "快速闪念"
    }
}

fn setup_tray<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut_status: &ShortcutStatus,
) -> tauri::Result<()> {
    use std::sync::atomic::Ordering;
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let capture_label = platform_capture_tray_label(shortcut_status.registered);

    let tray_menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "tray_open", "打开主窗口", true, None::<&str>)?,
            &MenuItem::with_id(app, "tray_capture", capture_label, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "tray_quit", "退出 KnowFlick", true, None::<&str>)?,
        ],
    )?;

    if let Some(icon) = app.default_window_icon() {
        let mut builder = TrayIconBuilder::with_id("knowflick-tray")
            .icon(icon.clone())
            .menu(&tray_menu)
            .on_menu_event(|app, event| {
                match event.id().as_ref() {
                    "tray_open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "tray_capture" => {
                        toggle_capsule_window(app);
                    }
                    "tray_quit" => {
                        IS_QUITTING.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                }
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            });

        #[cfg(target_os = "macos")]
        {
            builder = builder.show_menu_on_left_click(true);
        }
        #[cfg(not(target_os = "macos"))]
        {
            builder = builder.show_menu_on_left_click(false);
        }

        let _tray = builder.build(app)?;
    } else {
        eprintln!("[KnowFlick] Warning: default_window_icon not available, tray icon skipped");
    }
    Ok(())
}

fn setup_shortcuts<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<ShortcutStatus> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let shortcut_str = "Alt+Space";
    let shortcut: Shortcut = shortcut_str.parse().expect("valid shortcut");
    let shortcut_clone = shortcut.clone();

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app_h, s, event| {
                if event.state() == ShortcutState::Pressed && *s == shortcut_clone {
                    toggle_capsule_window(app_h);
                }
            })
            .build(),
    )?;

    // Register Alt+Space (Option+Space on macOS). Do NOT silently fall back to Control+Space
    // to avoid hijacking system input method (IME) switching.
    match app.global_shortcut().register(shortcut) {
        Ok(_) => {
            eprintln!("[KnowFlick] Global shortcut registered: {}", shortcut_str);
            Ok(ShortcutStatus {
                shortcut: shortcut_str.to_string(),
                registered: true,
                error: None,
            })
        }
        Err(err) => {
            let err_msg = err.to_string();
            eprintln!(
                "[KnowFlick] Failed to register global shortcut {}: {}",
                shortcut_str, err_msg
            );
            Ok(ShortcutStatus {
                shortcut: shortcut_str.to_string(),
                registered: false,
                error: Some(err_msg),
            })
        }
    }
}

static IS_QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            let shortcut_status = setup_shortcuts(app.handle())?;
            setup_tray(app.handle(), &shortcut_status)?;
            app.manage(shortcut_status);

            // Apply platform vibrancy / materials where supported
            #[cfg(target_os = "macos")]
            {
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = window_vibrancy::apply_vibrancy(
                        &main_win,
                        window_vibrancy::NSVisualEffectMaterial::Sidebar,
                        Some(window_vibrancy::NSVisualEffectState::Active),
                        Some(8.0),
                    );
                }
            }
            #[cfg(target_os = "windows")]
            {
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = window_vibrancy::apply_mica(&main_win, None);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            use std::sync::atomic::Ordering;
            if IS_QUITTING.load(Ordering::SeqCst) {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main" || label == "quick-capture" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .on_menu_event(|app, event| {
            use tauri::Manager;
            let id = event.id().as_ref().to_string();
            if id == "capsule" {
                toggle_capsule_window(app);
                return;
            }
            // Forward the menu choice to the web layer; ignore when no window is ready.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(&format!(
                    "window.dispatchEvent(new CustomEvent('knowflick:menu', {{detail: '{}'}}))",
                    id
                ));
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_store,
            save_media,
            read_media,
            mail_list_accounts,
            mail_save_account,
            mail_test_account,
            mail_remove_account,
            mail_sync_account,
            mail_sync_history,
            mail_list_rejected,
            mail_retry_rejected,
            mail_sync_due_accounts,
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
            note_upsert,
            note_ensure_from_material,
            note_get,
            note_list,
            note_delete,
            note_restore,
            note_search,
            kb_create,
            kb_list,
            kb_add_note,
            kb_remove_note,
            kb_membership,
            db_list_materials,
            db_update_material_status,
            db_get_stats,
            db_library_signature,
            db_replace_cards,
            hide_capsule,
            toggle_capsule,
            get_shortcut_status,
            db_save_artifact,
            db_list_artifacts,
            db_delete_artifact,
            db_save_card_embedding,
            db_search_cards_vector,
            db_search_cards_hybrid,
            db_list_unembedded_card_ids,
            db_save_card_embeddings_batch,
            request_embeddings,
            db_search_materials_fts,
            db_backfill_material_fts,
            db_list_subscriptions,
            db_save_subscription,
            db_mark_subscription_polled,
            db_delete_subscription,
            asr_model_status,
            asr_download_model,
            asr_transcribe,
            local_embed_status,
            local_embed_warm_up,
            local_embed,
            db_list_stale_embedding_card_ids
        ])
        .build(tauri::generate_context!())
        .expect("error while running KnowFlick")
        .run(|app_handle, event| {
            use std::sync::atomic::Ordering;
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                    use tauri::Manager;
                    if !has_visible_windows {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                }
                tauri::RunEvent::ExitRequested { .. } => {
                    IS_QUITTING.store(true, Ordering::SeqCst);
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod library_command_tests {
    use super::*;

    /// 走真实命令函数（目录解析 + 开库 + 落库），覆盖 IPC 层之下的整条链路。
    #[test]
    fn subscription_commands_round_trip_in_a_real_library() {
        let dir = std::env::temp_dir().join(format!("kf_cmd_sub_{}", uuid::Uuid::new_v4()));
        let dir_string = dir.to_string_lossy().to_string();

        let sub = db::SubscriptionDto {
            id: "cmd-sub-1".to_string(),
            r#type: "github_release".to_string(),
            title: "Rust 发布".to_string(),
            target_url: "rust-lang/rust".to_string(),
            interval_minutes: 720,
            last_polled_at: None,
            is_active: true,
            created_at: 1_700_000_000_000,
        };
        db_save_subscription(Some(dir_string.clone()), sub.clone()).unwrap();

        let listed = db_list_subscriptions(Some(dir_string.clone())).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].target_url, "rust-lang/rust");

        // 命令层能标已轮询（这条路径是 save 不会覆盖的字段）
        db_mark_subscription_polled(Some(dir_string.clone()), "cmd-sub-1".to_string(), 1_700_000_900_000).unwrap();
        let after_poll = db_list_subscriptions(Some(dir_string.clone())).unwrap();
        assert_eq!(after_poll[0].last_polled_at, Some(1_700_000_900_000));

        db_delete_subscription(Some(dir_string.clone()), "cmd-sub-1".to_string()).unwrap();
        assert!(db_list_subscriptions(Some(dir_string.clone())).unwrap().is_empty());

        // 素材全文检索命令：空库不该报错
        let hits = db_search_materials_fts(Some(dir_string.clone()), "任何词".to_string(), Some(10)).unwrap();
        assert!(hits.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod shortcut_and_tray_tests {
    use super::*;

    #[test]
    fn shortcut_status_serialization() {
        let ok_status = ShortcutStatus {
            shortcut: "Alt+Space".to_string(),
            registered: true,
            error: None,
        };
        let ok_json = serde_json::to_string(&ok_status).unwrap();
        assert!(ok_json.contains("\"shortcut\":\"Alt+Space\""));
        assert!(ok_json.contains("\"registered\":true"));
        assert!(ok_json.contains("\"error\":null"));

        let err_status = ShortcutStatus {
            shortcut: "Alt+Space".to_string(),
            registered: false,
            error: Some("Shortcut in use by system".to_string()),
        };
        let err_json = serde_json::to_string(&err_status).unwrap();
        assert!(err_json.contains("\"registered\":false"));
        assert!(err_json.contains("\"error\":\"Shortcut in use by system\""));
    }

    #[test]
    fn platform_tray_label_test() {
        if cfg!(target_os = "macos") {
            assert_eq!(platform_capture_tray_label(true), "快速闪念 (⌥Space)");
        } else {
            assert_eq!(platform_capture_tray_label(true), "快速闪念 (Alt+Space)");
        }
        assert_eq!(platform_capture_tray_label(false), "快速闪念");
    }
}

#[cfg(test)]
mod library_signature_tests {
    use super::*;

    /// 签名必须能看出「外部进程改了库」——这正是它存在的理由。
    #[test]
    fn signature_changes_when_the_database_is_touched() {
        let dir = std::env::temp_dir().join(format!("kf-sig-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("knowflick.db");
        // 建一个真实库，让签名有内容可读
        {
            let conn = db::open_db(&db_path).unwrap();
            drop(conn);
        }
        let before = library_signature(Some(dir.to_string_lossy().to_string())).unwrap();
        assert!(before.contains("knowflick.db"), "签名里应含库文件名：{before}");

        // 外部写一笔（模拟 MCP server）
        {
            let conn = db::open_db(&db_path).unwrap();
            conn.execute(
                "INSERT INTO cards (id, category, headline, summary, details, links_json, tags_json, source, created_at, updated_at) VALUES ('sig-1','x','标题','摘要','正文','[]','[]','imported',1,1)",
                [],
            ).unwrap();
            drop(conn);
        }
        let after = library_signature(Some(dir.to_string_lossy().to_string())).unwrap();
        assert_ne!(before, after, "库被外部写入后签名必须变化");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 库还不存在时也要给出签名（不能报错——首次启动时它就是空的）。
    #[test]
    fn signature_works_on_an_empty_directory() {
        let dir = std::env::temp_dir().join(format!("kf-sig-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sig = library_signature(Some(dir.to_string_lossy().to_string())).unwrap();
        assert!(sig.contains("knowflick.db"), "{sig}");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 没改库时签名必须稳定——否则界面会一直白刷新。
    #[test]
    fn signature_is_stable_when_nothing_changed() {
        let dir = std::env::temp_dir().join(format!("kf-sig-stable-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("knowflick.db");
        {
            let conn = db::open_db(&db_path).unwrap();
            drop(conn);
        }
        let first = library_signature(Some(dir.to_string_lossy().to_string())).unwrap();
        let second = library_signature(Some(dir.to_string_lossy().to_string())).unwrap();
        assert_eq!(first, second, "库没变，签名必须稳定：不然界面会一直白刷新");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 签名跟的是**内容**，不是 mtime。
    ///
    /// 这条把设计钉死：把文件的 mtime 拨到别处，签名必须一个字节都不变。
    /// 退回 mtime 实现的那个版本会立刻变红——CI 上真的红过（见实现处的注释）。
    #[test]
    fn signature_ignores_mtime() {
        let dir = std::env::temp_dir().join(format!("kf-sig-mtime-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("knowflick.db");
        std::fs::write(&file, b"some content").unwrap();
        let before = library_signature(Some(dir.to_string_lossy().to_string())).unwrap();

        let handle = std::fs::OpenOptions::new().write(true).open(&file).unwrap();
        let an_hour_from_now = std::time::SystemTime::now() + std::time::Duration::from_secs(60 * 60);
        handle
            .set_times(std::fs::FileTimes::new().set_modified(an_hour_from_now))
            .unwrap();
        drop(handle);

        let after = library_signature(Some(dir.to_string_lossy().to_string())).unwrap();
        assert_eq!(before, after, "签名不该受 mtime 影响——它跟的是内容");
        std::fs::remove_dir_all(&dir).ok();
    }
}

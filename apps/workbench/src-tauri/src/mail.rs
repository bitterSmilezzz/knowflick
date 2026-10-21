//! Read-only, bounded IMAP ingestion for KnowFlick.
//!
//! Contract with the rest of the app:
//! - Only `LOGIN`, `EXAMINE`, `UID SEARCH` and `UID FETCH ... BODY.PEEK[]` are ever
//!   sent. No `STORE`, `DELETE`, `EXPUNGE`, `COPY` or `APPEND`: importing mail
//!   never marks a message read and never touches the server mailbox.
//! - TLS is always verified (system roots + hostname). There is no plaintext
//!   switch in production code; the only plaintext path lives in `#[cfg(test)]`.
//! - Passwords live in `<dir>/credentials/mail-<uuid>` (0600 file, 0700 dir) and
//!   never reach SQLite, DTOs, logs or the archive exporter.
//! - Every size is bounded: 2 MiB per message, 512 KiB of extracted text,
//!   bounded protocol lines, 15 s socket timeouts and a 120 s session budget.
use crate::db::{self, RawMaterialDto};
use mailparse::{DispositionType, MailHeaderMap, ParsedMail};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Largest mail body accepted from the server.
const MAX_MESSAGE: usize = 2 * 1024 * 1024;
/// Largest plain-text body kept for a material.
const MAX_TEXT: usize = 512 * 1024;
/// Largest single protocol line. A `UID SEARCH` reply can be long, so this is
/// generous, but it is still a hard cap.
const MAX_LINE: usize = 8 * 1024 * 1024;
/// Largest total response accepted for one command.
const MAX_RESPONSE: usize = 16 * 1024 * 1024;
/// Largest number of protocol lines accepted for one command.
const MAX_LINES: usize = 100_000;
const IO_TIMEOUT: Duration = Duration::from_secs(15);
const SESSION_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_FOLDER_LEN: usize = 512;
const MAX_ATTACHMENT_NAMES: usize = 128;

type MailResult<T> = Result<T, String>;
type Connector = fn(&MailAccountConfig) -> MailResult<Imap>;

/// Serializes every mail operation. One process may own the library directory,
/// and two concurrent syncs would fight over the same cursor row.
static ACCOUNT_LOCK: Mutex<()> = Mutex::new(());

/// Account settings as edited in the UI. The `id` is a UI-generated UUID.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAccountConfig {
    pub id: String,
    pub name: String,
    pub email: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default = "default_folder")]
    pub folder: String,
    #[serde(default = "default_limit")]
    pub sync_limit: u16,
}

fn default_folder() -> String {
    "INBOX".into()
}

fn default_limit() -> u16 {
    50
}

/// A stored account. The password is never included; `has_password` says
/// whether one is stored on disk.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAccount {
    #[serde(flatten)]
    pub config: MailAccountConfig,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
    pub has_password: bool,
}

/// Result of a connectivity check.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailConnectionSummary {
    pub account_id: String,
    pub folder: String,
    pub message_count: u32,
}

/// Result of one sync run.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailSyncResult {
    pub imported: usize,
    pub skipped: usize,
    /// Messages this run could not read and has set aside (not retried).
    pub rejected: usize,
    pub account_id: String,
    pub last_sync_at: i64,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// SQLite errors are reported without their text: a driver message can echo a
/// bound parameter, and bound parameters may contain account metadata.
fn sql_error(_: rusqlite::Error) -> String {
    "Mail database operation failed".into()
}

fn network_error(_: std::io::Error) -> String {
    "Mail connection failed or timed out".into()
}

fn valid_id(id: &str) -> MailResult<()> {
    match uuid::Uuid::parse_str(id) {
        Ok(parsed) if parsed.to_string() == id => Ok(()),
        _ => Err("Account id must be a canonical UUID".into()),
    }
}

fn validate(mut config: MailAccountConfig) -> MailResult<MailAccountConfig> {
    valid_id(&config.id)?;
    config.name = config.name.trim().to_string();
    config.email = config.email.trim().to_string();
    config.host = config.host.trim().to_string();
    config.username = config.username.trim().to_string();
    config.folder = config.folder.trim().to_string();
    if config.folder.is_empty() {
        config.folder = default_folder();
    }
    let fields: [(&str, &str, usize); 5] = [
        ("name", &config.name, 200),
        ("email", &config.email, 320),
        ("host", &config.host, 253),
        ("username", &config.username, 320),
        ("folder", &config.folder, MAX_FOLDER_LEN),
    ];
    for (field, value, max) in fields {
        if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
            return Err(format!("Invalid account {field}"));
        }
    }
    if !config.email.contains('@') {
        return Err("Invalid account email".into());
    }
    if config.port == 0 {
        return Err("Invalid account port".into());
    }
    if !(1..=200).contains(&config.sync_limit) {
        return Err("Sync limit must be between 1 and 200".into());
    }
    if !config.host.is_ascii()
        || config
            .host
            .chars()
            .any(|ch| ch.is_whitespace() || "/\\:@[]\"'<>".contains(ch))
    {
        return Err("Host must be a DNS name or IP address without scheme or port".into());
    }
    Ok(config)
}

// ---------------------------------------------------------------- credentials

fn credential_path(dir: &Path, id: &str) -> MailResult<PathBuf> {
    valid_id(id)?;
    let root = dir.join("credentials");
    if let Ok(meta) = fs::symlink_metadata(&root) {
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Invalid credentials directory".into());
        }
    }
    let path = root.join(format!("mail-{id}"));
    if let Ok(meta) = fs::symlink_metadata(&path) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Invalid credentials file".into());
        }
    }
    Ok(path)
}

fn validate_password(password: &str) -> MailResult<()> {
    if password.is_empty() || password.len() > 4096 || password.chars().any(char::is_control) {
        Err("A password of 1..4096 bytes without control characters is required".into())
    } else {
        Ok(())
    }
}

fn read_password(dir: &Path, id: &str) -> MailResult<String> {
    let path = credential_path(dir, id)?;
    let mut file =
        fs::File::open(path).map_err(|_| "Mail password is missing; enter it again".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = file
            .metadata()
            .map_err(|_| "Cannot inspect mail credentials".to_string())?
            .permissions()
            .mode();
        if mode & 0o077 != 0 {
            return Err("Mail credentials must be readable by the owner only".into());
        }
    }
    let mut password = String::new();
    std::io::Read::by_ref(&mut file)
        .take(4097)
        .read_to_string(&mut password)
        .map_err(|_| "Cannot read mail credentials".to_string())?;
    validate_password(&password)?;
    Ok(password)
}

fn write_password(dir: &Path, id: &str, password: &str) -> MailResult<()> {
    validate_password(password)?;
    let path = credential_path(dir, id)?;
    let root = path.parent().ok_or("Invalid credential path")?.to_path_buf();
    fs::create_dir_all(&root).map_err(|_| "Cannot create mail credentials directory")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot restrict mail credentials directory")?;
    }
    let tmp = root.join(format!(".mail-{}", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // Windows: the file inherits the profile directory ACL. Rust's std has no
    // portable ACL API and this project has no windows-only dependency, so the
    // permission is documented rather than silently claimed: on Windows the
    // credential file is protected by the user profile ACL only.
    let outcome = (|| -> std::io::Result<()> {
        let mut file = options.open(&tmp)?;
        file.write_all(password.as_bytes())?;
        file.sync_all()?;
        // On Windows a rename cannot replace an existing destination, so the old
        // credential file is removed only after the replacement is fully written.
        #[cfg(windows)]
        if path.exists() {
            fs::remove_file(&path)?;
        }
        fs::rename(&tmp, &path)
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    outcome.map_err(|_| "Cannot write mail credentials".to_string())
}

// -------------------------------------------------------------------- schema

fn open(dir: &Path) -> MailResult<Connection> {
    let conn = db::open_db(&dir.join("knowflick.db")).map_err(sql_error)?;
    conn.busy_timeout(Duration::from_secs(10)).map_err(sql_error)?;
    ensure_schema(&conn)?;
    Ok(conn)
}

/// Own schema, created on every call so this module never needs a change to
/// `db.rs`. `mail_imports` is the dedupe ledger; `mail_accounts` holds the
/// non-secret configuration plus the sync cursor.
fn ensure_schema(conn: &Connection) -> MailResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS mail_accounts (
            id            TEXT PRIMARY KEY,
            config_json   TEXT NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT 0,
            last_sync_at  INTEGER,
            last_error    TEXT,
            uid_validity  INTEGER,
            last_uid      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS mail_imports (
            account_id   TEXT NOT NULL,
            folder       TEXT NOT NULL,
            uid_validity INTEGER NOT NULL,
            uid          INTEGER NOT NULL,
            message_id   TEXT NOT NULL DEFAULT '',
            material_id  TEXT NOT NULL,
            PRIMARY KEY (account_id, folder, uid_validity, uid)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_imports_message
            ON mail_imports(account_id, folder, message_id)
            WHERE message_id <> '';

        -- Messages that cannot be imported (too large, broken MIME, ...).
        -- Recording them keeps one bad message from blocking the rest of the
        -- mailbox on every later sync.
        CREATE TABLE IF NOT EXISTS mail_rejected (
            account_id   TEXT NOT NULL,
            folder       TEXT NOT NULL,
            uid_validity INTEGER NOT NULL,
            uid          INTEGER NOT NULL,
            reason       TEXT NOT NULL DEFAULT '',
            rejected_at  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (account_id, folder, uid_validity, uid)
        );
        "#,
    )
    .map_err(sql_error)
}

fn account_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MailAccount> {
    let json: String = row.get(0)?;
    let config: MailAccountConfig = serde_json::from_str(&json).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })?;
    Ok(MailAccount {
        config,
        last_sync_at: row.get(1)?,
        last_error: row.get(2)?,
        has_password: false,
    })
}

fn account(conn: &Connection, dir: &Path, id: &str) -> MailResult<MailAccount> {
    valid_id(id)?;
    let mut found = conn
        .query_row(
            "SELECT config_json,last_sync_at,last_error FROM mail_accounts WHERE id=?1",
            [id],
            account_row,
        )
        .optional()
        .map_err(sql_error)?
        .ok_or("Mail account not found")?;
    found.has_password = read_password(dir, id).is_ok();
    Ok(found)
}

// ------------------------------------------------------------- public API

/// Every account known to this library directory. Passwords are never returned.
pub fn list_accounts(dir: &Path) -> MailResult<Vec<MailAccount>> {
    let _guard = ACCOUNT_LOCK.lock().map_err(|_| "Mail account lock failed")?;
    let conn = open(dir)?;
    let mut stmt = conn
        .prepare("SELECT config_json,last_sync_at,last_error FROM mail_accounts ORDER BY created_at,id")
        .map_err(sql_error)?;
    let rows = stmt.query_map([], account_row).map_err(sql_error)?;
    let mut out = Vec::new();
    for row in rows {
        let mut found = row.map_err(sql_error)?;
        found.has_password = read_password(dir, &found.config.id).is_ok();
        out.push(found);
    }
    Ok(out)
}

/// Stores an account. An empty password keeps the stored one; a new account
/// or a changed server/username requires the password again.
pub fn save_account(
    dir: &Path,
    config: MailAccountConfig,
    password: &str,
) -> MailResult<MailAccount> {
    let _guard = ACCOUNT_LOCK.lock().map_err(|_| "Mail account lock failed")?;
    let config = validate(config)?;
    let mut conn = open(dir)?;
    let stored = conn
        .query_row(
            "SELECT config_json FROM mail_accounts WHERE id=?1",
            [&config.id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql_error)?;
    if password.is_empty() {
        let previous: MailAccountConfig = serde_json::from_str(
            stored
                .as_deref()
                .ok_or("Password required for a new account")?,
        )
        .map_err(|_| "Invalid stored mail account")?;
        if previous.host != config.host
            || previous.port != config.port
            || previous.username != config.username
        {
            return Err("Enter the password again when changing server or username".into());
        }
        read_password(dir, &config.id)?;
    } else {
        write_password(dir, &config.id, password)?;
    }
    let json = serde_json::to_string(&config).map_err(|_| "Cannot encode mail account")?;
    let changed = stored.as_ref().map(|old| old != &json).unwrap_or(false);
    // IMAP UIDs are only meaningful inside one server, folder generation. When
    // the account is re-pointed at a different host/username/folder, the old
    // dedupe ledger must not be reused: a different mailbox can reuse the same
    // (UIDVALIDITY, UID) pair and its unrelated mail would be skipped silently.
    let identity_changed = stored
        .as_deref()
        .and_then(|old| serde_json::from_str::<MailAccountConfig>(old).ok())
        .is_some_and(|old| {
            old.host != config.host || old.username != config.username || old.folder != config.folder
        });
    if identity_changed {
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        for table in ["mail_imports", "mail_rejected"] {
            transaction
                .execute(&format!("DELETE FROM {table} WHERE account_id=?1"), [&config.id])
                .map_err(sql_error)?;
        }
        transaction.commit().map_err(sql_error)?;
    }
    conn.execute(
        "INSERT INTO mail_accounts(id,config_json,created_at) VALUES(?1,?2,?3)
         ON CONFLICT(id) DO UPDATE SET
            config_json = excluded.config_json,
            last_error = NULL,
            uid_validity = CASE WHEN ?4 THEN NULL ELSE mail_accounts.uid_validity END,
            last_uid = CASE WHEN ?4 THEN 0 ELSE mail_accounts.last_uid END",
        params![config.id, json, now(), changed],
    )
    .map_err(sql_error)?;
    account(&conn, dir, &config.id)
}

/// Disconnects an account: the stored password is deleted, the account row is
/// removed. Imported materials and the dedupe ledger stay, so the history of
/// what was imported is not lost and a re-added account does not duplicate it.
pub fn remove_account(dir: &Path, id: &str) -> MailResult<()> {
    let _guard = ACCOUNT_LOCK.lock().map_err(|_| "Mail account lock failed")?;
    let conn = open(dir)?;
    let path = credential_path(dir, id)?;
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("Cannot remove mail credentials".into()),
    }
    conn.execute("DELETE FROM mail_accounts WHERE id=?1", [id])
        .map_err(sql_error)?;
    Ok(())
}

/// Checks that the server accepts the credentials and the folder exists.
pub fn test_account(
    dir: &Path,
    config: MailAccountConfig,
    password: &str,
) -> MailResult<MailConnectionSummary> {
    test_using(dir, config, password, connect_production)
}

fn test_using(
    dir: &Path,
    config: MailAccountConfig,
    password: &str,
    connect: Connector,
) -> MailResult<MailConnectionSummary> {
    let _guard = ACCOUNT_LOCK.lock().map_err(|_| "Mail account lock failed")?;
    let config = validate(config)?;
    let conn = open(dir)?;
    let secret = if password.is_empty() {
        let saved = account(&conn, dir, &config.id)?;
        if saved.config.host != config.host
            || saved.config.port != config.port
            || saved.config.username != config.username
        {
            return Err("Enter the password again when changing server or username".into());
        }
        read_password(dir, &config.id)?
    } else {
        validate_password(password)?;
        password.to_string()
    };
    let mut client = connect(&config)?;
    let (_, message_count) = client.login_examine(&config, &secret)?;
    Ok(MailConnectionSummary {
        account_id: config.id,
        folder: config.folder,
        message_count,
    })
}

/// Imports new mail into the material inbox as `source_type = "email"`.
pub fn sync_account(dir: &Path, id: &str) -> MailResult<MailSyncResult> {
    sync_using(dir, id, connect_production)
}

fn sync_using(dir: &Path, id: &str, connect: Connector) -> MailResult<MailSyncResult> {
    let _guard = ACCOUNT_LOCK.lock().map_err(|_| "Mail account lock failed")?;
    valid_id(id)?;
    let mut conn = open(dir)?;
    let saved = account(&conn, dir, id)?;
    let config = validate(saved.config)?;
    let outcome = sync_inner(&mut conn, dir, id, &config, connect);
    if let Err(error) = &outcome {
        let _ = conn.execute(
            "UPDATE mail_accounts SET last_error=?1 WHERE id=?2",
            params![error, id],
        );
    }
    outcome
}

fn sync_inner(
    conn: &mut Connection,
    dir: &Path,
    id: &str,
    config: &MailAccountConfig,
    connect: Connector,
) -> MailResult<MailSyncResult> {
    let password = read_password(dir, id)?;
    let mut client = connect(config)?;
    let (validity, _) = client.login_examine(config, &password)?;
    let (stored_validity, cursor): (Option<u32>, u32) = conn
        .query_row(
            "SELECT uid_validity,last_uid FROM mail_accounts WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(sql_error)?;
    // A new UIDVALIDITY means the server renumbered the mailbox: the old cursor
    // is meaningless, so the scan restarts from the beginning. The Message-ID
    // ledger keeps already imported mail from being imported twice.
    let after = if stored_validity == Some(validity) {
        cursor
    } else {
        0
    };
    // The first run of an account takes the newest messages, matching the UI
    // label 「最近 N 封」. Later runs continue from the cursor and pick up the
    // mail that arrived since, oldest first.
    let first_run = stored_validity != Some(validity) || cursor == 0;
    let uids = client.search(after, config.sync_limit as usize, first_run)?;
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut rejected = 0usize;
    for uid in uids {
        let known: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM mail_imports WHERE account_id=?1 AND folder=?2 AND uid_validity=?3 AND uid=?4)
                        OR EXISTS(SELECT 1 FROM mail_rejected WHERE account_id=?1 AND folder=?2 AND uid_validity=?3 AND uid=?4)",
                params![id, config.folder, validity, uid],
                |row| row.get(0),
            )
            .map_err(sql_error)?;
        if known {
            skipped += 1;
            conn.execute(
                "UPDATE mail_accounts SET uid_validity=?1,last_uid=?2 WHERE id=?3",
                params![validity, uid, id],
            )
            .map_err(sql_error)?;
            continue;
        }
        // The body is fetched outside the database transaction: a slow server
        // must not hold a write lock on the library. A transport error still
        // aborts the run, because the connection itself is suspect.
        let Some(bytes) = client.fetch(uid)? else {
            rejected += 1;
            quarantine(conn, id, config, validity, uid, "message size exceeds the import limit")?;
            continue;
        };
        let Some(material) = material_from_mail(config, validity, uid, &bytes)? else {
            rejected += 1;
            quarantine(conn, id, config, validity, uid, "message text or MIME structure cannot be read")?;
            continue;
        };
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        let duplicate = if material_message_id(&material.metadata_json).is_empty() {
            false
        } else {
            transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM mail_imports WHERE account_id=?1 AND folder=?2 AND message_id=?3)",
                    params![id, config.folder, material_message_id(&material.metadata_json)],
                    |row| row.get(0),
                )
                .map_err(sql_error)?
        };
        if duplicate {
            skipped += 1;
        } else {
            db::save_material(&transaction, &material).map_err(sql_error)?;
            transaction
                .execute(
                    "INSERT INTO mail_imports(account_id,folder,uid_validity,uid,message_id,material_id) VALUES(?1,?2,?3,?4,?5,?6)",
                    params![
                        id,
                        config.folder,
                        validity,
                        uid,
                        material_message_id(&material.metadata_json),
                        material.id
                    ],
                )
                .map_err(sql_error)?;
            imported += 1;
        }
        // The cursor only advances over rows that are safely stored.
        transaction
            .execute(
                "UPDATE mail_accounts SET uid_validity=?1,last_uid=?2 WHERE id=?3",
                params![validity, uid, id],
            )
            .map_err(sql_error)?;
        transaction.commit().map_err(sql_error)?;
    }
    let time = now();
    conn.execute(
        "UPDATE mail_accounts SET last_sync_at=?1,last_error=NULL,uid_validity=?2,
            last_uid=CASE WHEN uid_validity IS NULL OR uid_validity<>?2 THEN 0 ELSE last_uid END
         WHERE id=?3",
        params![time, validity, id],
    )
    .map_err(sql_error)?;
    Ok(MailSyncResult {
        imported,
        skipped,
        rejected,
        account_id: id.to_string(),
        last_sync_at: time,
    })
}

/// Records a message this account cannot read, and moves the cursor past it.
///
/// Without this record the same message would be retried on every sync and,
/// because the cursor only advances over handled messages, it would block every
/// message behind it forever.
fn quarantine(
    conn: &mut Connection,
    id: &str,
    config: &MailAccountConfig,
    validity: u32,
    uid: u32,
    reason: &str,
) -> MailResult<()> {
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO mail_rejected(account_id,folder,uid_validity,uid,reason,rejected_at)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![id, config.folder, validity, uid, reason, now()],
        )
        .map_err(sql_error)?;
    transaction
        .execute(
            "UPDATE mail_accounts SET uid_validity=?1,last_uid=?2 WHERE id=?3",
            params![validity, uid, id],
        )
        .map_err(sql_error)?;
    transaction.commit().map_err(sql_error)
}

fn material_message_id(metadata_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(metadata_json)
        .ok()
        .and_then(|value| {
            value
                .get("messageId")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------- IMAP wire

struct Response {
    lines: Vec<String>,
    literals: Vec<(String, Vec<u8>)>,
}

trait Transport: Read + Write {}
impl<T: Read + Write> Transport for T {}

struct Imap {
    io: BufReader<Box<dyn Transport>>,
    tag: u32,
    deadline: Instant,
}

/// Quotes an IMAP string literal.
fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Encodes a mailbox name as IMAP modified UTF-7 (RFC 3501 §5.1.3).
fn mailbox_name(name: &str) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+,";
    fn flush(pending: &mut Vec<u8>, out: &mut String) {
        if pending.is_empty() {
            return;
        }
        out.push('&');
        let mut acc: u32 = 0;
        let mut bits = 0u32;
        for byte in pending.drain(..) {
            acc = (acc << 8) | byte as u32;
            bits += 8;
            while bits >= 6 {
                bits -= 6;
                out.push(ALPHABET[((acc >> bits) & 63) as usize] as char);
                // Keep only the bits that have not been emitted yet.
                acc &= (1 << bits) - 1;
            }
        }
        if bits > 0 {
            out.push(ALPHABET[((acc << (6 - bits)) & 63) as usize] as char);
        }
        out.push('-');
    }
    let mut out = String::new();
    let mut pending: Vec<u8> = Vec::new();
    for ch in name.chars() {
        if (' '..='~').contains(&ch) {
            flush(&mut pending, &mut out);
            if ch == '&' {
                out.push_str("&-");
            } else {
                out.push(ch);
            }
        } else {
            let mut units = [0u16; 2];
            for unit in ch.encode_utf16(&mut units).iter() {
                pending.extend_from_slice(&unit.to_be_bytes());
            }
        }
    }
    flush(&mut pending, &mut out);
    out
}

/// Production transport: TCP plus verified TLS (system roots, hostname check).
fn connect_production(config: &MailAccountConfig) -> MailResult<Imap> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let host = config.host.clone();
    let port = config.port;
    std::thread::spawn(move || {
        let resolved = (host.as_str(), port)
            .to_socket_addrs()
            .map(|addrs| addrs.take(8).collect::<Vec<_>>())
            .ok();
        let _ = sender.send(resolved);
    });
    let addresses = receiver
        .recv_timeout(IO_TIMEOUT)
        .map_err(|_| "Mail DNS lookup timed out".to_string())?
        .ok_or("Cannot resolve mail host")?;
    let started = Instant::now();
    let mut stream = None;
    for address in addresses {
        let remaining = IO_TIMEOUT.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            break;
        }
        if let Ok(connected) = TcpStream::connect_timeout(&address, remaining) {
            stream = Some(connected);
            break;
        }
    }
    let stream = stream.ok_or("Cannot connect to mail server")?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).map_err(network_error)?;
    stream.set_write_timeout(Some(IO_TIMEOUT)).map_err(network_error)?;
    let mut builder = native_tls::TlsConnector::builder();
    builder.min_protocol_version(Some(native_tls::Protocol::Tlsv12));
    let connector = builder
        .build()
        .map_err(|_| "Cannot initialize verified TLS".to_string())?;
    let tls = connector
        .connect(&config.host, stream)
        .map_err(|_| "Mail TLS handshake or certificate verification failed".to_string())?;
    Imap::new(Box::new(tls))
}

impl Imap {
    fn new(stream: Box<dyn Transport>) -> MailResult<Self> {
        let mut client = Self {
            io: BufReader::new(stream),
            tag: 0,
            deadline: Instant::now() + SESSION_TIMEOUT,
        };
        let greeting = client.line()?;
        if !greeting.to_ascii_uppercase().starts_with("* OK") {
            return Err("Mail server rejected the connection".into());
        }
        Ok(client)
    }

    fn check_deadline(&self) -> MailResult<()> {
        if Instant::now() >= self.deadline {
            Err("Mail session time limit exceeded".into())
        } else {
            Ok(())
        }
    }

    /// Reads one CRLF terminated line, bounded by `MAX_LINE`.
    fn line(&mut self) -> MailResult<String> {
        let mut out: Vec<u8> = Vec::new();
        loop {
            self.check_deadline()?;
            let buffer = self.io.fill_buf().map_err(network_error)?;
            if buffer.is_empty() {
                return Err("Mail server closed the connection".into());
            }
            let take = buffer
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|index| index + 1)
                .unwrap_or(buffer.len());
            let complete = buffer[take - 1] == b'\n';
            if out.len() + take > MAX_LINE {
                return Err("Mail response line exceeds the size limit".into());
            }
            out.extend_from_slice(&buffer[..take]);
            self.io.consume(take);
            if complete {
                break;
            }
        }
        String::from_utf8(out).map_err(|_| "Invalid mail protocol response".into())
    }

    /// Sends one command and collects the untagged replies plus the tagged
    /// completion. Server text is never echoed back to the caller: an
    /// authentication failure may contain the submitted secret.
    fn command(&mut self, command: &str, allow_literal: bool) -> MailResult<Response> {
        self.check_deadline()?;
        self.tag += 1;
        let tag = format!("K{:04}", self.tag);
        write!(self.io.get_mut(), "{tag} {command}\r\n").map_err(network_error)?;
        self.io.get_mut().flush().map_err(network_error)?;
        let mut response = Response {
            lines: Vec::new(),
            literals: Vec::new(),
        };
        let mut total = 0usize;
        for _ in 0..MAX_LINES {
            let line = self.line()?;
            total += line.len();
            if total > MAX_RESPONSE {
                return Err("Mail response exceeds the size limit".into());
            }
            if let Some(status) = line.strip_prefix(&format!("{tag} ")) {
                if status
                    .split_whitespace()
                    .next()
                    .is_some_and(|word| word.eq_ignore_ascii_case("OK"))
                {
                    return Ok(response);
                }
                return Err("Mail server rejected the request; check the credentials and folder".into());
            }
            if line.to_ascii_uppercase().starts_with("* BYE") {
                return Err("Mail server closed the session".into());
            }
            let trimmed = line.trim_end();
            if trimmed.ends_with('}') {
                if let Some(start) = trimmed.rfind('{') {
                    let length = trimmed[start + 1..trimmed.len() - 1]
                        .parse::<usize>()
                        .map_err(|_| "Invalid mail literal length".to_string())?;
                    if !allow_literal
                        || length > MAX_MESSAGE
                        || total + length > MAX_RESPONSE
                        || !response.literals.is_empty()
                    {
                        return Err("Mail message or literal exceeds the size limit".into());
                    }
                    let mut body = vec![0u8; length];
                    for chunk in body.chunks_mut(8192) {
                        self.check_deadline()?;
                        self.io.read_exact(chunk).map_err(network_error)?;
                    }
                    total += length;
                    response.literals.push((line.clone(), body));
                }
            }
            response.lines.push(line);
        }
        Err("Too many mail response lines".into())
    }

    /// Logs in and opens the folder read-only. Returns UIDVALIDITY and the
    /// message count of the folder.
    fn login_examine(&mut self, config: &MailAccountConfig, password: &str) -> MailResult<(u32, u32)> {
        validate_password(password)?;
        self.command(&format!("LOGIN {} {}", quote(&config.username), quote(password)), false)?;
        let response = self.command(
            &format!("EXAMINE {}", quote(&mailbox_name(&config.folder))),
            false,
        )?;
        let mut validity = None;
        let mut exists = 0u32;
        for line in response.lines {
            let tokens: Vec<&str> = line.split_whitespace().collect();
            if tokens.len() >= 3 && tokens[2].eq_ignore_ascii_case("EXISTS") {
                exists = tokens[1]
                    .parse()
                    .map_err(|_| "Invalid message count".to_string())?;
            }
            let upper = line.to_ascii_uppercase();
            if let Some(position) = upper.find("[UIDVALIDITY ") {
                validity = upper[position + 13..]
                    .split(']')
                    .next()
                    .and_then(|value| value.parse::<u32>().ok());
            }
        }
        let validity = validity.filter(|value| *value > 0).ok_or("Mail server omitted UIDVALIDITY")?;
        Ok((validity, exists))
    }

    /// Returns up to `limit` UIDs above `after`, always in ascending order.
    ///
    /// `newest_first` keeps the *latest* messages (the UI offers “最近 N 封” on
    /// the first sync). The list stays ascending even then: the caller advances
    /// the cursor per row, so a descending list would move the cursor backwards
    /// and a failure could leave a newer UID unretried.
    fn search(&mut self, after: u32, limit: usize, newest_first: bool) -> MailResult<Vec<u32>> {
        if after == u32::MAX {
            return Ok(Vec::new());
        }
        let response = self.command(&format!("UID SEARCH UID {}:*", after + 1), false)?;
        let mut found = false;
        let mut uids: std::collections::BTreeSet<u32> = std::collections::BTreeSet::new();
        for line in response.lines {
            if !line.to_ascii_uppercase().starts_with("* SEARCH") {
                continue;
            }
            found = true;
            for token in line.split_whitespace().skip(2) {
                let uid = token
                    .parse::<u32>()
                    .map_err(|_| "Invalid mail UID".to_string())?;
                // A range such as `100:*` also returns the last UID of the
                // mailbox when 100 is beyond it; that UID is not newer.
                if uid > after {
                    uids.insert(uid);
                    while uids.len() > limit {
                        if newest_first {
                            uids.pop_first();
                        } else {
                            uids.pop_last();
                        }
                    }
                }
            }
        }
        if !found {
            return Err("Mail server omitted the search response".into());
        }
        let list: Vec<u32> = uids.into_iter().collect();
        Ok(list)
    }

    /// Fetches one message with `BODY.PEEK[]`, so the server keeps the message
    /// unread. The size is checked before the body is transferred.
    /// `Ok(None)` means this message cannot be imported (too large); that is a
    /// content problem for one message, not a failure of the whole sync.
    fn fetch(&mut self, uid: u32) -> MailResult<Option<Vec<u8>>> {
        let response = self.command(&format!("UID FETCH {uid} (UID RFC822.SIZE)"), false)?;
        let mut size = None;
        for line in response.lines {
            let upper = line.to_ascii_uppercase().replace(['(', ')'], " ");
            let tokens: Vec<&str> = upper.split_whitespace().collect();
            if token_number(&tokens, "UID") == Some(uid as u64) {
                size = token_number(&tokens, "RFC822.SIZE");
            }
        }
        let size = size.ok_or("Mail server omitted the message size or UID".to_string())?;
        if size > MAX_MESSAGE as u64 {
            return Ok(None);
        }
        // Request BODY.PEEK[] so the server keeps the message unread, but accept
        // the response body item as BODY[]: RFC 3501 echoes the *requested*
        // section, and PEEK is a request modifier that servers do not echo.
        // Requiring the literal "BODY.PEEK[]" in the response made every real
        // import fail; the read-only guarantee comes from the request and from
        // examining (not selecting) the mailbox.
        let response = self.command(&format!("UID FETCH {uid} (UID BODY.PEEK[])"), true)?;
        let (header, body) = response
            .literals
            .into_iter()
            .next()
            .ok_or("Mail server omitted the message body".to_string())?;
        let upper = header.to_ascii_uppercase();
        if !upper.contains("BODY[") {
            return Err("Mail server returned an unexpected body section".into());
        }
        let all = response.lines.join(" ").to_ascii_uppercase().replace(['(', ')'], " ");
        let tokens: Vec<&str> = all.split_whitespace().collect();
        if token_number(&tokens, "UID") != Some(uid as u64) {
            return Err("Mail server returned an unexpected message UID".into());
        }
        Ok(Some(body))
    }
}

fn token_number(tokens: &[&str], name: &str) -> Option<u64> {
    tokens
        .iter()
        .position(|token| *token == name)
        .and_then(|index| tokens.get(index + 1))
        .and_then(|value| value.parse().ok())
}

// ------------------------------------------------------------- MIME handling

fn capped(text: &str, max: usize) -> String {
    let mut end = text.len().min(max);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].replace('\0', "")
}

fn header(mail: &ParsedMail<'_>, name: &str) -> String {
    capped(mail.headers.get_first_value(name).unwrap_or_default().as_str(), 4096)
}

/// Extracts the readable text of a MIME part.
///
/// `multipart/alternative` prefers `text/plain`. Attachments are never
/// downloaded or decoded: only their file names are kept as metadata. HTML is
/// converted to text locally; no remote resource is ever fetched or executed.
fn body_text(mail: &ParsedMail<'_>, depth: usize, attachments: &mut Vec<String>) -> MailResult<String> {
    if depth > 32 {
        return Err("Mail MIME nesting exceeds the limit".into());
    }
    let disposition = mail.get_content_disposition();
    let filename = disposition
        .params
        .get("filename")
        .or_else(|| mail.ctype.params.get("name"));
    if let Some(name) = filename {
        if attachments.len() < MAX_ATTACHMENT_NAMES {
            attachments.push(capped(name, 512));
        }
    }
    if disposition.disposition == DispositionType::Attachment || filename.is_some() {
        return Ok(String::new());
    }
    if !mail.subparts.is_empty() {
        let mut parts: Vec<(String, String)> = Vec::new();
        for child in &mail.subparts {
            let text = body_text(child, depth + 1, attachments)?;
            parts.push((child.ctype.mimetype.to_ascii_lowercase(), text));
        }
        if mail.ctype.mimetype.eq_ignore_ascii_case("multipart/alternative") {
            let chosen = parts
                .iter()
                .find(|(mime, text)| mime == "text/plain" && !text.trim().is_empty())
                .or_else(|| parts.iter().find(|(_, text)| !text.trim().is_empty()));
            return Ok(chosen.map(|(_, text)| text.clone()).unwrap_or_default());
        }
        let joined = parts
            .into_iter()
            .map(|(_, text)| text)
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        return Ok(capped(&joined, MAX_TEXT));
    }
    if !matches!(mail.ctype.mimetype.as_str(), "text/plain" | "text/html") {
        return Ok(String::new());
    }
    let body = mail
        .get_body()
        .map_err(|_| "Cannot decode the mail text or charset".to_string())?;
    let body = capped(&body, MAX_TEXT);
    if mail.ctype.mimetype == "text/html" {
        // html2text keeps Markdown emphasis, which shows up as literal `**` in a
        // plain-text mail body. The mail body is rendered as plain text, so drop
        // the emphasis markers instead of leaking markup into the reading pane.
        html2text::from_read(body.as_bytes(), 100)
            .map(|text| capped(&strip_markdown_emphasis(&text), MAX_TEXT))
            .map_err(|_| "Cannot convert the mail HTML".to_string())
    } else {
        Ok(body)
    }
}

/// Removes the emphasis markers html2text emits, keeping the words.
fn strip_markdown_emphasis(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut index = 0usize;
    while index < chars.len() {
        let ch = chars[index];
        if ch != '*' {
            out.push(ch);
            index += 1;
            continue;
        }
        // A doubled marker wraps a word; drop both markers and keep the word.
        if chars.get(index + 1) == Some(&'*') {
            let mut word = String::new();
            let mut cursor = index + 2;
            let mut closed = false;
            while cursor < chars.len() {
                if chars[cursor] == '*' && chars.get(cursor + 1) == Some(&'*') {
                    cursor += 2;
                    closed = true;
                    break;
                }
                word.push(chars[cursor]);
                cursor += 1;
            }
            if closed {
                out.push_str(&word);
                index = cursor;
            } else {
                out.push_str("**");
                out.push_str(&word);
                index = cursor;
            }
            continue;
        }
        out.push(ch);
        index += 1;
    }
    out
}

/// Turns a raw message into a material. The material id is stable: the same
/// message in the same folder of the same account always maps to the same id.
fn material_from_mail(
    config: &MailAccountConfig,
    validity: u32,
    uid: u32,
    bytes: &[u8],
) -> MailResult<Option<RawMaterialDto>> {
    // The MIME parser is recursive, so a pathological tree is rejected before
    // parsing. Each MIME part carries one Content-Type header.
    let content_types = bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| {
            line.get(..13)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"content-type:"))
        })
        .count();
    if bytes.len() > MAX_MESSAGE || content_types > 64 {
        return Ok(None);
    }
    // A message this account cannot read must not stop the other messages:
    // `None` means "skip this one", not "the sync failed".
    let Ok(parsed) = mailparse::parse_mail(bytes) else {
        return Ok(None);
    };
    let mut attachments = Vec::new();
    let Ok(body) = body_text(&parsed, 0, &mut attachments) else {
        return Ok(None);
    };
    let subject = header(&parsed, "Subject");
    let message_id = header(&parsed, "Message-ID");
    let time = now();
    let metadata = serde_json::json!({
        "mailAccountId": config.id,
        "accountEmail": config.email,
        "folder": config.folder,
        "uidValidity": validity,
        "uid": uid,
        "messageId": message_id,
        "from": header(&parsed, "From"),
        "to": header(&parsed, "To"),
        "cc": header(&parsed, "Cc"),
        "date": header(&parsed, "Date"),
        "attachmentFilenames": attachments,
        "originalSizeBytes": bytes.len(),
        "textTruncated": body.len() >= MAX_TEXT,
    });
    // Identity: Message-ID when the message has one, otherwise the UID triple.
    // IMAP UIDs are only unique inside one mailbox generation.
    let identity = if message_id.trim().is_empty() {
        format!("{}\n{}\nuid:{validity}:{uid}", config.id, config.folder)
    } else {
        format!("{}\n{}\n{}", config.id, config.folder, message_id.trim())
    };
    Ok(Some(RawMaterialDto {
        id: format!("mail-{}", db::calculate_hash(&identity)),
        source_type: "email".into(),
        title: if subject.trim().is_empty() {
            "(No subject)".into()
        } else {
            subject
        },
        source_url: None,
        raw_text: if body.trim().is_empty() {
            "(No readable text body)".into()
        } else {
            body.trim().to_string()
        },
        cleaned_markdown: None,
        content_hash: String::new(),
        media_path: None,
        media_size_bytes: 0,
        metadata_json: metadata.to_string(),
        inbox_status: "inbox".into(),
        created_at: time,
        updated_at: time,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::io::BufRead;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    const PASSWORD: &str = "fixture-secret-1";

    struct ServerState {
        validity: u32,
        messages: Vec<(u32, String)>,
        fail_fetch: Option<u32>,
    }

    struct FakeServer {
        port: u16,
        state: Arc<Mutex<ServerState>>,
        commands: Arc<Mutex<Vec<String>>>,
        stop: Arc<AtomicBool>,
        handle: Option<std::thread::JoinHandle<()>>,
    }

    impl FakeServer {
        fn start(validity: u32, messages: Vec<(u32, String)>) -> FakeServer {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
            let port = listener.local_addr().expect("addr").port();
            let state = Arc::new(Mutex::new(ServerState {
                validity,
                messages,
                fail_fetch: None,
            }));
            let commands = Arc::new(Mutex::new(Vec::new()));
            let stop = Arc::new(AtomicBool::new(false));
            let thread_state = state.clone();
            let thread_commands = commands.clone();
            let thread_stop = stop.clone();
            let handle = std::thread::spawn(move || {
                for stream in listener.incoming() {
                    if thread_stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let stream = match stream {
                        Ok(stream) => stream,
                        Err(_) => break,
                    };
                    let state = thread_state.clone();
                    let commands = thread_commands.clone();
                    std::thread::spawn(move || {
                        let _ = serve_connection(stream, state, commands);
                    });
                }
            });
            FakeServer {
                port,
                state,
                commands,
                stop,
                handle: Some(handle),
            }
        }

        fn commands(&self) -> Vec<String> {
            self.commands.lock().unwrap().clone()
        }

        fn set_validity(&self, validity: u32) {
            self.state.lock().unwrap().validity = validity;
        }

        fn set_fail_fetch(&self, uid: Option<u32>) {
            self.state.lock().unwrap().fail_fetch = uid;
        }
    }

    impl Drop for FakeServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            // Unblock the accept loop with a throwaway connection.
            let _ = TcpStream::connect(("127.0.0.1", self.port));
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    fn serve_connection(
        stream: std::net::TcpStream,
        state: Arc<Mutex<ServerState>>,
        commands: Arc<Mutex<Vec<String>>>,
    ) -> std::io::Result<()> {
        let mut writer = stream.try_clone()?;
        let mut reader = BufReader::new(stream);
        writer.write_all(b"* OK fixture ready\r\n")?;
        let mut line = String::new();
        loop {
            line.clear();
            let read = reader.read_line(&mut line)?;
            if read == 0 {
                return Ok(());
            }
            let command = line.trim_end().to_string();
            commands.lock().unwrap().push(command.clone());
            let upper = command.to_ascii_uppercase();
            let tag = command.split_whitespace().next().unwrap_or("K0000").to_string();
            if upper.contains("LOGIN") {
                let ok = command.contains(PASSWORD) && command.contains("fixture-user");
                let reply = if ok {
                    format!("{tag} OK LOGIN completed\r\n")
                } else {
                    format!("{tag} NO invalid credentials\r\n")
                };
                writer.write_all(reply.as_bytes())?;
            } else if upper.contains("EXAMINE") || upper.contains("SELECT") {
                let (validity, count) = {
                    let guard = state.lock().unwrap();
                    (guard.validity, guard.messages.len() as u32)
                };
                writer.write_all(
                    format!(
                        "* {count} EXISTS\r\n* OK [UIDVALIDITY {validity}] UIDs valid\r\n* OK [UIDNEXT {}] next\r\n{tag} OK [READ-ONLY] EXAMINE completed\r\n",
                        count as u32 + 1
                    )
                    .as_bytes(),
                )?;
            } else if upper.contains("UID SEARCH") {
                let after: u32 = command
                    .split_whitespace()
                    .nth(3)
                    .and_then(|value| value.trim_end_matches(":*").parse().ok())
                    .unwrap_or(1);
                let uids: Vec<u32> = {
                    let guard = state.lock().unwrap();
                    guard
                        .messages
                        .iter()
                        .map(|(uid, _)| *uid)
                        .filter(|uid| *uid >= after)
                        .collect()
                };
                let reply = if uids.is_empty() {
                    format!("* SEARCH\r\n{tag} OK SEARCH completed\r\n")
                } else {
                    format!(
                        "* SEARCH {}\r\n{tag} OK SEARCH completed\r\n",
                        uids.iter()
                            .map(|uid| uid.to_string())
                            .collect::<Vec<_>>()
                            .join(" ")
                    )
                };
                writer.write_all(reply.as_bytes())?;
            } else if upper.contains("RFC822.SIZE") {
                let uid = parse_uid(&command).unwrap_or(0);
                let size = {
                    let guard = state.lock().unwrap();
                    guard
                        .messages
                        .iter()
                        .find(|(candidate, _)| *candidate == uid)
                        .map(|(_, body)| body.len())
                        .unwrap_or(0)
                };
                writer.write_all(
                    format!("* {uid} FETCH (UID {uid} RFC822.SIZE {size})\r\n{tag} OK FETCH completed\r\n")
                        .as_bytes(),
                )?;
            } else if upper.contains("BODY.PEEK[]") {
                let uid = parse_uid(&command).unwrap_or(0);
                let guard = state.lock().unwrap();
                let fail = guard.fail_fetch == Some(uid);
                let body = guard
                    .messages
                    .iter()
                    .find(|(candidate, _)| *candidate == uid)
                    .map(|(_, body)| body.clone());
                drop(guard);
                match (fail, body) {
                    (true, _) => {
                        writer.write_all(format!("{tag} NO message unavailable\r\n").as_bytes())?;
                    }
                    (false, Some(body)) => {
                        writer.write_all(
                            format!("* {uid} FETCH (UID {uid} BODY[] {{{}}}\r\n", body.len()).as_bytes(),
                        )?;
                        writer.write_all(body.as_bytes())?;
                        writer.write_all(b")\r\n")?;
                        writer.write_all(format!("{tag} OK FETCH completed\r\n").as_bytes())?;
                    }
                    (false, None) => {
                        writer.write_all(format!("{tag} NO message unavailable\r\n").as_bytes())?;
                    }
                }
            } else {
                // Any mutating command must never appear in a real session.
                writer.write_all(format!("{tag} NO command not allowed\r\n").as_bytes())?;
            }
            writer.flush()?;
        }
    }

    fn parse_uid(command: &str) -> Option<u32> {
        let parts: Vec<&str> = command.split_whitespace().collect();
        let index = parts.iter().position(|part| part.eq_ignore_ascii_case("UID"))?;
        parts.get(index + 2).and_then(|value| value.parse().ok())
    }

    /// Plaintext loopback transport. Only compiled for tests: the production
    /// entry points always use verified TLS.
    fn connect_plaintext(config: &MailAccountConfig) -> MailResult<Imap> {
        let stream = TcpStream::connect((config.host.as_str(), config.port)).map_err(network_error)?;
        stream.set_read_timeout(Some(IO_TIMEOUT)).map_err(network_error)?;
        stream.set_write_timeout(Some(IO_TIMEOUT)).map_err(network_error)?;
        Imap::new(Box::new(stream))
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "knowflick-mail-{name}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn config(id: &str, port: u16) -> MailAccountConfig {
        MailAccountConfig {
            id: id.to_string(),
            name: "Fixture".into(),
            email: "reader@example.com".into(),
            host: "127.0.0.1".into(),
            port,
            username: "fixture-user".into(),
            folder: "INBOX".into(),
            sync_limit: 50,
        }
    }

    fn plain_message(subject: &str, body: &str) -> String {
        format!("Subject: {subject}\r\nFrom: sender@example.com\r\nTo: reader@example.com\r\nMessage-ID: <{subject}@example.com>\r\n\r\n{body}\r\n")
    }

    fn material_count(dir: &Path) -> usize {
        let conn = db::open_db(&dir.join("knowflick.db")).expect("db");
        db::list_materials(&conn, false, 1000).expect("materials").len()
    }

    fn material_rows(dir: &Path) -> Vec<RawMaterialDto> {
        let conn = db::open_db(&dir.join("knowflick.db")).expect("db");
        db::list_materials(&conn, false, 1000).expect("materials")
    }

    #[test]
    fn sync_imports_mail_once_and_dedupes_on_the_second_run() {
        let server = FakeServer::start(
            100,
            vec![
                (1, plain_message("First", "Hello from the first message")),
                (2, plain_message("Second", "Hello from the second message")),
            ],
        );
        let dir = temp_dir("sync");
        let id = uuid::Uuid::new_v4().to_string();
        let saved = save_account(&dir, config(&id, server.port), PASSWORD).expect("save");
        assert!(saved.has_password);

        let first = sync_using(&dir, &id, connect_plaintext).expect("first sync");
        assert_eq!(first.imported, 2);
        assert_eq!(first.skipped, 0);
        assert_eq!(material_count(&dir), 2);

        let second = sync_using(&dir, &id, connect_plaintext).expect("second sync");
        assert_eq!(second.imported, 0, "the second run must not import anything again");
        assert_eq!(material_count(&dir), 2);

        // The session only uses read-only commands.
        let commands = server.commands();
        assert!(commands.iter().all(|command| {
            let upper = command.to_ascii_uppercase();
            !(upper.contains("STORE")
                || upper.contains("DELETE")
                || upper.contains("EXPUNGE")
                || upper.contains("APPEND")
                || upper.contains("COPY")
                || upper.contains("RENAME"))
        }));
        assert!(commands.iter().any(|command| command.contains("EXAMINE")));
        assert!(commands.iter().any(|command| command.contains("UID SEARCH")));
        assert!(commands.iter().any(|command| command.contains("BODY.PEEK[]")));

        // The imported material carries the mail metadata.
        let rows = material_rows(&dir);
        let metadata: serde_json::Value =
            serde_json::from_str(&rows[0].metadata_json).expect("metadata");
        assert_eq!(rows[0].source_type, "email");
        assert_eq!(metadata["mailAccountId"], id.as_str());
        assert_eq!(metadata["folder"], "INBOX");
        assert_eq!(metadata["uidValidity"], 100);
        assert!(rows[0].raw_text.contains("Hello from the"));

        // The password is not in the database or in the exported archive.
        let db_bytes = fs::read(dir.join("knowflick.db")).expect("db bytes");
        assert!(!String::from_utf8_lossy(&db_bytes).contains(PASSWORD));
        let archive = dir.join("export.zip");
        crate::store::export_archive(&dir, &archive).expect("export");
        let archive_bytes = fs::read(&archive).expect("archive bytes");
        assert!(!String::from_utf8_lossy(&archive_bytes).contains(PASSWORD));
    }

    #[test]
    fn credentials_stay_out_of_sqlite_and_are_owner_only() {
        let dir = temp_dir("credentials");
        let id = uuid::Uuid::new_v4().to_string();
        save_account(&dir, config(&id, 993), PASSWORD).expect("save");
        let path = dir.join("credentials").join(format!("mail-{id}"));
        assert!(path.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "the credential file must be 0600");
            let dir_mode = fs::metadata(dir.join("credentials")).unwrap().permissions().mode();
            assert_eq!(dir_mode & 0o777, 0o700, "the credential directory must be 0700");
        }
        // The list output never carries the secret.
        let listed = list_accounts(&dir).expect("list");
        assert_eq!(listed.len(), 1);
        assert!(listed[0].has_password);
        let json = serde_json::to_string(&listed[0]).expect("json");
        assert!(!json.contains(PASSWORD));
    }

    #[test]
    fn missing_credentials_fail_with_a_bounded_error() {
        let dir = temp_dir("missing");
        let id = uuid::Uuid::new_v4().to_string();
        save_account(&dir, config(&id, 993), PASSWORD).expect("save");
        fs::remove_file(dir.join("credentials").join(format!("mail-{id}"))).expect("remove");
        let error = sync_using(&dir, &id, connect_plaintext).expect_err("must fail");
        assert!(error.contains("password"), "unexpected error: {error}");
        assert!(!error.contains(PASSWORD), "the error must not echo the secret");
    }

    /// A transport failure (the connection refused the FETCH) aborts the run:
    /// the connection itself is suspect, so guessing on would be unsafe. The
    /// cursor stays where it was, so the batch is retried once the server
    /// recovers and no message is lost.
    #[test]
    fn a_transport_failure_keeps_the_cursor_and_retries_the_batch() {
        let server = FakeServer::start(
            100,
            vec![
                (1, plain_message("First", "body one")),
                (2, plain_message("Second", "body two")),
            ],
        );
        let dir = temp_dir("failing-fetch");
        let id = uuid::Uuid::new_v4().to_string();
        save_account(&dir, config(&id, server.port), PASSWORD).expect("save");
        // The second message cannot be fetched.
        server.set_fail_fetch(Some(2));

        // Messages are processed oldest first, so the first one is stored and
        // the run then fails on the second.
        let error = sync_using(&dir, &id, connect_plaintext).expect_err("must fail");
        assert!(!error.contains(PASSWORD));
        assert_eq!(material_count(&dir), 1, "the message before the failure is kept");
        let conn = db::open_db(&dir.join("knowflick.db")).expect("db");
        let (validity, cursor): (Option<u32>, u32) = conn
            .query_row(
                "SELECT uid_validity,last_uid FROM mail_accounts WHERE id=?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("cursor");
        assert_eq!(validity, Some(100));
        assert_eq!(cursor, 1, "the cursor stops before the failed message");

        // The failed message is retried and imported once the server recovers.
        server.set_fail_fetch(None);
        let retried = sync_using(&dir, &id, connect_plaintext).expect("retry");
        assert_eq!(retried.imported, 1, "only the missing message is imported");
        assert_eq!(material_count(&dir), 2);
    }

    /// A message this account cannot read is quarantined and the run continues.
    /// Without this, one unreadable message would starve every other message.
    #[test]
    fn an_unreadable_message_is_quarantined_without_stopping_the_sync() {
        // A body with a broken transfer encoding cannot be decoded into text.
        let poison = "Subject: Poison\r\nMessage-ID: <poison@example.com>\r\n\
Content-Transfer-Encoding: base64\r\n\r\n!!!not base64!!!\r\n"
            .to_string();
        let server = FakeServer::start(
            100,
            vec![
                (1, plain_message("First", "body one")),
                (2, poison),
                (3, plain_message("Third", "body three")),
            ],
        );
        let dir = temp_dir("quarantine");
        let id = uuid::Uuid::new_v4().to_string();
        save_account(&dir, config(&id, server.port), PASSWORD).expect("save");

        // The unreadable message sits between two good ones; the run must
        // still import everything else.
        let result = sync_using(&dir, &id, connect_plaintext).expect("sync");
        assert_eq!(result.imported, 2, "the readable messages are imported");
        assert_eq!(result.rejected, 1, "the unreadable message is set aside");
        assert_eq!(material_count(&dir), 2);

        // The quarantined UID is not retried, and it no longer blocks the run.
        // The cursor already moved past every handled message, so the second
        // run has nothing left to look at.
        let second = sync_using(&dir, &id, connect_plaintext).expect("second sync");
        assert_eq!(second.imported, 0);
        assert_eq!(second.rejected, 0);
        assert_eq!(material_count(&dir), 2);
        let conn = db::open_db(&dir.join("knowflick.db")).expect("db");
        let rejected_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM mail_rejected", [], |row| row.get(0))
            .expect("rejected rows");
        assert_eq!(rejected_rows, 1, "the unreadable message is recorded once");
    }

    /// Re-pointing an account at another server must not reuse the old ledger:
    /// a different mailbox can hand out the same (UIDVALIDITY, UID) pair.
    #[test]
    fn changing_the_server_does_not_reuse_the_old_dedupe_ledger() {
        let server = FakeServer::start(100, vec![(1, plain_message("Old", "old body"))]);
        let dir = temp_dir("repurpose");
        let id = uuid::Uuid::new_v4().to_string();
        save_account(&dir, config(&id, server.port), PASSWORD).expect("save");
        sync_using(&dir, &id, connect_plaintext).expect("first account");
        assert_eq!(material_count(&dir), 1);

        // The same account id now points at a different mailbox with a different
        // host, so UID 1 there is unrelated mail and must be imported again.
        let mut moved = config(&id, server.port + 1);
        moved.host = "127.0.0.2".into();
        save_account(&dir, moved, PASSWORD).expect("move account");
        let conn = db::open_db(&dir.join("knowflick.db")).expect("db");
        let ledger: i64 = conn
            .query_row("SELECT COUNT(*) FROM mail_imports", [], |row| row.get(0))
            .expect("ledger");
        assert_eq!(ledger, 0, "the old dedupe ledger is discarded");
    }

    #[test]
    fn a_new_uidvalidity_restarts_the_scan_without_duplicating_mail() {
        let server = FakeServer::start(
            100,
            vec![(1, plain_message("First", "body one"))],
        );
        let dir = temp_dir("rollover");
        let id = uuid::Uuid::new_v4().to_string();
        save_account(&dir, config(&id, server.port), PASSWORD).expect("save");
        assert_eq!(sync_using(&dir, &id, connect_plaintext).expect("first").imported, 1);

        // The server renumbers the mailbox: same mail, new UIDVALIDITY and UIDs.
        server.set_validity(200);
        {
            let mut guard = server.state.lock().unwrap();
            guard.messages = vec![
                (1, plain_message("First", "body one")),
                (7, plain_message("Second", "body two")),
            ];
        }
        let result = sync_using(&dir, &id, connect_plaintext).expect("rollover");
        assert_eq!(result.imported, 1, "only the new message is imported");
        assert_eq!(result.skipped, 1, "the known message is skipped by its Message-ID");
        assert_eq!(material_count(&dir), 2);
    }

    #[test]
    fn wrong_credentials_are_reported_without_the_secret() {
        let server = FakeServer::start(100, vec![]);
        let dir = temp_dir("wrong-password");
        let id = uuid::Uuid::new_v4().to_string();
        let error = test_using(&dir, config(&id, server.port), "wrong-secret", connect_plaintext)
            .expect_err("must fail");
        assert!(!error.contains("wrong-secret"));
        assert!(error.contains("Mail server rejected"), "unexpected error: {error}");
    }

    #[test]
    fn a_working_account_reports_the_folder_size() {
        let server = FakeServer::start(100, vec![(1, plain_message("A", "a"))]);
        let dir = temp_dir("test-connection");
        let id = uuid::Uuid::new_v4().to_string();
        let summary = test_using(&dir, config(&id, server.port), PASSWORD, connect_plaintext)
            .expect("summary");
        assert_eq!(summary.account_id, id);
        assert_eq!(summary.folder, "INBOX");
        assert_eq!(summary.message_count, 1);
    }

    #[test]
    fn removing_an_account_drops_the_secret_but_keeps_the_materials() {
        let server = FakeServer::start(100, vec![(1, plain_message("A", "a"))]);
        let dir = temp_dir("remove");
        let id = uuid::Uuid::new_v4().to_string();
        save_account(&dir, config(&id, server.port), PASSWORD).expect("save");
        sync_using(&dir, &id, connect_plaintext).expect("sync");
        assert_eq!(material_count(&dir), 1);

        remove_account(&dir, &id).expect("remove");
        assert!(list_accounts(&dir).expect("list").is_empty());
        assert!(!dir.join("credentials").join(format!("mail-{id}")).exists());
        assert_eq!(material_count(&dir), 1, "imported mail is kept");
    }

    #[test]
    fn multipart_mail_prefers_plain_text_and_records_attachment_names() {
        let raw = "Subject: Mixed\r\nFrom: a@example.com\r\nMessage-ID: <mixed@example.com>\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"outer\"\r\n\r\n\
--outer\r\n\
Content-Type: multipart/alternative; boundary=\"inner\"\r\n\r\n\
--inner\r\n\
Content-Type: text/plain; charset=utf-8\r\n\r\n\
plain body wins\r\n\
--inner\r\n\
Content-Type: text/html; charset=utf-8\r\n\r\n\
<p>html body</p>\r\n\
--inner--\r\n\
--outer\r\n\
Content-Type: application/pdf; name=\"paper.pdf\"\r\n\
Content-Disposition: attachment; filename=\"paper.pdf\"\r\n\
Content-Transfer-Encoding: base64\r\n\r\n\
AAAA\r\n\
--outer--\r\n";
        let config = MailAccountConfig {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Fixture".into(),
            email: "reader@example.com".into(),
            host: "127.0.0.1".into(),
            port: 993,
            username: "fixture-user".into(),
            folder: "INBOX".into(),
            sync_limit: 50,
        };
        let material =
            material_from_mail(&config, 100, 5, raw.as_bytes()).expect("transport").expect("readable");
        assert!(material.raw_text.contains("plain body wins"));
        assert!(!material.raw_text.contains("html body"));
        let metadata: serde_json::Value =
            serde_json::from_str(&material.metadata_json).expect("metadata");
        assert_eq!(metadata["attachmentFilenames"][0], "paper.pdf");
        assert_eq!(metadata["uid"], 5);
    }

    #[test]
    fn html_only_mail_becomes_readable_text() {
        let raw = "Subject: HTML\r\nMessage-ID: <html@example.com>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
<html><body><p>Hello <b>world</b></p><script>alert(1)</script></body></html>\r\n";
        let config = MailAccountConfig {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Fixture".into(),
            email: "reader@example.com".into(),
            host: "127.0.0.1".into(),
            port: 993,
            username: "fixture-user".into(),
            folder: "INBOX".into(),
            sync_limit: 50,
        };
        let material = material_from_mail(&config, 100, 6, raw.as_bytes()).expect("transport").expect("readable");
        println!("HTML_OUTPUT={:?}", material.raw_text);
        assert!(material.raw_text.contains("Hello world"), "body: {:?}", material.raw_text);
        assert!(!material.raw_text.contains("alert(1)"));
        assert!(!material.raw_text.contains("**"), "the plain-text body must not show Markdown markers");
    }

    #[test]
    fn an_oversized_message_is_refused() {
        let raw = format!(
            "Subject: Huge\r\nMessage-ID: <huge@example.com>\r\n\r\n{}",
            "x".repeat(MAX_MESSAGE + 1024)
        );
        let config = MailAccountConfig {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Fixture".into(),
            email: "reader@example.com".into(),
            host: "127.0.0.1".into(),
            port: 993,
            username: "fixture-user".into(),
            folder: "INBOX".into(),
            sync_limit: 50,
        };
        // An over-long message is refused for this run, not a sync failure.
        let outcome = material_from_mail(&config, 100, 7, raw.as_bytes()).expect("transport");
        assert!(outcome.is_none(), "the oversized message must be skippable");
    }

    #[test]
    fn invalid_configurations_are_rejected() {
        let dir = temp_dir("validation");
        let id = uuid::Uuid::new_v4().to_string();
        let mut bad = config(&id, 993);
        bad.sync_limit = 0;
        assert!(save_account(&dir, bad, PASSWORD).is_err());
        let mut bad = config(&id, 993);
        bad.sync_limit = 500;
        assert!(save_account(&dir, bad, PASSWORD).is_err());
        let mut bad = config(&id, 993);
        bad.host = "imap.example.com:143".into();
        assert!(save_account(&dir, bad, PASSWORD).is_err());
        let mut bad = config(&id, 993);
        bad.email = "not-an-email".into();
        assert!(save_account(&dir, bad, PASSWORD).is_err());
        let mut bad = config("not-a-uuid", 993);
        bad.id = "../../etc/passwd".into();
        assert!(save_account(&dir, bad, PASSWORD).is_err());
    }

    #[test]
    fn saving_without_a_password_keeps_the_stored_one() {
        let dir = temp_dir("reuse");
        let id = uuid::Uuid::new_v4().to_string();
        save_account(&dir, config(&id, 993), PASSWORD).expect("save");
        let mut renamed = config(&id, 993);
        renamed.name = "Renamed".into();
        let saved = save_account(&dir, renamed, "").expect("save again");
        assert_eq!(saved.config.name, "Renamed");
        assert!(saved.has_password);

        // Changing the server requires the password again.
        let mut moved = config(&id, 143);
        moved.name = "Renamed".into();
        let error = save_account(&dir, moved, "").expect_err("must fail");
        assert!(error.contains("password"), "unexpected error: {error}");
    }

    #[test]
    fn mailbox_names_use_modified_utf7() {
        assert_eq!(mailbox_name("INBOX"), "INBOX");
        assert_eq!(mailbox_name("A&B"), "A&-B");
        // Modified UTF-7: UTF-16BE bytes in a modified base64 alphabet, "&" -> "&-".
        assert_eq!(mailbox_name("收件箱"), "&ZTZO9nux-");
    }

    #[test]
    fn the_login_command_never_leaks_into_results() {
        let server = FakeServer::start(100, vec![]);
        let dir = temp_dir("no-leak");
        let id = uuid::Uuid::new_v4().to_string();
        let _ = save_account(&dir, config(&id, server.port), PASSWORD);
        let _ = sync_using(&dir, &id, connect_plaintext);
        let listed = list_accounts(&dir).expect("list");
        let rendered = serde_json::to_string(&listed).expect("json");
        assert!(!rendered.contains(PASSWORD));
        let conn = db::open_db(&dir.join("knowflick.db")).expect("db");
        let (last_error,): (Option<String>,) = conn
            .query_row(
                "SELECT last_error FROM mail_accounts WHERE id=?1",
                [&id],
                |row| Ok((row.get(0)?,)),
            )
            .expect("error row");
        let error_text = last_error.unwrap_or_default();
        assert!(!error_text.contains(PASSWORD));
    }

    #[test]
    fn the_fixture_only_saw_read_only_commands() {
        let server = FakeServer::start(100, vec![(1, plain_message("A", "a"))]);
        let dir = temp_dir("readonly");
        let id = uuid::Uuid::new_v4().to_string();
        save_account(&dir, config(&id, server.port), PASSWORD).expect("save");
        sync_using(&dir, &id, connect_plaintext).expect("sync");
        let mut verbs: HashSet<String> = HashSet::new();
        for command in server.commands() {
            if let Some(verb) = command.split_whitespace().nth(1) {
                verbs.insert(verb.to_ascii_uppercase());
            }
        }
        assert!(verbs.contains("LOGIN"));
        assert!(verbs.contains("EXAMINE"));
        assert!(verbs.contains("UID"));
        for forbidden in ["STORE", "DELETE", "EXPUNGE", "APPEND", "COPY", "RENAME", "SELECT"] {
            assert!(!verbs.contains(forbidden), "the session used {forbidden}");
        }
    }

    #[test]
    fn the_sync_limit_caps_one_run() {
        let server = FakeServer::start(
            100,
            (1..=10)
                .map(|uid| (uid, plain_message(&format!("M{uid}"), "body")))
                .collect(),
        );
        let dir = temp_dir("limit");
        let id = uuid::Uuid::new_v4().to_string();
        let mut limited = config(&id, server.port);
        limited.sync_limit = 3;
        save_account(&dir, limited, PASSWORD).expect("save");
        let result = sync_using(&dir, &id, connect_plaintext).expect("sync");
        assert_eq!(result.imported, 3);
        assert_eq!(material_count(&dir), 3);
    }
}

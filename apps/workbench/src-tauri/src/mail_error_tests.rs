//! 用户看到的是**中文**。
//!
//! 邮件的这些校验错误以前是英文的（"Invalid account email"），
//! 前端的 `errorText()` 只做密钥脱敏、**不翻译**——于是英文原样显示给用户。
//! 一个中文软件里突然冒出英文错误，是「看不懂就卡住」的典型来源。
//!
//! 这几条测试是**防回退**的：以后有人加新校验又写成英文，这里会挡住。

use super::*;

/// 消息里含中文就算「面向用户」。
fn contains_chinese(text: &str) -> bool {
    text.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}

fn base_config() -> MailAccountConfig {
    MailAccountConfig {
        id: "6f1a5b3e-2c4d-4a8f-9e1b-7c5d2a9f0e33".into(),
        name: "测试账号".into(),
        email: "me@example.com".into(),
        host: "imap.example.com".into(),
        port: 993,
        username: "me@example.com".into(),
        folder: "INBOX".into(),
        sync_limit: 50,
        sync_interval_minutes: 0,
    }
}

#[test]
fn validation_errors_are_in_chinese() {
    // 邮箱格式不对
    let mut config = base_config();
    config.email = "not-an-email".into();
    let err = validate(config).unwrap_err();
    assert!(contains_chinese(&err), "邮箱校验错误应是中文，实际：{err}");

    // 主机名带 scheme
    let mut config = base_config();
    config.host = "https://imap.example.com".into();
    let err = validate(config).unwrap_err();
    assert!(contains_chinese(&err), "主机名校验错误应是中文，实际：{err}");

    // 端口越界
    let mut config = base_config();
    config.port = 0;
    let err = validate(config).unwrap_err();
    assert!(contains_chinese(&err), "端口校验错误应是中文，实际：{err}");

    // 同步上限越界
    let mut config = base_config();
    config.sync_limit = 0;
    let err = validate(config).unwrap_err();
    assert!(contains_chinese(&err), "同步上限校验错误应是中文，实际：{err}");

    // 账号 id 不是 UUID
    let mut config = base_config();
    config.id = "not-a-uuid".into();
    let err = validate(config).unwrap_err();
    assert!(contains_chinese(&err), "账号 id 校验错误应是中文，实际：{err}");
}

#[test]
fn password_errors_are_in_chinese() {
    let err = validate_password("").unwrap_err();
    assert!(contains_chinese(&err), "密码校验错误应是中文，实际：{err}");

    let err = validate_password("with\u{0}control").unwrap_err();
    assert!(contains_chinese(&err), "密码校验错误应是中文，实际：{err}");
}

/// 密码错误在**换服务器/用户名**时要提醒「再输一次」——那句以前也是英文的。
#[test]
fn password_reentry_hint_is_in_chinese() {
    assert!(
        contains_chinese(PASSWORD_REENTRY_HINT),
        "密码重输提示应是中文，实际：{PASSWORD_REENTRY_HINT}"
    );
}

//! 邮件落进收件箱时，**内容**也要是中文。
//!
//! 这一条和「错误消息要中文」是同一类问题，但更隐蔽：
//! 错误消息只在出错时出现，而**内容**是常态——
//! 一封无主题的邮件以前落成 `"(No subject)"`，收件箱里就**一直**写着它。

use super::*;

/// 一个可用的账号配置。
fn fixture_config(id: &str) -> MailAccountConfig {
    MailAccountConfig {
        id: id.to_string(),
        name: "Fixture".into(),
        email: "reader@example.com".into(),
        host: "127.0.0.1".into(),
        port: 993,
        username: "fixture-user".into(),
        folder: "INBOX".into(),
        sync_limit: 50,
        sync_interval_minutes: 0,
    }
}

/// 造一封最小可解析的邮件。
fn raw_message(subject: &str, body: &str) -> Vec<u8> {
    let mut out = String::new();
    out.push_str(&format!("Subject: {subject}\r\n"));
    out.push_str("From: sender@example.com\r\n");
    out.push_str("To: reader@example.com\r\n");
    out.push_str("Date: Wed, 23 Oct 2026 10:00:00 +0800\r\n");
    out.push_str("Message-ID: <probe-1@example.com>\r\n");
    out.push_str("MIME-Version: 1.0\r\n");
    out.push_str("Content-Type: text/plain; charset=utf-8\r\n");
    out.push_str("\r\n");
    out.push_str(body);
    out.into_bytes()
}

#[test]
fn 无主题的邮件标题是中文() {
    let cfg = fixture_config("mail-cn-title");
    let material = material_from_mail(&cfg, 1, 7, &raw_message("", "正文内容"))
        .expect("应能解析")
        .expect("应产出一条素材");
    assert!(
        material.title.contains("无主题"),
        "无主题邮件的标题应是中文，实际：{}",
        material.title
    );
    assert!(
        !material.title.contains("No subject"),
        "标题里不该再有英文占位：{}",
        material.title
    );
}

#[test]
fn 没有可读正文的邮件内容是中文() {
    let cfg = fixture_config("mail-cn-body");
    let material = material_from_mail(&cfg, 1, 8, &raw_message("标题", ""))
        .expect("应能解析")
        .expect("应产出一条素材");
    assert!(
        material.raw_text.contains("没有可读"),
        "无正文邮件的内容应是中文，实际：{}",
        material.raw_text
    );
    assert!(
        !material.raw_text.contains("No readable"),
        "内容里不该再有英文占位：{}",
        material.raw_text
    );
}

#[test]
fn 有主题有正文的邮件保持原样() {
    let cfg = fixture_config("mail-cn-normal");
    let material = material_from_mail(&cfg, 1, 9, &raw_message("季度计划", "下周一开始"))
        .expect("应能解析")
        .expect("应产出一条素材");
    assert_eq!(material.title, "季度计划");
    assert!(material.raw_text.contains("下周一开始"), "{}", material.raw_text);
}

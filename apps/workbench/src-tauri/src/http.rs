use std::time::Duration;

use encoding_rs::Encoding;

pub struct ClipPage {
    pub text: String,
    pub final_url: String,
}

pub async fn fetch_clip(raw: &str) -> Result<ClipPage, String> {
    let url = validate_url(raw)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", "KnowFlick/0.1")
        .send()
        .await
        .map_err(|err| format!("抓取失败: {err}"))?;
    let final_url = response.url().to_string();
    validate_url(&final_url)?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = read_capped(response, 4 * 1024 * 1024).await?;
    let text = decode_body(&bytes, &content_type);
    Ok(ClipPage { text, final_url })
}

pub async fn complete_chat(endpoint: &str, api_key: &str, body: String) -> Result<String, String> {
    validate_url(endpoint)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .header("User-Agent", "KnowFlick/0.1")
        .body(body);
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {api_key}"));
    }
    let response = request.send().await.map_err(|err| format!("AI 请求失败: {err}"))?;
    let status = response.status();
    let text = read_capped(response, 2 * 1024 * 1024).await?;
    let text = String::from_utf8_lossy(&text).to_string();
    if !status.is_success() {
        return Err(format!("API 返回 {}：{}", status.as_u16(), text.chars().take(200).collect::<String>()));
    }
    let content = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| {
            value["choices"][0]["message"]["content"]
                .as_str()
                .map(str::to_string)
        })
        .unwrap_or(text);
    Ok(content)
}

fn validate_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "链接无效".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("链接里不能带账号密码".to_string());
    }
    match url.scheme() {
        "https" => Ok(url),
        "http" => {
            let host = url.host_str().unwrap_or("");
            if host == "localhost" || host == "127.0.0.1" || host == "::1" {
                Ok(url)
            } else {
                Err("只有本机地址可以用 HTTP".to_string())
            }
        }
        _ => Err("只接受 http 或 https 链接".to_string()),
    }
}

async fn read_capped(response: reqwest::Response, max_bytes: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut stream = response;
    while let Some(chunk) = stream.chunk().await.map_err(|err| err.to_string())? {
        if bytes.len() + chunk.len() > max_bytes {
            return Err("响应超过大小上限".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn decode_body(bytes: &[u8], content_type: &str) -> String {
    let labeled = charset_from_header(content_type)
        .or_else(|| charset_from_meta(bytes))
        .and_then(|label| Encoding::for_label(label.as_bytes()));
    let encoding = labeled.unwrap_or(encoding_rs::UTF_8);
    let (text, _, _) = encoding.decode(bytes);
    text.to_string()
}

fn charset_from_header(content_type: &str) -> Option<String> {
    for part in content_type.split(';') {
        let part = part.trim();
        let lower = part.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("charset=") {
            return Some(value.trim_matches('"').to_string());
        }
    }
    None
}

/// 嗅探 `<meta charset>` 的窗口（字节）。**三处实现必须一致**：这里的 Rust 壳、Android 的
/// `WebClipEngine.kt`、前端的 `clipEngine.ts`——`tools/check_clip_parity.py` 会比对。
/// HTML 规范要求字符编码声明完整出现在文档前 1024 字节内，所以窗口就是 1024；
/// 放宽到 4096 只会多认一批不合规范的页面，而这里的解析是「找第一个 `charset=`」而非只认
/// `<meta>` 标签，窗口越大越容易误命中正文里讲编码的句子。
const META_SNIFF_BYTES: usize = 1024;

fn charset_from_meta(bytes: &[u8]) -> Option<String> {
    let head = &bytes[..bytes.len().min(META_SNIFF_BYTES)];
    let text = String::from_utf8_lossy(head).to_ascii_lowercase();
    let marker = "charset=";
    let start = text.find(marker)? + marker.len();
    let rest = text[start..].trim_start_matches(|ch: char| ch == '"' || ch == '\'');
    let end = rest.find(|ch: char| ch == '"' || ch == '\'' || ch == ' ' || ch == '>' || ch == ';')?;
    Some(rest[..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::{charset_from_header, charset_from_meta, decode_body, validate_url, META_SNIFF_BYTES};

    #[test]
    fn validate_url_allows_https_and_local_http() {
        assert!(validate_url("https://example.com/a").is_ok());
        assert!(validate_url("http://127.0.0.1:8080/x").is_ok());
    }

    #[test]
    fn validate_url_rejects_credentials_and_remote_http() {
        assert!(validate_url("https://user:pw@example.com").is_err());
        assert!(validate_url("http://example.com").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn decode_body_sniffs_charset() {
        assert_eq!(charset_from_header("text/html; charset=GBK").map(|s| s.to_ascii_lowercase()), Some("gbk".to_string()));
        let html = b"<html><head><meta charset=\"gbk\"></head></html>";
        assert_eq!(charset_from_meta(html), Some("gbk".to_string()));
        let text = decode_body(b"\xe4\xbd\xa0\xe5\xa5\xbd", "text/html; charset=utf-8");
        assert_eq!(text, "你好");
    }

    #[test]
    fn meta_sniffing_stops_at_the_shared_window() {
        // 窗口大小是跨端契约（三处实现一致，`tools/check_clip_parity.py` 守着）：
        // 声明落在窗口内能认出，越界就不认——否则同一页在三个实现上可能解出不同编码。
        let inside = format!("<html><head>{}<meta charset=\"gbk\">", " ".repeat(META_SNIFF_BYTES - 40));
        assert_eq!(charset_from_meta(inside.as_bytes()), Some("gbk".to_string()));
        let outside = format!("<html><head>{}<meta charset=\"gbk\">", " ".repeat(META_SNIFF_BYTES + 10));
        assert_eq!(charset_from_meta(outside.as_bytes()), None);
    }
}

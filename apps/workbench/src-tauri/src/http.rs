use std::time::Duration;

use encoding_rs::Encoding;

pub struct ClipPage {
    pub text: String,
    pub final_url: String,
}

pub async fn fetch_clip(raw: &str) -> Result<ClipPage, String> {
    let url = validate_url(raw)?;
    let client = client_for(
        &url,
        Duration::from_secs(15),
        Some(reqwest::redirect::Policy::limited(5)),
    )?;
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

/// 抹掉服务端错误原文里可能出现的凭据。
///
/// 与前端 `redactSecrets` 同一套规则：界面上的密钥一旦被截图或分享就泄露了。
/// 邮箱侧早定了「错误不回显密钥」的原则（docs/EMAIL_INTEGRATION.md），AI 侧对齐。
///
/// 纯字符串扫描实现，不引入 regex 依赖（这台工程刻意保持依赖少）。
pub fn redact_secrets(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let bytes: Vec<char> = text.chars().collect();
    let mut i = 0usize;
    while i < bytes.len() {
        let rest: String = bytes[i..].iter().collect();
        // Bearer 后的整串（按字符比较，别用字节切片——错误原文可能是中文）
        if rest.len() >= 7 && rest.chars().take(7).collect::<String>().eq_ignore_ascii_case("bearer ") {
            out.push_str("Bearer [已隐藏的密钥]");
            // 跳过 token 本体
            let mut j = i + 7;
            while j < bytes.len() && is_secret_char(bytes[j]) {
                j += 1;
            }
            i = j;
            continue;
        }
        // 带常见前缀的 key：sk-、sk-proj-、gsk_、xai-、api_ 等
        if let Some(len) = prefixed_key_len(&bytes, i) {
            out.push_str("[已隐藏的密钥]");
            i += len;
            continue;
        }
        // 长随机串（32 位以上）多半是凭据
        if is_secret_char(bytes[i]) {
            let mut j = i;
            while j < bytes.len() && is_secret_char(bytes[j]) {
                j += 1;
            }
            if j - i >= 32 {
                out.push_str("[已隐藏的长串]");
                i = j;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

fn is_secret_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.'
}

/// 若从 `at` 开始是一个「带前缀的密钥」，返回它的长度；否则返回 None。
fn prefixed_key_len(chars: &[char], at: usize) -> Option<usize> {
    const PREFIXES: [&str; 5] = ["sk", "rk", "gsk", "xai", "api"];
    for prefix in PREFIXES {
        let plen = prefix.chars().count();
        if at + plen + 1 > chars.len() {
            continue;
        }
        // 前缀都是 ASCII，但**后面**可能接着中文——按字符切，不要用字节索引。
        let head: String = chars[at..at + plen].iter().collect();
        if !head.eq_ignore_ascii_case(prefix) {
            continue;
        }
        let sep = chars[at + plen];
        if sep != '-' && sep != '_' {
            continue;
        }
        let mut j = at + plen + 1;
        while j < chars.len() && is_secret_char(chars[j]) {
            j += 1;
        }
        if j - (at + plen + 1) >= 8 {
            return Some(j - at);
        }
    }
    None
}

pub async fn complete_chat(endpoint: &str, api_key: &str, body: String) -> Result<String, String> {
    validate_url(endpoint)?;
    let client = client_for(
        &reqwest::Url::parse(endpoint).map_err(|_| "链接无效".to_string())?,
        Duration::from_secs(120),
        None,
    )?;
    let mut request = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .header("User-Agent", "KnowFlick/0.1")
        .body(body);
    if endpoint.contains("anthropic.com") {
        request = request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01");
    } else if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {api_key}"));
    }
    let response = request.send().await.map_err(|err| format!("AI 请求失败: {err}"))?;
    let status = response.status();
    let text = read_capped(response, 2 * 1024 * 1024).await?;
    let text = String::from_utf8_lossy(&text).to_string();
    if !status.is_success() {
        // 服务端原文里可能带着 API key（部分服务商在 401 里会回显）。
        // 邮箱侧定的原则是「错误不回显密钥」，这里同一标准：抹掉再给界面。
        return Err(format!(
            "API 返回 {}：{}",
            status.as_u16(),
            redact_secrets(&text).chars().take(200).collect::<String>()
        ));
    }
    let content = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| {
            if let Some(c) = value["choices"][0]["message"]["content"].as_str() {
                return Some(c.to_string());
            }
            if let Some(c) = value["content"][0]["text"].as_str() {
                return Some(c.to_string());
            }
            None
        })
        .unwrap_or(text);
    Ok(content)
}

pub async fn request_embeddings(
    endpoint: &str,
    api_key: &str,
    model: &str,
    input: Vec<String>,
) -> Result<Vec<Vec<f32>>, String> {
    validate_url(endpoint)?;
    let client = client_for(
        &reqwest::Url::parse(endpoint).map_err(|_| "链接无效".to_string())?,
        Duration::from_secs(60),
        None,
    )?;

    let body = serde_json::json!({
        "model": model,
        "input": input,
    });

    let mut request = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .header("User-Agent", "KnowFlick/0.1")
        .body(body.to_string());

    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {api_key}"));
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("Embedding 请求失败: {err}"))?;
    let status = response.status();
    let text = read_capped(response, 10 * 1024 * 1024).await?;
    let text = String::from_utf8_lossy(&text).to_string();
    if !status.is_success() {
        // 与 complete_chat 同理：服务端原文可能带着 API key，
        // 而这条错误会被 console.warn 打出来（用户报 bug 时会把控制台贴出去）。
        return Err(format!(
            "Embedding API 返回 {}：{}",
            status.as_u16(),
            redact_secrets(&text).chars().take(200).collect::<String>()
        ));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| crate::error_text::explain("解析 Embedding 响应 JSON 失败", &e))?;

    let data = parsed["data"]
        .as_array()
        .ok_or_else(|| "Embedding 响应缺少 data 数组".to_string())?;

    let mut embeddings = Vec::with_capacity(data.len());
    for item in data {
        let vec = item["embedding"]
            .as_array()
            .ok_or_else(|| "Embedding 条目缺少 embedding 浮点数组".to_string())?;
        let f32_vec: Result<Vec<f32>, String> = vec
            .iter()
            .map(|v| {
                v.as_f64()
                    .map(|f| f as f32)
                    .ok_or_else(|| "非浮点数".to_string())
            })
            .collect();
        embeddings.push(f32_vec?);
    }
    Ok(embeddings)
}

/// 本机地址（回环）判定：这些地址永远**直连**，不走任何代理。
///
/// 为什么要单列：用户设了 `HTTP_PROXY` 时，reqwest 默认会把请求交给代理，
/// 于是「本地模型」（`http://127.0.0.1:11434`、`http://[::1]:11434`）的请求
/// 会被送到代理而不是本机服务——连接测试报「抓取失败」，而用户看不出原因。
/// 只有回环走直连；外部站点仍按系统代理走，用户配的代理照常生效。
fn is_loopback_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host == "localhost" || host == "127.0.0.1" {
        return true;
    }
    // IPv6 回环：规范化后是 ::1，但用户也可能写成 0:0:0:0:0:0:0:1。
    // 交给地址解析器判断，不做字符串比较。
    match host.parse::<std::net::Ipv6Addr>() {
        Ok(address) => address.is_loopback(),
        Err(_) => false,
    }
}

/// 是否让这次请求**绕过代理**。
///
/// 只有回环地址绕过：本地模型就跑在本机，走代理只会失败。
/// 外部地址保留系统代理——用户配的代理对剪藏外站必须照常生效。
fn bypasses_proxy(url: &reqwest::Url) -> bool {
    is_loopback_host(url.host_str().unwrap_or(""))
}

/// 按目标地址选客户端：回环直连，其余跟随系统代理。
///
/// `redirect` 只给剪藏用（跟随跳转后再校验最终地址）；模型请求不跟随跳转。
fn client_for(
    url: &reqwest::Url,
    timeout: Duration,
    redirect: Option<reqwest::redirect::Policy>,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(timeout);
    if bypasses_proxy(url) {
        builder = builder.no_proxy();
    }
    if let Some(policy) = redirect {
        builder = builder.redirect(policy);
    }
    builder.build().map_err(|err| err.to_string())
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
            // url::Url::host_str keeps IPv6 brackets and normalizes expanded ::1.
            if is_loopback_host(host) {
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
    use super::{charset_from_header, charset_from_meta, decode_body, redact_secrets, validate_url, META_SNIFF_BYTES};
    use std::time::Duration;

    #[test]
    fn redacts_prefixed_api_keys() {
        let text = "Incorrect API key provided: sk-proj-abc123DEF456ghi789. Check your dashboard.";
        let out = redact_secrets(text);
        assert!(!out.contains("sk-proj-abc123DEF456ghi789"), "不该回显密钥：{out}");
        assert!(out.contains("[已隐藏的密钥]"), "{out}");
        assert!(out.contains("Check your dashboard."), "其余原文要保留：{out}");
    }

    #[test]
    fn redacts_bearer_tokens() {
        let out = redact_secrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdefgh");
        assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9"), "{out}");
    }

    #[test]
    fn embeddings_api_error_path_does_not_leak_key() {
        // 这条错误会被 console.warn 打出来（用户报 bug 时会把控制台贴出去），
        // 所以和 complete_chat 一样不能带出服务端原文里的密钥。
        // 走**真实调用链**：本地起一个回 401 且回显 key 的服务器。
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = r#"{"error":{"message":"Incorrect API key provided: {{API_KEY_1uv3bev0}}."}}"#;
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 8192];
                let _ = std::io::Read::read(&mut stream, &mut buf);
                let response = format!(
                    "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = std::io::Write::write_all(&mut stream, response.as_bytes());
            }
        });

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let url = format!("http://{addr}/v1/embeddings");
        let result = runtime.block_on(super::request_embeddings(&url, "sk-key", "text-embedding-3-small", vec!["hi".to_string()]));
        handle.join().unwrap();

        let err = result.unwrap_err();
        assert!(err.contains("401"), "应带状态码：{err}");
        assert!(!err.contains("{{API_KEY_1uv3bev0}}"), "不该回显密钥：{err}");
    }

    #[test]
    fn ipv6_loopback_requests_reach_local_service_without_key() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::{Duration, Instant};

        let listener = TcpListener::bind("[::1]:0").expect("IPv6 loopback listener");
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || -> Result<Vec<String>, String> {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut requests = Vec::new();
            for body in [
                r#"{"choices":[{"message":{"content":"IPv6 local OK"}}]}"#,
                r#"{"data":[{"embedding":[0.25,0.75]}]}"#,
                "<html><body>IPv6 local page</body></html>",
            ] {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                            if Instant::now() >= deadline {
                                return Err("本地服务没有收到预期的请求".into());
                            }
                            std::thread::sleep(Duration::from_millis(10));
                        }
                        Err(err) => return Err(err.to_string()),
                    }
                };
                stream.set_nonblocking(false).map_err(|e| e.to_string())?;
                stream.set_read_timeout(Some(Duration::from_secs(2))).map_err(|e| e.to_string())?;
                stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|e| e.to_string())?;
                let mut request = Vec::new();
                loop {
                    let mut buffer = [0; 2048];
                    let size = stream.read(&mut buffer).map_err(|e| e.to_string())?;
                    if size == 0 { return Err("HTTP 请求不完整".into()); }
                    request.extend_from_slice(&buffer[..size]);
                    if request.len() > 64 * 1024 { return Err("HTTP 请求过大".into()); }
                    if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]);
                        let length = headers.lines().find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            if name.eq_ignore_ascii_case("content-length") {
                                value.trim().parse::<usize>().ok()
                            } else { None }
                        }).unwrap_or(0);
                        if request.len() >= end + 4 + length { break; }
                    }
                }
                requests.push(String::from_utf8(request).map_err(|e| e.to_string())?);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(), body
                );
                stream.write_all(response.as_bytes()).map_err(|e| e.to_string())?;
            }
            Ok(requests)
        });
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let (chat, vectors, page) = runtime.block_on(async {
            let chat = super::complete_chat(&format!("http://{address}/v1/chat/completions"), "", "{}".into()).await;
            let vectors = super::request_embeddings(&format!("http://{address}/v1/embeddings"), "", "local", vec!["note".into()]).await;
            let page = super::fetch_clip(&format!("http://{address}/page")).await;
            (chat, vectors, page)
        });
        let requests = server.join().unwrap().expect("Local service received all three requests");
        assert_eq!(chat.unwrap(), "IPv6 local OK");
        assert_eq!(vectors.unwrap(), vec![vec![0.25_f32, 0.75_f32]]);
        assert!(page.unwrap().text.contains("IPv6 local page"));
        assert_eq!(requests.len(), 3);
        assert!(requests[0].starts_with("POST /v1/chat/completions "));
        assert!(requests[1].starts_with("POST /v1/embeddings "));
        assert!(requests[2].starts_with("GET /page "));
        for request in requests {
            assert!(!request.to_ascii_lowercase().contains("authorization:"));
        }
    }

    #[test]
    fn only_loopback_addresses_bypass_the_proxy() {
        // 用户设了 HTTP_PROXY 时，reqwest 默认把请求交给代理——于是本地模型
        // （http://127.0.0.1:11434）的请求会被送到代理而不是本机服务，
        // 连接测试报「抓取失败」，而用户看不出原因。
        //
        // 绕过代理的**范围**必须精确：只有回环绕过。外部地址绕过的话，
        // 用户配的代理对剪藏外站就失效了——那是更大的问题。
        for raw in [
            "http://127.0.0.1:11434/v1",
            "http://localhost:11434/v1",
            "http://[::1]:11434/v1",
            "http://[0:0:0:0:0:0:0:1]:11434/v1",
        ] {
            let url = reqwest::Url::parse(raw).unwrap();
            assert!(super::bypasses_proxy(&url), "回环该绕过代理：{raw}");
        }
        for raw in [
            "https://api.example.test/v1",
            "http://example.test/x",
            "http://192.168.1.10:11434/v1",
            "http://[2001:db8::1]:11434/v1",
        ] {
            let url = reqwest::Url::parse(raw).unwrap();
            assert!(!super::bypasses_proxy(&url), "外部地址不该绕过代理：{raw}");
        }
    }

    #[test]
    fn loopback_requests_bypass_ambient_proxy_settings() {
        // 本机服务在回环上监听；若客户端把请求交给代理，这个监听收不到。
        // 用例不依赖环境是否设了代理变量：本机默认就有 HTTP_PROXY，
        // 而显式清空 NO_PROXY 时更严格（回环也不再被排除）。
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || -> Option<String> {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).ok();
                        let mut buf = [0u8; 8192];
                        use std::io::Read;
                        let _ = stream.read(&mut buf);
                        let body = r#"{"choices":[{"message":{"content":"direct"}}]}"#;
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        use std::io::Write;
                        let _ = stream.write_all(response.as_bytes());
                        return Some(body.to_string());
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        if std::time::Instant::now() >= deadline {
                            return None;
                        }
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    Err(_) => return None,
                }
            }
        });
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let url = format!("http://{address}/v1/chat/completions");
        let result = runtime.block_on(async {
            tokio::time::timeout(Duration::from_secs(5), super::complete_chat(&url, "", "{}".into())).await
        });
        let served = handle.join().unwrap();
        assert!(served.is_some(), "本机监听没收到请求：回环请求被送去了代理");
        assert_eq!(result.expect("不应超时").unwrap(), "direct");
    }

    #[test]
    fn loopback_detection_covers_ipv4_and_ipv6_forms() {
        for host in ["localhost", "127.0.0.1", "::1", "[::1]", "0:0:0:0:0:0:0:1"] {
            assert!(super::is_loopback_host(host), "应算回环：{host}");
        }
        for host in ["example.com", "192.168.1.10", "[2001:db8::1]", "[::]", "10.0.0.1"] {
            assert!(!super::is_loopback_host(host), "不该算回环：{host}");
        }
    }

    #[test]
    fn prints_loopback_verdicts_for_cross_platform_parity() {
        // 常驻的对照探针：`tools/check_loopback_parity.mjs` 跑 Rust 测试时
        // 读它的输出，与 TypeScript 侧逐条比对。
        //
        // 为什么是常驻测试而不是临时插桩：临时改 http.rs 会让 cargo **重新编译**
        // 整个 crate 依赖树——CI 上一次门禁要多花十几分钟，实测把 Linux job
        // 顶到 25 分钟上限之外。常驻测试只需一次增量编译。
        for host in [
            "127.0.0.1",
            "localhost",
            "::1",
            "[::1]",
            "0:0:0:0:0:0:0:1",
            "[0:0:0:0:0:0:0:1]",
            "::",
            "[::]",
            "::ffff:127.0.0.1",
            "[::ffff:7f00:1]",
            "[2001:db8::1]",
            "192.168.1.10",
            "10.0.0.1",
            "example.com",
            "",
            "not a host",
        ] {
            println!("PARITY\t{}\t{}", host, super::is_loopback_host(host));
        }
    }

    #[test]
    fn keeps_ordinary_error_text() {
        let text = "模型 120 秒没有响应，已中止。可以先检查网络。";
        assert_eq!(redact_secrets(text), text);
    }

    #[test]
    fn validate_url_allows_https_and_local_http() {
        assert!(validate_url("https://example.com/a").is_ok());
        assert!(validate_url("http://127.0.0.1:8080/x").is_ok());
        assert!(validate_url("http://[::1]:8080/x").is_ok());
        assert!(validate_url("http://[0:0:0:0:0:0:0:1]:8080/x").is_ok());
    }

    #[test]
    fn validate_url_rejects_credentials_and_remote_http() {
        assert!(validate_url("https://user:pw@example.com").is_err());
        assert!(validate_url("http://example.com").is_err());
        assert!(validate_url("http://[2001:db8::1]/x").is_err());
        assert!(validate_url("http://[::]/x").is_err());
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

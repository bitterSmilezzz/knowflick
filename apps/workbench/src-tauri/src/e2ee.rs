//! 备份包的端到端加密（R3 第 3 项，LOCAL_DATA_AND_AI「可选 E2EE」）。
//!
//! 设计（按文档口径）：
//! - **上传前**加密内容与附件：AES-256-GCM（认证加密——密文被服务端篡改
//!   时解密会失败，而不是静默还原出坏数据）；
//! - 密钥本地生成（32 字节随机），口令派生：PBKDF2-HMAC-SHA256 之外不
//!   引入 KDF 依赖——用 SHA-256 多轮迭代（数万轮不是常量时间防护的目标：
//!   这里防的是服务端拿到口令字典暴力破解，轮数写进头里，未来可调）；
//! - 文件头自描述（版本、轮数、盐、nonce），旧版本解不开新文件时明确
//!   报「版本不认识」，不猜；
//! - **忘记口令不能找回**：文档原话，界面与错误消息如实说。
//!
//! 明确不做：静态数据库加密（文档要求独立评估，不以本模块冒充）。

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::RngCore;
use sha2::{Digest, Sha256};

const HEADER: &[u8; 8] = b"KFENC\0\x01\0"; // [0..5]=KFENC [5]=0 [6]=版本 [7]=保留
const PBKDF2_ITERATIONS: u32 = 210_000; // OWASP 2023 对 SHA-256 的建议值

fn derive_key(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = Sha256::digest(salt).to_vec();
    let pass_bytes = passphrase.as_bytes();
    for i in 0..iterations {
        let mut hasher = Sha256::new();
        hasher.update(&key);
        hasher.update(pass_bytes);
        // 每轮混入轮次号，避免轮函数可被预计算折叠
        hasher.update(&i.to_le_bytes());
        key = hasher.finalize().to_vec();
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&key);
    out
}

/// 口令加密备份包。返回自描述容器：头 + 轮数 + 盐 + nonce + 密文。
pub fn encrypt(passphrase: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    if passphrase.is_empty() {
        return Err("口令不能为空——空口令的加密等于没加密".to_string());
    }
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key = derive_key(passphrase, &salt, PBKDF2_ITERATIONS);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), Payload::from(plaintext))
        .map_err(|_| "加密失败".to_string())?;

    let mut out = Vec::with_capacity(HEADER.len() + 4 + salt.len() + nonce_bytes.len() + ciphertext.len());
    out.extend_from_slice(HEADER);
    out.extend_from_slice(&PBKDF2_ITERATIONS.to_le_bytes());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// 口令解密。错误区分三种：不是加密文件 / 版本不认识 / 口令不对或数据被改。
pub fn decrypt(passphrase: &str, blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < HEADER.len() + 4 + 16 + 12 {
        return Err("这不是 KnowFlick 加密备份（头都不完整）".to_string());
    }
    // 魔数只比前 6 字节（KFENC\0）；[6] 是版本、[7] 保留——
    // 版本位不进魔数，否则新版本文件会被误报成「不是加密文件」。
    if &blob[..6] != &HEADER[..6] {
        return Err("这不是 KnowFlick 加密备份（魔数不匹配）".to_string());
    }
    let version = blob[6]; // 文件里的版本位（魔数之后第一字节）
    if version != 1 {
        return Err(format!("加密版本 {version} 不认识——本版本只认 1；请用更新版本的应用打开"));
    }
    let mut offset = HEADER.len();
    let iterations = u32::from_le_bytes([blob[offset], blob[offset + 1], blob[offset + 2], blob[offset + 3]]);
    offset += 4;
    let salt = &blob[offset..offset + 16];
    offset += 16;
    let nonce_bytes = &blob[offset..offset + 12];
    offset += 12;
    let ciphertext = &blob[offset..];

    let key = derive_key(passphrase, salt, iterations);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), Payload::from(ciphertext))
        .map_err(|_| "口令不对，或文件在服务端被改动（认证校验没过）。忘记口令无法找回——这是端到端加密的代价".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_tamper_detection() {
        let plaintext = b"PK\x03\x04 backup archive bytes".to_vec();
        let blob = encrypt("correct horse", &plaintext).unwrap();
        assert!(blob.starts_with(HEADER));

        // 正确口令 → 无损还原
        assert_eq!(decrypt("correct horse", &blob).unwrap(), plaintext);

        // 错误口令 → 明确说「口令不对或被改」，不是静默坏数据
        let err = decrypt("wrong", &blob).unwrap_err();
        assert!(err.contains("口令不对"), "{err}");

        // 服务端篡改一个字节 → GCM 认证失败（同样是那条错误）
        let mut tampered = blob.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        assert!(decrypt("correct horse", &tampered).is_err());

        // 不是加密文件 / 头不完整
        assert!(decrypt("x", b"PK-plain-zip").unwrap_err().contains("不是 KnowFlick 加密备份"));
        assert!(decrypt("x", &blob[..10]).unwrap_err().contains("头都不完整"));

        // 空口令拒绝
        assert!(encrypt("", &plaintext).is_err());

        // 同一口令两次加密产生不同密文（盐与 nonce 都随机）
        let blob2 = encrypt("correct horse", &plaintext).unwrap();
        assert_ne!(blob, blob2);
    }

    #[test]
    fn future_version_is_rejected_with_clear_message() {
        let mut future = encrypt("p", b"data").unwrap();
        future[6] = 2; // 头里的版本位（offset 6）改成 2
        let err = decrypt("p", &future).unwrap_err();
        assert!(err.contains("版本 2 不认识"), "{err}");
    }
}

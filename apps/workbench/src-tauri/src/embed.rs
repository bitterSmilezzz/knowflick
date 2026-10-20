//! 本地语义向量推理（M3「本地轻量 Embedding 推理」）。
//!
//! 为什么单独一个模块：向量空间必须唯一确定。API 嵌入、本地嵌入、以及没有模型时的
//! 确定性哈希投影，三者产出的向量**不在同一个空间**，跨空间算余弦没有意义。
//! 所以这里固定用一个模型（`MultilingualE5Small`，384 维），并把维度暴露给上层：
//! 检索时只比较同维度的向量，换引擎时按维度标脏重算。
//!
//! 模型权重不随包，首次使用时由用户点「下载」触发；缓存在 `<data_root>/models/fastembed`。

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

/// 本地嵌入模型标识。改了它等于换了向量空间，必须让旧向量失效。
pub const LOCAL_MODEL_ID: &str = "multilingual-e5-small";
/// 该模型输出的向量维度。
pub const LOCAL_MODEL_DIM: usize = 384;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalEmbedStatus {
    pub model: String,
    pub dim: usize,
    /// 模型权重是否已经在本地缓存目录里。
    pub downloaded: bool,
    pub cache_dir: String,
}

pub fn cache_dir(data_root: &Path) -> PathBuf {
    data_root.join("models").join("fastembed")
}

/// 判断模型是否已下载：fastembed 把权重放在 `<cache>/models--<repo>` 下。
pub fn is_downloaded(data_root: &Path) -> bool {
    let dir = cache_dir(data_root);
    if !dir.exists() {
        return false;
    }
    // 只要缓存目录里出现过任一 *.onnx 权重就算下载过；具体文件名由 fastembed 决定，
    // 这里不去猜它的目录结构。
    fn has_onnx(dir: &Path) -> bool {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return false;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if has_onnx(&path) {
                    return true;
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("onnx") {
                return true;
            }
        }
        false
    }
    has_onnx(&dir)
}

pub fn status(data_root: &Path) -> LocalEmbedStatus {
    LocalEmbedStatus {
        model: LOCAL_MODEL_ID.to_string(),
        dim: LOCAL_MODEL_DIM,
        downloaded: is_downloaded(data_root),
        cache_dir: cache_dir(data_root).to_string_lossy().to_string(),
    }
}

/// 进程内只保留一份模型（加载一次约几十 MB 内存，反复加载不可接受）。
fn engine(data_root: &Path) -> Result<&'static Mutex<fastembed::TextEmbedding>, String> {
    static INSTANCE: OnceLock<Result<Mutex<fastembed::TextEmbedding>, String>> = OnceLock::new();
    let shared = INSTANCE.get_or_init(|| {
        use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
        let dir = cache_dir(data_root);
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建模型缓存目录失败: {e}"))?;
        let model = TextEmbedding::try_new(
            InitOptions::new(EmbeddingModel::MultilingualE5Small)
                .with_cache_dir(dir)
                .with_show_download_progress(false),
        )
        .map_err(|e| format!("加载本地嵌入模型失败（先下载模型）: {e}"))?;
        Ok(Mutex::new(model))
    });
    match shared {
        Ok(mutex) => Ok(mutex),
        Err(err) => Err(err.clone()),
    }
}

/// E5 系列模型区分 query / passage 前缀；不加前缀会明显掉检索质量。
fn with_prefix(text: &str, is_query: bool) -> String {
    let prefix = if is_query { "query: " } else { "passage: " };
    format!("{prefix}{text}")
}

/// 批量生成向量。`is_query` 为真时按查询侧前缀处理。
///
/// `allow_download` 决定没权重时是「拒绝」还是「顺手下载」：
/// 检索路径必须传 false（用户搜一下不该静默拉百 MB），只有显式下载/预热才传 true。
pub fn embed(
    data_root: &Path,
    texts: Vec<String>,
    is_query: bool,
    allow_download: bool,
) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    if !allow_download && !is_downloaded(data_root) {
        return Err("本地语义模型尚未下载".to_string());
    }
    let mutex = engine(data_root)?;
    let prepared: Vec<String> = texts.iter().map(|t| with_prefix(t, is_query)).collect();
    let mut guard = mutex
        .lock()
        .map_err(|_| "本地嵌入模型状态异常（锁被污染）".to_string())?;
    guard
        .embed(prepared, None)
        .map_err(|e| format!("本地嵌入失败: {e}"))
}

/// 单纯触发一次加载，用于「下载模型」按钮——顺带验证模型真的能跑起来。
pub fn warm_up(data_root: &Path) -> Result<LocalEmbedStatus, String> {
    let _ = embed(data_root, vec!["预热".to_string()], false, true)?;
    Ok(status(data_root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_reports_missing_before_download() {
        let dir = std::env::temp_dir().join(format!("kf-embed-{}", uuid::Uuid::new_v4()));
        let s = status(&dir);
        assert_eq!(s.model, LOCAL_MODEL_ID);
        assert_eq!(s.dim, LOCAL_MODEL_DIM);
        assert!(!s.downloaded);
        let expected_suffix = PathBuf::from("models").join("fastembed");
        assert!(Path::new(&s.cache_dir).ends_with(&expected_suffix));
    }

    #[test]
    fn detects_downloaded_weights_in_nested_cache() {
        let dir = std::env::temp_dir().join(format!("kf-embed-{}", uuid::Uuid::new_v4()));
        let nested = cache_dir(&dir).join("models--intfloat--multilingual-e5-small").join("onnx");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(!is_downloaded(&dir), "只有空目录不算下载过");
        std::fs::write(nested.join("model.onnx"), b"fake weights").unwrap();
        assert!(is_downloaded(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn embed_without_model_returns_actionable_error() {
        let dir = std::env::temp_dir().join(format!("kf-embed-{}", uuid::Uuid::new_v4()));
        let err = embed(&dir, vec!["测试".to_string()], false, false).unwrap_err();
        assert!(err.contains("尚未下载"), "错误要告诉用户去下载: {err}");
    }

    #[test]
    fn empty_input_is_a_no_op_even_without_model() {
        let dir = std::env::temp_dir().join(format!("kf-embed-{}", uuid::Uuid::new_v4()));
        assert!(embed(&dir, Vec::new(), true, false).unwrap().is_empty());
    }

    /// 真下载真推理。默认 `#[ignore]`：CI 不拉百 MB 权重。
    ///
    /// 本地跑法：`cargo test -- --ignored local_embedding_is_semantic --nocapture`
    #[test]
    #[ignore]
    fn local_embedding_is_semantic() {
        // 想复用已下载的权重就设 KNOWFLICK_EMBED_CACHE；否则用一次性临时目录。
        let dir = match std::env::var("KNOWFLICK_EMBED_CACHE") {
            Ok(custom) => std::path::PathBuf::from(custom),
            Err(_) => std::env::temp_dir().join(format!("kf-embed-real-{}", uuid::Uuid::new_v4())),
        };
        let docs = vec![
            "SQLite 全文检索与端侧向量数据库架构设计".to_string(),
            "在 SQLite 中使用 FTS5 索引与嵌入式向量检索".to_string(),
            "高中生物课本：光合作用中光反应与暗反应机制解析".to_string(),
        ];
        let started = std::time::Instant::now();
        let passages = embed(&dir, docs.clone(), false, true).unwrap();
        let query = embed(&dir, vec!["端侧数据库怎么做向量检索".to_string()], true, true).unwrap();
        println!("首次加载+推理耗时: {:?}", started.elapsed());

        assert_eq!(passages.len(), 3);
        assert_eq!(passages[0].len(), LOCAL_MODEL_DIM);
        assert_eq!(query[0].len(), LOCAL_MODEL_DIM);

        let cos = |a: &[f32], b: &[f32]| -> f32 {
            let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
            let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
            let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
            dot / (na * nb)
        };
        let a = cos(&query[0], &passages[0]);
        let b = cos(&query[0], &passages[1]);
        let c = cos(&query[0], &passages[2]);
        println!("query~A={a:.4} query~B={b:.4} query~C={c:.4}");
        // 数据库两条都比生物那条更像
        assert!(a > c && b > c, "同主题应高于跨主题: {a:.4}/{b:.4} vs {c:.4}");
        assert!(is_downloaded(&dir), "推理成功后缓存目录里应有权重");
        if std::env::var("KNOWFLICK_EMBED_CACHE").is_err() {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn prefixes_match_the_model_family_convention() {
        assert_eq!(with_prefix("你好", true), "query: 你好");
        assert_eq!(with_prefix("你好", false), "passage: 你好");
    }
}

//! 把底层错误翻译成**用户能照着做**的中文说明。
//!
//! 背景：Rust 里到处是 `format!("下载模型失败: {e}")`。`{e}` 是底层库的
//! **英文**错误——用户看到的是「下载模型失败: error sending request for url ...」
//! **半中半英**：他看懂了「下载模型失败」，但不知道**为什么**失败、
//! 更不知道**下一步怎么办**。
//!
//! 这里按错误里的关键词给出**原因 + 下一步**，原始英文保留在括号里
//! ——它是开发者定位问题要用的，但不能是用户唯一的线索。

/// 常见的底层错误 → 用户能照着做的说明。
///
/// 只列**真正常见**的：网络不通、磁盘满/权限、文件不存在、超时。
/// 认不出来就退回通用说法，不硬猜。
const CAUSES: &[(&str, &str)] = &[
    (
        "connection refused",
        "连不上服务器——请检查网络、代理与防火墙",
    ),
    (
        "connection reset",
        "连接被中断——网络不稳或服务器主动断开，请重试",
    ),
    (
        "connection timed out",
        "连接超时——网络太慢或服务器无响应，请稍后重试",
    ),
    (
        "timed out",
        "操作超时——网络太慢或服务器无响应，请稍后重试",
    ),
    (
        "error sending request",
        "网络请求没能发出去——请检查网络连接与代理设置",
    ),
    (
        "dns",
        "域名解析失败——请检查网络是否能解析这个地址",
    ),
    (
        "no such file or directory",
        "文件或目录不存在——请确认路径是否选对",
    ),
    (
        "permission denied",
        "权限不足——请检查该文件是否可写（有些位置需要管理员权限）",
    ),
    (
        "read-only file system",
        "这个位置是只读的——请换一个可写的位置（比如「文稿」目录）",
    ),
    (
        "no space left on device",
        "磁盘满了——请清理一些空间后重试",
    ),
    (
        // SQLite 满盘报的是这句（实测 rusqlite 在库目录写满时的错误文本）
        "database or disk is full",
        "磁盘满了——请清理一些空间后重试",
    ),
    (
        "is a directory",
        "这里是个文件夹，不是文件——请选具体的文件",
    ),
    (
        "not a directory",
        "这不是文件夹——请确认路径",
    ),
    (
        "certificate",
        "证书校验没通过——可能是网络中间设备换了证书，或系统时间不对",
    ),
    (
        "401",
        "身份验证没过——请检查账号或密钥",
    ),
    (
        "403",
        "被拒绝了——这个账号没有这个操作��权限",
    ),
    (
        "404",
        "找不到这个地址——请检查链接是否写错",
    ),
    (
        "500",
        "服务器出错了——请稍后重试",
    ),
    (
        "503",
        "服务器暂时不可用——请稍后重试",
    ),
];

/// 把底层错误变成「原因 + 下一步」的中文说明。
///
/// 原始英文保留在括号里，方便开发者定位；但**用户看到的第一句是中文**。
pub fn explain(what: &str, error: &dyn std::error::Error) -> String {
    explain_text(what, &error.to_string())
}

/// 同上，但直接吃字符串（测试与不实现 `Error` 的地方用）。
pub fn explain_text(what: &str, raw: &str) -> String {
    let lowered = raw.to_lowercase();
    for (needle, advice) in CAUSES {
        if lowered.contains(needle) {
            return format!("{what}：{advice}（原始信息：{raw}）");
        }
    }
    // 认不出来：至少把「是什么」说清楚，别让用户对着一句英文干瞪眼。
    if raw.trim().is_empty() {
        return format!("{what}，但没有拿到具体原因");
    }
    format!("{what}，请检查上面的提示；原始信息：{raw}")
}

#[cfg(test)]
mod tests {
    /// 命令层把 rusqlite 的英文透传交给 explain_text 包装（lib.rs 笔记命令族）。
    /// 静态守卫只扫字面量，看不见透传——这条测试守住包装结果真的可读。
    #[test]
    fn command_wrapper_explains_disk_error_in_chinese() {
        let out = super::explain_text("笔记保存失败", "disk I/O error");
        assert!(out.contains("笔记保存失败"), "{out}");
        // 模块约定：原始英文以「原始信息：…」保留供定位，主体必须是中文说法。
        assert!(out.contains("原始信息：disk I/O error"), "原始信息要保留：{out}");
        let full = super::explain_text("移入回收站失败", "database or disk is full");
        assert!(full.contains("移入回收站失败"), "{full}");
        assert!(full.contains("磁盘") || full.contains("空间"), "磁盘满要说到原因：{full}");
    }

    use super::*;

    #[test]
    fn 网络错误给出可执行的下一步() {
        let msg = explain_text(
            "下载模型失败",
            "error sending request for url https://example.com/model: error trying to connect: tcp connect error: Connection refused (os error 61)",
        );
        assert!(msg.contains("网络"), "应说明是网络问题：{msg}");
        assert!(msg.contains("重试") || msg.contains("检查"), "应给出下一步：{msg}");
        // 原始信息保留
        assert!(msg.contains("Connection refused"), "原始信息要保留：{msg}");
    }

    #[test]
    fn 磁盘满与权限不足各有说法() {
        let full = explain_text("写入模型失败", "No space left on device (os error 28)");
        assert!(full.contains("磁盘"), "{full}");

        let denied = explain_text("保存模型失败", "Permission denied (os error 13)");
        assert!(denied.contains("权限"), "{denied}");
    }

    #[test]
    fn 认不出来的错误也不让用户干瞪眼() {
        let msg = explain_text("转写失败", "something odd happened");
        assert!(msg.contains("转写失败"), "{msg}");
        // 第一句是中文
        assert!(msg.split('，').next().unwrap().contains("转写失败"), "{msg}");
    }

    #[test]
    fn 空错误也要有话可说() {
        let msg = explain_text("转写失败", "");
        assert!(msg.contains("转写失败"), "{msg}");
    }
}

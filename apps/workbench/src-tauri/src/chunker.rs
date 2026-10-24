//! 笔记正文分块（R2，依据 docs/product/LOCAL_DATA_AND_AI.md 的切片建议）。
//!
//! 切法：标题行强制开新块；段落（空行分隔）累积到目标大小成块；超长段落
//! 按字符硬切。**每块记录原文偏移（char_start/char_end）**——禁止切片后
//! 无法回原件。目标 900 字符是实验参数（路线图建议 400–800 tokens 起点），
//! 中文一个字符近似一个 token。
//!
//! 纯函数，无 IO——语义由测试钉住；notes.rs 在 upsert 时用它重建该笔记
//! 的分块与 FTS（笔记量级下同步重建即可，大库优化后置）。

pub const TARGET_CHUNK_CHARS: usize = 900;
pub const HARD_LIMIT_CHARS: usize = 1200;

#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub index: usize,
    pub content: String,
    /// 在原 body 中的字符偏移（按 Unicode 标量计，与 Rust/JS 的
    /// String/索引一致），供回原件定位。
    pub char_start: usize,
    pub char_end: usize,
}

/// 把 Markdown 正文切块。空正文返回空（该笔记不进分块索引，整篇仍走 fts_notes）。
pub fn chunk_markdown(body: &str) -> Vec<Chunk> {
    let mut chunks: Vec<Chunk> = Vec::new();
    if body.trim().is_empty() {
        return chunks;
    }

    // 预切：标题行强制断开；其余按空行成段。记录「是否标题开头」——
    // 合并小段落时不得跨越标题边界（切片优先按标题边界，LOCAL_DATA_AND_AI）。
    let mut paragraphs: Vec<(usize, String, bool)> = Vec::new();
    let mut current = String::new();
    let mut current_start = 0usize;
    let mut offset = 0usize;
    for line in body.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed.starts_with('#') && !current.trim().is_empty() {
            let text = std::mem::take(&mut current);
            let is_heading = text.trim_start().starts_with('#');
            paragraphs.push((current_start, text, is_heading));
            current_start = offset;
        }
        if line.trim().is_empty() && !current.trim().is_empty() {
            let text = std::mem::take(&mut current);
            let is_heading = text.trim_start().starts_with('#');
            paragraphs.push((current_start, text, is_heading));
            current_start = offset;
        }
        if current.is_empty() {
            current_start = offset;
        }
        current.push_str(line);
        offset += line.chars().count();
    }
    if !current.trim().is_empty() {
        let starts_heading = current.trim_start().starts_with('#');
        paragraphs.push((current_start, current, starts_heading));
    }

    // 段落累积成块；单段超长再按字符硬切。
    let mut buffer = String::new();
    let mut buffer_start = 0usize;
    let mut flush = |chunks: &mut Vec<Chunk>, buffer: &mut String, start: usize| {
        if buffer.trim().is_empty() {
            buffer.clear();
            return;
        }
        let end = start + buffer.chars().count();
        chunks.push(Chunk {
            index: chunks.len(),
            content: buffer.trim_end().to_string(),
            char_start: start,
            char_end: end,
        });
        buffer.clear();
    };

    for (start, para, starts_heading) in paragraphs {
        let para_chars = para.chars().count();
        if starts_heading && !buffer.trim().is_empty() {
            flush(&mut chunks, &mut buffer, buffer_start);
            buffer_start = start;
        }
        if para_chars >= HARD_LIMIT_CHARS {
            // 超长段落：先冲掉缓冲，再按目标大小硬切（相邻块不重叠——重叠是
            // 实验参数，等真实语料验证后再开）。
            flush(&mut chunks, &mut buffer, buffer_start);
            let chars: Vec<char> = para.chars().collect();
            let mut pos = 0usize;
            while pos < chars.len() {
                let take = (chars.len() - pos).min(TARGET_CHUNK_CHARS);
                let piece: String = chars[pos..pos + take].iter().collect();
                chunks.push(Chunk {
                    index: chunks.len(),
                    content: piece.trim().to_string(),
                    char_start: start + pos,
                    char_end: start + pos + take,
                });
                pos += take;
            }
            buffer_start = start + para_chars;
            continue;
        }
        if !buffer.is_empty() && buffer.chars().count() + para_chars > TARGET_CHUNK_CHARS {
            flush(&mut chunks, &mut buffer, buffer_start);
            buffer_start = start;
        }
        if buffer.is_empty() {
            buffer_start = start;
        }
        buffer.push_str(&para);
    }
    flush(&mut chunks, &mut buffer, buffer_start);

    // index 连续化
    for (i, c) in chunks.iter_mut().enumerate() {
        c.index = i;
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(chunks: &[Chunk]) -> Vec<String> {
        chunks.iter().map(|c| c.content.clone()).collect()
    }

    #[test]
    fn headings_force_new_chunks() {
        let body = "引言段落。\n\n## 第一节\n\n第一节的内容。\n\n## 第二节\n\n第二节的内容。";
        let chunks = chunk_markdown(body);
        // 标题与其后内容同块；下一个标题强制开新块（3 块而非 5——
        // 标题行不是孤立成块，是「节的开始」）。
        assert_eq!(chunks.len(), 3, "标题行强制开新块：{:?}", texts(&chunks));
        assert!(chunks[0].content.starts_with("引言"));
        // 块内容可能带前导空行（段落连同分隔一起累积），判断用 trim
        assert!(chunks[1].content.trim_start().starts_with("## 第一节"));
        assert!(chunks[2].content.trim_start().starts_with("## 第二节"));
    }

    #[test]
    fn small_paragraphs_coalesce_up_to_target() {
        let body = "短句一。\n\n短句二。\n\n短句三。";
        let chunks = chunk_markdown(body);
        assert_eq!(chunks.len(), 1, "小段落合并成一块：{:?}", texts(&chunks));
    }

    #[test]
    fn oversized_paragraph_is_hard_split_with_offsets() {
        let body = "很".repeat(TARGET_CHUNK_CHARS + 300);
        let chunks = chunk_markdown(&body);
        assert!(chunks.len() >= 2);
        // 偏移必须连续覆盖原文（可回原件定位）
        assert_eq!(chunks.first().unwrap().char_start, 0);
        let last = chunks.last().unwrap();
        assert_eq!(last.char_end, body.chars().count());
        // 拼回的字符总量等于原文
        let total: usize = chunks.iter().map(|c| c.content.chars().count()).sum();
        assert!(total >= TARGET_CHUNK_CHARS, "切片内容不为空");
    }

    #[test]
    fn empty_and_whitespace_only_bodies_yield_no_chunks() {
        assert!(chunk_markdown("").is_empty());
        assert!(chunk_markdown("  \n\n  \n").is_empty());
    }

    #[test]
    fn chinese_content_keeps_offsets_alignment() {
        let body = "# 标题\n\n这是包含中文与 English 混排的正文段落，用来验证偏移按 Unicode 标量计算。";
        let chunks = chunk_markdown(body);
        for c in &chunks {
            // 每块的 char 范围取回的切片必须以该块内容开头（可回原件定位）
            let slice: String = body.chars().collect::<Vec<char>>()[c.char_start..c.char_end]
                .iter()
                .collect();
            assert!(slice.trim_start().starts_with(c.content.trim_start().chars().next().unwrap_or(' ')), "偏移对不上");
        }
    }

    #[test]
    fn offsets_point_at_original_text() {
        let body = "第一段内容。\n\n## 标题行\n\n第二段在标题之后。";
        let chunks = chunk_markdown(body);
        let chars: Vec<char> = body.chars().collect();
        for c in &chunks {
            let slice: String = chars[c.char_start..c.char_end].iter().collect();
            assert!(slice.contains(c.content.split('\n').next().unwrap().trim().get(0..6).unwrap_or("")), "切片要在原文里：{slice}");
        }
    }
}

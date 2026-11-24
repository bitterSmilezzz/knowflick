// 分块逻辑：与 Rust 侧 chunker.rs 逐条对齐。
package library

import "strings"

const (
	TargetChunkChars = 900
	HardLimitChars   = 1200
)

type Chunk struct {
	Index     int
	Content   string
	CharStart int
	CharEnd   int
}

// ChunkMarkdown 把 Markdown 正文切块。空正文返回空（整篇仍进 fts_notes）。
func ChunkMarkdown(body string) []Chunk {
	if strings.TrimSpace(body) == "" {
		return []Chunk{}
	}
	paragraphs := splitParagraphs(body)
	chunks := make([]Chunk, 0, len(paragraphs))
	buffer := ""
	bufferStart := 0
	flush := func() {
		if strings.TrimSpace(buffer) == "" {
			buffer = ""
			return
		}
		chunks = append(chunks, Chunk{
			Content:   strings.TrimRight(buffer, " \t\n\r\v\f"),
			CharStart: bufferStart,
			CharEnd:   bufferStart + runeLen(buffer),
		})
		buffer = ""
	}
	for _, para := range paragraphs {
		paraChars := runeLen(para.text)
		if para.heading && strings.TrimSpace(buffer) != "" {
			flush()
			bufferStart = para.start
		}
		if paraChars >= HardLimitChars {
			hardSplit(&chunks, para)
			bufferStart = para.start + paraChars
			continue
		}
		if buffer != "" && runeLen(buffer)+paraChars > TargetChunkChars {
			flush()
			bufferStart = para.start
		}
		if buffer == "" {
			bufferStart = para.start
		}
		buffer += para.text
	}
	flush()
	for i := range chunks {
		chunks[i].Index = i
	}
	return chunks
}

// hardSplit 把超长段落按目标大小硬切；相邻块不重叠（与 Rust 同）。
func hardSplit(chunks *[]Chunk, para paragraph) {
	runes := []rune(para.text)
	for pos := 0; pos < len(runes); {
		take := len(runes) - pos
		if take > TargetChunkChars {
			take = TargetChunkChars
		}
		*chunks = append(*chunks, Chunk{
			Content:   strings.TrimSpace(string(runes[pos : pos+take])),
			CharStart: para.start + pos,
			CharEnd:   para.start + pos + take,
		})
		pos += take
	}
}

type paragraph struct {
	start int
	text  string
	// heading 记录该段是否以标题开头：合并小段时不得跨标题边界。
	heading bool
}

// splitParagraphs 预切成段：标题行强制断开，其余按空行断开；start 是段落首字符偏移。
func splitParagraphs(body string) []paragraph {
	paragraphs := make([]paragraph, 0, 8)
	current := ""
	currentStart := 0
	offset := 0
	for _, line := range splitInclusiveLines(body) {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") && strings.TrimSpace(current) != "" {
			paragraphs = appendParagraph(paragraphs, currentStart, current)
			current = ""
			currentStart = offset
		} else if trimmed == "" && strings.TrimSpace(current) != "" {
			paragraphs = appendParagraph(paragraphs, currentStart, current)
			current = ""
			currentStart = offset
		}
		if current == "" {
			currentStart = offset
		}
		current += line
		offset += runeLen(line)
	}
	if strings.TrimSpace(current) != "" {
		paragraphs = appendParagraph(paragraphs, currentStart, current)
	}
	return paragraphs
}

func appendParagraph(paragraphs []paragraph, start int, text string) []paragraph {
	return append(paragraphs, paragraph{start: start, text: text, heading: strings.HasPrefix(strings.TrimLeft(text, " \t\n\r\v\f"), "#")})
}

// splitInclusiveLines 与 Rust 的 split_inclusive('\n') 同义：换行符留在行尾。
func splitInclusiveLines(body string) []string {
	lines := make([]string, 0, 16)
	start := 0
	for i, r := range body {
		if r == '\n' {
			lines = append(lines, body[start:i+1])
			start = i + 1
		}
	}
	if start < len(body) {
		lines = append(lines, body[start:])
	}
	return lines
}

func runeLen(s string) int { return len([]rune(s)) }

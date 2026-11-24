// Package embed 迁自 Rust 的 embed.rs 与前端 embeddingEngine.ts：
// 本地语义向量的**状态判定**与**确定性哈希投影**。
//
// 为什么要单独一个模块：向量空间必须唯一确定。API 嵌入、本地嵌入、以及没有模型时的
// 确定性哈希投影，三者产出的向量**不在同一个空间**，跨空间算余弦没有意义。
// 所以身份（provider + model + dim）与向量一起流动，检索只比较同身份的向量。
package embed

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	// LocalModelID 改了它等于换了向量空间，必须让旧向量失效。
	LocalModelID = "multilingual-e5-small"
	// LocalModelDim 是该模型输出的维度。
	LocalModelDim = 384
	// HashModelID 是确定性哈希投影的身份。
	HashModelID = "char-ngram-128"
	// HashDim 是哈希投影的默认维度。
	HashDim = 128
)

// LocalStatus 是本地模型的可用状态。
type LocalStatus struct {
	Model      string `json:"model"`
	Dim        int    `json:"dim"`
	Downloaded bool   `json:"downloaded"`
	CacheDir   string `json:"cacheDir"`
}

// CacheDir 是模型权重缓存目录（与 Rust 的 <data_root>/models/fastembed 一致）。
func CacheDir(dataRoot string) string {
	return filepath.Join(dataRoot, "models", "fastembed")
}

// IsDownloaded 判断权重是否已在缓存里：目录中出现任一 *.onnx 即算下载过。
// 不猜 fastembed 的具体目录结构——它随时可能变。
func IsDownloaded(dataRoot string) bool {
	return hasOnnx(CacheDir(dataRoot))
}

func hasOnnx(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		if entry.IsDir() {
			if hasOnnx(path) {
				return true
			}
			continue
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ".onnx") {
			return true
		}
	}
	return false
}

// Status 返回本地模型状态。
func Status(dataRoot string) LocalStatus {
	return LocalStatus{Model: LocalModelID, Dim: LocalModelDim, Downloaded: IsDownloaded(dataRoot), CacheDir: CacheDir(dataRoot)}
}

// ErrNotDownloaded 供调用方用 errors.Is 判定，避免比对中文字符串。
var ErrNotDownloaded = errors.New("本地语义模型尚未下载")

// RequireModel 在没权重时给出可执行的错误；检索路径必须先过这一关，
// 用户搜一下不该静默拉百 MB。返回同一个哨兵值，调用方才判得准。
func RequireModel(dataRoot string) error {
	if !IsDownloaded(dataRoot) {
		return ErrNotDownloaded
	}
	return nil
}

// QueryPrefix / PassagePrefix：E5 系列区分查询与段落前缀，不加会明显掉检索质量。
func withPrefix(text string, isQuery bool) string {
	if isQuery {
		return "query: " + text
	}
	return "passage: " + text
}

// HashEmbedding 是**确定性**的字符 n-gram 哈希投影：完全离线、可复现，
// 与前端 localSemanticHashEmbedding 逐位对齐（同样的分词、权重、种子与归一化）。
//
// 注意：它不是语义模型。共享字面片段的文本才高相似，这是「没有模型时的降级」，
// 不能当「理解同义语义」的承诺——所以身份里单独标 hash。
func HashEmbedding(text string, dim int) []float64 {
	if dim <= 0 {
		dim = HashDim
	}
	clean := strings.ToLower(strings.TrimSpace(text))
	out := make([]float64, dim)
	if clean == "" {
		return out
	}
	counts := map[string]int{}
	// 英文与数字单词
	var word strings.Builder
	flushWord := func() {
		if word.Len() > 0 {
			counts[word.String()]++
			word.Reset()
		}
	}
	for _, r := range clean {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			word.WriteRune(r)
			continue
		}
		flushWord()
	}
	flushWord()
	// 中文及其它非 ASCII 字符的 1/2/3-gram（去掉空白、标点、符号）
	cjk := make([]rune, 0, len(clean))
	for _, r := range clean {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			continue
		}
		cjk = append(cjk, r)
	}
	for i := 0; i < len(cjk); i++ {
		counts[string(cjk[i])]++
		if i+1 < len(cjk) {
			counts[string(cjk[i:i+2])]++
		}
		if i+2 < len(cjk) {
			counts[string(cjk[i:i+3])]++
		}
	}
	seeds := []uint32{0x811c9dc5, 0x9e3779b9, 0xa0761d64, 0x68bc21eb}
	for term, count := range counts {
		runeLen := len([]rune(term))
		lenWeight := 0.6
		if runeLen >= 3 {
			lenWeight = 2.5
		} else if runeLen == 2 {
			lenWeight = 1.8
		}
		weight := lenWeight * (1 + math.Log(float64(count)))
		for _, seed := range seeds {
			h := fnv1a(term, seed)
			// 复刻 JS 的位运算语义：`h ^ (h >>> 16)` 在 JS 里是**有符号** int32，
			// 负数取模仍为负，而给 Float32Array 赋负下标会被静默丢弃。
			// 现有向量都是前端生成的，这里必须逐位对齐——否则同一份数据两侧
			// 落在不同空间，向量检索会分裂。
			index := int(int32(h^(h>>16))) % dim
			if index < 0 {
				continue
			}
			sign := 1.0
			if h&1 != 0 {
				sign = -1
			}
			out[index] += sign * weight
		}
	}
	sumSq := 0.0
	for _, v := range out {
		sumSq += v * v
	}
	norm := math.Sqrt(sumSq)
	if norm < 1e-6 {
		return out
	}
	for i := range out {
		out[i] = roundTo6(out[i] / norm)
	}
	return out
}

// fnv1a 与前端同实现：按 UTF-16 码元逐位混入（JS 的 charCodeAt 语义）。
func fnv1a(s string, seed uint32) uint32 {
	h := seed
	for _, unit := range utf16Units(s) {
		h ^= uint32(unit)
		h *= 0x01000193
	}
	return h
}

func utf16Units(s string) []uint16 {
	out := make([]uint16, 0, len(s))
	for _, r := range s {
		if r > 0xFFFF {
			r -= 0x10000
			out = append(out, uint16(0xD800+(r>>10)), uint16(0xDC00+(r&0x3FF)))
			continue
		}
		out = append(out, uint16(r))
	}
	return out
}

// roundTo6 与前端 toFixed(6) 对齐，避免两侧余弦比较出现微小偏差。
func roundTo6(v float64) float64 {
	return math.Round(v*1e6) / 1e6
}

// Cosine 与前端 cosineSimilarity 同义：长度不等直接 0，零向量返回 0。
func Cosine(a, b []float64) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	dot, normA, normB := 0.0, 0.0, 0.0
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

// Identity 是向量身份；调用方必须把它与向量一起存。
func Identity(provider string, dim int) string {
	return fmt.Sprintf("%s:%s:%d", provider, LocalModelID, dim)
}

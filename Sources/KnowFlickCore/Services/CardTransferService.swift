import Foundation

/// CPU and file work stays off the UI actor; callers own presentation and cancellation.
public enum CardTransferError: LocalizedError, Sendable {
    case fileTooLarge(maxBytes: Int)

    public var errorDescription: String? {
        switch self {
        case .fileTooLarge(let maxBytes):
            let megabytes = maxBytes / (1024 * 1024)
            return "导入文件过大，当前最多支持 \(megabytes) MB。"
        }
    }
}

public enum CardTransferService {
    /// Protect the UI and parser from accidentally importing an unbounded file.
    /// This is intentionally generous for notes while keeping malformed input from
    /// consuming the whole process on a single import action.
    public static let maximumNoteBytes = 32 * 1024 * 1024

    private static func background<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try Task.checkCancellation()
        let task = Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            let result = try work()
            try Task.checkCancellation()
            return result
        }
        return try await withTaskCancellationHandler {
            let result = try await task.value
            try Task.checkCancellation()
            return result
        } onCancel: { task.cancel() }
    }

    public static func readNote(at url: URL) async throws -> String {
        try await background {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let byteCount = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
               byteCount > maximumNoteBytes {
                throw CardTransferError.fileTooLarge(maxBytes: maximumNoteBytes)
            }
            return try String(contentsOf: url, encoding: .utf8)
        }
    }

    public static func parse(_ content: String, fileName: String?) async throws -> [KnowledgeCard] {
        try await background {
            let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
            let json = fileName?.lowercased().hasSuffix(".json") == true || text.hasPrefix("{") ||
                text.range(of: #"^\[\s*(?:\{|"|\[|\]|$)"#, options: .regularExpression) != nil
            return try json ? CardImportEngine.parseJSON(data: Data(text.utf8)) : CardImportEngine.parseMarkdown(text: text)
        }
    }

    private static func render(_ cards: [KnowledgeCard], format: CardExportFormat) throws -> String {
        switch format {
        case .markdownSingle: return CardExportEngine.exportToSingleMarkdown(cards: cards)
        case .ankiTSV: return CardExportEngine.exportToAnkiTSV(cards: cards)
        case .jsonArchive: return try CardExportEngine.exportToJSON(cards: cards)
        case .obsidianVault:
            return CardExportEngine.exportToObsidianVault(cards: cards)
                .map { "=== \($0.filename) ===\n\($0.content)" }.joined(separator: "\n\n")
        }
    }

    public static func content(cards: [KnowledgeCard], format: CardExportFormat) async throws -> String {
        try await background { try render(cards, format: format) }
    }

    public static func preview(cards: [KnowledgeCard], format: CardExportFormat, totalCount: Int) async throws -> String {
        try await background {
            guard totalCount > 0 else { return "当前筛选范围暂无卡片。" }
            let sample = cards.prefix(3).map { card in
                var copy = card
                copy.headline = String(card.headline.prefix(200))
                copy.summary = String(card.summary.prefix(500))
                copy.details = String(card.details.prefix(1200))
                copy.links = Array(card.links.prefix(3))
                return copy
            }
            let text = try render(sample, format: format)
            return "预览样本：前 \(sample.count) 张 / 共 \(totalCount) 张。预览可能截断，保存与完整复制包含全部原文。\n\n" + String(text.prefix(1800))
        }
    }

    public static func save(cards: [KnowledgeCard], format: CardExportFormat, to url: URL) async throws -> URL {
        try await background {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if format == .obsidianVault {
                return try CardExportWriter.writeObsidian(cards: cards, into: url)
            }
            let text = try render(cards, format: format)
            try Task.checkCancellation()
            try text.write(to: url, atomically: true, encoding: .utf8)
            return url
        }
    }
}

import SwiftUI
import KnowFlickCore

struct CardEditorView: View {
    let card: KnowledgeCard
    let store: AppStore
    let onClose: () -> Void
    @State private var headline: String
    @State private var category: String
    @State private var summary: String
    @State private var details: String
    @State private var saveError: String?
    @State private var confirmDiscard = false

    init(card: KnowledgeCard, store: AppStore, onClose: @escaping () -> Void) {
        self.card = card; self.store = store; self.onClose = onClose
        _headline = State(initialValue: card.headline)
        _category = State(initialValue: card.category)
        _summary = State(initialValue: card.summary)
        _details = State(initialValue: card.details)
    }
    private var isValid: Bool {
        [headline, category, summary, details].allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
    private var isChanged: Bool {
        headline != card.headline || category != card.category || summary != card.summary || details != card.details
    }
    /// 受控分类集合（内置「冷知识」+ 用户自定义分类）
    private var categoryOptions: [String] { store.settings.allCategoryNames }
    /// 卡片原有分类若已不在分类体系中，保留为可选项，避免静默改写用户数据
    private var selectableCategories: [String] {
        let options = categoryOptions
        if card.category.isEmpty { return options }
        if !options.contains(card.category) { return options + [card.category] }
        return options
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("整理这张知识卡片").font(EditorialFont.modalTitle)
                    Text("用自己的语言补充理解，收藏与复习记录会保留。")
                        .font(EditorialFont.labelSmall).foregroundStyle(EditorialColor.textSecondary)
                }
                Spacer()
                Button { close() } label: { Image(systemName: "xmark").padding(8) }
                    .buttonStyle(.plain).keyboardShortcut(.escape, modifiers: []).help("关闭编辑")
            }.padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    field("标题", text: $headline)
                    categoryField
                    field("摘要", text: $summary)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("正文 · 支持 Markdown").font(EditorialFont.label)
                        TextEditor(text: $details)
                            .font(.system(size: 14)).scrollContentBackground(.hidden)
                            .padding(10).frame(minHeight: 230)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 9))
                            .accessibilityLabel("卡片正文")
                    }
                }.padding(24)
            }
            Divider()
            HStack {
                if let saveError { Text(saveError).font(EditorialFont.caption).foregroundStyle(EditorialColor.dislikeRed) }
                else { Text(isValid ? "更改仅保存在本机知识库。" : "标题、主题、摘要和正文都不能为空。")
                    .font(EditorialFont.caption).foregroundStyle(EditorialColor.textSecondary) }
                Spacer()
                Button("取消") { close() }.buttonStyle(.bordered)
                Button("保存更改") {
                    if store.updateCardContent(id: card.id, headline: headline, category: category, summary: summary, details: details) {
                        onClose()
                    } else { saveError = "卡片已不存在，或内容为空，无法更新。" }
                }.buttonStyle(.borderedProminent).tint(EditorialColor.aiAmber)
                    .disabled(!isValid || !isChanged).keyboardShortcut("s", modifiers: .command)
            }.padding(20)
        }
        .frame(minWidth: 640, idealWidth: 720, minHeight: 540, idealHeight: 680)
        .background(EditorialColor.canvasDark).foregroundStyle(EditorialColor.textPrimary)
        .interactiveDismissDisabled(isChanged)
        .confirmationDialog("放弃尚未保存的更改？", isPresented: $confirmDiscard) {
            Button("放弃更改", role: .destructive, action: onClose)
            Button("继续编辑", role: .cancel) { }
        }
    }
    /// 主题必须是分类体系内的受控值，避免写入「物理系」等脏分类污染筛选/统计/AI 白名单。
    private var categoryField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("主题").font(EditorialFont.label)
            Picker("主题", selection: $category) {
                ForEach(selectableCategories, id: \.self) { name in
                    Text(name).tag(name)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .font(.system(size: 14))
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 9))
            .accessibilityLabel("主题")
            Text("主题只能从分类体系中选择，可在设置中增删自定义分类。")
                .font(EditorialFont.captionSmall).foregroundStyle(EditorialColor.textTertiary)
        }
    }
    private func field(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(EditorialFont.label)
            TextField(title, text: text, axis: .vertical)
                .textFieldStyle(.plain).font(.system(size: 14)).padding(12)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 9))
                .accessibilityLabel(title)
        }
    }
    private func close() {
        if isChanged { confirmDiscard = true } else { onClose() }
    }
}

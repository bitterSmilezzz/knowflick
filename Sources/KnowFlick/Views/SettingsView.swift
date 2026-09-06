import SwiftUI
import KnowFlickCore

/// 设置页：AI 服务配置
struct SettingsView: View {
    @Bindable var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var baseURL = ""
    @State private var model = ""
    @State private var apiKey = ""
    @State private var autoGenerate = true
    @State private var selectedCategories: Set<String> = []   // 偏好分类（分类体系多选）
    @State private var enableSeed = true
    @State private var enableAI = true
    @State private var aiSources = ""
    @State private var showAIMark = true
    @State private var customCategories: [CategoryConfig] = []   // 自定义分类（编辑副本）
    @State private var newCategoryName = ""
    @State private var newCategoryDesc = ""
    @State private var savedToast = false
    @State private var testResult: String?
    @State private var isTesting = false

    @State private var selectedProviderId = "deepseek"

    private var currentPreset: AIProviderPreset {
        AIProviderPreset.presets.first(where: { $0.id == selectedProviderId }) ?? AIProviderPreset.presets.last!
    }

    private func selectProvider(_ preset: AIProviderPreset) {
        selectedProviderId = preset.id
        if preset.id != "custom" {
            baseURL = preset.defaultBaseURL
            if !preset.models.contains(model) {
                model = preset.defaultModel
            }
        }
    }

    /// 当前编辑中的分类体系（内置「冷知识」+ 自定义），偏好 chips 与分类管理共用
    private var editingCategoryNames: [String] {
        [CategoryRegistry.builtinCategory] + customCategories.map(\.name)
    }

    var body: some View {
        ZStack {
            EditorialColor.canvasGradient
                .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                header
                Divider().overlay(EditorialColor.glassDivider)

                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        aiServiceCard
                        categoryManagementCard
                        sourcesCard
                        aboutCard
                    }
                    .padding(22)
                }

                Divider().overlay(EditorialColor.glassDivider)
                bottomBar
            }
        }
        .preferredColorScheme(.dark)
        .frame(width: 620, height: 720)
        .onAppear {
            baseURL = store.settings.baseURL
            model = store.settings.model
            apiKey = store.settings.apiKey
            selectedProviderId = AIProviderPreset.match(baseURL: store.settings.baseURL).id
            autoGenerate = store.settings.autoGenerate
            selectedCategories = Set(store.settings.preferredCategories)
            enableSeed = store.settings.enableSeed
            enableAI = store.settings.enableAI
            aiSources = store.settings.aiSources
            showAIMark = store.settings.showAIMark
            customCategories = store.settings.customCategories
        }
        .overlay(alignment: .bottom) {
            if savedToast {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(EditorialColor.likeGreen)
                    Text("设置已保存并生效")
                        .font(EditorialFont.labelSmall)
                        .foregroundStyle(EditorialColor.textPrimary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
                .background(Color.black.opacity(0.8), in: Capsule())
                .overlay(Capsule().strokeBorder(EditorialColor.likeGreen.opacity(0.6), lineWidth: 1))
                .shadow(color: EditorialColor.likeGreen.opacity(0.3), radius: 10, y: 4)
                .padding(.bottom, 64)
                .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 8) {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(EditorialColor.textSecondary)
                Text("偏好设置")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
            }
            Spacer()
            Button("完成") {
                save()
                dismiss()
            }
            .font(EditorialFont.label)
            .foregroundStyle(EditorialColor.textSecondary)
            .padding(.horizontal, 18)
            .padding(.vertical, 6)
            .background(EditorialColor.glassSurface, in: Capsule())
            .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
    }

    // MARK: - 卡片 1：AI 服务配置

    private var aiServiceCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .foregroundStyle(EditorialColor.aiAmber)
                Text("AI 驱动服务")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
            }

            VStack(alignment: .leading, spacing: 12) {
                // 1. 服务商预设切换
                fieldRow(label: "服务商预设") {
                    Menu {
                        ForEach(AIProviderPreset.presets) { preset in
                            Button {
                                selectProvider(preset)
                            } label: {
                                Label(preset.name, systemImage: preset.icon)
                            }
                        }
                    } label: {
                        HStack {
                            Image(systemName: currentPreset.icon)
                                .foregroundStyle(EditorialColor.aiAmber)
                                .frame(width: 18)
                            Text(currentPreset.name)
                                .font(EditorialFont.label)
                                .foregroundStyle(EditorialColor.textPrimary)
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 11))
                                .foregroundStyle(EditorialColor.textTertiary)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                    }
                }

                if !currentPreset.helpText.isEmpty {
                    Text(currentPreset.helpText)
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textTertiary)
                        .padding(.top, -3)
                }

                // 2. API 地址
                fieldRow(label: "API 地址") {
                    TextField(currentPreset.defaultBaseURL.isEmpty ? "https://..." : currentPreset.defaultBaseURL, text: $baseURL)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                        .foregroundStyle(EditorialColor.textPrimary)
                }

                // 3. 模型选择
                fieldRow(label: "模型选择") {
                    if currentPreset.models.isEmpty {
                        TextField("例如：deepseek-chat、gpt-4o、qwen-plus", text: $model)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                            .foregroundStyle(EditorialColor.textPrimary)
                    } else {
                        HStack(spacing: 8) {
                            Menu {
                                ForEach(currentPreset.models, id: \.self) { m in
                                    Button(m) {
                                        model = m
                                    }
                                }
                                Divider()
                                Button("手动输入其他模型…") {
                                    if currentPreset.models.contains(model) {
                                        model = ""
                                    }
                                }
                            } label: {
                                HStack {
                                    Text(currentPreset.models.contains(model) ? model : (model.isEmpty ? "选择模型…" : "自定义模型"))
                                        .font(EditorialFont.labelSmall)
                                        .foregroundStyle(EditorialColor.textPrimary)
                                    Spacer()
                                    Image(systemName: "chevron.up.chevron.down")
                                        .font(.system(size: 11))
                                        .foregroundStyle(EditorialColor.textTertiary)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .frame(width: 190)
                                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                            }

                            if !currentPreset.models.contains(model) {
                                TextField("输入具体模型名", text: $model)
                                    .textFieldStyle(.plain)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                                    .foregroundStyle(EditorialColor.textPrimary)
                            }
                        }
                    }
                }

                // 4. API Key
                fieldRow(label: "API Key") {
                    VStack(alignment: .leading, spacing: 4) {
                        SecureField(currentPreset.apiKeyPlaceholder, text: $apiKey)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                            .foregroundStyle(EditorialColor.textPrimary)

                        if !currentPreset.requiresKey {
                            Text("本地离线模型（Ollama 等），无需在应用中配置 Key")
                                .font(EditorialFont.captionSmall)
                                .foregroundStyle(EditorialColor.textMuted)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("优先刷卡分类")
                        .font(EditorialFont.captionSmall.weight(.semibold))
                        .foregroundStyle(EditorialColor.textTertiary)

                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: 6)], alignment: .leading, spacing: 6) {
                            ForEach(editingCategoryNames, id: \.self) { cat in
                                categoryChip(cat)
                            }
                        }
                        .padding(2)
                    }
                    .frame(maxHeight: 95)

                    Text("选中的分类将优先排列在卡堆前列，未看卡刷完后自动回退全量；全部未选则均等浏览")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textMuted)
                }
                .padding(.top, 4)

                Toggle("卡片不足时自动触发 AI 批量补充", isOn: $autoGenerate)
                    .font(EditorialFont.labelSmall)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .padding(.top, 2)
            }
        }
        .padding(18)
        .editorialGlassCard(cornerRadius: EditorialRadius.container)
    }

    // MARK: - 卡片 2：分类体系管理

    private var categoryManagementCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "square.grid.2x2")
                    .foregroundStyle(EditorialColor.likeGreen)
                Text("分类体系与视觉主题")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
            }

            VStack(alignment: .leading, spacing: 10) {
                // 内置分类
                HStack(spacing: 8) {
                    Circle()
                        .fill(CategoryTheme.theme(for: CategoryRegistry.builtinCategory, cache: .shared).accent)
                        .frame(width: 8, height: 8)
                    Text(CategoryRegistry.builtinCategory)
                        .font(EditorialFont.labelSmall)
                        .foregroundStyle(EditorialColor.textPrimary)
                    Text("（系统内置 · 160 张精选知识底库）")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textMuted)
                    Spacer()
                    Image(systemName: "lock.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(EditorialColor.textMuted)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(EditorialColor.glassSurface.opacity(0.5), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                // 自定义分类列表
                ForEach(customCategories) { cat in
                    let accent = CategoryTheme.theme(for: cat.name, cache: .shared).accent
                    HStack(spacing: 8) {
                        Circle()
                            .fill(accent)
                            .frame(width: 8, height: 8)
                            .shadow(color: accent.opacity(0.5), radius: 4, y: 1)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(cat.name)
                                .font(EditorialFont.labelSmall)
                                .foregroundStyle(EditorialColor.textPrimary)
                            Text(cat.description.isEmpty ? "未指定方向" : cat.description)
                                .font(EditorialFont.captionSmall)
                                .foregroundStyle(EditorialColor.textTertiary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Button {
                            selectedCategories.remove(cat.name)
                            customCategories.removeAll { $0.name == cat.name }
                        } label: {
                            Image(systemName: "trash")
                                .font(.system(size: 11))
                                .foregroundStyle(EditorialColor.dislikeRed.opacity(0.75))
                        }
                        .buttonStyle(.plain)
                        .help("删除该分类")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }

                // 添加分类
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        TextField("新分类名（如：认知心理学）", text: $newCategoryName)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                            .foregroundStyle(EditorialColor.textPrimary)
                            .frame(width: 170)

                        TextField("内容方向（AI 生成参考，可留空）", text: $newCategoryDesc)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                            .foregroundStyle(EditorialColor.textPrimary)

                        Button("添加") {
                            addCategory()
                        }
                        .font(EditorialFont.labelSmall)
                        .foregroundStyle(EditorialColor.textPrimary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(EditorialColor.glassSurfaceHover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorderHover, lineWidth: 1))
                        .buttonStyle(PressableButtonStyle())
                        .disabled(newCategoryName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    Text("新增分类后，系统将自动映射唯一的摄影底图与主题色彩")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textMuted)
                }
                .padding(.top, 4)
            }
        }
        .padding(18)
        .editorialGlassCard(cornerRadius: EditorialRadius.container)
    }

    // MARK: - 卡片 3：信息来源与偏好

    private var sourcesCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "newspaper")
                    .foregroundStyle(EditorialColor.textSecondary)
                Text("内容来源与呈现")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
            }

            VStack(alignment: .leading, spacing: 12) {
                Toggle("启用预置精选知识库", isOn: $enableSeed)
                    .font(EditorialFont.labelSmall)
                    .foregroundStyle(EditorialColor.textPrimary)

                Toggle("启用 AI 智能生成卡片", isOn: $enableAI)
                    .font(EditorialFont.labelSmall)
                    .foregroundStyle(EditorialColor.textPrimary)

                fieldRow(label: "权威来源偏好") {
                    TextField("维基百科, 国家地理, NASA", text: $aiSources)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                        .foregroundStyle(EditorialColor.textPrimary)
                }

                Toggle("在卡片与详情页标注「AI 生成」徽章", isOn: $showAIMark)
                    .font(EditorialFont.labelSmall)
                    .foregroundStyle(EditorialColor.textPrimary)
            }
        }
        .padding(18)
        .editorialGlassCard(cornerRadius: EditorialRadius.container)
    }

    // MARK: - 卡片 4：知识库状态与安全说明

    private var aboutCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "square.stack.3d.up.fill")
                    .foregroundStyle(EditorialColor.aiAmber)
                Text("知识库状态")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Text("共 \(store.cards.count) 张 · 待探索 \(store.deck.count) 张")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textSecondary)
            }

            HStack {
                Text("已刷完想再次回顾，或想重新体验全新的分类背景，可随时重置探索状态。")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textTertiary)
                Spacer()
                Button("重新探索全部卡片") {
                    store.clearHistory()
                }
                .font(EditorialFont.labelSmall)
                .foregroundStyle(EditorialColor.textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            }

            Divider().overlay(EditorialColor.glassDivider)

            HStack(spacing: 10) {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 14))
                    .foregroundStyle(EditorialColor.textTertiary)
                Text("API Key 仅安全存储于 macOS 原生钥匙串（Keychain），绝不会明文保存在本地 JSON 或向外部泄露。")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .editorialGlassCard(cornerRadius: EditorialRadius.container)
    }

    // MARK: - 底栏操作

    private var bottomBar: some View {
        HStack {
            if let result = testResult {
                Label(result, systemImage: isTesting ? "ellipsis" : (result.contains("成功") ? "checkmark.circle.fill" : "xmark.circle.fill"))
                    .font(EditorialFont.caption)
                    .foregroundStyle(isTesting ? EditorialColor.textSecondary : (result.contains("成功") ? EditorialColor.likeGreen : EditorialColor.dislikeRed))
            }

            Spacer()

            Button("测试连通性") {
                testConnection()
            }
            .font(EditorialFont.labelSmall)
            .foregroundStyle(EditorialColor.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            .buttonStyle(PressableButtonStyle())
            .disabled(isTesting || apiKey.isEmpty)

            Button("保存配置") {
                save()
            }
            .font(EditorialFont.label)
            .foregroundStyle(Color.black.opacity(0.85))
            .padding(.horizontal, 20)
            .padding(.vertical, 7)
            .background(EditorialColor.likeGreen, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .shadow(color: EditorialColor.likeGreen.opacity(0.35), radius: 8, y: 2)
            .buttonStyle(PressableButtonStyle(scale: 1.02))
        }
        .padding(18)
    }

    private func fieldRow<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(EditorialFont.captionSmall.weight(.semibold))
                .foregroundStyle(EditorialColor.textTertiary)
            content()
        }
    }

    /// 偏好分类选择 chip
    private func categoryChip(_ cat: String) -> some View {
        let selected = selectedCategories.contains(cat)
        let accent = CategoryTheme.theme(for: cat, cache: .shared).accent
        return Button {
            if selected {
                selectedCategories.remove(cat)
            } else {
                selectedCategories.insert(cat)
            }
        } label: {
            HStack(spacing: 5) {
                Circle()
                    .fill(accent)
                    .frame(width: 6, height: 6)
                Text(cat)
                    .font(EditorialFont.captionSmall)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(selected ? accent.opacity(0.2) : EditorialColor.glassSurface, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? accent.opacity(0.7) : EditorialColor.glassBorder, lineWidth: 1))
            .foregroundStyle(selected ? EditorialColor.textPrimary : EditorialColor.textSecondary)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
    }

    /// 保存：key 进 Keychain + 其余进 JSON，由 AppStore 单点负责分置落盘
    private func save() {
        var updated = store.settings
        updated.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.model = model.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.autoGenerate = autoGenerate
        updated.customCategories = customCategories
        // 偏好中已被删除的分类自动清理
        selectedCategories = selectedCategories.intersection(editingCategoryNames)
        updated.setPreferredCategories(Array(selectedCategories))
        updated.enableSeed = enableSeed
        updated.enableAI = enableAI
        updated.aiSources = aiSources.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.showAIMark = showAIMark
        updated.apiKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try store.saveSettings(updated)
            savedToast = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                savedToast = false
            }
        } catch {
            testResult = error.localizedDescription
        }
    }

    /// 添加自定义分类（去重、trim；描述可空）
    private func addCategory() {
        let name = newCategoryName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        guard name != CategoryRegistry.builtinCategory, !customCategories.contains(where: { $0.name == name }) else {
            testResult = "分类「\(name)」已存在"
            return
        }
        customCategories.append(CategoryConfig(
            name: name,
            description: newCategoryDesc.trimmingCharacters(in: .whitespacesAndNewlines)
        ))
        newCategoryName = ""
        newCategoryDesc = ""
    }

    /// 连通测试：轻量 ping 请求，不消耗 AI 额度
    private func testConnection() {
        isTesting = true
        testResult = nil
        // 用当前输入值组一个临时设置做探测
        var temp = store.settings
        temp.baseURL = baseURL
        temp.model = model
        temp.apiKey = apiKey
        Task {
            testResult = await store.testConnection(settings: temp)
            isTesting = false
        }
    }
}

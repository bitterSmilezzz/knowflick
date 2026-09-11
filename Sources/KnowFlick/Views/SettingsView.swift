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
    @State private var appearance: AppearanceMode = .system
    @State private var customCategories: [CategoryConfig] = []   // 自定义分类（编辑副本）
    @State private var speech = SpeechSettings()
    @State private var speechRate: Float = 1.0
    @State private var speechVoiceIdentifier: String = "auto"
    @State private var ambientGapSeconds: Double = 1.5
    @State private var autoSpeakOnDetailOpen: Bool = false
    @State private var newCategoryName = ""
    @State private var newCategoryDesc = ""
    @State private var savedToast = false
    @State private var saveErrorMessage: String?
    @State private var testResult: String?
    @State private var isTesting = false
    @State private var showExportModal = false
    @State private var showImportModal = false

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
                if let message = saveErrorMessage {
                    saveErrorBanner(message)
                }
                Divider().overlay(EditorialColor.glassDivider)

                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        appearanceCard
                        aiServiceCard
                        categoryManagementCard
                        sourcesCard
                        speechSettingsCard
                        dataManagementCard
                        aboutCard
                    }
                    .padding(22)
                }

                Divider().overlay(EditorialColor.glassDivider)
                bottomBar
            }
        }
        .frame(minWidth: 620, idealWidth: 680, minHeight: 520, idealHeight: 700)
        .onAppear {
            appearance = store.settings.appearance
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
            speech = store.settings.speech
            speechRate = store.settings.speechRate
            speechVoiceIdentifier = store.settings.speechVoiceIdentifier
            ambientGapSeconds = store.settings.ambientGapSeconds
            autoSpeakOnDetailOpen = store.settings.autoSpeakOnDetailOpen
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
        .overlay {
            if showExportModal {
                ExportCardsModalView(store: store) {
                    showExportModal = false
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .overlay {
            if showImportModal {
                ImportNotesModalView(store: store) {
                    showImportModal = false
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
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
                // 保存失败时不关闭：错误以顶部横幅呈现，用户可修正后重试或手动关闭
                if save() { dismiss() }
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

    /// 保存失败横幅：位于标题栏下方，不随底栏提示被忽略
    private func saveErrorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(EditorialColor.dislikeRed)
            Text("保存失败：\(message)")
                .font(EditorialFont.caption)
                .foregroundStyle(EditorialColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button("放弃修改并关闭") {
                dismiss()
            }
            .font(EditorialFont.captionSmall)
            .foregroundStyle(EditorialColor.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(EditorialColor.glassSurface, in: Capsule())
            .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
            .buttonStyle(PressableButtonStyle())
            .help("不保存本次修改，直接关闭设置页")
            Button {
                saveErrorMessage = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(EditorialColor.textTertiary)
            }
            .buttonStyle(PressableButtonStyle())
            .help("忽略此提示，继续修正")
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(EditorialColor.dislikeRed.opacity(0.12))
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(EditorialColor.dislikeRed)
                .frame(width: 3)
        }
    }

    // MARK: - 卡片 0：外观表现（跟随系统 / 深色 / 浅色）
    private var appearanceCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "circle.lefthalf.filled.inverse")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)
                Text("外观模式")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Text(appearance.title)
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textMuted)
            }

            HStack(spacing: 12) {
                ForEach(AppearanceMode.allCases) { mode in
                    let isSelected = (appearance == mode)
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                            appearance = mode
                            store.settings.appearance = mode
                        }
                        do { try store.saveSettings(store.settings) }
                        catch { store.lastError = "外观设置保存失败：\(error.localizedDescription)" }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: mode.icon)
                                .font(.system(size: 14, weight: .semibold))
                            Text(mode.title)
                                .font(EditorialFont.label)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            isSelected
                                ? EditorialColor.aiAmberBg
                                : EditorialColor.glassSurface,
                            in: RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: EditorialRadius.control, style: .continuous)
                                .strokeBorder(
                                    isSelected
                                        ? EditorialColor.aiAmberBorder
                                        : EditorialColor.glassBorder,
                                    lineWidth: isSelected ? 1.5 : 1
                                )
                        )
                        .foregroundStyle(
                            isSelected
                                ? EditorialColor.aiAmber
                                : EditorialColor.textSecondary
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(18)
        .editorialGlassCard()
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
                        ForEach(AIProviderPreset.groups, id: \.self) { group in
                            Section(group) {
                                ForEach(AIProviderPreset.presets.filter { $0.group == group }) { preset in
                                    Button {
                                        selectProvider(preset)
                                    } label: {
                                        Label(preset.name, systemImage: preset.icon)
                                    }
                                }
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
                                .fixedSize(horizontal: false, vertical: true)
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

    // MARK: - 卡片：智能语音与磨耳朵 (Smart TTS)

    private var speechSettingsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "headphones")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)
                Text("语音与连续朗读")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Text("系统 · 云端 · 本地服务")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.likeGreen)
            }

            Divider().overlay(EditorialColor.glassDivider)

            // 默认语速倍率
            SpeechSettingsEditor(settings: $speech)

            fieldRow(label: "默认朗读语速 (当前: \(String(format: "%.2fx", speechRate)))") {
                HStack(spacing: 12) {
                    Slider(value: $speechRate, in: 0.75...1.5, step: 0.25)
                        .tint(EditorialColor.likeGreen)

                    HStack(spacing: 6) {
                        ForEach([0.75, 1.0, 1.25, 1.5], id: \.self) { rate in
                            Button("\(String(format: "%.2f", rate))x") {
                                speechRate = Float(rate)
                            }
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(abs(speechRate - Float(rate)) < 0.05 ? EditorialColor.textPrimary : EditorialColor.textTertiary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(abs(speechRate - Float(rate)) < 0.05 ? EditorialColor.likeGreen.opacity(0.3) : EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 4))
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            // 磨耳朵换卡缓冲时间
            fieldRow(label: "磨耳朵模式换卡缓冲间隔 (当前: \(String(format: "%.1f", ambientGapSeconds)) 秒)") {
                HStack(spacing: 10) {
                    ForEach([1.0, 1.5, 2.0, 3.0], id: \.self) { sec in
                        Button("\(String(format: "%.1f", sec)) 秒") {
                            ambientGapSeconds = sec
                        }
                        .font(EditorialFont.captionSmall.weight(.medium))
                        .foregroundStyle(abs(ambientGapSeconds - sec) < 0.1 ? EditorialColor.textPrimary : EditorialColor.textTertiary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(abs(ambientGapSeconds - sec) < 0.1 ? EditorialColor.aiAmber.opacity(0.25) : EditorialColor.glassSurface, in: Capsule())
                        .overlay(Capsule().strokeBorder(abs(ambientGapSeconds - sec) < 0.1 ? EditorialColor.aiAmber.opacity(0.6) : EditorialColor.glassBorder, lineWidth: 1))
                        .buttonStyle(.plain)
                    }
                }
            }

            // 声音选择
            fieldRow(label: "系统音色（系统模式与离线兜底使用）") {
                Picker("", selection: $speechVoiceIdentifier) {
                    Text("自动选择已下载的高质量音色（推荐）").tag("auto")
                    ForEach(SpeechSynthesizerService.availableVoices(), id: \.identifier) { voice in
                        Text("\(voice.name) · \(voice.language)\(voice.quality == .default ? " · 标准" : " · 高质量")").tag(voice.identifier)
                    }
                }
                .labelsHidden()
            }

            // 试听与自动朗读
            HStack {
                Toggle("进入详情页时自动开启语音导读", isOn: $autoSpeakOnDetailOpen)
                    .toggleStyle(SwitchToggleStyle(tint: EditorialColor.likeGreen))
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textSecondary)

                Spacer()

                Button {
                    store.speechService.preview(configuration: speech, voice: speechVoiceIdentifier, speed: speechRate)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "speaker.wave.2")
                        Text("试听发音")
                    }
                    .font(EditorialFont.captionSmall.weight(.semibold))
                    .foregroundStyle(EditorialColor.textPrimary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(EditorialColor.glassSurface, in: Capsule())
                    .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
            }
            if store.speechService.isPreparing {
                ProgressView("正在生成语音…")
                    .font(EditorialFont.caption)
            }
            if store.speechService.state != .idle {
                Button("停止播放") { store.speechService.stopAmbientMode() }
            }
            if let error = store.speechService.lastError {
                Text(error)
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .editorialGlassCard(cornerRadius: EditorialRadius.container)
    }

    // MARK: - 卡片 3.5：数据管理与迁移 (导入与导出)

    private var dataManagementCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .foregroundStyle(EditorialColor.aiAmber)
                Text("数据管理与双向迁移")
                    .font(EditorialFont.sectionTitle)
                    .foregroundStyle(EditorialColor.textPrimary)
                Spacer()
                Text("Markdown · Obsidian · Anki · JSON")
                    .font(EditorialFont.captionSmall)
                    .foregroundStyle(EditorialColor.textSecondary)
            }

            Text("支持将卡库或收藏阁批量导出为多种笔记与闪卡格式；亦支持将个人 Markdown 笔记或长文通过规则与 AI 解构导入为知识闪卡。")
                .font(EditorialFont.captionSmall)
                .foregroundStyle(EditorialColor.textTertiary)

            HStack(spacing: 12) {
                Button {
                    showExportModal = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.arrow.up")
                        Text("批量导出知识卡片…")
                    }
                    .font(EditorialFont.label)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                    .foregroundStyle(EditorialColor.textPrimary)
                }
                .buttonStyle(PressableButtonStyle())

                Button {
                    showImportModal = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.arrow.down")
                        Text("导入笔记为卡片…")
                    }
                    .font(EditorialFont.label)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                    .foregroundStyle(EditorialColor.textPrimary)
                }
                .buttonStyle(PressableButtonStyle())
            }
        }
        .padding(18)
        .editorialGlassCard()
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

            Divider().overlay(EditorialColor.glassDivider)

            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "app.badge.checkmark")
                        .font(.system(size: 13))
                        .foregroundStyle(EditorialColor.aiAmber)
                    Text("KnowFlick v3.2.0")
                        .font(EditorialFont.captionSmall)
                        .foregroundStyle(EditorialColor.textTertiary)
                }
                Spacer()
                Link(destination: URL(string: "https://github.com/bitterSmilezzz/knowflick")!) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 11))
                        Text("版本与更新说明")
                            .font(EditorialFont.captionSmall)
                    }
                    .foregroundStyle(EditorialColor.aiAmber.opacity(0.85))
                }
            }
        }
        .padding(16)
        .editorialGlassCard(cornerRadius: EditorialRadius.container)
    }

    // MARK: - 底栏操作

    private var bottomBar: some View {
        HStack {
            connectionStatus

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
            .disabled(isTesting || (currentPreset.requiresKey && apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))

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

    /// 连通性反馈必须始终占据底栏空间：测试中显示进度，完成后保留明确的成功或失败状态。
    private var connectionStatus: some View {
        Group {
            if isTesting {
                HStack(spacing: 7) {
                    ProgressView()
                        .controlSize(.small)
                    Text("正在测试连接…")
                }
                .foregroundStyle(EditorialColor.textSecondary)
            } else if let result = testResult {
                let succeeded = result.hasPrefix("连接成功")
                Label(result, systemImage: succeeded ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundStyle(succeeded ? EditorialColor.likeGreen : EditorialColor.dislikeRed)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(succeeded ? "连接测试成功：\(result)" : "连接测试失败：\(result)")
            } else {
                Text("测试连接会使用当前输入的配置")
                    .foregroundStyle(EditorialColor.textTertiary)
            }
        }
        .font(EditorialFont.caption)
        .lineLimit(2)
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
    /// 返回是否成功；失败时在设置页顶部展示可见错误，调用方不应关闭页面
    @discardableResult
    private func save() -> Bool {
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
        updated.appearance = appearance
        updated.apiKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.speech = speech
        updated.speechRate = speechRate
        updated.speechVoiceIdentifier = speechVoiceIdentifier
        updated.ambientGapSeconds = ambientGapSeconds
        updated.autoSpeakOnDetailOpen = autoSpeakOnDetailOpen
        do {
            try store.saveSettings(updated)
            saveErrorMessage = nil
            savedToast = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                savedToast = false
            }
            return true
        } catch {
            // 失败提示放在页面顶部横幅，避免只写底栏（sheet 关闭后即不可见）
            saveErrorMessage = error.localizedDescription
            return false
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
        testResult = "正在测试连接…"
        // 用当前输入值组一个临时设置做探测
        var temp = store.settings
        temp.baseURL = baseURL
        temp.model = model
        temp.apiKey = apiKey
        Task { @MainActor in
            testResult = await store.testConnection(settings: temp)
            isTesting = false
        }
    }
}

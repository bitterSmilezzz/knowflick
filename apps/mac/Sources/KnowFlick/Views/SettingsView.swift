import SwiftUI
import AVFoundation
import KnowFlickCore

/// 设置页：AI 服务配置
struct SettingsView: View {
    @Bindable var store: AppStore
    @Environment(\.dismiss) private var dismiss

    /// 设置编辑缓冲：可编辑字段的编辑态集中在 SettingsEditBuffer（Core），
    /// 字段清单只维护一处——旧实现要在 onAppear 与 save() 各手抄一份，漏一处即静默丢配置
    @State private var buffer = SettingsEditBuffer(from: .default)
    /// 系统音色列表：枚举 + 排序是重活，若写在 body 里会在任意输入框每次击键时重算，故 onAppear 取一次
    @State private var voiceOptions: [AVSpeechSynthesisVoice] = []
    @State private var newCategoryName = ""
    @State private var newCategoryDesc = ""
    @State private var toast = ToastCenter()
    @State private var saveErrorMessage: String?
    @State private var testResult: String?
    // 分类管理的独立提示：与连通性测试状态分离，避免「分类已存在」被误渲染为连接失败
    @State private var categoryNotice: String?
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
            buffer.baseURL = preset.defaultBaseURL
            if !preset.models.contains(buffer.model) {
                buffer.model = preset.defaultModel
            }
        }
    }

    /// 当前编辑中的分类体系（内置「冷知识」+ 自定义），偏好 chips 与分类管理共用
    private var editingCategoryNames: [String] {
        [CategoryRegistry.builtinCategory] + buffer.customCategories.map(\.name)
    }

    var body: some View {
        ZStack {
            InsightColor.canvas
                .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                header
                if let message = saveErrorMessage {
                    saveErrorBanner(message)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                Divider().overlay(InsightColor.divider)

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        InsightSectionLabel(text: "外观")
                        appearanceCard
                        InsightSectionLabel(text: "AI 服务")
                        aiServiceCard
                        InsightSectionLabel(text: "分类")
                        categoryManagementCard
                        InsightSectionLabel(text: "来源")
                        sourcesCard
                        InsightSectionLabel(text: "语音")
                        speechSettingsCard
                        InsightSectionLabel(text: "数据")
                        dataManagementCard
                        InsightSectionLabel(text: "关于")
                        aboutCard
                    }
                    .padding(18)
                }

                Divider().overlay(InsightColor.divider)
                bottomBar
            }
        }
        // 保存错误横幅的插入/移除动画上下文（此前直接推挤整页）
        .animation(EditorialSpring.state, value: saveErrorMessage)
        .frame(minWidth: 620, idealWidth: 680, minHeight: 520, idealHeight: 700)
        .onAppear {
            buffer = SettingsEditBuffer(from: store.settings)
            selectedProviderId = AIProviderPreset.match(baseURL: store.settings.baseURL).id
            voiceOptions = SpeechSynthesizerService.availableVoices()
        }
        .overlay(alignment: .bottom) {
            InsightToast(center: toast, edge: .bottom)
                .padding(.bottom, 64)
        }
        .overlay {
            if showExportModal {
                ExportCardsModalView(store: store) {
                    showExportModal = false
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .animation(EditorialSpring.content, value: showExportModal)
        .overlay {
            if showImportModal {
                ImportNotesModalView(store: store) {
                    showImportModal = false
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .animation(EditorialSpring.content, value: showImportModal)
    }

    private var header: some View {
        HStack {
            HStack(spacing: 8) {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(InsightColor.textSecondary)
                Text("偏好设置")
                    .font(InsightFont.title)
                    .foregroundStyle(InsightColor.textPrimary)
            }
            Spacer()
            Button("完成") {
                // 保存失败时不关闭：错误以顶部横幅呈现，用户可修正后重试或手动关闭
                if save() { dismiss() }
            }
            .font(InsightFont.bodyStrong)
            .foregroundStyle(InsightColor.textSecondary)
            .padding(.horizontal, 18)
            .padding(.vertical, 6)
            .background(InsightColor.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
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
                .foregroundStyle(InsightColor.danger)
            Text("保存失败：\(message)")
                .font(InsightFont.caption)
                .foregroundStyle(InsightColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button("放弃修改并关闭") {
                dismiss()
            }
            .font(InsightFont.captionSmall)
            .foregroundStyle(InsightColor.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(InsightColor.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
            .buttonStyle(PressableButtonStyle())
            .help("不保存本次修改，直接关闭设置页")
            Button {
                saveErrorMessage = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(InsightColor.textTertiary)
            }
            .buttonStyle(PressableButtonStyle())
            .help("忽略此提示，继续修正")
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(InsightColor.danger.opacity(0.12))
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(InsightColor.danger)
                .frame(width: 3)
        }
    }

    // MARK: - 卡片 0：外观表现（跟随系统 / 深色 / 浅色）
    private var appearanceCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "circle.lefthalf.filled.inverse")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(InsightColor.accent)
                Text("外观模式")
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                Spacer()
                Text(buffer.appearance.title)
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textMuted)
            }

            HStack(spacing: 12) {
                ForEach(AppearanceMode.allCases) { mode in
                    let isSelected = (buffer.appearance == mode)
                    Button {
                        withAnimation(InsightMotion.pill) {
                            // 与其余 18 项一致：仅写入本地编辑态，点击「保存配置」统一生效，
                            // 保证「放弃修改并关闭」承诺可兑现
                            buffer.appearance = mode
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: mode.icon)
                                .font(.system(size: 14, weight: .semibold))
                            Text(mode.title)
                                .font(InsightFont.bodyStrong)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            isSelected
                                ? InsightColor.accentSoft
                                : InsightColor.surface,
                            in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                                .strokeBorder(
                                    isSelected
                                        ? InsightColor.accent
                                        : InsightColor.border,
                                    lineWidth: isSelected ? 1.5 : 1
                                )
                        )
                        .foregroundStyle(
                            isSelected
                                ? InsightColor.accent
                                : InsightColor.textSecondary
                        )
                    }
                    .buttonStyle(PressableButtonStyle(scale: 0.97, playAudio: false))
                }
            }

            Divider().overlay(InsightColor.divider)

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("纸质人文主题")
                        .font(InsightFont.bodyStrong)
                        .foregroundStyle(InsightColor.textPrimary)
                    Spacer()
                    Text(buffer.paperTheme.subtitle)
                        .font(InsightFont.caption)
                        .foregroundStyle(InsightColor.textMuted)
                }

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(PaperTheme.allCases) { theme in
                        let isSelected = (buffer.paperTheme == theme)
                        let palette = PaperThemePalette.colors(for: theme)
                        Button {
                            withAnimation(InsightMotion.pill) {
                                buffer.paperTheme = theme
                            }
                        } label: {
                            HStack(spacing: 10) {
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(palette.canvas)
                                    .frame(width: 24, height: 24)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 6)
                                            .strokeBorder(palette.border, lineWidth: 1)
                                    )

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(theme.title)
                                        .font(InsightFont.bodyStrong)
                                        .foregroundStyle(isSelected ? InsightColor.accent : InsightColor.textPrimary)
                                    Text(theme.subtitle)
                                        .font(InsightFont.captionSmall)
                                        .foregroundStyle(InsightColor.textMuted)
                                }
                                Spacer()
                                if isSelected {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(InsightColor.accent)
                                }
                            }
                            .padding(10)
                            .background(
                                isSelected ? InsightColor.accentSoft : InsightColor.surface,
                                in: RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: InsightRadius.control, style: .continuous)
                                    .strokeBorder(
                                        isSelected ? InsightColor.accent : InsightColor.border,
                                        lineWidth: isSelected ? 1.5 : 1
                                    )
                            )
                        }
                        .buttonStyle(PressableButtonStyle(scale: 0.97, playAudio: false))
                    }
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
                Image(systemName: "cpu")
                    .foregroundStyle(InsightColor.warning)
                Text("AI 驱动服务")
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
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
                                .foregroundStyle(InsightColor.warning)
                                .frame(width: 18)
                            Text(currentPreset.name)
                                .font(InsightFont.bodyStrong)
                                .foregroundStyle(InsightColor.textPrimary)
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 11))
                                .foregroundStyle(InsightColor.textTertiary)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                    }
                }

                if !currentPreset.helpText.isEmpty {
                    Text(currentPreset.helpText)
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textTertiary)
                        .padding(.top, -3)
                }

                // 2. API 地址
                fieldRow(label: "API 地址") {
                    TextField(currentPreset.defaultBaseURL.isEmpty ? "https://..." : currentPreset.defaultBaseURL, text: $buffer.baseURL)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                        .foregroundStyle(InsightColor.textPrimary)
                }

                // 3. 模型选择
                fieldRow(label: "模型选择") {
                    if currentPreset.models.isEmpty {
                        TextField("例如：deepseek-chat、gpt-4o、qwen-plus", text: $buffer.model)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                            .foregroundStyle(InsightColor.textPrimary)
                    } else {
                        HStack(spacing: 8) {
                            Menu {
                                ForEach(currentPreset.models, id: \.self) { m in
                                    Button(m) {
                                        buffer.model = m
                                    }
                                }
                                Divider()
                                Button("手动输入其他模型…") {
                                    if currentPreset.models.contains(buffer.model) {
                                        buffer.model = ""
                                    }
                                }
                            } label: {
                                HStack {
                                    Text(currentPreset.models.contains(buffer.model) ? buffer.model : (buffer.model.isEmpty ? "选择模型…" : "自定义模型"))
                                        .font(InsightFont.callout)
                                        .foregroundStyle(InsightColor.textPrimary)
                                    Spacer()
                                    Image(systemName: "chevron.up.chevron.down")
                                        .font(.system(size: 11))
                                        .foregroundStyle(InsightColor.textTertiary)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .frame(width: 190)
                                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                            }

                            if !currentPreset.models.contains(buffer.model) {
                                TextField("输入具体模型名", text: $buffer.model)
                                    .textFieldStyle(.plain)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                                    .foregroundStyle(InsightColor.textPrimary)
                            }
                        }
                    }
                }

                // 4. API Key
                fieldRow(label: "API Key") {
                    VStack(alignment: .leading, spacing: 4) {
                        SecureField(currentPreset.apiKeyPlaceholder, text: $buffer.apiKey)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                            .foregroundStyle(InsightColor.textPrimary)

                        if !currentPreset.requiresKey {
                            Text("本地离线模型（Ollama 等），无需在应用中配置 Key")
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textMuted)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("优先刷卡分类")
                        .font(InsightFont.captionSmall.weight(.semibold))
                        .foregroundStyle(InsightColor.textTertiary)

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
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textMuted)
                }
                .padding(.top, 4)

                Toggle("卡片不足时自动触发 AI 批量补充", isOn: $buffer.autoGenerate)
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textSecondary)
                    .padding(.top, 2)
            }
        }
        .padding(18)
        .editorialGlassCard(cornerRadius: InsightRadius.inset)
    }

    // MARK: - 卡片 2：分类体系管理

    private var categoryManagementCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "square.grid.2x2")
                    .foregroundStyle(InsightColor.success)
                Text("分类体系与视觉主题")
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
            }

            VStack(alignment: .leading, spacing: 10) {
                // 内置分类
                HStack(spacing: 8) {
                    Circle()
                        .fill(CategoryTheme.visualSpec(for: CategoryRegistry.builtinCategory).accent)
                        .frame(width: 8, height: 8)
                    Text(CategoryRegistry.builtinCategory)
                        .font(InsightFont.callout)
                        .foregroundStyle(InsightColor.textPrimary)
                    Text("（系统内置 · 160 张精选知识底库）")
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textMuted)
                    Spacer()
                    Image(systemName: "lock.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(InsightColor.textMuted)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(InsightColor.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                // 自定义分类列表
                ForEach(buffer.customCategories) { cat in
                    let accent = CategoryTheme.visualSpec(for: cat.name).accent
                    HStack(spacing: 8) {
                        Circle()
                            .fill(accent)
                            .frame(width: 8, height: 8)
                            .shadow(color: accent.opacity(0.5), radius: 4, y: 1)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(cat.name)
                                .font(InsightFont.callout)
                                .foregroundStyle(InsightColor.textPrimary)
                            Text(cat.description.isEmpty ? "未指定方向" : cat.description)
                                .font(InsightFont.captionSmall)
                                .foregroundStyle(InsightColor.textTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        Button {
                            buffer.selectedCategories.remove(cat.name)
                            buffer.customCategories.removeAll { $0.name == cat.name }
                        } label: {
                            Image(systemName: "trash")
                                .font(.system(size: 11))
                                .foregroundStyle(InsightColor.danger.opacity(0.75))
                        }
                        .buttonStyle(PressableButtonStyle(scale: 0.85, playAudio: false))
                        .help("删除该分类")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
                .animation(EditorialSpring.state, value: buffer.customCategories)

                // 添加分类
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        TextField("新分类名（如：认知心理学）", text: $newCategoryName)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                            .foregroundStyle(InsightColor.textPrimary)
                            .frame(width: 170)

                        TextField("内容方向（AI 生成参考，可留空）", text: $newCategoryDesc)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                            .foregroundStyle(InsightColor.textPrimary)

                        Button("添加") {
                            addCategory()
                        }
                        .font(InsightFont.callout)
                        .foregroundStyle(InsightColor.textPrimary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(InsightColor.surfaceRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.borderStrong, lineWidth: 1))
                        .buttonStyle(PressableButtonStyle())
                        .disabled(newCategoryName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    Text("新增分类后，系统将自动映射唯一的摄影底图与主题色彩")
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textMuted)

                    if let notice = categoryNotice {
                        Label(notice, systemImage: "exclamationmark.circle.fill")
                            .font(InsightFont.captionSmall)
                            .foregroundStyle(InsightColor.warning)
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(18)
        .editorialGlassCard(cornerRadius: InsightRadius.inset)
    }

    // MARK: - 卡片 3：信息来源与偏好

    private var sourcesCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "newspaper")
                    .foregroundStyle(InsightColor.textSecondary)
                Text("内容来源与呈现")
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
            }

            VStack(alignment: .leading, spacing: 12) {
                Toggle("启用预置精选知识库", isOn: $buffer.enableSeed)
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textPrimary)

                Toggle("启用 AI 智能生成卡片", isOn: $buffer.enableAI)
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textPrimary)

                fieldRow(label: "权威来源偏好") {
                    TextField("维基百科, 国家地理, NASA", text: $buffer.aiSources)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                        .foregroundStyle(InsightColor.textPrimary)
                }

                Toggle("在卡片与详情页标注「AI 生成」徽章", isOn: $buffer.showAIMark)
                    .font(InsightFont.callout)
                    .foregroundStyle(InsightColor.textPrimary)
            }
        }
        .padding(18)
        .editorialGlassCard(cornerRadius: InsightRadius.inset)
    }

    // MARK: - 卡片：智能语音与磨耳朵 (Smart TTS)

    private var speechSettingsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "headphones")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(InsightColor.accent)
                Text("语音与连续朗读")
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                Spacer()
                Text("系统 · 云端 · 本地服务")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.success)
            }

            Divider().overlay(InsightColor.divider)

            // 默认语速倍率
            SpeechSettingsEditor(settings: $buffer.speech)

            fieldRow(label: "默认朗读语速 (当前: \(String(format: "%.2fx", buffer.speechRate)))") {
                HStack(spacing: 12) {
                    Slider(value: $buffer.speechRate, in: 0.75...2.0, step: 0.25)
                        .tint(InsightColor.success)

                    HStack(spacing: 6) {
                        ForEach([0.75, 1.0, 1.25, 1.5, 2.0], id: \.self) { rate in
                            Button("\(String(format: "%.2f", rate))x") {
                                buffer.speechRate = Float(rate)
                            }
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(abs(buffer.speechRate - Float(rate)) < 0.05 ? InsightColor.textPrimary : InsightColor.textTertiary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(abs(buffer.speechRate - Float(rate)) < 0.05 ? InsightColor.success.opacity(0.3) : InsightColor.surface, in: RoundedRectangle(cornerRadius: 4))
                            .buttonStyle(PressableButtonStyle(scale: 0.92, playAudio: false))
                        }
                    }
                    .animation(InsightMotion.tactile, value: buffer.speechRate)
                }
            }

            // 默认音调倍率（仅系统合成器生效）
            fieldRow(label: "默认朗读音调 (当前: \(String(format: "%.2fx", buffer.speechPitch)))") {
                HStack(spacing: 12) {
                    Slider(value: $buffer.speechPitch, in: 0.5...2.0, step: 0.05)
                        .tint(InsightColor.accent)

                    HStack(spacing: 6) {
                        ForEach([("低沉", 0.85), ("自然", 1.0), ("清亮", 1.15)], id: \.1) { name, value in
                            Button(name) {
                                buffer.speechPitch = Float(value)
                            }
                            .font(InsightFont.captionSmall.weight(.medium))
                            .foregroundStyle(abs(buffer.speechPitch - Float(value)) < 0.05 ? InsightColor.textPrimary : InsightColor.textTertiary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(abs(buffer.speechPitch - Float(value)) < 0.05 ? InsightColor.accent.opacity(0.28) : InsightColor.surface, in: RoundedRectangle(cornerRadius: 4))
                            .buttonStyle(PressableButtonStyle(scale: 0.92, playAudio: false))
                        }
                    }
                    .animation(InsightMotion.tactile, value: buffer.speechPitch)
                }
            }

            // 磨耳朵换卡缓冲时间
            fieldRow(label: "磨耳朵模式换卡缓冲间隔 (当前: \(String(format: "%.1f", buffer.ambientGapSeconds)) 秒)") {
                HStack(spacing: 10) {
                    ForEach([1.0, 1.5, 2.0, 3.0], id: \.self) { sec in
                        Button("\(String(format: "%.1f", sec)) 秒") {
                            buffer.ambientGapSeconds = sec
                        }
                        .font(InsightFont.captionSmall.weight(.medium))
                        .foregroundStyle(abs(buffer.ambientGapSeconds - sec) < 0.1 ? InsightColor.textPrimary : InsightColor.textTertiary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(abs(buffer.ambientGapSeconds - sec) < 0.1 ? InsightColor.accent.opacity(0.25) : InsightColor.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(abs(buffer.ambientGapSeconds - sec) < 0.1 ? InsightColor.accent.opacity(0.6) : InsightColor.border, lineWidth: 1))
                        .buttonStyle(PressableButtonStyle(scale: 0.92, playAudio: false))
                    }
                }
                .animation(InsightMotion.tactile, value: buffer.ambientGapSeconds)
            }

            // 声音选择
            fieldRow(label: "系统音色（系统模式与离线兜底使用）") {
                Picker("", selection: $buffer.speechVoiceIdentifier) {
                    Text("自动选择已下载的高质量音色（推荐）").tag("auto")
                    ForEach(voiceOptions, id: \.identifier) { voice in
                        Text("\(voice.name) · \(voice.language)\(voice.quality == .default ? " · 标准" : " · 高质量")").tag(voice.identifier)
                    }
                }
                .labelsHidden()
            }

            // 试听与自动朗读
            HStack {
                Toggle("进入详情页时自动开启语音导读", isOn: $buffer.autoSpeakOnDetailOpen)
                    .toggleStyle(SwitchToggleStyle(tint: InsightColor.success))
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textSecondary)

                Spacer()

                Button {
                    store.speechService.preview(configuration: buffer.speech, voice: buffer.speechVoiceIdentifier, speed: buffer.speechRate, pitch: buffer.speechPitch)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "speaker.wave.2")
                        Text("试听发音")
                    }
                    .font(InsightFont.captionSmall.weight(.semibold))
                    .foregroundStyle(InsightColor.textPrimary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(InsightColor.surface, in: Capsule())
                    .overlay(Capsule().strokeBorder(InsightColor.border, lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
            }
            if store.speechService.isPreparing {
                ProgressView("正在生成语音…")
                    .font(InsightFont.caption)
                    .transition(.opacity)
            }
            if store.speechService.state != .idle {
                // 文案承诺「停止播放」：必须同时停常规朗读与磨耳朵连续播报（stopSpeech 内部两者都停），
                // 此前只调 stopAmbientMode，详情页朗读中点此按钮无任何反应。
                Button("停止播放") { store.stopSpeech() }
                    .transition(.opacity)
            }
            if let error = store.speechService.lastError {
                Text(error)
                    .font(InsightFont.caption)
                    .foregroundStyle(InsightColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
        }
        .animation(EditorialSpring.state, value: store.speechService.isPreparing)
        .animation(EditorialSpring.state, value: store.speechService.state == .idle)
        .animation(EditorialSpring.state, value: store.speechService.lastError)
        .padding(18)
        .editorialGlassCard(cornerRadius: InsightRadius.inset)
    }

    // MARK: - 卡片 3.5：数据管理与迁移 (导入与导出)

    private var dataManagementCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .foregroundStyle(InsightColor.accent)
                Text("数据管理与双向迁移")
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                Spacer()
                Text("Markdown · Obsidian · Anki · JSON")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textSecondary)
            }

            Text("支持将卡库或收藏阁批量导出为多种笔记与闪卡格式；亦支持将个人 Markdown 笔记或长文通过规则与 AI 解构导入为知识闪卡。")
                .font(InsightFont.captionSmall)
                .foregroundStyle(InsightColor.textTertiary)

            HStack(spacing: 12) {
                Button {
                    showExportModal = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.arrow.up")
                        Text("批量导出知识卡片…")
                    }
                    .font(InsightFont.bodyStrong)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                    .foregroundStyle(InsightColor.textPrimary)
                }
                .buttonStyle(PressableButtonStyle())

                Button {
                    showImportModal = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.arrow.down")
                        Text("导入笔记为卡片…")
                    }
                    .font(InsightFont.bodyStrong)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
                    .foregroundStyle(InsightColor.textPrimary)
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
                    .foregroundStyle(InsightColor.accent)
                Text("知识库状态")
                    .font(InsightFont.headline)
                    .foregroundStyle(InsightColor.textPrimary)
                Spacer()
                Text("共 \(store.cards.count) 张 · 待探索 \(store.deck.count) 张")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textSecondary)
            }

            HStack {
                Text("已刷完想再次回顾，或想重新体验全新的分类背景，可随时重置探索状态。")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textTertiary)
                Spacer()
                Button("重新探索全部卡片") {
                    store.clearHistory()
                }
                .buttonStyle(PressableButtonStyle(scale: 0.97))
                .font(InsightFont.callout)
                .foregroundStyle(InsightColor.textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
            }

            Divider().overlay(InsightColor.divider)

            HStack(spacing: 10) {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 14))
                    .foregroundStyle(InsightColor.textTertiary)
                Text("API Key 仅安全存储于 macOS 原生钥匙串（Keychain），绝不会明文保存在本地 JSON 或向外部泄露。")
                    .font(InsightFont.captionSmall)
                    .foregroundStyle(InsightColor.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider().overlay(InsightColor.divider)

            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "app.badge.checkmark")
                        .font(.system(size: 13))
                        .foregroundStyle(InsightColor.accent)
                    Text("KnowFlick v" + AppVersion.current)
                        .font(InsightFont.captionSmall)
                        .foregroundStyle(InsightColor.textTertiary)
                }
                Spacer()
                Link(destination: URL(string: "https://github.com/bitterSmilezzz/knowflick")!) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 11))
                        Text("版本与更新说明")
                            .font(InsightFont.captionSmall)
                    }
                    .foregroundStyle(InsightColor.accent.opacity(0.85))
                }
            }
        }
        .padding(16)
        .editorialGlassCard(cornerRadius: InsightRadius.inset)
    }

    // MARK: - 底栏操作

    private var bottomBar: some View {
        HStack {
            connectionStatus

            Spacer()

            Button("测试连通性") {
                testConnection()
            }
            .font(InsightFont.callout)
            .foregroundStyle(InsightColor.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(InsightColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(InsightColor.border, lineWidth: 1))
            .buttonStyle(PressableButtonStyle())
            .disabled(isTesting || (currentPreset.requiresKey && buffer.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))

            Button("保存配置") {
                save()
            }
            .font(InsightFont.bodyStrong)
            .foregroundStyle(Color.black.opacity(0.85))
            .padding(.horizontal, 20)
            .padding(.vertical, 7)
            .background(InsightColor.success, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .buttonStyle(PressableButtonStyle(scale: 0.97))
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
                .foregroundStyle(InsightColor.textSecondary)
            } else if let result = testResult {
                let succeeded = result.hasPrefix("连接成功")
                Label(result, systemImage: succeeded ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundStyle(succeeded ? InsightColor.success : InsightColor.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(succeeded ? "连接测试成功：\(result)" : "连接测试失败：\(result)")
            } else {
                Text("测试连接会使用当前输入的配置")
                    .foregroundStyle(InsightColor.textTertiary)
            }
        }
        .font(InsightFont.caption)
        .lineLimit(2)
        .animation(EditorialSpring.state, value: isTesting)
        .animation(EditorialSpring.state, value: testResult)
    }

    private func fieldRow<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(InsightFont.captionSmall.weight(.semibold))
                .foregroundStyle(InsightColor.textTertiary)
            content()
        }
    }

    /// 偏好分类选择 chip
    private func categoryChip(_ cat: String) -> some View {
        let selected = buffer.selectedCategories.contains(cat)
        let accent = CategoryTheme.visualSpec(for: cat).accent
        return Button {
            if selected {
                buffer.selectedCategories.remove(cat)
            } else {
                buffer.selectedCategories.insert(cat)
            }
        } label: {
            HStack(spacing: 5) {
                Circle()
                    .fill(accent)
                    .frame(width: 6, height: 6)
                Text(cat)
                    .font(InsightFont.captionSmall)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(selected ? accent.opacity(0.2) : InsightColor.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? accent.opacity(0.7) : InsightColor.border, lineWidth: 1))
            .foregroundStyle(selected ? InsightColor.textPrimary : InsightColor.textSecondary)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
    }

    /// 保存：key 进 Keychain + 其余进 JSON，由 AppStore 单点负责分置落盘
    /// 返回是否成功；失败时在设置页顶部展示可见错误，调用方不应关闭页面
    @discardableResult
    private func save() -> Bool {
        // 拷出与清洗集中在 SettingsEditBuffer.applying(to:)（trim / 已删分类清理都在那里）；
        // 非编辑字段（如自动补卡节流时间戳）从 store.settings 原样保留
        let updated = buffer.applying(to: store.settings)
        do {
            try store.saveSettings(updated)
            saveErrorMessage = nil
            toast.show("配置已保存", style: .success)
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
        guard name != CategoryRegistry.builtinCategory, !buffer.customCategories.contains(where: { $0.name == name }) else {
            categoryNotice = "分类「\(name)」已存在"
            return
        }
        categoryNotice = nil
        buffer.customCategories.append(CategoryConfig(
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
        temp.baseURL = buffer.baseURL
        temp.model = buffer.model
        temp.apiKey = buffer.apiKey
        Task { @MainActor in
            testResult = await store.testConnection(settings: temp)
            isTesting = false
        }
    }
}

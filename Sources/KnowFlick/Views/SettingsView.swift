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

    private let presetModels = ["deepseek-chat", "deepseek-reasoner"]

    /// 当前编辑中的分类体系（内置「冷知识」+ 自定义），偏好 chips 与分类管理共用
    private var editingCategoryNames: [String] {
        [CategoryRegistry.builtinCategory] + customCategories.map(\.name)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("设置")
                    .font(.title2.bold())
                Spacer()
                Button("完成") {
                    save()
                    dismiss()
                }
                .keyboardShortcut(.escape, modifiers: [])
            }
            .padding(20)

            Divider()

            Form {
                Section("AI 服务") {
                    LabeledContent("API 地址") {
                        TextField("https://api.deepseek.com", text: $baseURL)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 320)
                    }
                    LabeledContent("模型") {
                        Picker("", selection: $model) {
                            ForEach(presetModels, id: \.self) { Text($0) }
                            Text("自定义…").tag("")
                        }
                        .frame(width: 180)
                        if !presetModels.contains(model) {
                            TextField("模型名", text: $model)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 320)
                        }
                    }
                    LabeledContent("API Key") {
                        SecureField("sk-...", text: $apiKey)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 320)
                    }
                    LabeledContent("偏好分类") {
                        VStack(alignment: .leading, spacing: 6) {
                            ScrollView {
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 74), spacing: 6)], alignment: .leading, spacing: 6) {
                                    ForEach(editingCategoryNames, id: \.self) { cat in
                                        categoryChip(cat)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                            .frame(maxHeight: 104)
                            Text("选中后刷卡优先这些分类，刷完自动回退其他；全不选 = 全部")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Toggle("卡片不足时自动让 AI 补充", isOn: $autoGenerate)
                }

                Section("分类管理") {
                    // 内置分类（不可删改）
                    HStack {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                        Text(CategoryRegistry.builtinCategory)
                            .font(.system(size: 13, weight: .medium))
                        Text("内置 · 收纳预置知识库")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(.vertical, 3)

                    // 自定义分类列表
                    ForEach(customCategories) { cat in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(cat.name)
                                    .font(.system(size: 13, weight: .semibold))
                                Text(cat.description.isEmpty ? "未填写内容方向" : cat.description)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Button {
                                selectedCategories.remove(cat.name)
                                customCategories.removeAll { $0.name == cat.name }
                            } label: {
                                Image(systemName: "trash")
                                    .font(.system(size: 11))
                                    .foregroundStyle(.red.opacity(0.75))
                            }
                            .buttonStyle(.plain)
                            .help("删除该分类")
                        }
                        .padding(.vertical, 2)
                    }

                    // 添加分类
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            TextField("分类名（如：前端开发）", text: $newCategoryName)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 170)
                            TextField("内容方向描述（AI 生成时参考，可留空）", text: $newCategoryDesc)
                                .textFieldStyle(.roundedBorder)
                            Button("添加") {
                                addCategory()
                            }
                            .disabled(newCategoryName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        Text("自定义分类可增删改；AI 生成时按分类内容方向产出对应领域卡片")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 4)
                }

                Section("信息来源") {
                    Toggle("预置精选库", isOn: $enableSeed)
                    Toggle("AI 生成内容", isOn: $enableAI)
                    LabeledContent("AI 引用站点") {
                        TextField("维基百科, 国家地理, NASA", text: $aiSources)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 280)
                    }
                    Text("AI 生成卡片时只从这些站点中引用来源，检索链接优先命中。留空则使用默认权威站点。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Toggle("显示 AI 内容标记", isOn: $showAIMark)
                    Text("开启后 AI 生成的卡片会在正面和详情页标注「AI 生成」，方便区分内容来源。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("说明") {
                    Text("默认对接 DeepSeek（openai 兼容接口）。API Key 仅存入本机钥匙串，不会写进配置文件。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                if let result = testResult {
                    Label(result, systemImage: isTesting ? "ellipsis" : (result.contains("成功") ? "checkmark.circle" : "xmark.circle"))
                        .font(.caption)
                        .foregroundStyle(isTesting ? Color.secondary : (result.contains("成功") ? Color.green : Color.red))
                }

                Spacer()

                Button("测试连接") {
                    testConnection()
                }
                .disabled(isTesting || apiKey.isEmpty)

                Button("保存") {
                    save()
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(16)
        }
        .frame(width: 580, height: 640)
        .onAppear {
            baseURL = store.settings.baseURL
            model = store.settings.model
            apiKey = store.settings.apiKey
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
                Text("已保存")
                    .font(.callout)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.green.opacity(0.85), in: Capsule())
                    .padding(.bottom, 64)
                    .transition(.opacity)
            }
        }
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
            // 钥匙串写入失败等错误要显式可见，不再静默
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

    /// 偏好分类选择 chip
    private func categoryChip(_ cat: String) -> some View {
        let selected = selectedCategories.contains(cat)
        return Button {
            if selected {
                selectedCategories.remove(cat)
            } else {
                selectedCategories.insert(cat)
            }
        } label: {
            Text(cat)
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(selected ? Color.accentColor.opacity(0.16) : Color.white.opacity(0.06), in: Capsule())
                .overlay(Capsule().strokeBorder(selected ? Color.accentColor.opacity(0.6) : Color.white.opacity(0.12), lineWidth: 1))
                .foregroundStyle(selected ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.96))
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

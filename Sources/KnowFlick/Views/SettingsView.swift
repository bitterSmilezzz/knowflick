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
    @State private var selectedCategories: Set<String> = []   // 偏好分类（白名单多选）
    @State private var savedToast = false
    @State private var testResult: String?
    @State private var isTesting = false

    private let presetModels = ["deepseek-chat", "deepseek-reasoner"]

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
                                    ForEach(CategoryRegistry.canonical, id: \.self) { cat in
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
        .frame(width: 560, height: 480)
        .onAppear {
            baseURL = store.settings.baseURL
            model = store.settings.model
            apiKey = store.settings.apiKey
            autoGenerate = store.settings.autoGenerate
            selectedCategories = Set(store.settings.preferredCategories)
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
        updated.setPreferredCategories(Array(selectedCategories))
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

import SwiftUI

/// 设置页：AI 服务配置
struct SettingsView: View {
    @Bindable var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var baseURL = ""
    @State private var model = ""
    @State private var apiKey = ""
    @State private var autoGenerate = true
    @State private var categoryFilter = ""
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
                        TextField("留空=全部（如：物理, 天文）", text: $categoryFilter)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 320)
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
                    savedToast = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        savedToast = false
                    }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(16)
        }
        .frame(width: 560, height: 420)
        .onAppear {
            baseURL = store.settings.baseURL
            model = store.settings.model
            apiKey = store.settings.apiKey
            autoGenerate = store.settings.autoGenerate
            categoryFilter = store.settings.categoryFilter
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

    private func save() {
        store.settings.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        store.settings.model = model.trimmingCharacters(in: .whitespacesAndNewlines)
        store.settings.autoGenerate = autoGenerate
        store.settings.categoryFilter = categoryFilter.trimmingCharacters(in: .whitespacesAndNewlines)
        store.settings.apiKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        // key 单独进 Keychain
        KeychainHelper.save(store.settings.apiKey)
        var persisted = store.settings
        persisted.apiKey = ""
        Storage.saveSettings(persisted)
    }

    private func testConnection() {
        isTesting = true
        testResult = nil
        // 用当前输入值组一个临时设置做轻量请求
        var temp = store.settings
        temp.baseURL = baseURL
        temp.model = model
        temp.apiKey = apiKey
        Task {
            let service = AIService()
            do {
                _ = try await service.generateCards(settings: temp, count: 1, excludeHeadlines: [])
                testResult = "连接成功，AI 可正常生成"
            } catch {
                testResult = error.localizedDescription
            }
            isTesting = false
        }
    }
}

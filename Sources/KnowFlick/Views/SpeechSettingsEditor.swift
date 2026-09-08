import SwiftUI
import KnowFlickCore

struct SpeechSettingsEditor: View {
    @Binding var settings: SpeechSettings

    private var selectedIndex: Int? { settings.profiles.firstIndex { $0.id == settings.selectedID } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("朗读引擎", selection: $settings.selectedID) {
                Text("系统语音 · 离线").tag("system")
                ForEach(settings.profiles) { profile in
                    Text(profile.name).tag(profile.id)
                }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)

            if let index = selectedIndex {
                profileFields(index: index)
            } else {
                Text("无需 API Key 或模型文件。优先使用已下载的增强 / 优质声音；你也可以在下方指定音色。")
                    .font(EditorialFont.caption)
                    .foregroundStyle(EditorialColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Link("在系统设置中下载更高质量声音", destination: URL(string: "x-apple.systempreferences:com.apple.preference.universalaccess?SpokenContent")!)
                    .font(EditorialFont.caption)
            }

            Button("添加另一套云端 / 本地语音配置", systemImage: "plus") {
                let profile = SpeechProfile(name: "自定义语音服务", baseURL: "https://", model: "", voice: "")
                settings.profiles.append(profile)
                settings.selectedID = profile.id
            }
            .font(EditorialFont.caption)

            Text("可保存多套配置，每次只启用一个引擎。语音模型与生成知识的聊天模型独立；普通聊天模型不能直接发声。")
                .font(EditorialFont.caption)
                .foregroundStyle(EditorialColor.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .textFieldStyle(.roundedBorder)
    }

    private func profileFields(index: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            field("配置名称", value: $settings.profiles[index].name)
            field("API Base URL", value: $settings.profiles[index].baseURL)
            field("语音模型 Model", value: $settings.profiles[index].model)
            field("音色 Voice", value: $settings.profiles[index].voice)
            VStack(alignment: .leading, spacing: 4) {
                Text("此语音服务的 API Key").font(EditorialFont.caption)
                SecureField("本机服务可留空；云端填写独立密钥", text: $settings.profiles[index].apiKey)
            }
            Text(settings.profiles[index].isLocal
                 ? "本地模式连接已运行的 /audio/speech 服务。模型文件由服务加载，本应用不直接导入模型权重。"
                 : "点击朗读或试听时，文本将发送到上方服务地址合成音频，并可能产生服务费用。密钥只存 Keychain。")
                .font(EditorialFont.caption)
                .foregroundStyle(EditorialColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Toggle("服务失败时自动使用系统声音", isOn: $settings.fallbackToSystem)
                .font(EditorialFont.caption)
            Button("移除此配置", role: .destructive) {
                settings.selectedID = "system"
                settings.profiles.remove(at: index)
            }.font(EditorialFont.caption)
        }
    }

    private func field(_ title: String, value: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(EditorialFont.caption)
            TextField(title, text: value)
                .labelsHidden()
        }
    }
}

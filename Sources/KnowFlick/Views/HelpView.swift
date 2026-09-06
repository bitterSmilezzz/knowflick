import SwiftUI

/// 快捷键速查
struct HelpView: View {
    let onClose: () -> Void

    private struct ShortcutRow: Identifiable {
        let keys: String
        let action: String
        let id = UUID()
    }

    private let mainShortcuts: [ShortcutRow] = [
        .init(keys: "← / →", action: "上一张 / 下一张（划卡）"),
        .init(keys: "⏎", action: "展开卡片详情"),
        .init(keys: "⌘Z", action: "撤销上一张"),
        .init(keys: "⌘N", action: "AI 生成 3 张新卡"),
        .init(keys: "Esc", action: "关闭详情 / 历史 / 设置"),
    ]

    private let detailShortcuts: [ShortcutRow] = [
        .init(keys: "← / →", action: "上一张 / 下一张（详情间切换）"),
        .init(keys: "⏎ / Esc", action: "关闭详情"),
        .init(keys: "⌘Z", action: "撤销上一张"),
    ]

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.085, green: 0.095, blue: 0.12), Color(red: 0.045, green: 0.05, blue: 0.065)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Text("快捷键")
                        .font(.custom("Songti SC Black", size: 20))
                        .foregroundStyle(Color(red: 0.96, green: 0.95, blue: 0.92))
                    Spacer()
                    Button(action: onClose) {
                        Text("完成")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.75))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 7)
                            .background(Color.white.opacity(0.08), in: Capsule())
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
                    }
                    .buttonStyle(PressableButtonStyle())
                    .keyboardShortcut(.escape, modifiers: [])
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)

                Divider().overlay(Color.white.opacity(0.08))

                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        shortcutSection(title: "主界面", rows: mainShortcuts)
                        shortcutSection(title: "详情页", rows: detailShortcuts)
                        Text("提示：详情页内点「不喜欢 / 跳过 / 感兴趣」会直接切到下一张，可连续刷卡。")
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.4))
                    }
                    .padding(24)
                }
            }
        }
        .preferredColorScheme(.dark)
        .frame(width: 480, height: 420)
    }

    private func shortcutSection(title: String, rows: [ShortcutRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.55))
            VStack(spacing: 8) {
                ForEach(rows) { row in
                    HStack {
                        Text(row.keys)
                            .font(.system(size: 12.5, weight: .bold, design: .monospaced))
                            .foregroundStyle(Color(red: 0.95, green: 0.72, blue: 0.42))
                            .frame(width: 96, alignment: .leading)
                        Text(row.action)
                            .font(.system(size: 13))
                            .foregroundStyle(.white.opacity(0.85))
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
                    )
                }
            }
        }
    }
}

import SwiftUI

/// 快捷键帮助弹窗
struct HelpView: View {
    let onClose: () -> Void

    private struct ShortcutRow: Identifiable {
        let id = UUID()
        let keys: String
        let action: String
    }

    private let mainShortcuts: [ShortcutRow] = [
        .init(keys: "⌘ F", action: "全局智能搜索与全文检索（支持拼音）"),
        .init(keys: "←", action: "不喜欢（划走）"),
        .init(keys: "→", action: "感兴趣（划走）"),
        .init(keys: "⏎ 回车", action: "展开卡片详情与来源链接"),
        .init(keys: "⌘ J", action: "向卡片追问（AI 伴学导师深入探讨）"),
        .init(keys: "⌘ P", action: "语音朗读 / 暂停（当前卡片）"),
        .init(keys: "⇧⌘ P", action: "开启 / 退出磨耳朵连续播报"),
        .init(keys: "⌘ K", action: "开启沉浸式知识测验"),
        .init(keys: "⌘ G", action: "探索全景知识星图与引力链"),
        .init(keys: "⌘ B", action: "打开知识收藏阁（沉淀笔记）"),
        .init(keys: "⌘ S", action: "生成并导出分享海报"),
        .init(keys: "⌘ Z", action: "撤销上一张卡片"),
        .init(keys: "⌘ N", action: "AI 生成 3 张新知识"),
        .init(keys: "⌘ ?", action: "打开此快捷键面板"),
        .init(keys: "⌘ ,", action: "打开偏好设置"),
        .init(keys: "Esc", action: "关闭弹出的面板")
    ]

    private let quizShortcuts: [ShortcutRow] = [
        .init(keys: "⌘ K", action: "开启知识测验 (Flashcard Quiz)"),
        .init(keys: "␣ 空格 / ⏎", action: "翻转卡片（查看背面答案与解析）"),
        .init(keys: "⌘ 1", action: "自评：没想起来（完全遗忘）"),
        .init(keys: "⌘ 2", action: "自评：犹豫想起（模糊记忆）"),
        .init(keys: "⌘ 3", action: "自评：熟练掌握（清晰再认）"),
        .init(keys: "Esc", action: "退出当前测验")
    ]

    private let detailShortcuts: [ShortcutRow] = [
        .init(keys: "⌘ J", action: "向当前知识卡片深入探讨追问"),
        .init(keys: "⌘ P", action: "朗读 / 暂停全文语音"),
        .init(keys: "⌘ D", action: "收藏 / 取消收藏当前卡片"),
        .init(keys: "⌘ S", action: "导出精美分享海报"),
        .init(keys: "←", action: "切换到上一张历史卡片"),
        .init(keys: "→", action: "切换到下一张待刷卡片"),
        .init(keys: "⏎ 或 Esc", action: "关闭详情"),
        .init(keys: "⌘ Z", action: "撤销上一张卡片")
    ]

    var body: some View {
        ZStack {
            EditorialColor.canvasGradient.ignoresSafeArea()
            NoiseOverlay().ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Text("快捷键")
                        .font(EditorialFont.modalTitle)
                        .foregroundStyle(EditorialColor.textPrimary)
                    Spacer()
                    Button(action: onClose) {
                        Text("完成")
                            .font(EditorialFont.label)
                            .foregroundStyle(EditorialColor.textSecondary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 7)
                            .background(EditorialColor.glassSurface, in: Capsule())
                            .overlay(Capsule().strokeBorder(EditorialColor.glassBorder, lineWidth: 1))
                    }
                    .buttonStyle(PressableButtonStyle())
                    .keyboardShortcut(.escape, modifiers: [])
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)

                Divider().overlay(EditorialColor.glassDivider)

                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        shortcutSection(title: "主界面", rows: mainShortcuts)
                        shortcutSection(title: "知识测验 (Flashcard)", rows: quizShortcuts)
                        shortcutSection(title: "详情页", rows: detailShortcuts)
                        Text("提示：测验支持全键盘盲操，按空格翻转卡片，按 ⌘1/⌘2/⌘3 快速自评并推进下一题。")
                            .font(EditorialFont.caption)
                            .foregroundStyle(EditorialColor.textMuted)
                    }
                    .padding(24)
                }
            }
        }
        .frame(width: 480, height: 420)
    }

    private func shortcutSection(title: String, rows: [ShortcutRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(EditorialFont.label)
                .foregroundStyle(EditorialColor.textTertiary)
            VStack(spacing: 8) {
                ForEach(rows) { row in
                    HStack {
                        Text(row.keys)
                            .font(.system(size: 12.5, weight: .bold, design: .monospaced))
                            .foregroundStyle(EditorialColor.aiAmber)
                            .frame(width: 96, alignment: .leading)
                        Text(row.action)
                            .font(EditorialFont.bodySerif)
                            .foregroundStyle(EditorialColor.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(EditorialColor.glassSurface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(EditorialColor.glassBorder, lineWidth: 1)
                    )
                }
            }
        }
    }
}

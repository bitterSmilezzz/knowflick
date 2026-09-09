import SwiftUI

/// Keep shortcuts registered even while the in-window menu is collapsed.
struct MacActions {
    let canOpen: Bool
    let hasCard: Bool
    let canUndo: Bool
    let open: (ActiveSheet) -> Void
    let toggleSpeech: () -> Void
    let toggleAmbient: () -> Void
    let undo: () -> Void
    let generate: () -> Void
    let chat: () -> Void
    let sharePoster: () -> Void
    let refreshDeck: () -> Void
}

private struct MacActionsKey: FocusedValueKey {
    typealias Value = MacActions
}

extension FocusedValues {
    var macActions: MacActions? {
        get { self[MacActionsKey.self] }
        set { self[MacActionsKey.self] = newValue }
    }
}

struct MacCommands: Commands {
    @FocusedValue(\.macActions) private var actions

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("偏好设置…") { actions?.open(.settings) }
                .keyboardShortcut(",", modifiers: .command)
                .disabled(actions?.canOpen != true)
        }

        CommandGroup(replacing: .newItem) {
            Button("AI 生成新知识卡片") { actions?.generate() }
                .keyboardShortcut("n", modifiers: .command)
                .disabled(actions?.canOpen != true)
        }

        CommandGroup(replacing: .undoRedo) {
            Button("撤销上次滑卡") { actions?.undo() }
                .keyboardShortcut("z", modifiers: .command)
                .disabled(actions?.canUndo != true || actions?.canOpen != true)
        }

        CommandMenu("学习与探索") {
            Button("全局智能搜索…") { actions?.open(.search) }
                .keyboardShortcut("f", modifiers: .command)
                .disabled(actions?.canOpen != true)
            Button("知识测验") { actions?.open(.quiz(category: nil)) }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(actions?.canOpen != true)
            Button("知识星图") { actions?.open(.graph) }
                .keyboardShortcut("g", modifiers: .command)
                .disabled(actions?.canOpen != true)
            Button("知识收藏阁") { actions?.open(.favorites) }
                .keyboardShortcut("b", modifiers: .command)
                .disabled(actions?.canOpen != true)
            Button("浏览历史足迹") { actions?.open(.history) }
                .disabled(actions?.canOpen != true)
            Button("学习统计分析") { actions?.open(.stats) }
                .disabled(actions?.canOpen != true)

            Divider()

            Button("向当前卡片追问…") { actions?.chat() }
                .keyboardShortcut("j", modifiers: .command)
                .disabled(actions?.hasCard != true || actions?.canOpen != true)
            Button("朗读 / 暂停当前卡片") { actions?.toggleSpeech() }
                .keyboardShortcut("p", modifiers: .command)
                .disabled(actions?.hasCard != true || actions?.canOpen != true)
            Button("磨耳朵连续朗读") { actions?.toggleAmbient() }
                .keyboardShortcut("p", modifiers: [.shift, .command])
                .disabled(actions?.canOpen != true)
            Button("分享当前卡片海报…") { actions?.sharePoster() }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(actions?.hasCard != true || actions?.canOpen != true)

            Divider()

            Button("换一批新知识") { actions?.refreshDeck() }
                .keyboardShortcut("r", modifiers: .command)
                .disabled(actions?.canOpen != true)
        }

        CommandGroup(replacing: .help) {
            Button("KnowFlick 快捷键帮助") { actions?.open(.help) }
                .keyboardShortcut("?", modifiers: .command)
                .disabled(actions?.canOpen != true)
        }
    }
}

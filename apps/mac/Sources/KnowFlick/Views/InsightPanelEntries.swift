import SwiftUI
import KnowFlickCore

// 星图 / 测验 / 听书的 Cutline 化入口（自 InsightPlaceholderViews.swift 拆出）。

// MARK: - 星图 / 测验 / 听书 —— 仍在深化的功能，给 Cutline 化入口

struct InsightGraphPlaceholder: View {
    @Bindable var store: AppStore
    var onOpen: () -> Void

    var body: some View {
        InsightContentScaffold(
            title: "知识星图",
            subtitle: "Card 之间的关联网络"
        ) {
            InsightEmptyState(
                icon: "point.3.connected.trianglepath.dotted",
                title: "全屏星图",
                message: "星图需要大画布，将在独立窗口中打开。",
                actionTitle: "打开星图",
                action: onOpen
            )
        }
    }
}

struct InsightQuizPlaceholder: View {
    @Bindable var store: AppStore
    var onOpen: () -> Void

    var body: some View {
        InsightContentScaffold(
            title: "知识测验",
            subtitle: "主动回忆，检验记忆"
        ) {
            InsightEmptyState(
                icon: "questionmark.circle",
                title: "开始测验",
                message: "从到期卡片中抽取题目，先回忆再揭晓答案。",
                actionTitle: "开始测验",
                action: onOpen
            )
        }
    }
}

struct InsightConsolePlaceholder: View {
    @Bindable var store: AppStore
    var onOpen: () -> Void

    var body: some View {
        InsightContentScaffold(
            title: "听书",
            subtitle: "语速、音调与睡前淡出"
        ) {
            InsightEmptyState(
                icon: "headphones",
                title: "语音控制台",
                message: "调节朗读档位、定时与淡出曲线。",
                actionTitle: "打开控制台",
                action: onOpen
            )
        }
    }
}

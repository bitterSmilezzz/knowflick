import SwiftUI
import AppKit
import KnowFlickCore

/// 全景交互知识星图：将知识卡片化为浩瀚星宿，以引力线织造学科语义网络
struct KnowledgeGraphView: View {
    let store: AppStore
    var onSelectCard: ((KnowledgeCard) -> Void)? = nil
    let onClose: () -> Void

    @State private var isLoadingGraph = true
    @State private var graphData: KnowledgeGraphData = .init(nodes: [], edges: [])
    @State private var selectedNode: GraphNode? = nil
    @State private var hoveredNode: GraphNode? = nil
    @State private var selectedCategory: String? = nil
    @State private var searchText: String = ""

    // 视口平移与缩放手势
    @State private var panOffset: CGSize = .zero
    @State private var currentDragTranslation: CGSize = .zero
    @State private var zoomScale: CGFloat = 1.0

    // 星尘粒子随机种子
    private let starDustCount = 80
    private let canvasBaseWidth: CGFloat = 1200
    private let canvasBaseHeight: CGFloat = 900

    private var allCategories: [String] {
        Array(Set(graphData.nodes.map(\.category))).sorted()
    }

    private var filteredNodes: [GraphNode] {
        graphData.nodes.filter { node in
            let matchCat = selectedCategory == nil || node.category == selectedCategory
            let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let matchSearch = query.isEmpty || node.headline.lowercased().contains(query) || node.category.lowercased().contains(query)
            return matchCat && matchSearch
        }
    }

    private var connectedNodeIdsForSelectedOrHovered: Set<UUID> {
        guard let active = hoveredNode ?? selectedNode else { return [] }
        var set = Set<UUID>([active.cardId])
        for edge in graphData.edges {
            if edge.sourceId == active.cardId { set.insert(edge.targetId) }
            if edge.targetId == active.cardId { set.insert(edge.sourceId) }
        }
        return set
    }

    var body: some View {
        ZStack {
            // 深邃宇宙星空底色
            deepSpaceBackground
                .ignoresSafeArea()

            // 星图主体交互画布
            GeometryReader { geo in
                ZStack {
                    Canvas { context, size in
                        drawGraph(context: context, size: size)
                    }
                    .frame(width: canvasBaseWidth, height: canvasBaseHeight)
                    .scaleEffect(zoomScale)
                    .offset(x: panOffset.width + currentDragTranslation.width, y: panOffset.height + currentDragTranslation.height)
                    .gesture(panGesture)

                    // 节点轻触与悬停热区层
                    nodeHitTestingLayer
                        .frame(width: canvasBaseWidth, height: canvasBaseHeight)
                        .scaleEffect(zoomScale)
                        .offset(x: panOffset.width + currentDragTranslation.width, y: panOffset.height + currentDragTranslation.height)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            // 顶栏操作区
            VStack(spacing: 0) {
                topBar
                Divider().overlay(Color.white.opacity(0.1))
                categoryFilterBar
                Spacer()
                bottomControls
            }

            // 选中的星宿悬浮名片 (Preview Card Popover)
            if let node = selectedNode, let card = store.cards.first(where: { $0.id == node.cardId }) {
                nodeDetailCard(card: card, node: node)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(200)
            }
        }
        .frame(minWidth: 920, minHeight: 660)
        .overlay {
            if isLoadingGraph {
                ProgressView("正在连接知识…")
                    .padding(20)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .task(id: store.cards) {
            await loadGraph()
        }
    }

    // MARK: - 顶栏

    private var topBar: some View {
        HStack(spacing: 16) {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .frame(width: 32, height: 32)
                    .background(Color.white.opacity(0.08), in: Circle())
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .keyboardShortcut(.escape, modifiers: [])
            .help("关闭星图 (Esc)")

            HStack(spacing: 9) {
                Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(EditorialColor.aiAmber)

                Text("全景知识星图")
                    .font(EditorialFont.modalTitle)
                    .foregroundStyle(Color.white)

                Text("\(graphData.nodes.count) 颗星宿 · \(graphData.edges.count) 条引力线")
                    .font(EditorialFont.captionSmall.weight(.medium))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3.5)
                    .background(Color.white.opacity(0.07), in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
            }

            Spacer()

            // 快速搜索框
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.45))
                TextField("检索星图知识…", text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white)
                    .frame(width: 140)
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(Color.white.opacity(0.4))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(Color.white.opacity(0.06), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
        .background(Color.black.opacity(0.35))
    }

    // MARK: - 学科过滤胶囊栏

    private var categoryFilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                categoryFilterChip(title: "全部星系", isSelected: selectedCategory == nil) {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                        selectedCategory = nil
                    }
                }

                ForEach(allCategories, id: \.self) { cat in
                    let count = graphData.nodes.filter { $0.category == cat }.count
                    categoryFilterChip(
                        title: "\(cat) (\(count))",
                        isSelected: selectedCategory == cat
                    ) {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                            selectedCategory = (selectedCategory == cat) ? nil : cat
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 10)
        }
        .background(Color.black.opacity(0.2))
    }

    private func categoryFilterChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(EditorialFont.captionSmall.weight(isSelected ? .bold : .medium))
                .foregroundStyle(isSelected ? Color.white : Color.white.opacity(0.65))
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(
                    isSelected ? EditorialColor.aiAmber.opacity(0.85) : Color.white.opacity(0.06),
                    in: Capsule()
                )
                .overlay(
                    Capsule().strokeBorder(
                        isSelected ? EditorialColor.aiAmber : Color.white.opacity(0.1),
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(PressableButtonStyle())
    }

    // MARK: - 底栏视口控制

    private var bottomControls: some View {
        HStack(spacing: 14) {
            HStack(spacing: 6) {
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        zoomScale = max(0.6, zoomScale - 0.2)
                    }
                } label: {
                    Image(systemName: "minus")
                        .font(.system(size: 11, weight: .bold))
                }
                .buttonStyle(controlButtonStyle)

                Text("\(Int(zoomScale * 100))%")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.75))
                    .frame(width: 44)

                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        zoomScale = min(2.2, zoomScale + 0.2)
                    }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .bold))
                }
                .buttonStyle(controlButtonStyle)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.black.opacity(0.4), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 1))

            Button {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                    panOffset = .zero
                    currentDragTranslation = .zero
                    zoomScale = 1.0
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 10, weight: .bold))
                    Text("重置视野")
                        .font(EditorialFont.captionSmall)
                }
                .foregroundStyle(Color.white.opacity(0.8))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.black.opacity(0.4), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
            }
            .buttonStyle(PressableButtonStyle())
            .help("重置缩放与平移视野 (空格键)")

            Spacer()

            Text("拖拽画布平移 · 滚轮缩放 · 点击星宿探秘知识灵感")
                .font(EditorialFont.captionSmall)
                .foregroundStyle(Color.white.opacity(0.45))
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
        .background(
            LinearGradient(
                colors: [.clear, Color.black.opacity(0.65)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private var controlButtonStyle: some ButtonStyle {
        PressableButtonStyle()
    }

    // MARK: - Canvas 渲染核心

    private func drawGraph(context: GraphicsContext, size: CGSize) {
        let nodeMap = Dictionary(uniqueKeysWithValues: graphData.nodes.map { ($0.cardId, $0) })
        let activeNode = hoveredNode ?? selectedNode
        let connectedSet = connectedNodeIdsForSelectedOrHovered

        // 1. 绘制引力线 (Edges)
        for edge in graphData.edges {
            guard let src = nodeMap[edge.sourceId], let dst = nodeMap[edge.targetId] else { continue }

            let isEdgeActive = activeNode != nil && (src.cardId == activeNode?.cardId || dst.cardId == activeNode?.cardId)
            let isCategoryMatched = (selectedCategory == nil) || (src.category == selectedCategory && dst.category == selectedCategory)

            var linePath = Path()
            linePath.move(to: CGPoint(x: src.x, y: src.y))
            linePath.addLine(to: CGPoint(x: dst.x, y: dst.y))

            let lineColor = edgeColor(for: edge.kind)
            let opacity: Double = isEdgeActive ? 0.9 : (isCategoryMatched ? 0.22 : 0.05)
            let lineWidth: CGFloat = isEdgeActive ? 2.2 : (isCategoryMatched ? 1.0 : 0.5)

            context.stroke(
                linePath,
                with: .color(lineColor.opacity(opacity)),
                lineWidth: lineWidth
            )
        }

        // 2. 绘制星宿节点 (Nodes)
        for node in graphData.nodes {
            let isNodeActive = (node.cardId == activeNode?.cardId)
            let isConnected = connectedSet.contains(node.cardId)
            let isCategoryMatched = (selectedCategory == nil || node.category == selectedCategory)
            let matchesSearch = searchText.isEmpty || node.headline.localizedCaseInsensitiveContains(searchText)

            let isHighlighted = isNodeActive || isConnected || (activeNode == nil && isCategoryMatched && matchesSearch)
            let dimOpacity = activeNode == nil ? (isCategoryMatched ? 1.0 : 0.18) : (isHighlighted ? 1.0 : 0.12)

            let baseColor = nodeColor(for: node.category)
            let center = CGPoint(x: node.x, y: node.y)
            let radius = node.radius * (isNodeActive ? 1.4 : (isConnected ? 1.15 : 1.0))

            // 外围微弱星宿光晕 (Glow aura)
            let glowRect = CGRect(x: center.x - radius * 2.2, y: center.y - radius * 2.2, width: radius * 4.4, height: radius * 4.4)
            context.fill(
                Path(ellipseIn: glowRect),
                with: .color(baseColor.opacity(0.18 * dimOpacity))
            )

            // 核心星核 (Star core)
            let coreRect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
            context.fill(
                Path(ellipseIn: coreRect),
                with: .color(baseColor.opacity(dimOpacity))
            )

            // 白色高光星芒中心
            let brightCenter = CGRect(x: center.x - radius * 0.45, y: center.y - radius * 0.45, width: radius * 0.9, height: radius * 0.9)
            context.fill(
                Path(ellipseIn: brightCenter),
                with: .color(Color.white.opacity(0.9 * dimOpacity))
            )

            // 已掌握卡片的外层环绕光环
            if node.masteryLevel == 2 {
                let ringRect = CGRect(x: center.x - radius * 1.5, y: center.y - radius * 1.5, width: radius * 3.0, height: radius * 3.0)
                context.stroke(
                    Path(ellipseIn: ringRect),
                    with: .color(EditorialColor.likeGreen.opacity(0.6 * dimOpacity)),
                    lineWidth: 1.0
                )
            }
        }
    }

    // MARK: - 节点交互点击与悬停热区层

    private var nodeHitTestingLayer: some View {
        ZStack {
            ForEach(graphData.nodes) { node in
                Circle()
                    .fill(Color.white.opacity(0.001))
                    .frame(width: max(28, node.radius * 3.0), height: max(28, node.radius * 3.0))
                    .position(x: node.x, y: node.y)
                    .contentShape(Circle())
                    .onHover { isHovering in
                        withAnimation(.easeOut(duration: 0.15)) {
                            hoveredNode = isHovering ? node : nil
                        }
                    }
                    .onTapGesture {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
                            if selectedNode?.id == node.id {
                                selectedNode = nil
                            } else {
                                selectedNode = node
                            }
                        }
                    }
            }
        }
    }

    // MARK: - 选中星宿卡片浮窗 (Node Detail Card)

    private func nodeDetailCard(card: KnowledgeCard, node: GraphNode) -> some View {
        VStack {
            Spacer()

            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(card.category)
                            .font(EditorialFont.badge)
                            .foregroundStyle(nodeColor(for: card.category))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(nodeColor(for: card.category).opacity(0.12), in: Capsule())
                            .overlay(Capsule().strokeBorder(nodeColor(for: card.category).opacity(0.35), lineWidth: 1))

                        Text("\(node.connectionsCount) 条关联引力线")
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(Color.white.opacity(0.6))

                        Spacer()

                        Button {
                            withAnimation { selectedNode = nil }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Color.white.opacity(0.6))
                                .frame(width: 24, height: 24)
                        }
                        .buttonStyle(.plain)
                    }

                    Text(card.headline)
                        .font(.system(size: 16, weight: .bold, design: .serif))
                        .foregroundStyle(Color.white)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(card.summary)
                        .font(EditorialFont.caption)
                        .foregroundStyle(Color.white.opacity(0.75))
                        .fixedSize(horizontal: false, vertical: true)
                        .lineSpacing(3)

                    Divider().overlay(Color.white.opacity(0.15))

                    HStack {
                        Button {
                            onSelectCard?(card)
                            onClose()
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "arrow.up.left.and.arrow.down.right")
                                    .font(.system(size: 11, weight: .bold))
                                Text("查看完整卡片")
                                    .font(EditorialFont.labelSmall)
                            }
                            .foregroundStyle(Color.black)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(Color.white, in: Capsule())
                        }
                        .buttonStyle(PressableButtonStyle())

                        Spacer()

                        Text("点击画布任意处关闭")
                            .font(EditorialFont.captionSmall)
                            .foregroundStyle(Color.white.opacity(0.4))
                    }
                    .padding(.top, 4)
                }
                .padding(18)
                .frame(maxWidth: 420)
                .background(
                    Color(red: 0.10, green: 0.12, blue: 0.16).opacity(0.92)
                )
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.18), lineWidth: 1.2)
                )
                .shadow(color: Color.black.opacity(0.55), radius: 24, y: 10)
                .padding(.bottom, 60)
            }
        }
    }

    // MARK: - 手势驱动

    private var panGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                currentDragTranslation = value.translation
            }
            .onEnded { value in
                panOffset.width += value.translation.width
                panOffset.height += value.translation.height
                currentDragTranslation = .zero
            }
    }

    // MARK: - 宇宙星空背景

    private var deepSpaceBackground: some View {
        ZStack {
            // 深空渐变
            RadialGradient(
                colors: [
                    Color(red: 0.06, green: 0.09, blue: 0.15),
                    Color(red: 0.02, green: 0.03, blue: 0.06)
                ],
                center: .center,
                startRadius: 50,
                endRadius: 700
            )

            // 漫天细小随机星尘 (Star dust)
            Canvas { context, size in
                for i in 0..<starDustCount {
                    let seedX = Double(abs((i * 997 + 13) % 10000)) / 10000.0
                    let seedY = Double(abs((i * 883 + 71) % 10000)) / 10000.0
                    let r = 0.5 + Double(i % 3) * 0.6
                    let alpha = 0.2 + (Double(i % 5) / 5.0) * 0.5
                    let rect = CGRect(x: seedX * size.width, y: seedY * size.height, width: r * 2, height: r * 2)
                    context.fill(Path(ellipseIn: rect), with: .color(Color.white.opacity(alpha)))
                }
            }

            NoiseOverlay().opacity(0.18)
        }
    }

    // MARK: - 辅助逻辑

    private func loadGraph() async {
        isLoadingGraph = true
        let cards = store.cards
        let width = canvasBaseWidth, height = canvasBaseHeight
        let worker = Task.detached(priority: .userInitiated) {
            KnowledgeGraphEngine.buildGraph(from: cards, width: width, height: height)
        }
        let result = await withTaskCancellationHandler {
            await worker.value
        } onCancel: {
            worker.cancel()
        }
        guard !Task.isCancelled else { return }
        graphData = result
        isLoadingGraph = false
    }

    private func nodeColor(for category: String) -> Color {
        switch category {
        case "物理": return Color(red: 0.35, green: 0.65, blue: 0.95)
        case "天文": return Color(red: 0.55, green: 0.50, blue: 0.98)
        case "数学": return Color(red: 0.98, green: 0.70, blue: 0.25)
        case "化学": return Color(red: 0.25, green: 0.85, blue: 0.75)
        case "生物": return Color(red: 0.35, green: 0.85, blue: 0.55)
        case "脑科学", "心理": return Color(red: 0.95, green: 0.45, blue: 0.65)
        case "历史": return Color(red: 0.85, green: 0.60, blue: 0.40)
        case "AI", "AI Agent", "AI 开发": return EditorialColor.aiAmber
        case "编程", "Rust", "Python": return Color(red: 0.30, green: 0.80, blue: 0.95)
        case "投资理财", "中级会计": return Color(red: 0.95, green: 0.80, blue: 0.30)
        default: return Color(red: 0.65, green: 0.70, blue: 0.80)
        }
    }

    private func edgeColor(for kind: RelationKind) -> Color {
        switch kind {
        case .disciplineDeepen: return Color(red: 0.45, green: 0.75, blue: 0.95)
        case .crossDiscipline: return EditorialColor.aiAmber
        case .conceptBridge: return EditorialColor.likeGreen
        case .serendipity: return Color(red: 0.85, green: 0.45, blue: 0.85)
        }
    }
}

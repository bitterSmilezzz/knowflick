import SwiftUI
import AppKit
import KnowFlickCore

// MARK: - 海报风格枚举

public enum CardPosterStyle: String, CaseIterable, Identifiable {
    case editorial = "画报风"
    case polaroid = "拍立得"
    case swiss = "瑞士风"

    public var id: String { rawValue }

    public var icon: String {
        switch self {
        case .editorial: return "newspaper.fill"
        case .polaroid: return "camera.macro"
        case .swiss: return "square.grid.2x2.fill"
        }
    }

    public var description: String {
        switch self {
        case .editorial: return "典雅杂志长图 · 深度知识排版"
        case .polaroid: return "文艺胶片相纸 · 极简生活留白"
        case .swiss: return "国际主义栅格 · 极简高对比现代排版"
        }
    }

    public var canvasSize: CGSize {
        switch self {
        case .editorial: return CGSize(width: 540, height: 760)
        case .polaroid: return CGSize(width: 520, height: 680)
        case .swiss: return CGSize(width: 540, height: 760)
        }
    }
}

// MARK: - 海报渲染统一主视图

public struct CardPosterRendererView: View {
    public let card: KnowledgeCard
    public let style: CardPosterStyle

    private var theme: CategoryTheme {
        CategoryTheme.theme(for: card, cache: .shared)
    }

    public init(card: KnowledgeCard, style: CardPosterStyle) {
        self.card = card
        self.style = style
    }

    public var body: some View {
        Group {
            switch style {
            case .editorial:
                editorialPoster
            case .polaroid:
                polaroidPoster
            case .swiss:
                swissPoster
            }
        }
        .frame(width: style.canvasSize.width, height: style.canvasSize.height)
        .clipped()
    }

    // MARK: - 1. 典雅画报风 (Editorial Magazine Poster)

    private var editorialPoster: some View {
        ZStack(alignment: .topLeading) {
            // 背景底色：高级深墨色质感
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.09, blue: 0.11),
                    Color(red: 0.05, green: 0.05, blue: 0.07),
                    Color(red: 0.03, green: 0.03, blue: 0.04)
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            // 顶部摄影画卷 (比例约占 42%)
            VStack(spacing: 0) {
                ZStack(alignment: .bottom) {
                    if let img = theme.image {
                        Image(nsImage: img)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 540, height: 320)
                            .clipped()
                    } else {
                        LinearGradient(colors: theme.ambient, startPoint: .top, endPoint: .bottom)
                            .frame(width: 540, height: 320)
                    }

                    // 摄影图向底色的自然羽化渐变
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0.0),
                            .init(color: Color(red: 0.08, green: 0.09, blue: 0.11).opacity(0.35), location: 0.6),
                            .init(color: Color(red: 0.08, green: 0.09, blue: 0.11), location: 1.0)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 180)
                }

                Spacer()
            }

            // 前景排版层
            VStack(alignment: .leading, spacing: 0) {
                // 顶栏：印章徽标 + 来源 + 编号
                HStack(spacing: 10) {
                    // 藏书印章徽标
                    HStack(spacing: 6) {
                        Image(systemName: theme.iconName)
                            .font(.system(size: 11, weight: .bold))
                        Text(card.category)
                            .font(.system(size: 12, weight: .bold, design: .serif))
                            .tracking(1.0)
                        Text("·")
                            .font(.system(size: 10, weight: .black))
                            .opacity(0.6)
                        Text(theme.domainCode)
                            .font(.system(size: 10, weight: .heavy, design: .monospaced))
                            .tracking(1.2)
                    }
                    .foregroundStyle(Color.black.opacity(0.92))
                    .padding(.horizontal, 13)
                    .padding(.vertical, 6.5)
                    .background(theme.accent, in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.white.opacity(0.4), lineWidth: 0.8))
                    .shadow(color: Color.black.opacity(0.18), radius: 4, y: 2)

                    // 来源标签
                    Text(card.source == .ai ? "AI 精研" : (card.source == .imported ? "导入笔记" : "预置典藏"))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.85))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.black.opacity(0.4), in: Capsule())
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.2), lineWidth: 0.8))

                    Spacer()

                    // 出版物期号/卡号
                    Text("№ \(String(format: "%04d", Int(CardThemeResolver.deterministicHash(card.headline) % 10000)))")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .tracking(1.5)
                }
                .padding(.horizontal, 36)
                .padding(.top, 32)

                Spacer().frame(height: 185)

                // 核心内容区
                VStack(alignment: .leading, spacing: 0) {
                    // 衬线大标题
                    Text(card.displayHeadline)
                        .font(.system(size: 26, weight: .bold, design: .serif))
                        .foregroundStyle(Color.white)
                        .lineSpacing(6.5)
                        .fixedSize(horizontal: false, vertical: true)
                        .shadow(color: Color.black.opacity(0.7), radius: 6, y: 2)

                    // 主题色彩装饰细条
                    HStack(spacing: 5) {
                        Rectangle()
                            .fill(theme.accent)
                            .frame(width: 44, height: 3.5)
                            .cornerRadius(1.75)
                        Circle()
                            .fill(theme.accent.opacity(0.6))
                            .frame(width: 3.5, height: 3.5)
                    }
                    .padding(.top, 16)
                    .padding(.bottom, 16)

                    // 引言金句 (Summary)
                    HStack(alignment: .top, spacing: 10) {
                        Text("“")
                            .font(.system(size: 34, weight: .bold, design: .serif))
                            .foregroundStyle(theme.accent.opacity(0.85))
                            .offset(y: -4)

                        Text(card.displaySummary)
                            .font(.system(size: 15, weight: .medium, design: .serif))
                            .foregroundStyle(Color.white.opacity(0.92))
                            .lineSpacing(6.0)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 14)
                    .padding(.horizontal, 16)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color.white.opacity(0.045))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                    )

                    // 深度解读精粹 (Details 选段)
                    if let firstDetail = card.details.split(separator: "\n").first, !firstDetail.isEmpty {
                        Text(String(firstDetail))
                            .font(.system(size: 13, weight: .regular))
                            .foregroundStyle(Color.white.opacity(0.68))
                            .lineSpacing(5.5)
                            .lineLimit(3)
                            .padding(.top, 16)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 36)

                Spacer()

                // 底部防伪装饰与品牌印章
                VStack(spacing: 14) {
                    // 精细装饰分割线
                    HStack(spacing: 8) {
                        Rectangle()
                            .fill(Color.white.opacity(0.12))
                            .frame(height: 1)
                        Image(systemName: "diamond.fill")
                            .font(.system(size: 6))
                            .foregroundStyle(theme.accent.opacity(0.75))
                        Rectangle()
                            .fill(Color.white.opacity(0.12))
                            .frame(height: 1)
                    }

                    // 品牌与日期徽章
                    HStack(alignment: .center) {
                        HStack(spacing: 9) {
                            Image(systemName: "f.cursive.circle.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(theme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("KnowFlick")
                                    .font(.system(size: 14, weight: .bold, design: .serif))
                                    .foregroundStyle(Color.white.opacity(0.95))
                                    .tracking(0.8)
                                Text("每天学点新东西 · Daily Knowledge")
                                    .font(.system(size: 9.5, weight: .medium))
                                    .foregroundStyle(Color.white.opacity(0.48))
                            }
                        }

                        Spacer()

                        VStack(alignment: .trailing, spacing: 2) {
                            Text(currentDateFormatted)
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.78))
                            Text("EDITORIAL COLLECTION")
                                .font(.system(size: 8, weight: .heavy))
                                .tracking(1.4)
                                .foregroundStyle(Color.white.opacity(0.35))
                        }
                    }
                }
                .padding(.horizontal, 36)
                .padding(.bottom, 28)
            }
        }
    }

    // MARK: - 2. 文艺拍立得风 (Polaroid Snapshot)

    private var polaroidPoster: some View {
        ZStack {
            // 拍立得复古相纸底色 (温润象牙米白)
            Color(red: 0.985, green: 0.980, blue: 0.970)

            // 相纸微细边框
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.black.opacity(0.08), lineWidth: 1.5)

            VStack(spacing: 0) {
                // 顶部相框区 (方形深凹感照片)
                ZStack(alignment: .bottomLeading) {
                    if let img = theme.image {
                        Image(nsImage: img)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 456, height: 380)
                            .clipped()
                    } else {
                        LinearGradient(colors: theme.ambient, startPoint: .top, endPoint: .bottom)
                            .frame(width: 456, height: 380)
                    }

                    // 拍立得相框暗角内阴影
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .strokeBorder(Color.black.opacity(0.18), lineWidth: 1)

                    // 相片左下角微标
                    HStack(spacing: 5) {
                        Image(systemName: theme.iconName)
                            .font(.system(size: 9.5, weight: .bold))
                        Text(card.category)
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(0.6)
                    }
                    .foregroundStyle(Color.white.opacity(0.95))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.black.opacity(0.6), in: Capsule())
                    .padding(14)
                }
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .padding(.top, 32)
                .padding(.horizontal, 32)

                // 底部相纸留白与手写感排版
                VStack(alignment: .leading, spacing: 10) {
                    // 主标题
                    Text(card.displayHeadline)
                        .font(.system(size: 21, weight: .bold, design: .serif))
                        .foregroundStyle(Color(red: 0.15, green: 0.16, blue: 0.18))
                        .lineSpacing(5)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)

                    // 摘要
                    Text(card.displaySummary)
                        .font(.system(size: 13.5, weight: .regular, design: .serif))
                        .foregroundStyle(Color(red: 0.38, green: 0.40, blue: 0.44))
                        .lineSpacing(4.5)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)

                    Spacer()

                    // 拍立得底部极简签名与日期
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("KnowFlick.")
                                .font(.system(size: 15, weight: .heavy, design: .serif))
                                .foregroundStyle(Color(red: 0.20, green: 0.21, blue: 0.24))
                            Text("daily snapshot")
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundStyle(Color.gray.opacity(0.7))
                        }

                        Spacer()

                        Text(currentDateFormatted)
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundStyle(Color.gray.opacity(0.85))
                    }
                }
                .padding(.top, 24)
                .padding(.horizontal, 36)
                .padding(.bottom, 28)
            }
        }
    }

    // MARK: - 3. 瑞士国际主义风 (Swiss International Typographic Poster)

    private var swissPoster: some View {
        ZStack(alignment: .topLeading) {
            // 背景底色：极深哑光黑曜岩质感
            Color(red: 0.05, green: 0.06, blue: 0.07)

            VStack(alignment: .leading, spacing: 0) {
                // 1. 瑞士网格顶栏：序号大标 + 坐标刻度 + 国际十字
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("№ \(String(format: "%02d", Int(CardThemeResolver.deterministicHash(card.headline) % 99) + 1))")
                            .font(.system(size: 38, weight: .black, design: .default))
                            .tracking(-1.5)
                            .foregroundStyle(Color.white)

                        Text("ARCHIVE / SYSTEM SPECIFICATION")
                            .font(.system(size: 8.5, weight: .heavy, design: .monospaced))
                            .tracking(2.0)
                            .foregroundStyle(Color.white.opacity(0.40))
                    }

                    Spacer()

                    // 瑞士十字标与分类徽标
                    VStack(alignment: .trailing, spacing: 6) {
                        HStack(spacing: 6) {
                            Text("CH-8001")
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundStyle(theme.accent)
                            Image(systemName: "plus")
                                .font(.system(size: 10, weight: .black))
                                .foregroundStyle(Color.white.opacity(0.8))
                        }

                        Text(card.category.uppercased())
                            .font(.system(size: 11, weight: .bold))
                            .tracking(1.4)
                            .foregroundStyle(Color.white.opacity(0.85))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color.white.opacity(0.08), in: Rectangle())
                            .overlay(Rectangle().strokeBorder(Color.white.opacity(0.18), lineWidth: 1))
                    }
                }
                .padding(.horizontal, 36)
                .padding(.top, 34)

                // 细如发丝的网格分割线
                Rectangle()
                    .fill(Color.white.opacity(0.14))
                    .frame(height: 1)
                    .padding(.horizontal, 36)
                    .padding(.top, 18)

                // 2. 结构化影像板块 (含对准角标十字)
                ZStack {
                    if let img = theme.image {
                        Image(nsImage: img)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 468, height: 230)
                            .clipped()
                            .saturation(0.9)
                            .contrast(1.1)
                    } else {
                        LinearGradient(colors: [theme.accent.opacity(0.7), Color.black], startPoint: .topLeading, endPoint: .bottomTrailing)
                            .frame(width: 468, height: 230)
                    }

                    // 国际主义版面标尺角标
                    VStack {
                        HStack {
                            Text("+")
                            Spacer()
                            Text("+")
                        }
                        Spacer()
                        HStack {
                            Text("+")
                            Spacer()
                            Text("+")
                        }
                    }
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.75))
                    .padding(8)
                }
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(Color.white.opacity(0.2), lineWidth: 1))
                .padding(.horizontal, 36)
                .padding(.top, 18)

                // 3. 核心大标题与观点 (Swiss Helvetica / Grotesque 严谨构图)
                VStack(alignment: .leading, spacing: 14) {
                    Text(card.displayHeadline)
                        .font(.system(size: 26, weight: .heavy, design: .default))
                        .tracking(-0.8)
                        .foregroundStyle(Color.white)
                        .lineSpacing(4.5)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(alignment: .top, spacing: 14) {
                        Rectangle()
                            .fill(theme.accent)
                            .frame(width: 4)

                        Text(card.displaySummary)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.82))
                            .lineSpacing(5.5)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 36)
                .padding(.top, 22)

                Spacer()

                // 4. 瑞士技术参数矩阵 (2×2 Spec Matrix)
                VStack(spacing: 12) {
                    Rectangle()
                        .fill(Color.white.opacity(0.12))
                        .frame(height: 1)

                    HStack(spacing: 24) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("SOURCE SPEC")
                                .font(.system(size: 8, weight: .heavy, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.40))
                            Text(card.source == .ai ? "AI SYNTHESIS" : "EDITORIAL CURATED")
                                .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.90))
                        }
                        Spacer()
                        VStack(alignment: .leading, spacing: 3) {
                            Text("DOMAIN CODE")
                                .font(.system(size: 8, weight: .heavy, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.40))
                            Text(theme.domainCode)
                                .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(theme.accent)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            Text("RELEASE DATE")
                                .font(.system(size: 8, weight: .heavy, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.40))
                            Text(currentDateFormatted)
                                .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.90))
                        }
                    }

                    Rectangle()
                        .fill(Color.white.opacity(0.12))
                        .frame(height: 1)

                    // 5. 条形码与版权印章
                    HStack(alignment: .center) {
                        // 仿真数据条形码
                        HStack(spacing: 2.2) {
                            ForEach(0..<28, id: \.self) { i in
                                Rectangle()
                                    .fill(Color.white.opacity((i % 4 == 0 || i % 7 == 0) ? 0.85 : 0.35))
                                    .frame(width: (i % 3 == 0) ? 2.5 : 1.2, height: 18)
                            }
                        }

                        Spacer()

                        VStack(alignment: .trailing, spacing: 1) {
                            Text("KNOWFLICK ARCHIVE")
                                .font(.system(size: 9.5, weight: .black))
                                .tracking(1.8)
                                .foregroundStyle(Color.white.opacity(0.90))
                            Text("VERIFIED KNOWLEDGE ARTIFACT")
                                .font(.system(size: 7.5, weight: .medium, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.45))
                        }
                    }
                }
                .padding(.horizontal, 36)
                .padding(.bottom, 28)
            }
        }
    }

    // MARK: - 辅助格式化

    private var currentDateFormatted: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy.MM.dd"
        return formatter.string(from: Date())
    }
}

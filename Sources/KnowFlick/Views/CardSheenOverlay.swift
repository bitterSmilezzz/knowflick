import SwiftUI

/// 卡片高光与斜角扫光视图：
/// 1. 换卡就位时单次柔和斜向扫过（0.65s 纯 GPU 线性平移动画）
/// 2. 拖拽交互时高光随 3D 俯仰倾角物理反光
public struct CardSheenOverlay: View {
    let isTop: Bool
    let dragOffset: CGSize
    let triggerPulse: Bool

    @State private var sweepProgress: CGFloat = -1.2

    public init(isTop: Bool, dragOffset: CGSize = .zero, triggerPulse: Bool = false) {
        self.isTop = isTop
        self.dragOffset = dragOffset
        self.triggerPulse = triggerPulse
    }

    public var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let height = geo.size.height
            // 计算拖拽时的视差微偏移量（微幅跟随）
            let dragShiftX = isTop ? (dragOffset.width * 0.18) : 0
            let dragShiftY = isTop ? (dragOffset.height * 0.10) : 0

            ZStack {
                // 1. 换卡就位时的斜角高光扫光带（135°）
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0.0),
                        .init(color: Color.white.opacity(0.04), location: 0.35),
                        .init(color: Color.white.opacity(0.24), location: 0.50),
                        .init(color: Color.white.opacity(0.04), location: 0.65),
                        .init(color: .clear, location: 1.0)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .frame(width: width * 1.5, height: height * 1.8)
                .rotationEffect(.degrees(18))
                .offset(
                    x: sweepProgress * width + dragShiftX,
                    y: sweepProgress * (height * 0.6) + dragShiftY
                )
                .blendMode(.screen)
                .opacity(isTop ? 0.85 : 0.0)

                // 2. 拖拽时的动态卡面受光晕（跟随手势倾角浮现）
                if isTop && abs(dragOffset.width) > 6 {
                    let tiltAlpha = min(0.18, abs(dragOffset.width) / 500)
                    let startPoint: UnitPoint = dragOffset.width > 0 ? .topLeading : .topTrailing
                    LinearGradient(
                        stops: [
                            .init(color: Color.white.opacity(tiltAlpha), location: 0.0),
                            .init(color: .clear, location: 0.65)
                        ],
                        startPoint: startPoint,
                        endPoint: .bottom
                    )
                    .blendMode(.plusLighter)
                }
            }
            .frame(width: width, height: height)
            .clipped()
        }
        .allowsHitTesting(false)
        .onAppear {
            if isTop {
                runSweepAnimation()
            }
        }
        .onChange(of: isTop) { _, nowTop in
            if nowTop {
                runSweepAnimation()
            }
        }
        .onChange(of: triggerPulse) { _, _ in
            if isTop {
                runSweepAnimation()
            }
        }
    }

    private func runSweepAnimation() {
        sweepProgress = -1.2
        withAnimation(.easeInOut(duration: 0.68).delay(0.06)) {
            sweepProgress = 1.3
        }
    }
}

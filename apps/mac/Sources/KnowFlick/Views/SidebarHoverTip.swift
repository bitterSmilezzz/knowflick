import SwiftUI

struct SidebarHoverTip {
    let text: String
    let anchor: Anchor<CGRect>
}

struct SidebarHoverTipPreference: PreferenceKey {
    static var defaultValue: SidebarHoverTip? { nil }
    static func reduce(value: inout SidebarHoverTip?, nextValue: () -> SidebarHoverTip?) {
        if let next = nextValue() { value = next }
    }
}

private struct SidebarHoverTipModifier: ViewModifier {
    let text: String
    let enabled: Bool
    @State private var hovering = false
    @State private var visible = false

    func body(content: Content) -> some View {
        content
            .onHover { inside in
                hovering = inside
                if !inside { visible = false }
            }
            .task(id: hovering && enabled) {
                guard hovering && enabled else { visible = false; return }
                do { try await Task.sleep(for: .milliseconds(200)) }
                catch { return }
                guard !Task.isCancelled else { return }
                visible = true
            }
            .simultaneousGesture(TapGesture().onEnded { hovering = false; visible = false })
            .anchorPreference(key: SidebarHoverTipPreference.self, value: .bounds) { anchor in
                visible && enabled ? SidebarHoverTip(text: text, anchor: anchor) : nil
            }
    }
}

extension View {
    func sidebarHoverTip(_ text: String, enabled: Bool) -> some View {
        modifier(SidebarHoverTipModifier(text: text, enabled: enabled))
    }

    /// Draw above the entire shell, outside the sidebar's scroll clipping region.
    func sidebarHoverTipLayer() -> some View {
        overlayPreferenceValue(SidebarHoverTipPreference.self) { tip in
            GeometryReader { geometry in
                if let tip {
                    let bounds = geometry[tip.anchor]
                    let lines = tip.text.components(separatedBy: "\n")
                    VStack(alignment: .leading, spacing: 6) {
                        Text(lines.first ?? "")
                            .font(InsightFont.bodyStrong)
                            .foregroundStyle(InsightColor.textPrimary)
                        Text(lines.dropFirst().joined(separator: "\n"))
                            .font(InsightFont.caption)
                            .foregroundStyle(InsightColor.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .frame(width: 256, alignment: .leading)
                    .background(InsightColor.surfaceRaised, in: RoundedRectangle(cornerRadius: InsightRadius.control))
                    .overlay(RoundedRectangle(cornerRadius: InsightRadius.control)
                        .strokeBorder(InsightColor.borderStrong, lineWidth: 1))
                    .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
                    .offset(x: bounds.maxX + 12, y: max(8, min(bounds.midY - 38, geometry.size.height - 140)))
                    .transaction { $0.animation = nil }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

import SwiftUI
import AppKit

/// Refresh date-derived snapshots at midnight and when returning to the app.
private struct LearningDayRefresh: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    @State private var revision = 0
    let refresh: () -> Void

    func body(content: Content) -> some View {
        content
            .task(id: revision) {
                while !Task.isCancelled {
                    let now = Date()
                    let calendar = Calendar.current
                    guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) else { return }
                    do { try await Task.sleep(for: .seconds(max(1, tomorrow.timeIntervalSince(now)))) }
                    catch { return }
                    guard !Task.isCancelled else { return }
                    refresh()
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { refresh(); revision += 1 }
            }
            .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didWakeNotification)) { _ in
                refresh(); revision += 1
            }
            .onReceive(NotificationCenter.default.publisher(for: .NSSystemClockDidChange)) { _ in
                refresh(); revision += 1
            }
            .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
                refresh(); revision += 1
            }
            .onReceive(NotificationCenter.default.publisher(for: .NSSystemTimeZoneDidChange)) { _ in
                refresh(); revision += 1
            }
    }
}

extension View {
    func onLearningDayChange(perform refresh: @escaping () -> Void) -> some View {
        modifier(LearningDayRefresh(refresh: refresh))
    }
}

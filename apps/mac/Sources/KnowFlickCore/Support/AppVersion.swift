import Foundation

/// 版本单一来源：发布版本号只在此处维护。
/// build_app.sh 通过 grep 该文件生成 Info.plist 版本；User-Agent 与关于页均引用此常量。
///
/// macOS 端的版本号自成一系，与 Android 端（`android-v*`）无关。
/// 历史遗留：4.1.1–4.1.8 曾被 Android 里程碑占用，CHANGELOG 中已更名为对应的
/// android-v0.1.0–v0.7.0；mac 端 4.2.0–4.6.0 沿用旧序列。
/// 自 2026-09-28 起改用 pre-1.0 序列（v0.1.0 起）：mac 尚非正规产品，
/// 版本号如实反映这一阶段；v4.6.0 为 4.x 序列末版，历史 tag/Release 全部保留。
public enum AppVersion {
    public static let current = "0.1.0"
}

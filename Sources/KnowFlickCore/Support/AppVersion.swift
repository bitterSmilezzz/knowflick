import Foundation

/// 版本单一来源：发布版本号只在此处维护。
/// build_app.sh 通过 grep 该文件生成 Info.plist 版本；User-Agent 与关于页均引用此常量。
public enum AppVersion {
    public static let current = "3.2.2"
}

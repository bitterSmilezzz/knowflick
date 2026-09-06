import Foundation
import Security

/// API Key 安全存储（macOS Keychain），避免明文落盘
public enum KeychainHelper {
    private static let service = "com.knowflick.app"
    private static let account = "apiKey"

    public enum KeychainError: Error, LocalizedError {
        case saveFailed(OSStatus)
        case emptyValue

        public var errorDescription: String? {
            switch self {
            case .saveFailed(let status):
                "钥匙串写入失败（\(status)）"
            case .emptyValue:
                "API Key 为空，未写入钥匙串"
            }
        }
    }

    /// 保存（覆盖旧值）；失败抛错而非静默
    @discardableResult
    public static func save(_ value: String) throws -> Bool {
        guard !value.isEmpty else { return false }
        guard let data = value.data(using: .utf8) else {
            throw KeychainError.saveFailed(errSecDecode)
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        var attrs = query
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(attrs as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
        return true
    }

    public static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

import Foundation

/// Credential persistence is separate from JSON settings and replaceable in tests.
@MainActor
public protocol CredentialStore {
    func read(account: String) -> String?
    func save(_ value: String, account: String) throws
    func delete(account: String) throws
}

public struct SystemCredentialStore: CredentialStore {
    public init() {}
    public func read(account: String) -> String? { KeychainHelper.read(account: account) }
    public func save(_ value: String, account: String) throws {
        try KeychainHelper.save(value, account: account)
    }
    public func delete(account: String) throws { try KeychainHelper.delete(account: account) }
}

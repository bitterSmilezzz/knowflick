import Foundation
import Testing
@testable import KnowFlickCore

private final class SpeechResponseStub: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        let mime = path.contains("html") ? "text/html" : path.contains("json") ? "application/json" : "audio/mpeg"
        let status = path.contains("unauthorized") ? 401 : 200
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": mime])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !path.contains("empty") { client?.urlProtocol(self, didLoad: Data("stub-response".utf8)) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

struct SpeechTransportTests {
    @Test func audioResponseReachesPlayerUnchanged() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SpeechResponseStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let profile = SpeechSettings().profiles[1]
        let data = try await RemoteSpeechClient(session: session).audio(text: "你好", profile: profile, speed: 1)
        #expect(data == Data("stub-response".utf8))
    }

    @Test(arguments: ["html", "json", "empty", "unauthorized"])
    func rejectsResponsesThatCannotBePlayed(kind: String) async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SpeechResponseStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var profile = SpeechSettings().profiles[1]
        profile.baseURL = "http://localhost/\(kind)"
        do {
            _ = try await RemoteSpeechClient(session: session).audio(text: "你好", profile: profile, speed: 1)
            Issue.record("Accepted \(kind) as playable audio")
        } catch { }
    }
}

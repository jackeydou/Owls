import CryptoKit
import XCTest
@testable import Owlto

/// The phone must compute exactly what the Mac's Node `crypto` computes, or no handshake opens.
/// The expected values were produced by Node with the same inputs (see the comment on each).
final class RemoteCryptoTests: XCTestCase {
  private let privateA = Data(repeating: 0xAA, count: 32)
  private let privateB = Data(repeating: 0xBB, count: 32)
  /// sha256("hs1" ‖ "hs2")
  private let transcript = Data(hex: "42f879273c1d3935c6b0f77fbbd208650dc96dc3f63190a44e34bf8b699157a4")

  func testPublicKeysMatchNodeJWK() throws {
    let a = try RemoteCrypto.PrivateKey(rawRepresentation: privateA)
    let b = try RemoteCrypto.PrivateKey(rawRepresentation: privateB)
    XCTAssertEqual(RemoteCrypto.publicKeyString(a), "FMqeTTh7zPNXRuBAfaqsxrKKT4RF71pRWIlNuYPiQHA")
    XCTAssertEqual(RemoteCrypto.publicKeyString(b), "awthbXGOU2kSNtO-PObUT50og2Qm2BMF0TH0iCBvjSs")
    XCTAssertTrue(RemoteCrypto.isPublicKey(RemoteCrypto.publicKeyString(a)))
  }

  func testDiffieHellmanMatchesNode() throws {
    let a = try RemoteCrypto.PrivateKey(rawRepresentation: privateA)
    let shared = try RemoteCrypto.dh(a, "awthbXGOU2kSNtO-PObUT50og2Qm2BMF0TH0iCBvjSs")
    XCTAssertEqual(shared.hex, "2f6d4d0247b4216d9114a87cf9206bc9c65c1b62593f18b7f3474a747e615229")
  }

  func testTranscriptHash() {
    XCTAssertEqual(RemoteCrypto.sha256(Data("hs1".utf8), Data("hs2".utf8)), transcript)
  }

  /// Node: scryptSync("K7QM2XRD", transcript, 32, { N: 2 ** 15, r: 8, p: 1 })
  func testPairingSecretMatchesNodeScrypt() async throws {
    let started = Date()
    let secret = try await RemoteCrypto.pairingSecret(code: "K7QM2XRD", transcript: transcript)
    XCTAssertEqual(secret.hex, "012eea9aa75d2f1bce80c8d3bb7429f42faade54e25bdad463c60525aa650b18")
    XCTAssertLessThan(Date().timeIntervalSince(started), 5, "scrypt should stay quick enough to pair on a phone")
  }

  /// RFC 7914 test vector 2.
  func testScryptRFCVector() throws {
    let out = try RemoteCrypto.scrypt(password: Data("password".utf8), salt: Data("NaCl".utf8), n: 1024, r: 8, p: 16, length: 64)
    XCTAssertEqual(out.hex, "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640")
  }

  /// Node: hkdfSync("sha256", shared ‖ scrypt, transcript, "owlto-remote-v1 keys", 64)
  func testSessionKeysMatchNodeHKDF() {
    let keys = sessionKeys()
    XCTAssertEqual(keys.initiator.withUnsafeBytes { Data($0) }.hex, "8269aac283e469dac32fd183a66a7c6b927b611d29165893e4cad32f7c002e0d")
    XCTAssertEqual(keys.responder.withUnsafeBytes { Data($0) }.hex, "811fa3e242f7073e28fcd19829c1400135e91276154f11a0a0e1df9b99a8b8c3")
  }

  /// Node: aes-256-gcm with the counter nonce, ciphertext ‖ tag.
  func testFrameCipherMatchesNodeAndCountsNonces() throws {
    let sender = FrameCipher(key: sessionKeys().initiator)
    XCTAssertEqual(try sender.seal(Data(#"{"t":"ping"}"#.utf8)).hex, "f1fb5f7bd5126b59863911dfe17db267bed2e9664670e8e335deca90")
    XCTAssertEqual(try sender.seal(Data(#"{"t":"pong"}"#.utf8)).hex, "7a76cdb162a33ae1043201da3ff5d607fe680e57e6d45ee72cbc4bf5")

    let receiver = FrameCipher(key: sessionKeys().initiator)
    XCTAssertEqual(try receiver.open(Data(hex: "f1fb5f7bd5126b59863911dfe17db267bed2e9664670e8e335deca90")), Data(#"{"t":"ping"}"#.utf8))
    // Opening the same frame again uses the next nonce, so a replay fails.
    XCTAssertThrowsError(try receiver.open(Data(hex: "f1fb5f7bd5126b59863911dfe17db267bed2e9664670e8e335deca90")))
  }

  private func sessionKeys() -> (initiator: SymmetricKey, responder: SymmetricKey) {
    RemoteCrypto.sessionKeys(
      secrets: [
        Data(hex: "2f6d4d0247b4216d9114a87cf9206bc9c65c1b62593f18b7f3474a747e615229"),
        Data(hex: "012eea9aa75d2f1bce80c8d3bb7429f42faade54e25bdad463c60525aa650b18")
      ],
      transcript: transcript
    )
  }
}

final class RemoteParsingTests: XCTestCase {
  func testAddressesParseLikeTheMac() {
    XCTAssertEqual(RemoteAddress("192.168.1.20"), RemoteAddress(host: "192.168.1.20", port: 47320))
    XCTAssertEqual(RemoteAddress(" mac-mini.tail1234.ts.net:5000 "), RemoteAddress(host: "mac-mini.tail1234.ts.net", port: 5000))
    XCTAssertEqual(RemoteAddress("[fd7a:115c::1]:47321"), RemoteAddress(host: "fd7a:115c::1", port: 47321))
    XCTAssertEqual(RemoteAddress("[fd7a:115c::1]"), RemoteAddress(host: "fd7a:115c::1", port: 47320))
    XCTAssertNil(RemoteAddress(""))
    XCTAssertNil(RemoteAddress("http://mac"))
    XCTAssertNil(RemoteAddress("mac:0"))
    XCTAssertNil(RemoteAddress("mac:70000"))
    XCTAssertEqual(RemoteAddress(host: "fd7a::1", port: 47320).formatted, "[fd7a::1]")
    XCTAssertEqual(RemoteAddress(host: "mac", port: 9).formatted, "mac:9")
  }

  func testPairingCodesNormalizeLikeTheMac() {
    XCTAssertEqual(PairingCode.normalize("k7qm-2xrd"), "K7QM2XRD")
    XCTAssertTrue(PairingCode.isValid("k7qm 2xrd"))
    XCTAssertFalse(PairingCode.isValid("K7QM2XRI"), "I is not in the alphabet")
    XCTAssertFalse(PairingCode.isValid("K7QM2XR"))
  }

  func testDeviceIds() {
    XCTAssertTrue(Handshake.isDeviceId("dv_0a1b2c3d"))
    XCTAssertFalse(Handshake.isDeviceId("dv_0A1B2C3D"))
    XCTAssertFalse(Handshake.isDeviceId("dv_0a1b2c3"))
  }

  func testEventsDecodeAndUnknownOnesAreIgnored() throws {
    let worker = #"{"type":"worker","worker":{"id":"w1","routerId":"r1","projectId":null,"sessionId":"s1","provider":"claude-code","goal":"Add tests\nmore","title":null,"parentId":null,"status":"running","workspace":{"kind":"worktree","branch":"claude/x","path":"/p","cwd":"/p","base":"head","baseBranch":null,"baseCommit":null,"state":"active"},"pullRequest":null,"report":null,"degraded":false,"createdAt":"2026-11-18T10:00:00.000Z","updatedAt":"2026-11-18T10:00:00.000Z","futureField":1}}"#
    guard case .worker(let decoded) = HostEvent.decode(Data(worker.utf8)) else { return XCTFail("worker event") }
    XCTAssertEqual(decoded.label, "Add tests")
    XCTAssertEqual(decoded.workspace?.branch, "claude/x")
    XCTAssertTrue(decoded.isWorking)
    guard case .other = HostEvent.decode(Data(#"{"type":"connection","connection":{}}"#.utf8)) else { return XCTFail("other") }
  }

  func testTimelineGroupsDispatchesAndSteps() {
    func entry(_ position: Int, _ kind: String, workerId: String? = nil, text: String = "x") -> ThreadItem {
      let json = """
      {"item":{"id":"i\(position)","kind":"\(kind)","status":"completed","text":"\(text)","detail":"","turnId":null\(workerId.map { ",\"workerId\":\"\($0)\"" } ?? "")},"position":\(position),"rev":1}
      """
      return try! JSONDecoder().decode(ThreadItem.self, from: Data(json.utf8))
    }
    let entries = TimelineEntry.build([
      entry(0, "user"),
      entry(1, "tool"),
      entry(2, "tool"),
      entry(3, "assistant"),
      entry(4, "worker", workerId: "w1"),
      entry(5, "worker", workerId: "w2"),
      entry(6, "assistant"),
      entry(7, "user", workerId: "w1")
    ])
    let kinds = entries.map { entry -> String in
      switch entry.kind {
      case .user: return "user"
      case .directed: return "directed"
      case .router(let items): return "router\(items.count)"
      case .dispatch(let ids): return "dispatch\(ids.count)"
      case .steps(let count): return "steps\(count)"
      }
    }
    XCTAssertEqual(kinds, ["user", "steps2", "router1", "dispatch2", "router1", "directed"])
  }

  func testDiffParsing() {
    let diff = """
    diff --git a/src/a.ts b/src/a.ts
    index 1..2 100644
    --- a/src/a.ts
    +++ b/src/a.ts
    @@ -1,2 +1,2 @@
     keep
    -old
    +new
    +more
    diff --git a/new.md b/new.md
    new file mode 100644
    --- /dev/null
    +++ b/new.md
    @@ -0,0 +1 @@
    +hello
    """
    let files = DiffFile.parse(diff)
    XCTAssertEqual(files.map(\.path), ["src/a.ts", "new.md"])
    XCTAssertEqual(files[0].added, 2)
    XCTAssertEqual(files[0].removed, 1)
    XCTAssertEqual(files[1].added, 1)
  }
}

extension Data {
  init(hex: String) {
    var data = Data()
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      data.append(UInt8(hex[index..<next], radix: 16)!)
      index = next
    }
    self = data
  }

  var hex: String { map { String(format: "%02x", $0) }.joined() }
}

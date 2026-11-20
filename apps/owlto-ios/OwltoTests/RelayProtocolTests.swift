import CryptoKit
import XCTest
@testable import Owlto

/// The relay additions to the protocol must match the Mac byte for byte too. The expected
/// values were produced by Node with the same inputs (see the comment on each).
final class RelayProtocolTests: XCTestCase {
  private let privateA = Data(repeating: 0xAA, count: 32)
  private let privateB = Data(repeating: 0xBB, count: 32)
  private let privateE = Data(repeating: 0xCC, count: 32)

  /// The session keys of `RemoteCryptoTests.testSessionKeysMatchNodeHKDF`.
  /// Node: `safetyCode({ initiator, responder })` in `remote/crypto.ts`.
  func testSafetyCodeMatchesNode() {
    let keys = (
      initiator: SymmetricKey(data: Data(hex: "8269aac283e469dac32fd183a66a7c6b927b611d29165893e4cad32f7c002e0d")),
      responder: SymmetricKey(data: Data(hex: "811fa3e242f7073e28fcd19829c1400135e91276154f11a0a0e1df9b99a8b8c3"))
    )
    XCTAssertEqual(RemoteCrypto.safetyCode(keys), "548388")
  }

  /// Node: `deflateRawSync(JSON.stringify({ t: 'res', id: 1, ok: true, value: 'owl '.repeat(400) }))`
  func testInflatesNodeRawDeflate() throws {
    let compressed = Data(hex: "ab562a51b2522a4a2d56d251ca4c51b232d451cacf56b22a292a4dd5512a4bcc294d55b252ca2fcf5118c5a378148fe2513c8a49c54ab500")
    let text = try Deflate.inflate(compressed)
    XCTAssertEqual(text.count, 1639)
    let message = try JSONSerialization.jsonObject(with: text) as? [String: Any]
    XCTAssertEqual(message?["value"] as? String, String(repeating: "owl ", count: 400))
  }

  func testPackCompressesLongMessagesOnly() throws {
    let short = Data(#"{"t":"ping"}"#.utf8)
    XCTAssertEqual(try SecureChannel.pack(short, compress: true), short)
    let long = Data(#"{"value":"\#(String(repeating: "owl ", count: 400))"}"#.utf8)
    let packed = try SecureChannel.pack(long, compress: true)
    XCTAssertEqual(packed.first, 0x01)
    XCTAssertLessThan(packed.count, long.count / 4)
    XCTAssertEqual(try SecureChannel.unpack(packed), long)
    XCTAssertEqual(try SecureChannel.pack(long, compress: false), long)
  }

  func testInflateStopsAtTheLimit() throws {
    let packed = try Deflate.compress(Data(repeating: 0x20, count: 100_000))
    XCTAssertThrowsError(try Deflate.inflate(packed, limit: 10_000))
  }

  /// Node: HKDF-SHA256(DH(E, B) ‖ DH(A, B), SHA-256("dv_0123abcd" ‖ eph ‖ B), "owlto-queue-v1", 32),
  /// as `queueKey` in `remote/sealed.ts` derives it.
  func testQueueItemKeyMatchesNodeAndOpens() throws {
    let a = try RemoteCrypto.PrivateKey(rawRepresentation: privateA)
    let b = try RemoteCrypto.PrivateKey(rawRepresentation: privateB)
    let e = try RemoteCrypto.PrivateKey(rawRepresentation: privateE)
    let me = LocalIdentity(deviceId: "dv_0123abcd", name: "iPhone", appVersion: "ios-test", privateKey: a)
    let hostKey = RemoteCrypto.publicKeyString(b)
    XCTAssertEqual(RemoteCrypto.publicKeyString(e), "6JgMTqXr-PtsKBCYt1zdMoYpIqY4d4JRl5ttMi7X4C4")
    let key = try SealedQueue.queueKey(ephemeral: e, me: me, hostKey: hostKey)
    XCTAssertEqual(key.withUnsafeBytes { Data($0) }.hex, "761a1135c087f5db4022220531493e85ab0d20e1516b5d95b6df206ae1d924c0")

    let routerId = "6f1d4b8e-3c2a-4e5f-9a7b-1c2d3e4f5a6b"
    let item = try SealedQueue.sealForHost(params: ["routerId": routerId, "text": "hi"], seq: 3, at: Date(timeIntervalSince1970: 1_700_000_000), me: me, hostKey: hostKey, ephemeral: e)
    let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(Base64URL.decode(item))) as? [String: Any])
    XCTAssertEqual(envelope["v"] as? Int, 1)
    XCTAssertEqual(envelope["from"] as? String, "dv_0123abcd")
    XCTAssertEqual(envelope["eph"] as? String, "6JgMTqXr-PtsKBCYt1zdMoYpIqY4d4JRl5ttMi7X4C4")
    let box = try XCTUnwrap(Base64URL.decode(XCTUnwrap(envelope["box"] as? String)))
    let sealed = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: box.prefix(12)), ciphertext: box.dropFirst(12).dropLast(16), tag: box.suffix(16))
    let plain = try AES.GCM.open(sealed, using: key, authenticating: Data("dv_0123abcd".utf8))
    let message = try XCTUnwrap(JSONSerialization.jsonObject(with: plain) as? [String: Any])
    XCTAssertEqual(message["seq"] as? Int, 3)
    XCTAssertEqual(message["at"] as? Int, 1_700_000_000_000)
    XCTAssertEqual(message["method"] as? String, "sendRouter")
    XCTAssertEqual((message["params"] as? [String: Any])?["routerId"] as? String, routerId)
    // The sender's device id is authenticated: another one does not open the box.
    XCTAssertThrowsError(try AES.GCM.open(sealed, using: key, authenticating: Data("dv_ffffffff".utf8)))
  }

  /// Node: base64url(nonce ‖ AES-256-GCM(key, JSON)) with key = 0x11 × 32 and nonce = 0x22 × 12,
  /// which `openPush` in `remote/sealed.ts` opens to the same message.
  func testOpensANodeSealedPush() throws {
    let payload = "IiIiIiIiIiIiIiIibNVzILSj-n3fHZFLJNKG9zOxvpcI9cU_Pioo0iunDHtlE8RlOsbb8mw6gkmfenMX8L7_F_EXWr3bEI_ZjA6K1gusZVck93FdoEMas2WGi3iAz-paIdS1JjVt_YhJzXO_7TMaelttqTltvpBVUpGzJGqD9k09cwvqxoJm"
    let message = try PushShared.open(payload, key: Data(repeating: 0x11, count: 32))
    XCTAssertEqual(message, PushShared.Message(title: "Owlto", subtitle: "Fix login", body: "Claude Code needs your OK", routerId: nil, workerId: "w1"))
    XCTAssertThrowsError(try PushShared.open(payload, key: Data(repeating: 0x12, count: 32)))
  }

  /// `formatRemoteInvite` output from the dev host.
  func testParsesAnInvite() throws {
    let invite = try XCTUnwrap(RemoteInvite("owlto://pair?v=1&relay=ws%3A%2F%2F127.0.0.1%3A8792&mailbox=wyA0zlOZrGZVCeCbzRep_X48-ESzHCBR&ticket=PLXtPF7myP7F0MTR13FCsx6QdYopkDaz&code=4VX1Z1NK&key=NUeDpiA6e-q1Poz8e8hhSqXSkUaEEZQLaVTfdDZUMyY"))
    XCTAssertEqual(invite.route, .relay(RelayRoute(url: "ws://127.0.0.1:8792", mailbox: "wyA0zlOZrGZVCeCbzRep_X48-ESzHCBR", ticket: "PLXtPF7myP7F0MTR13FCsx6QdYopkDaz")))
    XCTAssertEqual(invite.code, "4VX1Z1NK")
    XCTAssertEqual(invite.key, "NUeDpiA6e-q1Poz8e8hhSqXSkUaEEZQLaVTfdDZUMyY")
    XCTAssertNil(RemoteInvite("owlto://pair?v=2&relay=wss%3A%2F%2Frelay.owlto.dev&mailbox=wyA0zlOZrGZVCeCbzRep_X48-ESzHCBR&ticket=PLXtPF7myP7F0MTR13FCsx6QdYopkDaz&code=4VX1Z1NK&key=NUeDpiA6e-q1Poz8e8hhSqXSkUaEEZQLaVTfdDZUMyY"))
    XCTAssertNil(RemoteInvite("https://owlto.dev"))
  }

  /// `formatRemoteInvite({ host: '192.168.1.20:47330', code: '4VX1Z1NK', key })`: the same-network QR code.
  func testParsesAHostInvite() throws {
    let invite = try XCTUnwrap(RemoteInvite("owlto://pair?v=1&host=192.168.1.20%3A47330&code=4VX1Z1NK&key=NUeDpiA6e-q1Poz8e8hhSqXSkUaEEZQLaVTfdDZUMyY"))
    XCTAssertEqual(invite.route, .host(RemoteAddress(host: "192.168.1.20", port: 47330)))
    XCTAssertEqual(invite.code, "4VX1Z1NK")
    XCTAssertNil(RemoteInvite("owlto://pair?v=1&host=a%2Fb&code=4VX1Z1NK&key=NUeDpiA6e-q1Poz8e8hhSqXSkUaEEZQLaVTfdDZUMyY"))
  }

  /// `parseRelayCode` in `shared/remote.ts`.
  func testParsesRelayCodes() {
    XCTAssertEqual(RelayCode("7k09-qf92-w49q"), RelayCode("7K09QF92W49Q"))
    XCTAssertEqual(RelayCode("7K09-QF92-W49Q")?.rendezvous, "7K09")
    XCTAssertEqual(RelayCode("7K09-QF92-W49Q")?.code, "QF92W49Q")
    XCTAssertNil(RelayCode("QF92-W49Q"))
    XCTAssertNil(RelayCode("7K09-QF92-W49U"))
  }

  func testRelayRouteFromReply() {
    XCTAssertEqual(
      RelayRoute(json: ["url": "wss://relay.owlto.dev", "mailbox": "wyA0zlOZrGZVCeCbzRep_X48-ESzHCBR", "ticket": "PLXtPF7myP7F0MTR13FCsx6QdYopkDaz"]),
      RelayRoute(url: "wss://relay.owlto.dev", mailbox: "wyA0zlOZrGZVCeCbzRep_X48-ESzHCBR", ticket: "PLXtPF7myP7F0MTR13FCsx6QdYopkDaz")
    )
    XCTAssertNil(RelayRoute(json: NSNull()))
    XCTAssertNil(RelayRoute(json: ["url": "https://relay.owlto.dev", "mailbox": "wyA0zlOZrGZVCeCbzRep_X48-ESzHCBR", "ticket": "PLXtPF7myP7F0MTR13FCsx6QdYopkDaz"]))
  }

  /// A Mac paired before the relay is decoded with no relay route and no queue.
  func testDecodesAHostSavedBeforeTheRelay() throws {
    let json = #"[{"deviceId":"dv_0123abcd","name":"Mac","publicKey":"awthbXGOU2kSNtO-PObUT50og2Qm2BMF0TH0iCBvjSs","host":"192.168.1.20","port":47320,"pairedAt":700000000}]"#
    let hosts = try JSONDecoder().decode([PairedHost].self, from: Data(json.utf8))
    XCTAssertEqual(hosts.first?.address, "192.168.1.20")
    XCTAssertNil(hosts.first?.relay)
    XCTAssertNil(hosts.first?.queueSeq)
  }
}

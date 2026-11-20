import CryptoKit
import Foundation

/// The protocol version both sides must speak; `REMOTE_PROTOCOL` in `shared/remote.ts`.
let remoteProtocol = 1
/// The TCP port a Mac listens on; `REMOTE_PORT` in `shared/remote.ts`.
let remotePort: UInt16 = 47320

/// This phone as the Mac sees it.
struct LocalIdentity {
  let deviceId: String
  let name: String
  let appVersion: String
  let privateKey: RemoteCrypto.PrivateKey
  var publicKey: String { RemoteCrypto.publicKeyString(privateKey) }
}

/// The Mac that answered a handshake.
struct RemotePeer: Equatable {
  let deviceId: String
  let name: String
  let publicKey: String
  let appVersion: String
}

enum HandshakeMode {
  /// Reconnecting to a paired Mac, whose identity must match what was stored.
  case auth(deviceId: String, publicKey: String)
  /// Pairing with the code the Mac shows. `key`, when known (from an invite), pins the Mac's
  /// public key, so nobody else (the relay included) can answer.
  case pair(code: String, key: String?)
}

/// What a handshake opens: the channel, who answered, and the six-digit safety code both
/// screens show after pairing (`safetyCode` in `crypto.ts`).
struct OpenedChannel: Sendable {
  let channel: SecureChannel
  let peer: RemotePeer
  let safetyCode: String
}

/// Optional abilities the two sides announce in `hello` / `welcome`.
let capDeflate = "deflate"

/// JSON messages over frames sealed with the session keys. When the Mac reads deflate, long
/// messages are compressed before sealing: the plain text is then `0x01 ‖ raw deflate(JSON)`,
/// as `SecureChannel` in `handshake.ts` writes it.
final class SecureChannel: @unchecked Sendable {
  /// Messages shorter than this go uncompressed (`COMPRESS_MIN_BYTES`).
  static let compressMinBytes = 1024
  /// A compressed message starts with this byte; JSON never does.
  static let deflated: UInt8 = 0x01

  private let socket: FrameTransport
  private let compress: Bool
  private let sender: FrameCipher
  private let receiver: FrameCipher
  private var iterator: AsyncThrowingStream<Data, Error>.AsyncIterator
  private let sendLock = NSLock()

  fileprivate init(socket: FrameTransport, sender: FrameCipher, receiver: FrameCipher, iterator: AsyncThrowingStream<Data, Error>.AsyncIterator, compress: Bool) {
    self.socket = socket
    self.compress = compress
    self.sender = sender
    self.receiver = receiver
    self.iterator = iterator
  }

  /// The next decrypted message, or nil once the connection closed. A frame that does not
  /// open means tampering or a lost frame, so nothing after it can be trusted.
  func next() async throws -> Data? {
    guard let frame = try await iterator.next() else { return nil }
    do {
      let plain = try receiver.open(frame)
      return try Self.unpack(plain)
    } catch {
      socket.close()
      throw RemoteError.protocolViolation("frame did not open")
    }
  }

  static func unpack(_ plain: Data) throws -> Data {
    guard plain.first == deflated else { return plain }
    return try Deflate.inflate(plain.dropFirst())
  }

  static func pack(_ text: Data, compress: Bool) throws -> Data {
    guard compress, text.count >= compressMinBytes else { return text }
    return Data([deflated]) + (try Deflate.compress(text))
  }

  func send(_ message: [String: Any]) throws {
    let plain = try Self.pack(try JSONSerialization.data(withJSONObject: message), compress: compress)
    sendLock.lock()
    defer { sendLock.unlock() }
    socket.send(try sender.seal(plain))
  }

  func close() {
    socket.close()
  }
}

/// Opens a connection as the side that dialed, as `initiate` in `handshake.ts` does:
///
///   phone → hs1 { mode, deviceId, publicKey, ephemeral }
///   Mac   → hs2 { deviceId, publicKey, ephemeral }   (or reject { reason })
///   keys  = HKDF(DH(e_i, e_r) ‖ DH(s_i, e_r) ‖ DH(e_i, s_r) ‖ pairing secret, sha256(hs1 ‖ hs2))
///   phone → sealed hello { name },  Mac → sealed welcome { name }
enum Handshake {
  static let timeout: TimeInterval = 15

  static func initiate(socket: FrameTransport, me: LocalIdentity, mode: HandshakeMode) async throws -> OpenedChannel {
    do {
      return try await withTimeout(seconds: timeout) {
        try await run(socket: socket, me: me, mode: mode)
      }
    } catch {
      socket.close()
      if error is CancellationError { throw HandshakeError.timeout }
      throw error
    }
  }

  private static func run(socket: FrameTransport, me: LocalIdentity, mode: HandshakeMode) async throws -> OpenedChannel {
    var frames = socket.frames.makeAsyncIterator()
    let ephemeral = RemoteCrypto.PrivateKey()
    let modeName: String
    switch mode {
    case .auth: modeName = "auth"
    case .pair: modeName = "pair"
    }
    let hs1 = try JSONSerialization.data(withJSONObject: [
      "t": "hs1",
      "protocol": remoteProtocol,
      "mode": modeName,
      "deviceId": me.deviceId,
      "publicKey": me.publicKey,
      "ephemeral": RemoteCrypto.publicKeyString(ephemeral)
    ] as [String: Any])
    socket.send(hs1)

    guard let hs2Frame = try await frames.next() else { throw HandshakeError.closed }
    guard let hs2 = try? JSONSerialization.jsonObject(with: hs2Frame) as? [String: Any], let t = hs2["t"] as? String else {
      throw HandshakeError.malformed
    }
    if t == "reject" {
      throw HandshakeError(rejectReason: hs2["reason"] as? String ?? "") ?? HandshakeError.malformed
    }
    guard t == "hs2",
          let peerProtocol = hs2["protocol"] as? Int,
          let peerId = hs2["deviceId"] as? String, isDeviceId(peerId),
          let peerKey = hs2["publicKey"] as? String, RemoteCrypto.isPublicKey(peerKey),
          let peerEphemeral = hs2["ephemeral"] as? String, RemoteCrypto.isPublicKey(peerEphemeral)
    else { throw HandshakeError.malformed }
    guard peerProtocol == remoteProtocol else { throw HandshakeError.protocolMismatch }
    if case .auth(let deviceId, let publicKey) = mode, peerId != deviceId || peerKey != publicKey {
      throw HandshakeError.identityChanged
    }
    if case .pair(_, let key?) = mode, peerKey != key { throw HandshakeError.identityChanged }

    let transcript = RemoteCrypto.sha256(hs1, hs2Frame)
    var secrets = [
      try RemoteCrypto.dh(ephemeral, peerEphemeral),
      try RemoteCrypto.dh(me.privateKey, peerEphemeral),
      try RemoteCrypto.dh(ephemeral, peerKey)
    ]
    if case .pair(let code, _) = mode {
      secrets.append(try await RemoteCrypto.pairingSecret(code: code, transcript: transcript))
    }
    let keys = RemoteCrypto.sessionKeys(secrets: secrets, transcript: transcript)
    let sender = FrameCipher(key: keys.initiator)
    let receiver = FrameCipher(key: keys.responder)

    let hello = try JSONSerialization.data(withJSONObject: [
      "t": "hello", "name": me.name, "appVersion": me.appVersion, "nonce": randomHex(8), "caps": [capDeflate]
    ] as [String: Any])
    socket.send(try sender.seal(hello))

    guard let reply = try await frames.next() else { throw HandshakeError.closed }
    guard let opened = try? receiver.open(reply),
          let welcome = try? JSONSerialization.jsonObject(with: opened) as? [String: Any]
    else {
      // A plain-text reject arrives when the Mac could not open our hello.
      if let rejected = try? JSONSerialization.jsonObject(with: reply) as? [String: Any],
         rejected["t"] as? String == "reject",
         let reason = HandshakeError(rejectReason: rejected["reason"] as? String ?? "") {
        throw reason
      }
      throw HandshakeError.authFailed
    }
    guard welcome["t"] as? String == "welcome", let name = welcome["name"] as? String else { throw HandshakeError.malformed }
    let caps = welcome["caps"] as? [String] ?? []
    let channel = SecureChannel(socket: socket, sender: sender, receiver: receiver, iterator: frames, compress: caps.contains(capDeflate))
    let peer = RemotePeer(deviceId: peerId, name: name, publicKey: peerKey, appVersion: welcome["appVersion"] as? String ?? "")
    return OpenedChannel(channel: channel, peer: peer, safetyCode: RemoteCrypto.safetyCode(keys))
  }

  static func isDeviceId(_ value: String) -> Bool {
    value.count == 11 && value.hasPrefix("dv_") && value.dropFirst(3).allSatisfy { $0.isHexDigit && !$0.isUppercase }
  }

  static func randomHex(_ bytes: Int) -> String {
    (0..<bytes).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
  }
}

/// Runs `operation`, cancelling it after `seconds`.
func withTimeout<T: Sendable>(seconds: TimeInterval, _ operation: @escaping @Sendable () async throws -> T) async throws -> T {
  try await withThrowingTaskGroup(of: T.self) { group in
    group.addTask { try await operation() }
    group.addTask {
      try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      throw CancellationError()
    }
    defer { group.cancelAll() }
    guard let result = try await group.next() else { throw CancellationError() }
    return result
  }
}

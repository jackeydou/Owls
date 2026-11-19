import CryptoKit
import Foundation

/// The cryptography of Remote Router, matching `apps/owlto-client/src/main/remote/crypto.ts`
/// byte for byte: X25519 key agreement, HKDF-SHA256 session keys, scrypt for the pairing
/// code, and AES-256-GCM frames with a counter nonce.
enum RemoteCrypto {
  typealias PrivateKey = Curve25519.KeyAgreement.PrivateKey

  /// A public key as the peers store and compare it: 32 raw bytes in unpadded base64url.
  static func publicKeyString(_ key: PrivateKey) -> String {
    Base64URL.encode(key.publicKey.rawRepresentation)
  }

  static func isPublicKey(_ value: String) -> Bool {
    value.count == 43 && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
  }

  /// The raw 32-byte X25519 shared secret, as Node's `diffieHellman` returns it.
  static func dh(_ privateKey: PrivateKey, _ publicKey: String) throws -> Data {
    guard let raw = Base64URL.decode(publicKey), raw.count == 32 else { throw HandshakeError.malformed }
    let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: raw)
    let secret = try privateKey.sharedSecretFromKeyAgreement(with: peer)
    return secret.withUnsafeBytes { Data($0) }
  }

  static func sha256(_ parts: Data...) -> Data {
    var hash = SHA256()
    for part in parts { hash.update(data: part) }
    return Data(hash.finalize())
  }

  /// Stretches the pairing code with the handshake transcript as salt (N = 2^15, r = 8, p = 1).
  static func pairingSecret(code: String, transcript: Data) async throws -> Data {
    try await Task.detached(priority: .userInitiated) {
      try scrypt(password: Data(code.utf8), salt: transcript, n: 1 << 15, r: 8, p: 1, length: 32)
    }.value
  }

  static func scrypt(password: Data, salt: Data, n: UInt64, r: UInt32, p: UInt32, length: Int) throws -> Data {
    var out = Data(count: length)
    let status = out.withUnsafeMutableBytes { outBytes in
      password.withUnsafeBytes { passwordBytes in
        salt.withUnsafeBytes { saltBytes in
          owlto_scrypt(
            passwordBytes.bindMemory(to: UInt8.self).baseAddress, password.count,
            saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
            n, r, p,
            outBytes.bindMemory(to: UInt8.self).baseAddress, length
          )
        }
      }
    }
    guard status == 0 else { throw HandshakeError.malformed }
    return out
  }

  private static let keyInfo = Data("owlto-remote-v1 keys".utf8)

  /// One key per direction: the initiator (this phone) sends with `initiator`.
  static func sessionKeys(secrets: [Data], transcript: Data) -> (initiator: SymmetricKey, responder: SymmetricKey) {
    let material = SymmetricKey(data: secrets.reduce(Data(), +))
    let okm = HKDF<SHA256>.deriveKey(inputKeyMaterial: material, salt: transcript, info: keyInfo, outputByteCount: 64)
    let bytes = okm.withUnsafeBytes { Data($0) }
    return (SymmetricKey(data: bytes.prefix(32)), SymmetricKey(data: bytes.suffix(32)))
  }
}

/// Seals and opens frames for one direction. The nonce is a counter, so a dropped, replayed,
/// or reordered frame fails to open and the connection closes.
final class FrameCipher {
  private let key: SymmetricKey
  private var counter: UInt64 = 0

  init(key: SymmetricKey) {
    self.key = key
  }

  private func nextNonce() throws -> AES.GCM.Nonce {
    var bytes = Data(count: 12)
    let value = counter.bigEndian
    withUnsafeBytes(of: value) { bytes.replaceSubrange(4..<12, with: $0) }
    counter += 1
    return try AES.GCM.Nonce(data: bytes)
  }

  /// Ciphertext followed by the 16-byte tag, as Node writes it.
  func seal(_ plain: Data) throws -> Data {
    let box = try AES.GCM.seal(plain, using: key, nonce: nextNonce())
    return box.ciphertext + box.tag
  }

  func open(_ sealed: Data) throws -> Data {
    guard sealed.count >= 16 else { throw HandshakeError.malformed }
    let nonce = try nextNonce()
    let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: sealed.dropLast(16), tag: sealed.suffix(16))
    return try AES.GCM.open(box, using: key)
  }
}

enum Base64URL {
  static func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func decode(_ text: String) -> Data? {
    var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64 += "=" }
    return Data(base64Encoded: base64)
  }
}

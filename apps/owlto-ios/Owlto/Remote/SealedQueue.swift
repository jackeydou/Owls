import CryptoKit
import Foundation

/// A Router message sealed to a Mac's long-term key and left on the relay while the Mac is
/// away, as `sealForHost` in the desktop's `remote/sealed.ts` writes it:
///
///   item = base64url(JSON { v: 1, from, eph, box })
///   key  = HKDF-SHA256(DH(e, H) ‖ DH(C, H), salt = SHA-256(from ‖ eph ‖ H), "owlto-queue-v1")
///   box  = base64url(nonce ‖ AES-256-GCM(key, nonce, JSON { seq, at, method, params }, aad = from))
///
/// Only the Mac can open it, and only this phone could have sealed it. The Mac runs each
/// sequence number at most once.
enum SealedQueue {
  private static let info = Data("owlto-queue-v1".utf8)

  static func queueKey(ephemeral: RemoteCrypto.PrivateKey, me: LocalIdentity, hostKey: String) throws -> SymmetricKey {
    let eph = RemoteCrypto.publicKeyString(ephemeral)
    let secrets = try RemoteCrypto.dh(ephemeral, hostKey) + RemoteCrypto.dh(me.privateKey, hostKey)
    let salt = RemoteCrypto.sha256(Data(me.deviceId.utf8), Data(eph.utf8), Data(hostKey.utf8))
    return HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: secrets), salt: salt, info: info, outputByteCount: 32)
  }

  static func sealForHost(
    params: Any,
    seq: Int,
    at: Date,
    me: LocalIdentity,
    hostKey: String,
    ephemeral: RemoteCrypto.PrivateKey = RemoteCrypto.PrivateKey(),
    nonce: AES.GCM.Nonce = AES.GCM.Nonce()
  ) throws -> String {
    let eph = RemoteCrypto.publicKeyString(ephemeral)
    let key = try queueKey(ephemeral: ephemeral, me: me, hostKey: hostKey)
    let message: [String: Any] = [
      "seq": seq,
      "at": Int(at.timeIntervalSince1970 * 1000),
      "method": "sendRouter",
      "params": params
    ]
    let plain = try JSONSerialization.data(withJSONObject: message)
    let sealed = try AES.GCM.seal(plain, using: key, nonce: nonce, authenticating: Data(me.deviceId.utf8))
    let box = Data(nonce) + sealed.ciphertext + sealed.tag
    let envelope: [String: Any] = ["v": 1, "from": me.deviceId, "eph": eph, "box": Base64URL.encode(box)]
    return Base64URL.encode(try JSONSerialization.data(withJSONObject: envelope))
  }
}

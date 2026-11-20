import CryptoKit
import Foundation
import Security

/// Shared by the app and its notification extension. The app makes a 32-byte key, gives it
/// to each paired Mac with `registerPush`, and keeps it in a keychain group the extension can
/// read. A Mac seals each notification with it (`sealPush` in the desktop's `remote/sealed.ts`),
/// so APNs and the relay carry only ciphertext: base64url(nonce ‖ AES-256-GCM(key, JSON)).
enum PushShared {
  /// The app group both targets list; iOS lets it double as a keychain access group.
  static let group = "group.app.owlto.mobile"
  private static let service = "app.owlto.mobile.push"
  private static let account = "push.key"

  /// A notification as the Mac wrote it.
  struct Message: Decodable, Equatable {
    let title: String
    let subtitle: String
    let body: String
    let routerId: String?
    let workerId: String?
  }

  static func open(_ payload: String, key: Data) throws -> Message {
    guard let sealed = Base64URL.decode(payload), sealed.count >= 28, key.count == 32 else { throw CryptoKitError.incorrectParameterSize }
    let box = try AES.GCM.SealedBox(
      nonce: AES.GCM.Nonce(data: sealed.prefix(12)),
      ciphertext: sealed.dropFirst(12).dropLast(16),
      tag: sealed.suffix(16)
    )
    let plain = try AES.GCM.open(box, using: SymmetricKey(data: key))
    return try JSONDecoder().decode(Message.self, from: plain)
  }

  private static func query(group: String?) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account
    ]
    if let group { query[kSecAttrAccessGroup as String] = group }
    return query
  }

  /// The stored key, from the shared group or, where that group is not entitled (a build
  /// signed without a team), from the app's own keychain.
  static func readKey() -> Data? {
    for group in [group, nil] as [String?] {
      var query = query(group: group)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var result: CFTypeRef?
      if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data, data.count == 32 {
        return data
      }
    }
    return nil
  }

  /// The key, made and stored on first use.
  static func key() -> Data {
    if let key = readKey() { return key }
    let key = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
    for group in [group, nil] as [String?] {
      SecItemDelete(query(group: group) as CFDictionary)
      var add = query(group: group)
      add[kSecValueData as String] = key
      add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      if SecItemAdd(add as CFDictionary, nil) == errSecSuccess { break }
    }
    return key
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

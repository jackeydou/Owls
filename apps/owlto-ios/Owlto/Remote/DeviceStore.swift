import CryptoKit
import Foundation
import Security
import UIKit

/// A Mac this phone paired with. Its public key is what every later handshake must match.
/// It is reached directly at `host:port`, through the relay, or both, whichever answers first.
struct PairedHost: Codable, Equatable, Identifiable {
  let deviceId: String
  var name: String
  let publicKey: String
  /// Nil for a Mac paired through the relay, which has no address the phone could dial.
  var host: String?
  var port: UInt16?
  /// The Mac's relay mailbox and this phone's own ticket, refreshed on every connection.
  var relay: RelayRoute?
  /// The last sequence number this phone left on the relay for the Mac.
  var queueSeq: Int?
  let pairedAt: Date
  var lastSeenAt: Date?
  var id: String { deviceId }

  var address: String? {
    guard let host, let port else { return nil }
    return RemoteAddress(host: host, port: port).formatted
  }
}

/// How a link to a Mac was made, shown next to its status.
enum LinkPath: String, Equatable {
  case direct
  case relay
}

/// `host`, `host:port`, or `[ipv6]:port`, parsed as `parseRemoteAddress` in `shared/remote.ts` does.
struct RemoteAddress: Equatable {
  let host: String
  let port: UInt16

  init(host: String, port: UInt16) {
    self.host = host
    self.port = port
  }

  init?(_ text: String) {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty, !value.contains("/"), !value.contains(where: \.isWhitespace) else { return nil }
    var host = value
    var portText: Substring?
    if value.hasPrefix("[") {
      guard let close = value.firstIndex(of: "]") else { return nil }
      host = String(value[value.index(after: value.startIndex)..<close])
      let rest = value[value.index(after: close)...]
      if !rest.isEmpty {
        guard rest.hasPrefix(":") else { return nil }
        portText = rest.dropFirst()
      }
    } else if let colon = value.firstIndex(of: ":") {
      guard value.filter({ $0 == ":" }).count == 1 else { return nil }
      host = String(value[..<colon])
      portText = value[value.index(after: colon)...]
    }
    guard !host.isEmpty else { return nil }
    if let portText {
      guard let port = UInt16(portText), port > 0 else { return nil }
      self.init(host: host, port: port)
    } else {
      self.init(host: host, port: remotePort)
    }
  }

  var formatted: String {
    let shown = host.contains(":") ? "[\(host)]" : host
    return port == remotePort ? shown : "\(shown):\(port)"
  }
}

/// Uppercases and drops separators, so `abcd-efgh` and `ABCDEFGH` are the same code.
enum PairingCode {
  static let alphabet = Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
  static let length = 8

  static func normalize(_ code: String) -> String {
    code.uppercased().filter { $0 != "-" && !$0.isWhitespace }
  }

  static func isValid(_ code: String) -> Bool {
    let value = normalize(code)
    return value.count == length && value.allSatisfy { alphabet.contains($0) }
  }
}

/// A code that works from any network: `K7Q2-ABCD-EFGH`. The first four characters let the
/// relay find the Mac; the last eight are the pairing code, which never leaves the two devices.
/// `parseRelayCode` in `shared/remote.ts`.
struct RelayCode: Equatable {
  static let rendezvousLength = 4
  let rendezvous: String
  let code: String

  init?(_ text: String) {
    let value = PairingCode.normalize(text)
    guard value.count == Self.rendezvousLength + PairingCode.length, value.allSatisfy({ PairingCode.alphabet.contains($0) }) else { return nil }
    rendezvous = String(value.prefix(Self.rendezvousLength))
    code = String(value.dropFirst(Self.rendezvousLength))
  }
}

/// A pairing invite, as the Mac's QR code carries it (`parseRemoteInvite` in `shared/remote.ts`):
///
///   owlto://pair?v=1&relay=<wss url>&mailbox=<id>&ticket=<one-time ticket>&code=<code>&key=<public key>
///
/// It carries the Mac's public key, so the relay cannot stand in for the Mac.
struct RemoteInvite: Equatable {
  static let prefix = "owlto://pair?"
  let relay: String
  let mailbox: String
  let ticket: String
  let code: String
  let key: String

  init?(_ text: String) {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.hasPrefix(Self.prefix), value.count <= 2048,
          let items = URLComponents(string: "https://invite/?" + value.dropFirst(Self.prefix.count))?.queryItems
    else { return nil }
    func param(_ name: String) -> String { items.first { $0.name == name }?.value ?? "" }
    let code = param("code")
    guard param("v") == "1", PairingCode.isValid(code),
          RelayRoute.isRelayURL(param("relay")), !param("relay").contains("?"), !param("relay").contains("#"),
          RelayRoute.isToken(param("mailbox")), RelayRoute.isToken(param("ticket")),
          RemoteCrypto.isPublicKey(param("key"))
    else { return nil }
    relay = param("relay")
    mailbox = param("mailbox")
    ticket = param("ticket")
    self.code = PairingCode.normalize(code)
    key = param("key")
  }
}

/// This phone's identity and its paired Macs. The private key lives in the Keychain, readable
/// only on this device after first unlock; the paired list holds nothing secret.
final class DeviceStore {
  private let defaults: UserDefaults
  private let keychainService: String
  private static let deviceIdKey = "remote.deviceId"
  private static let hostsKey = "remote.hosts"
  private static let keyAccount = "remote.identity"

  init(defaults: UserDefaults = .standard, keychainService: String = "app.owlto.mobile.remote") {
    self.defaults = defaults
    self.keychainService = keychainService
  }

  /// `dv_` and eight hex digits, made on first use.
  var deviceId: String {
    if let id = defaults.string(forKey: Self.deviceIdKey), Handshake.isDeviceId(id) { return id }
    let id = "dv_" + Handshake.randomHex(4)
    defaults.set(id, forKey: Self.deviceIdKey)
    return id
  }

  /// The long-term X25519 key. If the Keychain cannot return the stored key, a new one is
  /// made: paired Macs then reject this phone, and the user pairs again.
  func identityKey() throws -> RemoteCrypto.PrivateKey {
    if let raw = readKey(), let key = try? RemoteCrypto.PrivateKey(rawRepresentation: raw) { return key }
    let key = RemoteCrypto.PrivateKey()
    try saveKey(key.rawRepresentation)
    return key
  }

  /// The name the Mac lists this phone under.
  @MainActor
  var phoneName: String {
    let name = UIDevice.current.name.trimmingCharacters(in: .whitespacesAndNewlines)
    return String((name.isEmpty ? "iPhone" : name).prefix(120))
  }

  @MainActor
  func identity() throws -> LocalIdentity {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    return LocalIdentity(
      deviceId: deviceId,
      name: phoneName,
      appVersion: "ios-\(version)",
      privateKey: try identityKey()
    )
  }

  func hosts() -> [PairedHost] {
    guard let data = defaults.data(forKey: Self.hostsKey),
          let hosts = try? JSONDecoder().decode([PairedHost].self, from: data) else { return [] }
    return hosts.sorted { $0.pairedAt < $1.pairedAt }
  }

  func save(_ hosts: [PairedHost]) {
    defaults.set(try? JSONEncoder().encode(hosts), forKey: Self.hostsKey)
  }

  private func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: Self.keyAccount
    ]
  }

  private func readKey() -> Data? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
    return result as? Data
  }

  private func saveKey(_ data: Data) throws {
    SecItemDelete(baseQuery() as CFDictionary)
    var query = baseQuery()
    query[kSecValueData as String] = data
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw RemoteError.protocolViolation("keychain \(status)") }
  }
}

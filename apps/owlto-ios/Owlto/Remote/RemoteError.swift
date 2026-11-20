import Foundation

/// Why a handshake did not finish, as `HandshakeError` in `handshake.ts` names it.
enum HandshakeError: Error, Equatable {
  /// The Mac does not know this phone, or its key changed.
  case unknownDevice
  /// The Mac is not showing a pairing code.
  case notPairing
  /// The keys did not match: a wrong pairing code, or someone in the middle.
  case authFailed
  /// The Mac speaks another protocol version.
  case protocolMismatch
  /// The Mac answered with a different identity than the one paired.
  case identityChanged
  case closed
  case timeout
  case malformed

  init?(rejectReason: String) {
    switch rejectReason {
    case "unknown_device": self = .unknownDevice
    case "not_pairing": self = .notPairing
    case "auth_failed": self = .authFailed
    case "protocol": self = .protocolMismatch
    default: return nil
    }
  }
}

/// What the user can act on, using the Mac's failure codes so messages match the desktop app.
enum RemoteError: Error, Equatable {
  case offline
  case timeout
  case unreachable(detail: String?)
  case pairingFailed
  case identityChanged
  case version
  case unsupported
  case invalidAddress
  /// The Mac is away and already has as many messages waiting on the relay as it takes.
  case queueFull
  case protocolViolation(String)
  /// A failure the Mac reported for a request, such as `thread_busy`.
  case host(code: String, message: String)

  /// Maps a failed dial or handshake the way `linkFailure` in `client.ts` does.
  static func from(_ error: Error, pairing: Bool) -> RemoteError {
    if let remote = error as? RemoteError { return remote }
    if let relay = error as? RelayFailure {
      switch relay.reason {
      case "version": return .version
      // The host is not on the relay right now.
      case "offline": return .offline
      default: return .unreachable(detail: "relay_\(relay.reason)")
      }
    }
    if let handshake = error as? HandshakeError {
      switch handshake {
      case .protocolMismatch: return .version
      case .authFailed, .notPairing: return pairing ? .pairingFailed : .identityChanged
      case .unknownDevice, .identityChanged: return .identityChanged
      case .closed, .timeout, .malformed: return .unreachable(detail: "handshake_\(handshake)")
      }
    }
    return .unreachable(detail: nil)
  }

  var code: String {
    switch self {
    case .offline: return "remote_offline"
    case .timeout: return "remote_timeout"
    case .unreachable: return "remote_unreachable"
    case .pairingFailed: return "remote_pairing_failed"
    case .identityChanged: return "remote_identity_changed"
    case .version: return "remote_version"
    case .unsupported: return "remote_unsupported"
    case .invalidAddress: return "invalid_request"
    case .queueFull: return "remote_offline"
    case .protocolViolation: return "protocol_error"
    case .host(let code, _): return code
    }
  }
}

extension RemoteError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .offline:
      return String(localized: "That Mac is not connected. Check that it is on, awake, and running Owlto.")
    case .timeout:
      return String(localized: "That Mac did not answer in time. Try again.")
    case .unreachable(let detail) where detail?.hasPrefix("relay_") == true:
      return String(localized: "Could not reach the Mac through the Owlto relay. Check that it is on, awake, and allows connections over the internet in Settings → Devices.")
    case .unreachable:
      return String(localized: "Nothing answered at that address. Check the address, that access is on in Owlto's Settings → Devices on the Mac, and that Owlto may use the local network.")
    case .pairingFailed:
      return String(localized: "The code did not work. Check it, or show a new code on the Mac.")
    case .identityChanged:
      return String(localized: "That Mac no longer recognizes this phone, or its identity changed. Remove it and pair again.")
    case .version:
      return String(localized: "That Mac runs a different version of Owlto. Update both apps.")
    case .unsupported:
      return String(localized: "This only works on the Mac itself.")
    case .invalidAddress:
      return String(localized: "Enter an address such as 192.168.1.20, a code such as K7Q2-ABCD-EFGH, or scan the Mac's QR code.")
    case .queueFull:
      return String(localized: "The Mac is offline and has too many messages waiting. Try again when it is back.")
    case .protocolViolation:
      return String(localized: "The Mac sent something this app could not read.")
    case .host(_, let message):
      return message
    }
  }
}

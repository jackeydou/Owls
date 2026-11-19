import Foundation

/// Requests, replies, and events over a secure channel, as `RpcConnection` in `rpc.ts`
/// frames them: `req`, `res`, `event`, `ping`, and `pong`. The phone only sends requests;
/// a request from the Mac is answered with `remote_unsupported`.
actor RpcConnection {
  static let requestTimeout: TimeInterval = 60
  static let pingInterval: TimeInterval = 20
  /// Silence this long means the Mac went away (asleep, or off the network).
  static let idleTimeout: TimeInterval = 50

  private let channel: SecureChannel
  private var nextId = 1
  private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
  private var lastHeard = Date()
  private var closed = false
  private var reader: Task<Void, Never>?
  private var heartbeat: Task<Void, Never>?
  private let onEvent: @Sendable (Data) -> Void
  private let onClose: @Sendable () -> Void

  init(channel: SecureChannel, onEvent: @escaping @Sendable (Data) -> Void, onClose: @escaping @Sendable () -> Void) {
    self.channel = channel
    self.onEvent = onEvent
    self.onClose = onClose
  }

  func start() {
    reader = Task { [weak self, channel] in
      while true {
        let message: Data?
        do { message = try await channel.next() } catch { message = nil }
        guard let message else { break }
        await self?.receive(message)
      }
      await self?.finish()
    }
    heartbeat = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: UInt64(RpcConnection.pingInterval * 1_000_000_000))
        guard let self, !Task.isCancelled else { return }
        await self.beat()
      }
    }
  }

  private func beat() {
    guard !closed else { return }
    if Date().timeIntervalSince(lastHeard) > Self.idleTimeout {
      close()
      return
    }
    try? channel.send(["t": "ping"])
  }

  private func receive(_ data: Data) {
    lastHeard = Date()
    guard let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let t = message["t"] as? String else { return }
    switch t {
    case "ping":
      try? channel.send(["t": "pong"])
    case "event":
      if let event = message["event"], JSONSerialization.isValidJSONObject(event),
         let raw = try? JSONSerialization.data(withJSONObject: event) {
        onEvent(raw)
      }
    case "req":
      if let id = message["id"] as? Int {
        try? channel.send([
          "t": "res", "id": id, "ok": false,
          "error": ["code": "remote_unsupported", "message": "A phone does not answer requests."]
        ])
      }
    case "res":
      guard let id = message["id"] as? Int, let continuation = pending.removeValue(forKey: id) else { return }
      if message["ok"] as? Bool == true {
        let value = message["value"] ?? NSNull()
        let raw = (try? JSONSerialization.data(withJSONObject: ["v": value])) ?? Data("{\"v\":null}".utf8)
        continuation.resume(returning: raw)
      } else {
        let error = message["error"] as? [String: Any]
        continuation.resume(throwing: RemoteError.host(
          code: error?["code"] as? String ?? "protocol_error",
          message: error?["message"] as? String ?? ""
        ))
      }
    default:
      break
    }
  }

  /// Sends one request. The reply comes back as `{"v": value}` JSON for the caller to decode.
  func request(method: String, params: Any?) async throws -> Data {
    guard !closed else { throw RemoteError.offline }
    let id = nextId
    nextId += 1
    let message: [String: Any] = ["t": "req", "id": id, "method": method, "params": params ?? NSNull()]
    return try await withCheckedThrowingContinuation { continuation in
      pending[id] = continuation
      do {
        try channel.send(message)
      } catch {
        pending.removeValue(forKey: id)
        continuation.resume(throwing: error)
        return
      }
      Task { [weak self] in
        try? await Task.sleep(nanoseconds: UInt64(RpcConnection.requestTimeout * 1_000_000_000))
        await self?.expire(id)
      }
    }
  }

  private func expire(_ id: Int) {
    pending.removeValue(forKey: id)?.resume(throwing: RemoteError.timeout)
  }

  func close() {
    channel.close()
    finish()
  }

  private func finish() {
    guard !closed else { return }
    closed = true
    reader?.cancel()
    heartbeat?.cancel()
    for continuation in pending.values { continuation.resume(throwing: RemoteError.offline) }
    pending.removeAll()
    onClose()
  }
}

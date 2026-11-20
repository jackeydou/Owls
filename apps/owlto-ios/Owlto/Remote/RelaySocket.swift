import Foundation

/// The relay's own protocol version; `RELAY_PROTOCOL` in `packages/owlto-relay/src/protocol.ts`.
let relayProtocol = 1

/// The Owlto relay this phone looks typed relay codes up on, matching the Mac's build:
/// debug builds use the debug relay (`RELAY_URL` in the desktop's `build-flavor.ts`).
#if DEBUG
let defaultRelayURL = "wss://relay-debug.owlto.dev"
#else
let defaultRelayURL = "wss://relay.owlto.dev"
#endif

/// How to reach a Mac through the relay: its mailbox and this phone's own ticket.
struct RelayRoute: Codable, Equatable, Sendable {
  let url: String
  let mailbox: String
  let ticket: String

  static func isToken(_ value: String) -> Bool {
    (22...128).contains(value.count) && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
  }

  static func isRelayURL(_ value: String) -> Bool {
    value.count <= 512 && (value.hasPrefix("wss://") || value.hasPrefix("ws://")) && !value.contains(where: \.isWhitespace)
  }

  /// A route as the Mac's `relayRoute` reply carries it, or nil when it has none.
  init?(json: Any?) {
    guard let object = json as? [String: Any],
          let url = object["url"] as? String, Self.isRelayURL(url),
          let mailbox = object["mailbox"] as? String, Self.isToken(mailbox),
          let ticket = object["ticket"] as? String, Self.isToken(ticket)
    else { return nil }
    self.init(url: url, mailbox: mailbox, ticket: ticket)
  }

  init(url: String, mailbox: String, ticket: String) {
    self.url = url
    self.mailbox = mailbox
    self.ticket = ticket
  }
}

/// What the relay answered instead of opening, as `RelayError` in the desktop's `relay.ts`.
struct RelayFailure: Error, Equatable {
  /// `denied`, `offline`, `full`, `limited`, `version`, `unreachable`, `timeout`, `closed`, …
  let reason: String
}

/// Whole frames over a relay pipe (a WebSocket), split into chunks that fit one relay
/// message: each chunk starts with one byte, 1 when more follow and 0 on the last, as
/// `WebSocketFrames` in `relay.ts` writes them. Text `ping`s every 30 s keep the socket open
/// through NATs; the relay answers them without waking its Durable Object.
final class RelaySocket: FrameTransport, @unchecked Sendable {
  static let chunkBytes = 256 * 1024
  static let openTimeout: TimeInterval = 10
  static let pingInterval: TimeInterval = 30
  static let silenceTimeout: TimeInterval = 75

  let frames: AsyncThrowingStream<Data, Error>
  private let continuation: AsyncThrowingStream<Data, Error>.Continuation
  private let task: URLSessionWebSocketTask
  private let lock = NSLock()
  private var parts = Data()
  private var finished = false
  private var lastHeard = Date()
  private var pinger: Task<Void, Never>?

  private init(task: URLSessionWebSocketTask) {
    self.task = task
    var continuation: AsyncThrowingStream<Data, Error>.Continuation!
    frames = AsyncThrowingStream(bufferingPolicy: .unbounded) { continuation = $0 }
    self.continuation = continuation
  }

  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = openTimeout
    return URLSession(configuration: configuration)
  }()

  static func socketURL(_ base: String, kind: String, mailbox: String) -> URL? {
    var trimmed = base
    while trimmed.hasSuffix("/") { trimmed.removeLast() }
    return URL(string: "\(trimmed)/v1/\(kind)/\(mailbox)")
  }

  /// Asks the relay for a pipe to the Mac behind `route`.
  static func dial(_ route: RelayRoute) async throws -> RelaySocket {
    guard let url = socketURL(route.url, kind: "client", mailbox: route.mailbox) else { throw RelayFailure(reason: "bad_request") }
    let socket = RelaySocket(task: session.webSocketTask(with: url))
    try await socket.open(hello: ["t": "client", "v": relayProtocol, "ticket": route.ticket], expect: "open")
    socket.startReading()
    return socket
  }

  /// Leaves one sealed item for a Mac that is away; it gets the item when it next connects.
  static func drop(_ route: RelayRoute, item: String) async throws {
    guard let url = socketURL(route.url, kind: "drop", mailbox: route.mailbox) else { throw RelayFailure(reason: "bad_request") }
    let socket = RelaySocket(task: session.webSocketTask(with: url))
    defer { socket.close() }
    try await socket.open(hello: ["t": "drop", "v": relayProtocol, "ticket": route.ticket, "item": item], expect: "stored")
  }

  /// Finds the mailbox and pairing ticket behind the first four characters of a code like
  /// `K7Q2-ABCD-EFGH`. Nil when the code is unknown or expired.
  static func lookupRendezvous(relay: String, code: String) async throws -> (mailbox: String, ticket: String)? {
    var http = relay
    if http.hasPrefix("wss://") { http = "https://" + http.dropFirst(6) } else if http.hasPrefix("ws://") { http = "http://" + http.dropFirst(5) }
    while http.hasSuffix("/") { http.removeLast() }
    guard let url = URL(string: "\(http)/v1/rendezvous/\(code)") else { throw RelayFailure(reason: "bad_request") }
    var request = URLRequest(url: url)
    request.timeoutInterval = openTimeout
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw RelayFailure(reason: "unreachable")
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 404 { return nil }
    if status == 429 { throw RelayFailure(reason: "limited") }
    guard status == 200,
          let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let mailbox = body["mailbox"] as? String, RelayRoute.isToken(mailbox),
          let ticket = body["ticket"] as? String, RelayRoute.isToken(ticket)
    else { throw RelayFailure(reason: status == 200 ? "bad_request" : "unreachable") }
    return (mailbox, ticket)
  }

  /// Sends the hello and waits for `expect`; the relay's `error` becomes a `RelayFailure`.
  private func open(hello: [String: Any], expect: String) async throws {
    task.resume()
    let text = String(decoding: try JSONSerialization.data(withJSONObject: hello), as: UTF8.self)
    do {
      try await withTimeout(seconds: Self.openTimeout) { [task] in
        try await task.send(.string(text))
        while true {
          let message = try await task.receive()
          guard case .string(let reply) = message,
                let object = try? JSONSerialization.jsonObject(with: Data(reply.utf8)) as? [String: Any],
                let t = object["t"] as? String else { continue }
          if t == expect { return }
          if t == "error" { throw RelayFailure(reason: object["code"] as? String ?? "unknown") }
        }
      }
    } catch let failure as RelayFailure {
      task.cancel(with: .normalClosure, reason: nil)
      throw failure
    } catch is CancellationError {
      task.cancel(with: .normalClosure, reason: nil)
      throw RelayFailure(reason: "timeout")
    } catch {
      task.cancel(with: .normalClosure, reason: nil)
      throw RelayFailure(reason: "unreachable")
    }
  }

  private func startReading() {
    receive()
    pinger = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: UInt64(RelaySocket.pingInterval * 1_000_000_000))
        guard let self, !Task.isCancelled else { return }
        if Date().timeIntervalSince(self.heard()) > RelaySocket.silenceTimeout {
          self.finish(RelayFailure(reason: "silent"))
          return
        }
        self.task.send(.string("ping")) { _ in }
      }
    }
  }

  private func heard() -> Date {
    lock.lock()
    defer { lock.unlock() }
    return lastHeard
  }

  private func receive() {
    task.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .failure(let error):
        self.finish(error)
      case .success(let message):
        self.consume(message)
        if !self.isFinished { self.receive() }
      }
    }
  }

  private var isFinished: Bool {
    lock.lock()
    defer { lock.unlock() }
    return finished
  }

  private func consume(_ message: URLSessionWebSocketTask.Message) {
    lock.lock()
    lastHeard = Date()
    // Text after `open` is only the relay's `pong`.
    guard case .data(let chunk) = message, let flag = chunk.first else {
      lock.unlock()
      return
    }
    parts.append(chunk.dropFirst())
    if parts.count > FrameSocket.maxFrameBytes {
      lock.unlock()
      finish(RemoteError.protocolViolation("frame too large"))
      return
    }
    guard flag == 0 else {
      lock.unlock()
      return
    }
    let frame = parts
    parts = Data()
    lock.unlock()
    continuation.yield(frame)
  }

  private func finish(_ error: Error?) {
    lock.lock()
    guard !finished else {
      lock.unlock()
      return
    }
    finished = true
    lock.unlock()
    pinger?.cancel()
    task.cancel(with: .normalClosure, reason: nil)
    if let error { continuation.finish(throwing: error) } else { continuation.finish() }
  }

  func send(_ frame: Data) {
    guard !isFinished else { return }
    var offset = 0
    repeat {
      let end = min(offset + Self.chunkBytes, frame.count)
      var chunk = Data([end < frame.count ? 1 : 0])
      chunk.append(frame[frame.startIndex + offset..<frame.startIndex + end])
      // URLSessionWebSocketTask sends in order, so chunks of one frame stay together.
      task.send(.data(chunk)) { [weak self] error in
        if let error { self?.finish(error) }
      }
      offset = end
    } while offset < frame.count
  }

  func close() {
    finish(nil)
  }
}

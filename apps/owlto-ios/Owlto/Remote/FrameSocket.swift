import Foundation
import Network

/// Whole binary frames in both directions: over TCP (`FrameSocket`) or a relay pipe
/// (`RelaySocket`). The handshake and everything after it only see this.
protocol FrameTransport: AnyObject, Sendable {
  /// Frames in order. It finishes when either side closes, with an error when it failed.
  var frames: AsyncThrowingStream<Data, Error> { get }
  func send(_ frame: Data)
  func close()
}

/// Whole binary frames over TCP, each prefixed with its length as a 32-bit big-endian
/// number, as `SocketFrames` in `apps/owlto-client/src/main/remote/frames.ts` writes them.
final class FrameSocket: FrameTransport, @unchecked Sendable {
  /// The largest frame either side accepts; a snapshot of a long history is the biggest.
  static let maxFrameBytes = 32 * 1024 * 1024

  /// Frames in order. It finishes when either side closes, with an error when it failed.
  let frames: AsyncThrowingStream<Data, Error>
  private let continuation: AsyncThrowingStream<Data, Error>.Continuation
  private let connection: NWConnection
  private let queue = DispatchQueue(label: "app.owlto.frames")
  private var buffer = Data()
  private var finished = false

  private init(connection: NWConnection) {
    self.connection = connection
    var continuation: AsyncThrowingStream<Data, Error>.Continuation!
    frames = AsyncThrowingStream(bufferingPolicy: .unbounded) { continuation = $0 }
    self.continuation = continuation
  }

  /// Opens a TCP connection; throws when it cannot connect within `timeout` seconds.
  static func connect(host: String, port: UInt16, timeout: TimeInterval = 8) async throws -> FrameSocket {
    guard let nwPort = NWEndpoint.Port(rawValue: port) else { throw RemoteError.unreachable(detail: "port") }
    let tcp = NWProtocolTCP.Options()
    tcp.noDelay = true
    tcp.connectionTimeout = Int(timeout)
    let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: NWParameters(tls: nil, tcp: tcp))
    let socket = FrameSocket(connection: connection)
    try await socket.start(timeout: timeout)
    return socket
  }

  private func start(timeout: TimeInterval) async throws {
    try await withCheckedThrowingContinuation { (ready: CheckedContinuation<Void, Error>) in
      var settled = false
      let settle: (Result<Void, Error>) -> Void = { result in
        guard !settled else { return }
        settled = true
        ready.resume(with: result)
      }
      connection.stateUpdateHandler = { [weak self] state in
        guard let self else { return }
        switch state {
        case .ready:
          settle(.success(()))
          self.receive()
        case .waiting(let error):
          // Refused, unreachable, or Local Network access denied: fail now rather than wait.
          settle(.failure(RemoteError.unreachable(detail: Self.describe(error))))
          self.connection.cancel()
        case .failed(let error):
          settle(.failure(RemoteError.unreachable(detail: Self.describe(error))))
          self.finish(error)
        case .cancelled:
          settle(.failure(RemoteError.unreachable(detail: "cancelled")))
          self.finish(nil)
        default:
          break
        }
      }
      connection.start(queue: queue)
      queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
        guard !settled else { return }
        settle(.failure(RemoteError.unreachable(detail: "timeout")))
        self?.connection.cancel()
      }
    }
  }

  private static func describe(_ error: NWError) -> String {
    switch error {
    case .posix(let code): return "\(code)"
    case .dns(let code): return "dns_\(code)"
    default: return "\(error)"
    }
  }

  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
      guard let self else { return }
      if let data, !data.isEmpty { self.consume(data) }
      if let error {
        self.finish(error)
      } else if isComplete {
        self.finish(nil)
      } else if !self.finished {
        self.receive()
      }
    }
  }

  private func consume(_ chunk: Data) {
    buffer.append(chunk)
    while buffer.count >= 4 {
      let start = buffer.startIndex
      let length = buffer[start..<start + 4].reduce(0) { ($0 << 8) | Int($1) }
      if length > Self.maxFrameBytes {
        finish(RemoteError.protocolViolation("frame too large"))
        connection.cancel()
        return
      }
      guard buffer.count >= 4 + length else { return }
      let frame = Data(buffer[start + 4..<start + 4 + length])
      buffer = Data(buffer[(start + 4 + length)...])
      continuation.yield(frame)
    }
  }

  private func finish(_ error: Error?) {
    guard !finished else { return }
    finished = true
    if let error { continuation.finish(throwing: error) } else { continuation.finish() }
  }

  func send(_ frame: Data) {
    var header = UInt32(frame.count).bigEndian
    let packet = Data(bytes: &header, count: 4) + frame
    queue.async { [weak self] in
      guard let self, !self.finished else { return }
      self.connection.send(content: packet, completion: .contentProcessed { [weak self] error in
        if let error { self?.queue.async { self?.finish(error) } }
      })
    }
  }

  func close() {
    queue.async { [weak self] in
      guard let self else { return }
      self.connection.cancel()
      self.finish(nil)
    }
  }
}

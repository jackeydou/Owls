import Foundation
import Observation

/// What the phone pairs with: an address and code on the same network, a scanned invite, or
/// a typed relay code from anywhere.
enum PairTarget: Equatable {
  case address(String, code: String)
  case invite(RemoteInvite)
  case relayCode(RelayCode)
}

/// A pairing that just finished: the Mac, and the six digits both screens show.
struct PairResult: Equatable {
  let host: PairedHost
  let safetyCode: String
}

/// The phone's side of Remote Router, like `HostLinks` in `client.ts`: one connection per
/// paired Mac, opened while the app is in front and reconnected with backoff. A Mac is
/// dialed directly and through the relay at once (direct first, with a head start), and the
/// first handshake to finish wins.
@MainActor
@Observable
final class RemoteHub {
  enum LinkStatus: Equatable {
    case offline
    case connecting
    case online
  }

  private(set) var hosts: [PairedHost]
  private(set) var status: [String: LinkStatus] = [:]
  /// Why the last connection attempt to a Mac failed; cleared once it connects.
  private(set) var lastError: [String: RemoteError] = [:]
  private(set) var stores: [String: HostStore] = [:]
  /// How each connected Mac was reached.
  private(set) var paths: [String: LinkPath] = [:]
  /// A pairing that just finished, until the user compares its safety code with the Mac's.
  var justPaired: PairResult?
  /// The Mac whose threads the app shows.
  var selectedHostId: String?

  private let deviceStore: DeviceStore
  private var links: [String: Link] = [:]
  private var active = false
  /// Threads open on screen, refreshed in full after a reconnect.
  private var openThreads: [String: Set<String>] = [:]

  private final class Link {
    var rpc: RpcConnection?
    var connecting: Task<RpcConnection, Error>?
    var retry: Task<Void, Never>?
    var failures = 0
    /// The relay turned this phone's ticket away; skip it until a direct connection
    /// fetches a fresh one.
    var relayDenied = false
  }

  /// Reconnect delays: quick at first, then once a minute while the Mac stays away.
  private static let backoff: [TimeInterval] = [2, 5, 15, 30, 60]
  /// Over the relay every attempt is a billed request, so a Mac that stays away is tried
  /// every five minutes; coming back to the app or tapping Reconnect tries at once.
  private static let relayBackoff: [TimeInterval] = backoff + [120, 300]
  /// A direct connection gets this head start before the relay is tried too.
  private static let relayHeadStart: TimeInterval = 0.3
  /// The APNs token, hex, once iOS hands it over; sent to each Mac with `registerPush`.
  private var pushToken: String?

  init(deviceStore: DeviceStore = DeviceStore()) {
    self.deviceStore = deviceStore
    hosts = deviceStore.hosts()
    selectedHostId = hosts.first?.deviceId
    for host in hosts { stores[host.deviceId] = HostStore(deviceId: host.deviceId) }
  }

  /// This phone, as paired Macs list it.
  var phoneName: String { deviceStore.phoneName }
  var phoneDeviceId: String { deviceStore.deviceId }

  var selectedHost: PairedHost? { hosts.first { $0.deviceId == selectedHostId } ?? hosts.first }
  var selectedStore: HostStore? { selectedHost.flatMap { stores[$0.deviceId] } }
  func status(of deviceId: String) -> LinkStatus { status[deviceId] ?? .offline }

  /// Everything waiting on the user across every paired Mac.
  var attention: [AttentionItem] { hosts.flatMap { stores[$0.deviceId]?.attention ?? [] } }

  // MARK: Lifecycle

  /// The app came to the front: connect to every paired Mac.
  func activate() {
    active = true
    if !hosts.isEmpty { PushRegistration.request() }
    for host in hosts { connectSoon(host.deviceId) }
  }

  /// The app went to the background, where iOS suspends sockets: close them cleanly.
  func deactivate() {
    active = false
    for (deviceId, link) in links {
      link.retry?.cancel()
      link.retry = nil
      link.connecting?.cancel()
      if let rpc = link.rpc { Task { await rpc.close() } }
      link.rpc = nil
      paths[deviceId] = nil
      status[deviceId] = .offline
    }
  }

  // MARK: Pairing

  /// Pairs with the Mac at `address` using the code it shows, and keeps the connection open.
  func pair(address: String, code: String) async throws -> PairResult {
    try await pair(.address(address, code: code))
  }

  /// Pairs with a Mac and keeps the connection open.
  func pair(_ target: PairTarget) async throws -> PairResult {
    let me = try deviceStore.identity()
    var address: RemoteAddress?
    var route: RelayRoute?
    let opened: OpenedChannel
    do {
      switch target {
      case .address(let text, let code):
        guard let parsed = RemoteAddress(text) else { throw RemoteError.invalidAddress }
        guard PairingCode.isValid(code) else { throw RemoteError.pairingFailed }
        address = parsed
        let socket = try await FrameSocket.connect(host: parsed.host, port: parsed.port)
        opened = try await Handshake.initiate(socket: socket, me: me, mode: .pair(code: PairingCode.normalize(code), key: nil))
      case .invite(let invite):
        let via = RelayRoute(url: invite.relay, mailbox: invite.mailbox, ticket: invite.ticket)
        route = via
        let socket = try await RelaySocket.dial(via)
        opened = try await Handshake.initiate(socket: socket, me: me, mode: .pair(code: invite.code, key: invite.key))
      case .relayCode(let relayCode):
        // An unknown or expired rendezvous code reads as a code that did not work.
        guard let found = try await RelaySocket.lookupRendezvous(relay: defaultRelayURL, code: relayCode.rendezvous) else {
          throw RemoteError.pairingFailed
        }
        let via = RelayRoute(url: defaultRelayURL, mailbox: found.mailbox, ticket: found.ticket)
        route = via
        let socket = try await RelaySocket.dial(via)
        opened = try await Handshake.initiate(socket: socket, me: me, mode: .pair(code: relayCode.code, key: nil))
      }
    } catch {
      throw RemoteError.from(error, pairing: true)
    }
    let peer = opened.peer
    let now = Date()
    // The invite's ticket worked once; the Mac hands out this phone's own ticket next.
    let host = PairedHost(
      deviceId: peer.deviceId, name: peer.name, publicKey: peer.publicKey,
      host: address?.host, port: address?.port, relay: route, queueSeq: 0,
      pairedAt: now, lastSeenAt: now
    )
    drop(host.deviceId)
    hosts.removeAll { $0.deviceId == host.deviceId }
    hosts.append(host)
    deviceStore.save(hosts)
    stores[host.deviceId] = HostStore(deviceId: host.deviceId)
    selectedHostId = host.deviceId
    let link = link(for: host.deviceId)
    let rpc = attach(host.deviceId, link: link, channel: opened.channel, path: route == nil ? .direct : .relay)
    // A Mac paired through the relay has no other way back: wait for this phone's own ticket.
    await refreshRoute(host.deviceId, rpc: rpc)
    await loadSnapshot(host.deviceId, rpc: rpc)
    PushRegistration.request()
    let result = PairResult(host: hosts.first { $0.deviceId == host.deviceId } ?? host, safetyCode: opened.safetyCode)
    justPaired = result
    return result
  }

  /// Forgets a Mac. It keeps this phone in its own list until removed there.
  func remove(_ deviceId: String) {
    drop(deviceId)
    hosts.removeAll { $0.deviceId == deviceId }
    deviceStore.save(hosts)
    stores[deviceId] = nil
    status[deviceId] = nil
    paths[deviceId] = nil
    lastError[deviceId] = nil
    if selectedHostId == deviceId { selectedHostId = hosts.first?.deviceId }
  }

  /// Tries a Mac again now instead of waiting for the next backoff step.
  func reconnect(_ deviceId: String) {
    guard let link = links[deviceId] else { connectSoon(deviceId); return }
    link.retry?.cancel()
    link.retry = nil
    link.failures = 0
    link.relayDenied = false
    connectSoon(deviceId)
  }

  // MARK: Requests

  /// Sends one request to a Mac, connecting first when needed, and decodes its value.
  func request<T: Decodable>(_ deviceId: String, _ method: String, _ params: Any? = nil, as type: T.Type = T.self) async throws -> T {
    let raw = try await send(deviceId, method, params)
    do {
      return try JSONDecoder().decode(RpcValue<T>.self, from: raw).v
    } catch {
      throw RemoteError.protocolViolation("\(method): \(error)")
    }
  }

  /// Sends a request whose reply carries nothing the phone needs.
  func perform(_ deviceId: String, _ method: String, _ params: Any) async throws {
    _ = try await send(deviceId, method, params)
  }

  /// Sends a request and returns its value as plain JSON objects, for replies passed on as is.
  func requestJSON(_ deviceId: String, _ method: String, _ params: Any?) async throws -> Any {
    let raw = try await send(deviceId, method, params)
    guard let object = try JSONSerialization.jsonObject(with: raw) as? [String: Any], let value = object["v"] else {
      throw RemoteError.protocolViolation(method)
    }
    return value
  }

  /// Sends a Router message, or, when the Mac cannot be reached and it uses the relay, seals
  /// it to the Mac's key and leaves it on the relay; the Mac runs it when it comes back.
  /// Only a failure to connect leads to the queue: once a request was sent, it may have run.
  /// Returns true when the message was queued.
  @discardableResult
  func sendRouter(_ deviceId: String, _ params: [String: Any]) async throws -> Bool {
    let rpc: RpcConnection
    do {
      rpc = try await connect(deviceId)
    } catch let error as RemoteError {
      guard error == .offline || error.code == "remote_unreachable",
            let index = hosts.firstIndex(where: { $0.deviceId == deviceId }),
            let route = hosts[index].relay,
            links[deviceId]?.relayDenied != true
      else { throw error }
      try await queue(index: index, route: route, params: params)
      return true
    }
    _ = try await rpc.request(method: "sendRouter", params: params)
    return false
  }

  private func queue(index: Int, route: RelayRoute, params: [String: Any]) async throws {
    let me = try deviceStore.identity()
    let seq = (hosts[index].queueSeq ?? 0) + 1
    let item = try SealedQueue.sealForHost(params: params, seq: seq, at: Date(), me: me, hostKey: hosts[index].publicKey)
    // Saved first: a number spent on a failed drop is harmless, a reused one is not.
    hosts[index].queueSeq = seq
    deviceStore.save(hosts)
    do {
      try await RelaySocket.drop(route, item: item)
    } catch let failure as RelayFailure where failure.reason == "full" {
      throw RemoteError.queueFull
    } catch {
      throw RemoteError.from(error, pairing: false)
    }
  }

  private func send(_ deviceId: String, _ method: String, _ params: Any?) async throws -> Data {
    let rpc = try await connect(deviceId)
    return try await rpc.request(method: method, params: params)
  }

  /// Loads a thread's items in full and keeps them current while it stays open.
  func openThread(_ deviceId: String, _ routerId: String) async throws {
    openThreads[deviceId, default: []].insert(routerId)
    let items: [ThreadItem] = try await request(deviceId, "threadItems", ["routerId": routerId, "after": 0])
    stores[deviceId]?.setItems(routerId, items)
  }

  func closeThread(_ deviceId: String, _ routerId: String) {
    openThreads[deviceId]?.remove(routerId)
  }

  // MARK: Connections

  private func link(for deviceId: String) -> Link {
    if let link = links[deviceId] { return link }
    let link = Link()
    links[deviceId] = link
    return link
  }

  private func drop(_ deviceId: String) {
    guard let link = links.removeValue(forKey: deviceId) else { return }
    link.retry?.cancel()
    link.connecting?.cancel()
    if let rpc = link.rpc { Task { await rpc.close() } }
  }

  private func connectSoon(_ deviceId: String) {
    Task { _ = try? await connect(deviceId) }
  }

  private func connect(_ deviceId: String) async throws -> RpcConnection {
    guard let host = hosts.first(where: { $0.deviceId == deviceId }) else { throw RemoteError.offline }
    let link = link(for: deviceId)
    if let rpc = link.rpc { return rpc }
    if let connecting = link.connecting { return try await connecting.value }
    link.retry?.cancel()
    link.retry = nil
    status[deviceId] = .connecting
    let task = Task { [weak self] () throws -> RpcConnection in
      guard let self else { throw RemoteError.offline }
      return try await self.open(host, link: link)
    }
    link.connecting = task
    defer { if links[deviceId] === link { link.connecting = nil } }
    return try await task.value
  }

  private func open(_ host: PairedHost, link: Link) async throws -> RpcConnection {
    do {
      let me = try deviceStore.identity()
      var attempts: [RaceAttempt] = []
      if let address = host.host, let port = host.port {
        attempts.append(RaceAttempt(path: .direct, delay: 0) { try await FrameSocket.connect(host: address, port: port) })
      }
      if let route = host.relay, !link.relayDenied {
        attempts.append(RaceAttempt(path: .relay, delay: attempts.isEmpty ? 0 : Self.relayHeadStart) { try await RelaySocket.dial(route) })
      }
      guard !attempts.isEmpty else { throw RemoteError.offline }
      let (opened, path) = try await Self.race(attempts, me: me, mode: .auth(deviceId: host.deviceId, publicKey: host.publicKey))
      guard links[host.deviceId] === link else {
        opened.channel.close()
        throw RemoteError.offline
      }
      if path == .direct { link.relayDenied = false }
      if let index = hosts.firstIndex(where: { $0.deviceId == host.deviceId }) {
        hosts[index].name = opened.peer.name
        hosts[index].lastSeenAt = Date()
        deviceStore.save(hosts)
      }
      let rpc = attach(host.deviceId, link: link, channel: opened.channel, path: path)
      Task { await refreshRoute(host.deviceId, rpc: rpc) }
      await loadSnapshot(host.deviceId, rpc: rpc)
      return rpc
    } catch {
      if (error as? RelayFailure)?.reason == "denied" { link.relayDenied = true }
      let failure = RemoteError.from(error, pairing: false)
      if links[host.deviceId] === link {
        status[host.deviceId] = .offline
        lastError[host.deviceId] = failure
        retryLater(host.deviceId, link: link)
      }
      throw failure
    }
  }

  /// One way to reach a Mac, tried in a race with the others.
  struct RaceAttempt: Sendable {
    let path: LinkPath
    let delay: TimeInterval
    let dial: @Sendable () async throws -> FrameTransport
  }

  private final class RaceState: @unchecked Sendable {
    let lock = NSLock()
    var won = false
    var left: Int
    var errors: [Error] = []
    /// Set when any attempt failed: later attempts stop waiting out their head start.
    var anyFailed = false
    var continuation: CheckedContinuation<(OpenedChannel, LinkPath), Error>?
    init(left: Int) { self.left = left }
  }

  /// Dials every route, the later ones after their head start (or at once when an earlier
  /// one fails), and keeps the first that completes the handshake; the others are closed.
  /// Losers finish in the background, so a slow dial never holds up the winner.
  nonisolated static func race(_ attempts: [RaceAttempt], me: LocalIdentity, mode: HandshakeMode) async throws -> (OpenedChannel, LinkPath) {
    let state = RaceState(left: attempts.count)
    return try await withCheckedThrowingContinuation { continuation in
      state.continuation = continuation
      for attempt in attempts {
        Task.detached {
          var waited: TimeInterval = 0
          while waited < attempt.delay {
            if state.lock.withLock({ state.won || state.anyFailed }) { break }
            try? await Task.sleep(nanoseconds: 50_000_000)
            waited += 0.05
          }
          if state.lock.withLock({ state.won }) {
            Self.settle(state, nil)
            return
          }
          do {
            let socket = try await attempt.dial()
            if state.lock.withLock({ state.won }) {
              socket.close()
              Self.settle(state, nil)
              return
            }
            let opened = try await Handshake.initiate(socket: socket, me: me, mode: mode)
            Self.settle(state, .success((opened, attempt.path)))
          } catch {
            Self.settle(state, .failure(error))
          }
        }
      }
    }
  }

  private nonisolated static func settle(_ state: RaceState, _ result: Result<(OpenedChannel, LinkPath), Error>?) {
    state.lock.lock()
    state.left -= 1
    var resume: (CheckedContinuation<(OpenedChannel, LinkPath), Error>, Result<(OpenedChannel, LinkPath), Error>)?
    switch result {
    case .success(let won):
      if state.won {
        won.0.channel.close()
      } else if let continuation = state.continuation {
        state.won = true
        state.continuation = nil
        resume = (continuation, .success(won))
      }
    case .failure(let error):
      state.errors.append(error)
      state.anyFailed = true
    case nil:
      break
    }
    if state.left == 0, !state.won, let continuation = state.continuation {
      state.continuation = nil
      resume = (continuation, .failure(pickError(state.errors)))
    }
    state.lock.unlock()
    if let resume { resume.0.resume(with: resume.1) }
  }

  /// The most telling failure: a handshake's verdict over the relay's over the network's.
  private nonisolated static func pickError(_ errors: [Error]) -> Error {
    errors.first { $0 is HandshakeError }
      ?? errors.first { ($0 as? RelayFailure).map { $0.reason != "unreachable" } ?? false }
      ?? errors.first
      ?? RemoteError.offline
  }

  /// Asks a connected Mac for its relay route and a fresh ticket, so this phone can reach it
  /// from another network later. A Mac that does not use the relay, or predates it, has none.
  private func refreshRoute(_ deviceId: String, rpc: RpcConnection) async {
    guard let raw = try? await rpc.request(method: "relayRoute", params: nil),
          let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
          let index = hosts.firstIndex(where: { $0.deviceId == deviceId })
    else { return }
    hosts[index].relay = RelayRoute(json: object["v"])
    deviceStore.save(hosts)
    await registerPush(rpc)
  }

  /// iOS handed over this phone's APNs token: give it, with the key the notifications are
  /// sealed with, to every connected Mac.
  func setPushToken(_ token: String) {
    guard token != pushToken else { return }
    pushToken = token
    for link in links.values {
      if let rpc = link.rpc { Task { await registerPush(rpc) } }
    }
  }

  private func registerPush(_ rpc: RpcConnection) async {
    guard let token = pushToken else { return }
    #if DEBUG
    let sandbox = true
    #else
    let sandbox = false
    #endif
    _ = try? await rpc.request(method: "registerPush", params: [
      "token": token, "key": Base64URL.encode(PushShared.key()), "sandbox": sandbox
    ])
  }

  private func attach(_ deviceId: String, link: Link, channel: SecureChannel, path: LinkPath) -> RpcConnection {
    let rpc = RpcConnection(
      channel: channel,
      keepalive: path == .relay ? .relay : .direct,
      onEvent: { [weak self] raw in
        let event = HostEvent.decode(raw)
        Task { @MainActor in self?.stores[deviceId]?.apply(event) }
      },
      onClose: { [weak self] in
        Task { @MainActor in self?.closed(deviceId, link: link) }
      }
    )
    link.rpc = rpc
    link.failures = 0
    paths[deviceId] = path
    status[deviceId] = .online
    lastError[deviceId] = nil
    Task { await rpc.start() }
    return rpc
  }

  private func closed(_ deviceId: String, link: Link) {
    guard links[deviceId] === link else { return }
    link.rpc = nil
    paths[deviceId] = nil
    status[deviceId] = .offline
    retryLater(deviceId, link: link)
  }

  private func retryLater(_ deviceId: String, link: Link) {
    guard active, link.retry == nil else { return }
    let usesRelay = hosts.first { $0.deviceId == deviceId }?.relay != nil && !link.relayDenied
    let steps = usesRelay ? Self.relayBackoff : Self.backoff
    let delay = steps[min(link.failures, steps.count - 1)]
    link.failures += 1
    link.retry = Task { [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
      guard !Task.isCancelled else { return }
      link.retry = nil
      self?.connectSoon(deviceId)
    }
  }

  private func loadSnapshot(_ deviceId: String, rpc: RpcConnection) async {
    do {
      let raw = try await rpc.request(method: "snapshot", params: nil)
      let snapshot = try JSONDecoder().decode(RpcValue<HostSnapshot>.self, from: raw).v
      stores[deviceId]?.load(snapshot)
      for routerId in openThreads[deviceId] ?? [] {
        try? await openThread(deviceId, routerId)
      }
    } catch let error as DecodingError {
      lastError[deviceId] = .protocolViolation("snapshot: \(error)")
    } catch {
      lastError[deviceId] = RemoteError.from(error, pairing: false)
    }
  }
}

/// A reply's value as `RpcConnection.request` returns it: `{"v": value}`.
struct RpcValue<T: Decodable>: Decodable {
  let v: T
}

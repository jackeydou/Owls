import Foundation
import Observation

/// The phone's side of Remote Router, like `HostLinks` in `client.ts`: one connection per
/// paired Mac, opened while the app is in front and reconnected with backoff.
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
  }

  /// Reconnect delays: quick at first, then once a minute while the Mac stays away.
  private static let backoff: [TimeInterval] = [2, 5, 15, 30, 60]

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
      status[deviceId] = .offline
    }
  }

  // MARK: Pairing

  /// Pairs with the Mac at `address` using the code it shows, and keeps the connection open.
  func pair(address: String, code: String) async throws -> PairedHost {
    guard let target = RemoteAddress(address) else { throw RemoteError.invalidAddress }
    guard PairingCode.isValid(code) else { throw RemoteError.pairingFailed }
    let me = try deviceStore.identity()
    let socket: FrameSocket
    do {
      socket = try await FrameSocket.connect(host: target.host, port: target.port)
    } catch {
      throw RemoteError.from(error, pairing: true)
    }
    let channel: SecureChannel
    let peer: RemotePeer
    do {
      (channel, peer) = try await Handshake.initiate(socket: socket, me: me, mode: .pair(code: PairingCode.normalize(code)))
    } catch {
      throw RemoteError.from(error, pairing: true)
    }
    let now = Date()
    let host = PairedHost(deviceId: peer.deviceId, name: peer.name, publicKey: peer.publicKey, host: target.host, port: target.port, pairedAt: now, lastSeenAt: now)
    drop(host.deviceId)
    hosts.removeAll { $0.deviceId == host.deviceId }
    hosts.append(host)
    deviceStore.save(hosts)
    stores[host.deviceId] = HostStore(deviceId: host.deviceId)
    selectedHostId = host.deviceId
    let link = link(for: host.deviceId)
    let rpc = attach(host.deviceId, link: link, channel: channel)
    await loadSnapshot(host.deviceId, rpc: rpc)
    return host
  }

  /// Forgets a Mac. It keeps this phone in its own list until removed there.
  func remove(_ deviceId: String) {
    drop(deviceId)
    hosts.removeAll { $0.deviceId == deviceId }
    deviceStore.save(hosts)
    stores[deviceId] = nil
    status[deviceId] = nil
    lastError[deviceId] = nil
    if selectedHostId == deviceId { selectedHostId = hosts.first?.deviceId }
  }

  /// Tries a Mac again now instead of waiting for the next backoff step.
  func reconnect(_ deviceId: String) {
    guard let link = links[deviceId] else { connectSoon(deviceId); return }
    link.retry?.cancel()
    link.retry = nil
    link.failures = 0
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
      let socket = try await FrameSocket.connect(host: host.host, port: host.port)
      let (channel, peer) = try await Handshake.initiate(socket: socket, me: me, mode: .auth(deviceId: host.deviceId, publicKey: host.publicKey))
      guard links[host.deviceId] === link else {
        channel.close()
        throw RemoteError.offline
      }
      if let index = hosts.firstIndex(where: { $0.deviceId == host.deviceId }) {
        hosts[index].name = peer.name
        hosts[index].lastSeenAt = Date()
        deviceStore.save(hosts)
      }
      let rpc = attach(host.deviceId, link: link, channel: channel)
      await loadSnapshot(host.deviceId, rpc: rpc)
      return rpc
    } catch {
      let failure = RemoteError.from(error, pairing: false)
      if links[host.deviceId] === link {
        status[host.deviceId] = .offline
        lastError[host.deviceId] = failure
        retryLater(host.deviceId, link: link)
      }
      throw failure
    }
  }

  private func attach(_ deviceId: String, link: Link, channel: SecureChannel) -> RpcConnection {
    let rpc = RpcConnection(
      channel: channel,
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
    status[deviceId] = .online
    lastError[deviceId] = nil
    Task { await rpc.start() }
    return rpc
  }

  private func closed(_ deviceId: String, link: Link) {
    guard links[deviceId] === link else { return }
    link.rpc = nil
    status[deviceId] = .offline
    retryLater(deviceId, link: link)
  }

  private func retryLater(_ deviceId: String, link: Link) {
    guard active, link.retry == nil else { return }
    let delay = Self.backoff[min(link.failures, Self.backoff.count - 1)]
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

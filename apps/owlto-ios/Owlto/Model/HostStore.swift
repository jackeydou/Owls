import Foundation
import Observation

/// One paired Mac's state as this phone last saw it: the snapshot it sent on connect, kept
/// current by its events. Nothing here is saved; the Mac keeps all data.
@MainActor
@Observable
final class HostStore {
  let deviceId: String
  private(set) var loaded = false
  private(set) var routers: [Router] = []
  private(set) var workers: [Worker] = []
  private(set) var sessions: [String: Session] = [:]
  private(set) var projects: [Project] = []
  /// Items of the threads the user opened, in position order.
  private(set) var threadItems: [String: [ThreadItem]] = [:]

  init(deviceId: String) {
    self.deviceId = deviceId
  }

  func load(_ snapshot: HostSnapshot) {
    routers = snapshot.routers
    workers = snapshot.workers
    sessions = Dictionary(snapshot.sessions.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    projects = snapshot.projects
    loaded = true
  }

  func setItems(_ routerId: String, _ items: [ThreadItem]) {
    threadItems[routerId] = items.sorted { $0.position < $1.position }
  }

  func apply(_ event: HostEvent) {
    switch event {
    case .router(let router):
      if let index = routers.firstIndex(where: { $0.id == router.id }) { routers[index] = router } else { routers.append(router) }
    case .threadRemoved(let routerId, let workerIds):
      routers.removeAll { $0.id == routerId }
      workers.removeAll { workerIds.contains($0.id) }
      threadItems[routerId] = nil
    case .threadItems(let routerId, let changed):
      // Only threads already loaded are kept current; others load in full when opened.
      guard var items = threadItems[routerId] else { return }
      for entry in changed {
        if let index = items.firstIndex(where: { $0.position == entry.position || $0.item.id == entry.item.id }) {
          items[index] = entry
        } else {
          items.append(entry)
        }
      }
      threadItems[routerId] = items.sorted { $0.position < $1.position }
    case .worker(let worker):
      if let index = workers.firstIndex(where: { $0.id == worker.id }) { workers[index] = worker } else { workers.append(worker) }
    case .session(let session):
      sessions[session.id] = session
    case .sessionRemoved(let id):
      sessions[id] = nil
    case .other:
      break
    }
  }

  // MARK: Derived views

  /// Threads on the sidebar: not archived, newest activity first.
  var threads: [Router] {
    routers.filter { $0.archivedAt == nil }.sorted { $0.updatedAt > $1.updatedAt }
  }

  func router(_ id: String) -> Router? { routers.first { $0.id == id } }
  func worker(_ id: String) -> Worker? { workers.first { $0.id == id } }
  func project(_ id: String?) -> Project? { id.flatMap { id in projects.first { $0.id == id } } }

  func workers(in routerId: String) -> [Worker] {
    workers.filter { $0.routerId == routerId && $0.status != .removed }.sorted { $0.createdAt < $1.createdAt }
  }

  func session(for worker: Worker) -> Session? { sessions[worker.sessionId] }

  func pendingRequests(for worker: Worker) -> [AgentRequest] {
    session(for: worker)?.requests.filter(\.isPending) ?? []
  }

  /// Everything waiting on the user, oldest first: requests from workers and batches whose
  /// delivery is unknown.
  var attention: [AttentionItem] {
    var items: [AttentionItem] = []
    for worker in workers where worker.status != .removed {
      guard let session = session(for: worker) else { continue }
      for request in session.requests where request.isPending {
        items.append(.request(hostId: deviceId, worker: worker, sessionId: session.id, request: request, at: session.updatedAt))
      }
    }
    for router in routers where router.archivedAt == nil {
      for batch in router.unknownBatches {
        items.append(.batch(hostId: deviceId, router: router, batch: batch))
      }
    }
    return items.sorted { $0.sortKey < $1.sortKey }
  }

  func needsAttention(_ routerId: String) -> Bool {
    if router(routerId)?.unknownBatches.isEmpty == false { return true }
    return workers(in: routerId).contains { !pendingRequests(for: $0).isEmpty || $0.report?.status == "needs_input" }
  }

  func isWorking(_ routerId: String) -> Bool {
    router(routerId)?.isRunning == true || workers(in: routerId).contains(where: \.isWorking)
  }
}

/// Something waiting on the user, for the inbox.
enum AttentionItem: Identifiable, Hashable {
  case request(hostId: String, worker: Worker, sessionId: String, request: AgentRequest, at: String)
  case batch(hostId: String, router: Router, batch: UnknownBatch)

  var id: String {
    switch self {
    case .request(let hostId, _, _, let request, _): return "\(hostId)/request/\(request.id)"
    case .batch(let hostId, _, let batch): return "\(hostId)/batch/\(batch.id)"
    }
  }

  var hostId: String {
    switch self {
    case .request(let hostId, _, _, _, _), .batch(let hostId, _, _): return hostId
    }
  }

  var sortKey: String {
    switch self {
    case .request(_, _, _, _, let at): return at
    case .batch(_, _, let batch): return batch.createdAt
    }
  }
}

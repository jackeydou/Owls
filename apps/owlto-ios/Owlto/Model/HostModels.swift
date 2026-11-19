import Foundation

/// The Mac's records as `shared/app.ts` and `shared/router.ts` define them, decoded leniently:
/// only the fields the phone shows, so a newer Mac with more fields still decodes.

struct Failure: Decodable, Equatable, Hashable {
  let code: String
  let message: String
}

enum AgentProvider: String, Decodable {
  case codex
  case claudeCode = "claude-code"
  case cursor
  /// A provider a newer Mac added.
  case other

  init(from decoder: Decoder) throws {
    self = AgentProvider(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
  }

  var displayName: String {
    switch self {
    case .codex: return "Codex"
    case .claudeCode: return "Claude Code"
    case .cursor: return "Cursor"
    case .other: return String(localized: "Agent")
    }
  }
}

struct Item: Decodable, Identifiable, Equatable, Hashable {
  enum Kind: String, Decodable {
    case user, assistant, reasoning, command, files, plan, tool, notice, worker, forward, unknown
    init(from decoder: Decoder) throws {
      self = Kind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
  }

  let id: String
  let kind: Kind
  let status: String
  let text: String
  let detail: String
  let turnId: String?
  let workerId: String?
  let author: String?

  var isRunning: Bool { status == "running" }
}

struct ThreadItem: Decodable, Equatable, Hashable {
  let item: Item
  let position: Int
  let rev: Int?
}

struct Question: Decodable, Equatable, Hashable, Identifiable {
  struct Option: Decodable, Equatable, Hashable {
    let label: String
    let description: String
  }

  let id: String
  let header: String
  let question: String
  let isSecret: Bool?
  let options: [Option]?
}

struct AgentRequest: Decodable, Equatable, Hashable, Identifiable {
  enum Kind: String, Decodable {
    case command, files, permissions, question, unknown
    init(from decoder: Decoder) throws {
      self = Kind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
  }

  let id: String
  let kind: Kind
  let title: String
  let detail: String
  let questions: [Question]
  let status: String
  let turnId: String

  var isPending: Bool { status == "pending" }
}

struct Session: Decodable, Equatable, Identifiable {
  let id: String
  let provider: AgentProvider?
  let title: String
  let cwd: String
  let status: String
  let items: [Item]
  let requests: [AgentRequest]
  let diff: String
  let updatedAt: String
}

struct UnknownBatch: Decodable, Equatable, Hashable, Identifiable {
  let id: String
  let events: Int
  let createdAt: String
}

struct Router: Decodable, Equatable, Identifiable, Hashable {
  let id: String
  let deviceId: String?
  let title: String?
  let projectId: String?
  let status: String
  let itemCount: Int
  let preview: String?
  let error: Failure?
  let unknownBatches: [UnknownBatch]
  let archivedAt: String?
  let createdAt: String
  let updatedAt: String

  var isRunning: Bool { status == "running" }
}

struct WorkerReport: Decodable, Equatable, Hashable {
  struct Artifact: Decodable, Equatable, Hashable {
    let kind: String
    let ref: String
  }

  let status: String
  let summary: String
  let artifacts: [Artifact]?
}

struct PendingWorkerMessage: Decodable, Equatable, Hashable, Identifiable {
  let id: String
  let text: String
  let createdAt: String
}

struct PullRequestLink: Decodable, Equatable, Hashable {
  let owner: String
  let name: String
  let branch: String
  let number: Int

  var url: URL? { URL(string: "https://github.com/\(owner)/\(name)/pull/\(number)") }
}

struct WorkerWorkspace: Decodable, Equatable, Hashable {
  let kind: String
  let branch: String?
}

struct Worker: Decodable, Equatable, Identifiable, Hashable {
  enum Status: String, Decodable {
    case queued, starting, running, waiting, reported, idle, stopped, failed, removed, unknown
    init(from decoder: Decoder) throws {
      self = Status(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
  }

  let id: String
  let routerId: String
  let projectId: String?
  let sessionId: String
  let provider: AgentProvider?
  let goal: String
  let title: String?
  let parentId: String?
  let status: Status
  let pending: [PendingWorkerMessage]?
  let report: WorkerReport?
  let pullRequest: PullRequestLink?
  let workspace: WorkerWorkspace?
  let createdAt: String
  let updatedAt: String

  /// Short label: the title, or the goal's first line.
  var label: String {
    if let title, !title.isEmpty { return title }
    return goal.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? goal
  }

  var isWorking: Bool { status == .starting || status == .running }
}

struct Project: Decodable, Equatable, Identifiable, Hashable {
  let id: String
  let name: String
  let path: String
}

/// `RemoteSnapshot`: the Mac's state without its settings or GitHub account.
struct HostSnapshot: Decodable {
  let sessions: [Session]
  let projects: [Project]
  let routers: [Router]
  let workers: [Worker]
}

/// A host event, as `AppEvent` in `shared/app.ts`; the ones the phone does not show are `.other`.
enum HostEvent {
  case router(Router)
  case threadRemoved(routerId: String, workerIds: [String])
  case threadItems(routerId: String, items: [ThreadItem])
  case worker(Worker)
  case session(Session)
  case sessionRemoved(String)
  case other

  static func decode(_ data: Data) -> HostEvent {
    struct Envelope: Decodable { let type: String }
    struct RouterEvent: Decodable { let router: Router }
    struct RemovedThread: Decodable { let routerId: String; let workerIds: [String] }
    struct Items: Decodable { let routerId: String; let items: [ThreadItem] }
    struct WorkerEvent: Decodable { let worker: Worker }
    struct SessionEvent: Decodable { let session: Session }
    struct Removed: Decodable { let sessionId: String }
    let decoder = JSONDecoder()
    guard let type = try? decoder.decode(Envelope.self, from: data).type else { return .other }
    switch type {
    case "router": return (try? decoder.decode(RouterEvent.self, from: data)).map { .router($0.router) } ?? .other
    case "thread-removed": return (try? decoder.decode(RemovedThread.self, from: data)).map { .threadRemoved(routerId: $0.routerId, workerIds: $0.workerIds) } ?? .other
    case "thread-items": return (try? decoder.decode(Items.self, from: data)).map { .threadItems(routerId: $0.routerId, items: $0.items) } ?? .other
    case "worker": return (try? decoder.decode(WorkerEvent.self, from: data)).map { .worker($0.worker) } ?? .other
    case "session": return (try? decoder.decode(SessionEvent.self, from: data)).map { .session($0.session) } ?? .other
    case "removed": return (try? decoder.decode(Removed.self, from: data)).map { .sessionRemoved($0.sessionId) } ?? .other
    default: return .other
    }
  }
}

/// What `previewFile` returns.
enum FilePreviewResult: Decodable {
  case text(name: String, label: String, text: String, truncated: Bool, line: Int?)
  case image(name: String, label: String, dataURL: String)
  case folder(name: String, label: String, entries: [(name: String, folder: Bool)])
  case binary(name: String, label: String)
  case missing(String)
  case outside(String)

  private struct Preview: Decodable {
    struct Body: Decodable {
      struct Entry: Decodable { let name: String; let folder: Bool }
      let kind: String
      let text: String?
      let truncated: Bool?
      let dataUrl: String?
      let entries: [Entry]?
    }
    let name: String
    let label: String
    let line: Int?
    let body: Body
  }

  private enum Keys: String, CodingKey { case status, preview, ref, path }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: Keys.self)
    switch try container.decode(String.self, forKey: .status) {
    case "ok":
      let preview = try container.decode(Preview.self, forKey: .preview)
      switch preview.body.kind {
      case "text":
        self = .text(name: preview.name, label: preview.label, text: preview.body.text ?? "", truncated: preview.body.truncated ?? false, line: preview.line)
      case "image":
        self = .image(name: preview.name, label: preview.label, dataURL: preview.body.dataUrl ?? "")
      case "folder":
        self = .folder(name: preview.name, label: preview.label, entries: (preview.body.entries ?? []).map { ($0.name, $0.folder) })
      default:
        self = .binary(name: preview.name, label: preview.label)
      }
    case "missing":
      self = .missing(try container.decodeIfPresent(String.self, forKey: .ref) ?? "")
    default:
      self = .outside(try container.decodeIfPresent(String.self, forKey: .path) ?? "")
    }
  }
}

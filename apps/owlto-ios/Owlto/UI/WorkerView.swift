import SwiftUI

/// One worker: how it is doing, what it reported and changed, its conversation, and a
/// composer that talks to it directly.
struct WorkerView: View {
  let hostId: String
  let workerId: String
  @Environment(RemoteHub.self) private var hub
  @State private var draft = ""
  @State private var error: String?
  @State private var showEarlier = false
  @State private var confirmStop = false
  @State private var attention: AttentionItem?
  @Environment(\.skin) private var skin

  private var store: HostStore? { hub.stores[hostId] }
  private var worker: Worker? { store?.worker(workerId) }

  var body: some View {
    Group {
      if let worker, let store {
        content(worker, store: store)
      } else {
        EmptyState(speaker: .dreaming, title: "This worker is gone", message: "It was removed on the Mac.")
      }
    }
    .background(Theme.background)
    .navigationTitle(worker?.label ?? "")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if let worker, worker.isWorking || worker.status == .waiting || worker.status == .queued {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            confirmStop = true
          } label: {
            Image(systemName: "stop.circle")
          }
          .accessibilityLabel(Text("Stop worker"))
        }
      }
    }
    .confirmationDialog("Stop this worker?", isPresented: $confirmStop, titleVisibility: .visible) {
      Button("Stop worker", role: .destructive) { stop() }
    } message: {
      Text("It ends its current turn on the Mac. Its worktree and conversation stay.")
    }
    .sheet(item: $attention) { AttentionSheet(item: $0) }
    .errorToast($error)
  }

  @ViewBuilder
  private func content(_ worker: Worker, store: HostStore) -> some View {
    let session = store.session(for: worker)
    let requests = store.pendingRequests(for: worker)
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          header(worker, pending: requests.count)
          ForEach(requests) { request in
            Button {
              if let session { attention = .request(hostId: hostId, worker: worker, sessionId: session.id, request: request, at: session.updatedAt) }
            } label: {
              AttentionRow(item: .request(hostId: hostId, worker: worker, sessionId: session?.id ?? "", request: request, at: session?.updatedAt ?? ""), compact: true)
                .padding(10)
                .owlCard(Theme.warningTint, stroke: Theme.warningBorder)
            }
            .buttonStyle(.plain)
          }
          if let report = worker.report { reportSection(report, worker: worker) }
          links(worker, session: session)
          if let session { conversation(session) }
        }
        .padding(16)
      }
      pendingQueue(worker)
      if worker.status != .removed {
        Composer(
          text: $draft,
          placeholder: worker.isWorking ? "The worker is busy; new messages queue…" : "Message this worker…",
          sendLabel: "Send to this worker",
          send: { try await send(worker) },
          onError: { error = describe($0) }
        )
      }
    }
  }

  /// Doodle sets the header on its own outlined card, as the website does.
  @ViewBuilder
  private func header(_ worker: Worker, pending: Int) -> some View {
    if skin == .doodle {
      headerRow(worker, pending: pending)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .owlCard(Theme.elevated, radius: 14)
    } else {
      headerRow(worker, pending: pending)
    }
  }

  private func headerRow(_ worker: Worker, pending: Int) -> some View {
    let tone = worker.tone(pendingRequests: pending)
    return HStack(alignment: .center, spacing: 14) {
      OwlAvatar(speaker: OwlSpeaker(worker.provider), working: worker.isWorking, size: 64)
        .statusBadge(tone.dot, size: 16)
      VStack(alignment: .leading, spacing: 6) {
        let agent = worker.provider?.displayName ?? String(localized: "Agent")
        Text(worker.isWorking ? String(localized: "\(agent) is working") : agent)
          .displayFont(.headline, size: 19, relativeTo: .headline)
        StatusText(worker.stateLabel(pendingRequests: pending), tone: tone, font: .subheadline.weight(.medium))
        HStack(spacing: 6) {
          if let project = store?.project(worker.projectId) { Chip(text: project.name) }
          if let branch = worker.workspace?.branch { Chip(text: branch, monospaced: true) }
        }
      }
    }
  }

  private func reportSection(_ report: WorkerReport, worker: Worker) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      VStack(alignment: .leading, spacing: 6) {
        SectionLabel(verbatim: reportTitle(report.status), color: Theme.info)
        MarkdownText(text: report.summary).font(.subheadline)
      }
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .owlCard(skin == .doodle ? Theme.elevated : .clear, stroke: Theme.border)
      if let artifacts = report.artifacts, !artifacts.isEmpty {
        SectionLabel("Artifacts")
        ForEach(artifacts, id: \.self) { artifact in
          artifactRow(artifact, worker: worker)
        }
      }
    }
  }

  @ViewBuilder
  private func artifactRow(_ artifact: WorkerReport.Artifact, worker: Worker) -> some View {
    switch artifact.kind {
    case "file":
      NavigationLink(value: FileRoute(hostId: hostId, ref: artifact.ref, routerId: worker.routerId, workerId: worker.id)) {
        artifactLabel(artifact.ref, icon: "doc.text")
      }
    case "url":
      if let url = URL(string: artifact.ref) {
        Link(destination: url) { artifactLabel(artifact.ref, icon: "link") }
      } else {
        artifactLabel(artifact.ref, icon: "link")
      }
    default:
      artifactLabel(artifact.ref, icon: "note.text", monospaced: false)
    }
  }

  private func artifactLabel(_ text: String, icon: String, monospaced: Bool = true) -> some View {
    HStack(spacing: 10) {
      Image(systemName: icon).foregroundStyle(Theme.secondary)
      Text(text).font(monospaced ? .footnote.monospaced() : .footnote).lineLimit(2).foregroundStyle(Theme.foreground)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .frame(minHeight: 46)
    .owlCard(skin == .doodle ? Theme.elevated : Theme.fill, radius: 10, shadow: 2)
  }

  @ViewBuilder
  private func links(_ worker: Worker, session: Session?) -> some View {
    let diff = session?.diff ?? ""
    if worker.pullRequest != nil || !diff.isEmpty {
      VStack(spacing: 8) {
        if let pr = worker.pullRequest, let url = pr.url {
          Link(destination: url) {
            HStack(spacing: 10) {
              Image(systemName: "arrow.triangle.pull").foregroundStyle(Theme.secondary)
              Text("Pull request #\(pr.number)").font(.subheadline.weight(.medium)).foregroundStyle(Theme.foreground)
              Text("\(pr.owner)/\(pr.name)").font(.caption).foregroundStyle(Theme.tertiary)
              Spacer()
              Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(Theme.tertiary)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 46)
            .owlCard(skin == .doodle ? Theme.elevated : .clear, radius: 10, stroke: Theme.border, shadow: 2)
          }
        }
        if !diff.isEmpty {
          let stats = DiffFile.parse(diff).reduce((0, 0)) { ($0.0 + $1.added, $0.1 + $1.removed) }
          NavigationLink(value: DiffRoute(title: worker.label, diff: diff)) {
            HStack(spacing: 10) {
              Image(systemName: "plusminus").foregroundStyle(Theme.secondary)
              Text("Changes").font(.subheadline.weight(.medium)).foregroundStyle(Theme.foreground)
              Spacer()
              Text("+\(stats.0)").font(.caption.monospaced()).foregroundStyle(Theme.success)
              Text("−\(stats.1)").font(.caption.monospaced()).foregroundStyle(Theme.danger)
              Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.tertiary)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 46)
            .owlCard(skin == .doodle ? Theme.elevated : .clear, radius: 10, stroke: Theme.border, shadow: 2)
          }
        }
      }
    }
  }

  @ViewBuilder
  private func conversation(_ session: Session) -> some View {
    let items = session.items.filter { $0.kind != .reasoning }
    let limit = 12
    let hidden = showEarlier ? 0 : max(0, items.count - limit)
    if !items.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        SectionLabel("Conversation")
        if hidden > 0 {
          Button("Show \(hidden) earlier messages") { showEarlier = true }.font(.footnote)
        }
        ForEach(items.suffix(items.count - hidden)) { item in
          sessionItem(item, provider: session.provider)
        }
      }
    }
  }

  @ViewBuilder
  private func sessionItem(_ item: Item, provider: AgentProvider?) -> some View {
    switch item.kind {
    case .user:
      SpeakerRow(speaker: item.author == "user" ? .user : .router, name: item.author == "user" ? String(localized: "You") : "Router") {
        Text(MarkdownText.attributed(item.text))
          .padding(.horizontal, 12)
          .padding(.vertical, 9)
          .owlCard(Theme.userBubble, shadow: 0)
      }
    case .assistant:
      SpeakerRow(speaker: OwlSpeaker(provider), name: provider?.displayName ?? String(localized: "Agent")) {
        MarkdownText(text: item.text)
      }
    case .command, .tool, .files:
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(stepLabel(item)).font(.caption).foregroundStyle(Theme.secondary).frame(width: 52, alignment: .leading)
        Text(item.text.isEmpty ? item.detail : item.text)
          .font(.caption.monospaced())
          .lineLimit(2)
        Spacer(minLength: 0)
        if item.status == "failed" {
          Text("Failed").font(.caption2).foregroundStyle(Theme.danger)
        } else if item.isRunning {
          ProgressView().controlSize(.mini)
        }
      }
      .padding(.leading, 38)
    case .notice:
      Label(item.text, systemImage: "info.circle").font(.footnote).foregroundStyle(Theme.secondary).padding(.leading, 38)
    default:
      EmptyView()
    }
  }

  private func stepLabel(_ item: Item) -> String {
    switch item.kind {
    case .command: return "Shell"
    case .files: return String(localized: "Edited")
    default: return String(localized: "Tool")
    }
  }

  private func reportTitle(_ status: String) -> String {
    switch status {
    case "done": return String(localized: "Report · Done")
    case "blocked": return String(localized: "Report · Blocked")
    case "needs_input": return String(localized: "Report · Needs your decision")
    default: return String(localized: "Report · Making progress")
    }
  }

  @ViewBuilder
  private func pendingQueue(_ worker: Worker) -> some View {
    if let pending = worker.pending, !pending.isEmpty {
      VStack(alignment: .leading, spacing: 8) {
        Text("\(pending.count) queued, sent when this turn ends").font(.caption).foregroundStyle(Theme.tertiary)
        ForEach(pending) { message in
          VStack(alignment: .leading, spacing: 8) {
            Text(message.text).font(.subheadline).lineLimit(3)
            HStack(spacing: 8) {
              Spacer()
              AsyncButton(action: {
                try await hub.perform(hostId, "dropPendingMessage", ["routerId": worker.routerId, "workerId": worker.id, "messageId": message.id])
              }, onError: { error = describe($0) }) {
                Text("Remove from queue").padding(.horizontal, skin == .doodle ? 10 : 4)
              }
              .buttonStyle(OwltoButtonStyle(kind: .secondary, height: 32, font: .footnote.weight(.medium)))
              .fixedSize()
              AsyncButton(action: {
                try await hub.perform(hostId, "steerPendingMessage", ["routerId": worker.routerId, "workerId": worker.id, "messageId": message.id])
              }, onError: { error = describe($0) }) {
                Text("Steer").padding(.horizontal, skin == .doodle ? 12 : 8)
              }
              .buttonStyle(OwltoButtonStyle(height: 32, font: .footnote.weight(.semibold)))
              .fixedSize()
            }
            .font(.footnote)
          }
        }
      }
      .padding(12)
      .owlCard(Theme.fill, shadow: 0, dashed: true)
      .padding(.horizontal, 12)
      .padding(.bottom, 8)
    }
  }

  private func send(_ worker: Worker) async throws {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    try await hub.perform(hostId, "sendRouter", [
      "routerId": worker.routerId, "commandId": UUID().uuidString.lowercased(), "text": text, "workerId": worker.id
    ])
    draft = ""
  }

  private func stop() {
    guard let worker else { return }
    Task {
      do {
        try await hub.perform(hostId, "stopWorker", ["routerId": worker.routerId, "workerId": worker.id])
      } catch {
        self.error = describe(error)
      }
    }
  }
}

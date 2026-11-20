import SwiftUI

/// Everything waiting on the user across every paired Mac. Rows stay short; tapping one opens
/// a sheet with the details and the buttons.
struct InboxView: View {
  @Environment(RemoteHub.self) private var hub
  @State private var selected: AttentionItem?

  var body: some View {
    let items = hub.attention
    List {
      if items.isEmpty {
        EmptyState(speaker: .dreaming, title: "Nothing needs you", message: "When a worker asks for approval or has a question, it shows up here.")
          .listRowSeparator(.hidden)
          .skinnedRow()
      }
      ForEach(items) { item in
        Button {
          selected = item
        } label: {
          AttentionRow(item: item, hostName: hub.hosts.count > 1 ? hub.hosts.first { $0.deviceId == item.hostId }?.name : nil)
        }
        .buttonStyle(.plain)
        .skinnedRow()
      }
    }
    .listStyle(.plain)
    .skinnedList()
    .navigationTitle("Needs You")
    .sheet(item: $selected) { AttentionSheet(item: $0) }
    .owltoDestinations()
    #if DEBUG
    .onChange(of: items.count, initial: true) { _, count in
      guard count > 0, DevLaunch.pendingOpen == "sheet" else { return }
      DevLaunch.pendingOpen = nil
      selected = items.first
    }
    #endif
  }
}

extension AttentionItem {
  var speaker: OwlSpeaker {
    switch self {
    case .request(_, let worker, _, _, _): return OwlSpeaker(worker.provider)
    case .batch: return .router
    }
  }

  var kindLabel: String {
    switch self {
    case .request(_, _, _, let request, _):
      switch request.kind {
      case .command: return String(localized: "Run a command")
      case .files: return String(localized: "Change files")
      case .permissions: return String(localized: "Permissions")
      case .question: return String(localized: "Has a question")
      case .unknown: return String(localized: "Needs you")
      }
    case .batch: return String(localized: "Delivery unknown")
    }
  }

  var summary: String {
    switch self {
    case .request(_, _, _, let request, _):
      if request.kind == .question, let question = request.questions.first { return question.question }
      return request.detail.isEmpty ? request.title : request.detail
    case .batch(_, _, let batch):
      return String(localized: "\(batch.events) events: resend or drop?")
    }
  }

  var threadTitle: String {
    switch self {
    case .request(_, let worker, _, _, _): return worker.label
    case .batch(_, let router, _): return router.title ?? String(localized: "New thread")
    }
  }

  var tint: Color {
    switch self {
    case .request(_, _, _, let request, _): return request.kind == .question ? Theme.info : Theme.warning
    case .batch: return Theme.secondary
    }
  }

  /// The fill behind `kindLabel` in Doodle's outlined pill.
  var tintFill: Color {
    switch self {
    case .request(_, _, _, let request, _): return request.kind == .question ? Theme.infoTint : Theme.warningTint
    case .batch: return Theme.elevated
    }
  }

  var dot: Color {
    switch self {
    case .request(_, _, _, let request, _): return request.kind == .question ? Theme.infoDot : Theme.warningDot
    case .batch: return Theme.connector
    }
  }
}

/// A short row: who, what kind, one line of what.
struct AttentionRow: View {
  let item: AttentionItem
  var compact = false
  var extra = 0
  var hostName: String?
  @Environment(\.skin) private var skin

  var body: some View {
    HStack(spacing: 12) {
      OwlAvatar(speaker: item.speaker, size: compact ? 32 : 40).statusBadge(item.dot, size: compact ? 10 : 12)
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline) {
          Text(item.threadTitle).font((compact ? Font.subheadline : .body).weight(skin == .doodle ? .heavy : .semibold)).lineLimit(1)
          Spacer(minLength: 8)
          if let hostName { Text(hostName).font(.caption).foregroundStyle(Theme.tertiary) }
          if extra > 0 { Text("+\(extra)").font(.caption.weight(.semibold)).foregroundStyle(Theme.secondary) }
        }
        (Text(item.kindLabel).foregroundStyle(item.tint).fontWeight(.semibold) + Text(" · ") + Text(item.summary))
          .font(compact ? .caption : .subheadline)
          .foregroundStyle(Theme.secondary)
          .lineLimit(1)
      }
      Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.tertiary)
    }
    .padding(.vertical, compact ? 0 : 6)
    .contentShape(Rectangle())
  }
}

/// The details of one item and every way to answer it.
struct AttentionSheet: View {
  let item: AttentionItem
  @Environment(RemoteHub.self) private var hub
  @Environment(\.dismiss) private var dismiss
  @State private var error: String?
  @State private var answers: [String: String] = [:]
  @Environment(\.skin) private var skin

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          header
          switch item {
          case .request(let hostId, let worker, let sessionId, let request, _):
            requestBody(hostId: hostId, worker: worker, sessionId: sessionId, request: request)
          case .batch(let hostId, let router, let batch):
            batchBody(hostId: hostId, router: router, batch: batch)
          }
          if let error {
            Label(error, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(Theme.danger)
          }
        }
        .padding(20)
      }
      .background(skin == .doodle ? Theme.background : Theme.elevated)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark")
          }
          .accessibilityLabel(Text("Close"))
        }
      }
      .owltoDestinations()
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var header: some View {
    HStack(spacing: 12) {
      OwlAvatar(speaker: item.speaker, size: 48)
      VStack(alignment: .leading, spacing: 4) {
        StatusText(item.kindLabel, color: item.tint, tint: item.tintFill, font: .caption.weight(.semibold))
        Text(heading).displayFont(.title3.weight(.semibold), size: 22, relativeTo: .title3)
        Text(meta).font(.footnote).foregroundStyle(Theme.secondary).lineLimit(1)
      }
    }
  }

  private var heading: String {
    switch item {
    case .request(_, let worker, _, let request, _):
      let agent = worker.provider?.displayName ?? String(localized: "Agent")
      return request.kind == .question ? String(localized: "\(agent) has a question") : String(localized: "\(agent) needs approval")
    case .batch(_, _, let batch):
      return String(localized: "\(batch.events) events were not confirmed")
    }
  }

  private var meta: String {
    let host = hub.hosts.first { $0.deviceId == item.hostId }?.name ?? ""
    return [item.threadTitle, host].filter { !$0.isEmpty }.joined(separator: " · ")
  }

  @ViewBuilder
  private func requestBody(hostId: String, worker: Worker, sessionId: String, request: AgentRequest) -> some View {
    if request.kind == .question {
      ForEach(request.questions) { question in
        VStack(alignment: .leading, spacing: 10) {
          if !question.header.isEmpty { Text(question.header).font(.caption.weight(.semibold)).foregroundStyle(Theme.tertiary) }
          Text(question.question).font(.body)
          if let options = question.options, !options.isEmpty {
            ForEach(options, id: \.label) { option in
              let chosen = answers[question.id] == option.label
              Button {
                answers[question.id] = option.label
              } label: {
                HStack(alignment: .top, spacing: 10) {
                  Image(systemName: chosen ? "largecircle.fill.circle" : "circle").foregroundStyle(chosen ? Theme.accent : Theme.tertiary)
                  VStack(alignment: .leading, spacing: 2) {
                    Text(option.label).font(.subheadline.weight(.medium))
                    if !option.description.isEmpty { Text(option.description).font(.caption).foregroundStyle(Theme.secondary) }
                  }
                  Spacer(minLength: 0)
                }
                .padding(12)
                .owlCard(chosen && skin == .doodle ? Theme.fill : Theme.elevated, stroke: chosen ? Theme.accent : Theme.border, shadow: chosen ? 3 : 0)
              }
              .buttonStyle(.plain)
            }
          }
          answerField(question)
        }
      }
      HStack(spacing: 10) {
        AsyncButton(action: { try await respond(hostId, sessionId, request, "decline") }, onError: { error = describe($0) }) { Text("Skip") }
          .buttonStyle(OwltoButtonStyle(kind: .secondary))
        AsyncButton(action: { try await respond(hostId, sessionId, request, "accept", answers: request.questions) }, onError: { error = describe($0) }) { Text("Answer") }
          .buttonStyle(OwltoButtonStyle())
          .disabled(request.questions.contains { (answers[$0.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty })
      }
    } else {
      if !request.title.isEmpty && request.title != request.detail {
        Text(request.title).font(.subheadline.weight(.medium))
      }
      if !request.detail.isEmpty {
        Text(request.detail)
          .font(request.kind == .command ? .footnote.monospaced() : .subheadline)
          .textSelection(.enabled)
          .padding(12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .owlCard(Theme.code, radius: 10)
      }
      VStack(spacing: 10) {
        AsyncButton(action: { try await respond(hostId, sessionId, request, "accept") }, onError: { error = describe($0) }) { Text("Allow") }
          .buttonStyle(OwltoButtonStyle())
        HStack(spacing: 10) {
          AsyncButton(action: { try await respond(hostId, sessionId, request, "cancel") }, onError: { error = describe($0) }) { Text("Stop the turn") }
            .buttonStyle(OwltoButtonStyle(kind: .secondary, height: 44))
          AsyncButton(role: .destructive, action: { try await respond(hostId, sessionId, request, "decline") }, onError: { error = describe($0) }) { Text("Decline") }
            .buttonStyle(OwltoButtonStyle(kind: .danger, height: 44))
        }
      }
    }
    NavigationLink(value: WorkerRoute(hostId: hostId, workerId: worker.id)) {
      Text("View context ›").font(.footnote.weight(.semibold))
    }
  }

  @ViewBuilder
  private func answerField(_ question: Question) -> some View {
    let binding = Binding(get: { answers[question.id] ?? "" }, set: { answers[question.id] = $0 })
    let placeholder = question.options?.isEmpty == false ? String(localized: "Or type another answer…") : String(localized: "Your answer")
    Group {
      if question.isSecret == true {
        SecureField(placeholder, text: binding)
      } else {
        TextField(placeholder, text: binding, axis: .vertical)
      }
    }
    .padding(12)
    .owlCard(Theme.elevated, stroke: Theme.border, shadow: 0)
    .tint(skin == .doodle ? Theme.doodleAmber : nil)
  }

  private func respond(_ hostId: String, _ sessionId: String, _ request: AgentRequest, _ decision: String, answers questions: [Question] = []) async throws {
    error = nil
    var params: [String: Any] = ["sessionId": sessionId, "requestId": request.id, "decision": decision]
    if !questions.isEmpty {
      params["answers"] = Dictionary(uniqueKeysWithValues: questions.map { ($0.id, [answers[$0.id] ?? ""]) })
    }
    try await hub.perform(hostId, "respond", params)
    dismiss()
  }

  @ViewBuilder
  private func batchBody(hostId: String, router: Router, batch: UnknownBatch) -> some View {
    Text("Owlto restarted on the Mac before the Router confirmed it got these events. Resending may show the Router a message twice; dropping means it never learns about them.")
      .font(.subheadline)
    HStack(spacing: 10) {
      AsyncButton(action: { try await resolve(hostId, router, batch, "ignore") }, onError: { error = describe($0) }) { Text("Drop") }
        .buttonStyle(OwltoButtonStyle(kind: .secondary))
      AsyncButton(action: { try await resolve(hostId, router, batch, "retry") }, onError: { error = describe($0) }) { Text("Resend") }
        .buttonStyle(OwltoButtonStyle())
    }
    NavigationLink(value: ThreadRoute(hostId: hostId, routerId: router.id)) {
      Text("Open the thread ›").font(.footnote.weight(.semibold))
    }
  }

  private func resolve(_ hostId: String, _ router: Router, _ batch: UnknownBatch, _ decision: String) async throws {
    error = nil
    try await hub.perform(hostId, "resolveBatch", ["routerId": router.id, "batchId": batch.id, "decision": decision])
    dismiss()
  }
}

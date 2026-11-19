import SwiftUI

/// One thread with its Router: the conversation, the workers it sent out, and a composer.
struct ThreadView: View {
  let hostId: String
  let routerId: String
  @Environment(RemoteHub.self) private var hub
  @Environment(\.dismiss) private var dismiss
  @State private var draft = ""
  @State private var error: String?
  @State private var loading = true
  @State private var attention: AttentionItem?

  private var store: HostStore? { hub.stores[hostId] }
  private var router: Router? { store?.router(routerId) }

  var body: some View {
    let entries = TimelineEntry.build(store?.threadItems[routerId] ?? [])
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 18) {
            if loading && entries.isEmpty {
              ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
            } else if entries.isEmpty {
              EmptyState(title: "Say what you need", message: "The Router splits the work and sends workers to your projects. Their results come back here.")
            }
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
              row(entry, follows: index > 0 && entries[index - 1].continuesRouterTurn)
            }
            if router?.isRunning == true {
              workingRow
            }
            Color.clear.frame(height: 1).id("bottom")
          }
          .padding(.horizontal, 16)
          .padding(.vertical, 16)
        }
        .onChange(of: entries.count) { proxy.scrollTo("bottom", anchor: .bottom) }
        .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
      }
      banners
      Composer(text: $draft, placeholder: "Message the Router…", sendLabel: "Send to the Router", send: send, onError: { error = describe($0) })
    }
    .background(Theme.background)
    .navigationTitle(router?.title ?? String(localized: "New thread"))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button {
            archive()
          } label: {
            Label("Archive thread", systemImage: "archivebox")
          }
        } label: {
          Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel(Text("More"))
      }
    }
    .task(id: routerId) {
      do {
        try await hub.openThread(hostId, routerId)
      } catch {
        self.error = describe(error)
      }
      loading = false
    }
    .onDisappear { hub.closeThread(hostId, routerId) }
    .sheet(item: $attention) { item in
      AttentionSheet(item: item)
    }
    .errorToast($error)
  }

  @ViewBuilder
  private func row(_ entry: TimelineEntry, follows: Bool) -> some View {
    switch entry.kind {
    case .user(let item):
      SpeakerRow(speaker: .user, name: String(localized: "You")) {
        Text(MarkdownText.attributed(item.text))
          .textSelection(.enabled)
          .padding(.horizontal, 12)
          .padding(.vertical, 9)
          .background(Theme.userBubble, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
    case .directed(let item):
      let worker = item.workerId.flatMap { store?.worker($0) }
      SpeakerRow(speaker: .user, name: String(localized: "You → \(worker?.label ?? String(localized: "a worker"))")) {
        Text(MarkdownText.attributed(item.text))
          .padding(.horizontal, 12)
          .padding(.vertical, 9)
          .background(Theme.userBubble, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
    case .router(let items):
      SpeakerRow(speaker: .router, name: "Router", follows: follows) {
        VStack(alignment: .leading, spacing: 10) {
          ForEach(items) { item in
            if item.kind == .notice {
              Label(item.text, systemImage: "info.circle").font(.footnote).foregroundStyle(Theme.secondary)
            } else {
              MarkdownText(text: item.text)
            }
          }
        }
      }
    case .dispatch(let workerIds):
      VStack(alignment: .leading, spacing: 2) {
        ForEach(workerIds, id: \.self) { id in
          if let worker = store?.worker(id), worker.status != .removed {
            DispatchRow(hostId: hostId, worker: worker, pending: store?.pendingRequests(for: worker).count ?? 0)
          }
        }
      }
      .padding(.leading, 38)
    case .steps(let count):
      Text("^[\(count) step](inflect: true)")
        .font(.caption)
        .foregroundStyle(Theme.tertiary)
        .padding(.leading, 38)
    }
  }

  private var workingRow: some View {
    HStack(spacing: 10) {
      OwlAvatar(speaker: .router, working: true, size: 28)
      Text("Router is working…").font(.subheadline).foregroundStyle(Theme.secondary)
      Spacer()
      AsyncButton(action: interrupt, onError: { error = describe($0) }) {
        Image(systemName: "stop.fill")
          .font(.system(size: 10))
          .foregroundStyle(Theme.foreground)
          .frame(width: 30, height: 30)
          .overlay(Circle().stroke(Theme.border))
      }
      .accessibilityLabel(Text("Stop the Router"))
    }
  }

  @ViewBuilder
  private var banners: some View {
    let items = (store?.attention ?? []).filter { item in
      switch item {
      case .request(_, let worker, _, _, _): return worker.routerId == routerId
      case .batch(_, let router, _): return router.id == routerId
      }
    }
    if let first = items.first {
      Button {
        attention = first
      } label: {
        AttentionRow(item: first, compact: true, extra: items.count - 1)
          .padding(10)
          .background(Theme.warningTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.warningBorder))
      }
      .buttonStyle(.plain)
      .padding(.horizontal, 12)
      .padding(.bottom, 8)
    }
  }

  private func send() async throws {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    try await hub.perform(hostId, "sendRouter", ["routerId": routerId, "commandId": UUID().uuidString.lowercased(), "text": text])
    draft = ""
  }

  private func interrupt() async throws {
    // `interruptRouter` takes the bare router id, not an object.
    try await hub.perform(hostId, "interruptRouter", routerId)
  }

  private func archive() {
    Task {
      do {
        try await hub.perform(hostId, "archiveThread", ["routerId": routerId, "archived": true])
        dismiss()
      } catch {
        self.error = describe(error)
      }
    }
  }
}

/// An avatar and name leading a message, as the desktop thread lays out turns.
struct SpeakerRow<Content: View>: View {
  let speaker: OwlSpeaker
  let name: String
  var working = false
  /// Continues the same speaker's turn, so the avatar and name are not repeated.
  var follows = false
  @ViewBuilder var content: () -> Content

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      if follows {
        Color.clear.frame(width: 28, height: 1)
      } else {
        OwlAvatar(speaker: speaker, working: working, size: 28)
      }
      VStack(alignment: .leading, spacing: 4) {
        if !follows {
          Text(name).font(.footnote.weight(.semibold)).frame(minHeight: 28, alignment: .leading)
        }
        content()
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/// One worker the Router sent out: its owl, typing while it runs, and how it is doing.
struct DispatchRow: View {
  let hostId: String
  let worker: Worker
  let pending: Int

  var body: some View {
    NavigationLink(value: WorkerRoute(hostId: hostId, workerId: worker.id)) {
      HStack(spacing: 8) {
        Image(systemName: "arrow.turn.down.right").font(.caption).foregroundStyle(Theme.connector)
        OwlAvatar(speaker: OwlSpeaker(worker.provider), working: worker.isWorking, size: 24)
        Text(worker.label).font(.subheadline.weight(.medium)).lineLimit(1).foregroundStyle(Theme.foreground)
        Spacer(minLength: 8)
        let tone = worker.tone(pendingRequests: pending)
        Text(worker.stateLabel(pendingRequests: pending)).font(.caption).foregroundStyle(tone.text)
      }
      .padding(.vertical, 8)
      .padding(.horizontal, 8)
      .background(pending > 0 ? Theme.fill : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
    .accessibilityLabel(Text("\(worker.label), \(worker.stateLabel(pendingRequests: pending))"))
  }
}

/// The thread's items grouped the way the desktop shows them: a user message, a Router turn,
/// one line per batch of dispatched workers, and tool steps folded into a count.
struct TimelineEntry: Identifiable {
  enum Kind {
    case user(Item)
    case directed(Item)
    case router([Item])
    case dispatch([String])
    case steps(Int)
  }

  let id: String
  let kind: Kind

  /// Whether a Router message right after this entry belongs to the same Router turn.
  var continuesRouterTurn: Bool {
    switch kind {
    case .router, .dispatch, .steps: return true
    case .user, .directed: return false
    }
  }

  static func build(_ threadItems: [ThreadItem]) -> [TimelineEntry] {
    var entries: [TimelineEntry] = []
    var routerItems: [Item] = []
    var dispatch: [String] = []
    var steps = 0
    var firstId = ""

    func flush() {
      if steps > 0 {
        entries.append(TimelineEntry(id: "steps-\(firstId)", kind: .steps(steps)))
        steps = 0
      }
      if !routerItems.isEmpty {
        entries.append(TimelineEntry(id: "router-\(routerItems[0].id)", kind: .router(routerItems)))
        routerItems = []
      }
      if !dispatch.isEmpty {
        entries.append(TimelineEntry(id: "dispatch-\(dispatch[0])", kind: .dispatch(dispatch)))
        dispatch = []
      }
    }

    for entry in threadItems {
      let item = entry.item
      switch item.kind {
      case .user, .forward:
        flush()
        if item.workerId != nil {
          entries.append(TimelineEntry(id: item.id, kind: .directed(item)))
        } else {
          entries.append(TimelineEntry(id: item.id, kind: .user(item)))
        }
      case .assistant, .notice:
        if !dispatch.isEmpty || steps > 0 { flush() }
        if !item.text.isEmpty { routerItems.append(item) }
      case .worker:
        if let id = item.workerId {
          if !routerItems.isEmpty || steps > 0 {
            let pendingDispatch = dispatch
            dispatch = []
            flush()
            dispatch = pendingDispatch
          }
          dispatch.append(id)
        }
      case .reasoning, .command, .files, .plan, .tool, .unknown:
        if steps == 0 { firstId = item.id }
        if !routerItems.isEmpty || !dispatch.isEmpty {
          let count = steps
          steps = 0
          flush()
          steps = count
          if steps == 0 { firstId = item.id }
        }
        steps += 1
      }
    }
    flush()
    return entries
  }
}

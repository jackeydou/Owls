import SwiftUI

struct ThreadRoute: Hashable {
  let hostId: String
  let routerId: String
}

struct WorkerRoute: Hashable {
  let hostId: String
  let workerId: String
}

struct DiffRoute: Hashable {
  let title: String
  let diff: String
}

struct FileRoute: Hashable {
  let hostId: String
  let ref: String
  let routerId: String
  let workerId: String?
}

extension View {
  /// Where rows in any tab can lead.
  func owltoDestinations() -> some View {
    navigationDestination(for: ThreadRoute.self) { ThreadView(hostId: $0.hostId, routerId: $0.routerId) }
      .navigationDestination(for: WorkerRoute.self) { WorkerView(hostId: $0.hostId, workerId: $0.workerId) }
      .navigationDestination(for: DiffRoute.self) { DiffView(title: $0.title, diff: $0.diff) }
      .navigationDestination(for: FileRoute.self) { FilePreviewView(route: $0) }
  }
}

/// The selected Mac's threads, newest first, with what is running and what waits on the user.
/// Where there is room (iPad, an open iPhone Duo) the selected thread sits beside the list;
/// on a compact width the split collapses into one stack.
struct ThreadsView: View {
  @Environment(RemoteHub.self) private var hub
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var selection: ThreadRoute?
  @State private var path = NavigationPath()
  @State private var sidebarWidth: CGFloat = 0
  @State private var columns = NavigationSplitViewVisibility.all
  @State private var error: String?
  @Environment(\.skin) private var skin

  var body: some View {
    NavigationSplitView(columnVisibility: $columns) {
      Group {
        if let host = hub.selectedHost, let store = hub.stores[host.deviceId] {
          list(host: host, store: store)
        }
      }
      .navigationTitle("Threads")
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { DevicePicker(iconOnly: isSplit) }
        ToolbarItem(placement: .topBarTrailing) { newThreadMenu }
      }
      // An ideal, not a fixed width: when the detail column's vertical bar leaves too little
      // room, the system narrows the list to keep both columns side by side.
      .navigationSplitViewColumnWidth(min: 300, ideal: min(max(sidebarWidth, 300), 520), max: 520)
    } detail: {
      NavigationStack(path: $path) {
        Group {
          if let selection {
            ThreadView(hostId: selection.hostId, routerId: selection.routerId)
              .id(selection)
          } else {
            EmptyState(title: "Pick a thread", message: "Its conversation and the workers it sent out show up here.")
          }
        }
        .owltoDestinations()
      }
      .environment(\.leaveThread, LeaveThreadAction { selection = nil })
    }
    .navigationSplitViewStyle(.balanced)
    .onGeometryChange(for: CGFloat.self, of: Self.hingeOffset) { sidebarWidth = $0 }
    .onChange(of: selection) { path = NavigationPath() }
    .onChange(of: hub.selectedHostId) { selection = nil }
    .errorToast($error)
    #if DEBUG
    .onChange(of: hub.selectedStore?.threads.count ?? 0) { _, count in
      guard count > 0, let open = DevLaunch.pendingOpen, open == "thread" || open == "worker",
            let host = hub.selectedHost, let store = hub.stores[host.deviceId], let first = store.threads.first else { return }
      DevLaunch.pendingOpen = nil
      selection = ThreadRoute(hostId: host.deviceId, routerId: first.id)
      if open == "worker", let worker = store.workers(in: first.id).last {
        Task { @MainActor in path.append(WorkerRoute(hostId: host.deviceId, workerId: worker.id)) }
      }
    }
    #endif
  }

  /// Both columns show. The list column's bar then puts the title inline, between the device
  /// picker and the new-thread button, so the picker drops its name to leave the title room.
  private var isSplit: Bool { sizeClass == .regular }

  /// Where the list column should end: on an iPhone Duo's hinge when it runs top to bottom
  /// (active or not, so the columns do not jump as the device folds), else halfway across.
  private static func hingeOffset(_ proxy: GeometryProxy) -> CGFloat {
    if #available(iOS 27.1, *),
       let hinge = proxy.reservedRegions(kind: .division, options: .includeInactive)
         .first(where: { $0.frame.height > $0.frame.width }) {
      return hinge.frame.midX
    }
    return proxy.size.width / 2
  }

  @ViewBuilder
  private func list(host: PairedHost, store: HostStore) -> some View {
    let threads = store.threads
    List(selection: $selection) {
      Section {
        VerticalBarReader { vertical in
          // Wherever the device picker shrinks to an icon, its name moves here.
          if vertical || isSplit {
            HStack(spacing: 6) {
              Circle().fill(DevicePicker.color(hub.status(of: host.deviceId))).frame(width: 7, height: 7)
              Text(host.name).lineLimit(1)
            }
            .font(.footnote)
            .foregroundStyle(Theme.secondary)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 4, trailing: 16))
          }
        }
        ConnectionBanner(host: host)
          .listRowSeparator(.hidden)
          .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
          .skinnedRow()
        summary(store)
          .listRowSeparator(.hidden)
          .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 4, trailing: 16))
          .skinnedRow()
      }
      if threads.isEmpty && store.loaded {
        EmptyState(title: "No threads yet", message: "Start one and the Router will send workers to your projects.") {
          newThreadMenu.buttonStyle(OwltoButtonStyle(height: 44)).frame(maxWidth: 220)
        }
        .listRowSeparator(.hidden)
        .skinnedRow()
      }
      ForEach(groups(threads), id: \.title) { group in
        Section {
          ForEach(group.threads) { router in
            NavigationLink(value: ThreadRoute(hostId: host.deviceId, routerId: router.id)) {
              ThreadRow(router: router, store: store)
            }
            .swipeActions {
              AsyncButton(action: {
                try await hub.perform(host.deviceId, "archiveThread", ["routerId": router.id, "archived": true])
                if selection?.routerId == router.id { selection = nil }
              }, onError: { error = describe($0) }) {
                Label("Archive", systemImage: "archivebox")
              }
              .tint(Theme.secondary)
            }
            .listRowSeparator(skin == .doodle ? .hidden : .automatic)
            .skinnedRow()
          }
        } header: {
          if skin == .doodle {
            SectionLabel(verbatim: group.title)
          } else {
            Text(group.title)
          }
        }
      }
    }
    .listStyle(.plain)
    .skinnedList()
    .refreshable { hub.reconnect(host.deviceId) }
  }

  @ViewBuilder
  private func summary(_ store: HostStore) -> some View {
    let working = store.workers.filter(\.isWorking)
    let waiting = hub.attention.filter { $0.hostId == store.deviceId }.count
    if !working.isEmpty || waiting > 0 {
      HStack(spacing: 8) {
        if !working.isEmpty {
          HStack(spacing: 6) {
            HStack(spacing: -6) {
              ForEach(Array(working.prefix(3))) { worker in
                OwlAvatar(speaker: OwlSpeaker(worker.provider), working: true, size: 20).owlRing(1.5)
              }
            }
            Text("\(working.count) working")
          }
          .font(skin == .doodle ? .footnote.weight(.bold) : .footnote)
          .foregroundStyle(Theme.running)
          .padding(.leading, 3)
          .padding(.trailing, 10)
          .frame(height: 28)
          .background(Theme.runningTint, in: Capsule())
          .overlay { if skin == .doodle { Capsule().strokeBorder(Theme.border, lineWidth: 1.5) } }
        }
        if waiting > 0 {
          Label {
            Text("\(waiting) waiting on you")
          } icon: {
            Circle()
              .fill(Theme.warningDot)
              .frame(width: skin == .doodle ? 8 : 6, height: skin == .doodle ? 8 : 6)
              .overlay { if skin == .doodle { Circle().stroke(Theme.border, lineWidth: 1.5) } }
          }
          .font(skin == .doodle ? .footnote.weight(.bold) : .footnote)
          .foregroundStyle(Theme.warning)
          .padding(.horizontal, 10)
          .frame(height: 28)
          .background(Theme.warningTint, in: Capsule())
          .overlay { if skin == .doodle { Capsule().strokeBorder(Theme.border, lineWidth: 1.5) } }
        }
      }
    }
  }

  private var newThreadMenu: some View {
    Menu {
      if let host = hub.selectedHost, let store = hub.stores[host.deviceId] {
        Button("No project") { create(host: host, projectId: nil) }
        if !store.projects.isEmpty {
          Section("In a project") {
            ForEach(store.projects.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }) { project in
              Button(project.name) { create(host: host, projectId: project.id) }
            }
          }
        }
      }
    } label: {
      Label("New thread", systemImage: "square.and.pencil")
    }
  }

  private func create(host: PairedHost, projectId: String?) {
    Task {
      do {
        let router: Router = try await hub.request(host.deviceId, "createThread", ["projectId": projectId.map { $0 as Any } ?? NSNull()])
        selection = ThreadRoute(hostId: host.deviceId, routerId: router.id)
      } catch {
        self.error = describe(error)
      }
    }
  }

  private struct ThreadGroup: Identifiable {
    let title: String
    let threads: [Router]
    var id: String { title }
  }

  private func groups(_ threads: [Router]) -> [ThreadGroup] {
    let calendar = Calendar.current
    var today: [Router] = []
    var yesterday: [Router] = []
    var earlier: [Router] = []
    for router in threads {
      let date = RelativeTime.date(router.updatedAt) ?? .distantPast
      if calendar.isDateInToday(date) { today.append(router) } else if calendar.isDateInYesterday(date) { yesterday.append(router) } else { earlier.append(router) }
    }
    return [
      ThreadGroup(title: String(localized: "Today"), threads: today),
      ThreadGroup(title: String(localized: "Yesterday"), threads: yesterday),
      ThreadGroup(title: String(localized: "Earlier"), threads: earlier)
    ].filter { !$0.threads.isEmpty }
  }
}

struct ThreadRow: View {
  let router: Router
  let store: HostStore
  @Environment(\.skin) private var skin

  var body: some View {
    let workers = store.workers(in: router.id)
    HStack(alignment: .top, spacing: 12) {
      OwlAvatar(speaker: .router, working: store.isWorking(router.id), size: 40)
        .statusBadge(badge, size: 12)
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline) {
          Text(router.title ?? String(localized: "New thread"))
            .font(.body.weight(skin == .doodle ? .heavy : .semibold))
            .lineLimit(1)
          Spacer(minLength: 8)
          Text(RelativeTime.short(router.updatedAt)).font(.caption).foregroundStyle(Theme.tertiary)
        }
        if let preview = router.preview, !preview.isEmpty {
          Text(preview).font(.subheadline).foregroundStyle(Theme.secondary).lineLimit(2)
        }
        HStack(spacing: 4) {
          if let project = store.project(router.projectId) { Text(project.name) }
          if !workers.isEmpty {
            if store.project(router.projectId) != nil { Text("·") }
            Text("^[\(workers.count) worker](inflect: true)")
          }
        }
        .font(.caption)
        .foregroundStyle(Theme.tertiary)
      }
    }
    .padding(.vertical, 4)
  }

  private var badge: Color? {
    if store.needsAttention(router.id) { return Theme.warningDot }
    if router.status == "failed" { return Theme.dangerDot }
    return nil
  }
}

/// Which Mac's threads to show.
struct DevicePicker: View {
  @Environment(RemoteHub.self) private var hub
  @Environment(\.skin) private var skin
  /// Show only the icon and status dot even in a horizontal bar.
  var iconOnly = false

  var body: some View {
    Menu {
      Picker("Show the Router on", selection: Binding(get: { hub.selectedHost?.deviceId ?? "" }, set: { hub.selectedHostId = $0 })) {
        ForEach(hub.hosts) { host in
          Text(host.name).tag(host.deviceId)
        }
      }
    } label: {
      if let host = hub.selectedHost {
        VerticalBarReader { vertical in
          // A vertical bar has a fixed narrow width: keep the icon and status dot, and let the
          // thread list show the name.
          if vertical || iconOnly {
            Image(systemName: "desktopcomputer")
              .overlay(alignment: .topTrailing) {
                statusDot(host).offset(x: 3, y: -2)
              }
          } else {
            HStack(spacing: 6) {
              Image(systemName: "desktopcomputer")
              Text(host.name).lineLimit(1)
              statusDot(host)
              Image(systemName: "chevron.down").font(.caption2.weight(.bold))
            }
            .font(.subheadline.weight(skin == .doodle ? .bold : .semibold))
          }
        }
        .foregroundStyle(Theme.foreground)
      }
    }
    .accessibilityLabel(Text("Device: \(hub.selectedHost?.name ?? "")"))
  }

  private func statusDot(_ host: PairedHost) -> some View {
    Circle()
      .fill(Self.color(hub.status(of: host.deviceId)))
      .frame(width: skin == .doodle ? 9 : 7, height: skin == .doodle ? 9 : 7)
      .overlay { if skin == .doodle { Circle().stroke(Theme.border, lineWidth: 1.5) } }
  }

  static func color(_ status: RemoteHub.LinkStatus) -> Color {
    switch status {
    case .online: return Theme.successDot
    case .connecting: return Theme.warningDot
    case .offline: return Theme.connector
    }
  }
}

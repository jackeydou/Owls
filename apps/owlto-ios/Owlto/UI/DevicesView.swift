import SwiftUI

/// The paired Macs: which one is shown, who is online, and pairing or removing one.
struct DevicesView: View {
  @Environment(RemoteHub.self) private var hub
  @State private var pairing = false
  @State private var removing: PairedHost?
  @AppStorage(Skin.storageKey) private var skin: Skin = .standard
  @AppStorage(ColorMode.storageKey) private var colorMode: ColorMode = .system

  var body: some View {
    List {
      Section {
        ForEach(hub.hosts) { host in
          Button {
            hub.selectedHostId = host.deviceId
          } label: {
            row(host).foregroundStyle(Theme.foreground)
          }
          .swipeActions {
            Button("Remove", systemImage: "trash", role: .destructive) { removing = host }
              .tint(.red)
          }
          .contextMenu {
            Button("Reconnect", systemImage: "arrow.clockwise") { hub.reconnect(host.deviceId) }
            Button("Remove", systemImage: "trash", role: .destructive) { removing = host }
          }
          .skinnedRow(Theme.elevated)
        }
        Button {
          pairing = true
        } label: {
          Label("Add a Mac", systemImage: "plus")
        }
        .skinnedRow(Theme.elevated)
      } header: {
        header("Paired Macs")
      } footer: {
        Text("Pick a Mac to see its threads. Each Mac keeps its own threads, settings, agent accounts, and GitHub connection.")
      }

      Section {
        Picker("Style", selection: $skin) {
          ForEach(Skin.allCases) { option in
            Text(option.label).tag(option)
          }
        }
        .skinnedRow(Theme.elevated)
        Picker("Theme", selection: $colorMode) {
          ForEach(ColorMode.allCases) { option in
            Text(option.label).tag(option)
          }
        }
        .skinnedRow(Theme.elevated)
      } header: {
        header("Appearance")
      } footer: {
        Text("Doodle matches the Owlto website: cream paper, bold outlines, and hard shadows.")
      }

      Section {
        LabeledContent("Name", value: hub.phoneName)
          .skinnedRow(Theme.elevated)
        LabeledContent("Device ID") {
          Text(hub.phoneDeviceId).font(.body.monospaced())
        }
        .skinnedRow(Theme.elevated)
      } header: {
        header("This phone")
      } footer: {
        Text("To cut this phone off, remove it on the Mac in Owlto → Settings → Devices.")
      }
    }
    .skinnedList(grouped: true)
    .navigationTitle("Devices")
    .sheet(isPresented: $pairing) {
      NavigationStack { PairView(cancellable: true) }
    }
    .confirmationDialog(
      Text("Remove \(removing?.name ?? "")?"),
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        if let removing { hub.remove(removing.deviceId) }
        removing = nil
      }
    } message: {
      Text("This phone forgets the Mac and must pair again to use it. Nothing on the Mac is deleted.")
    }
  }

  @ViewBuilder
  private func header(_ title: LocalizedStringKey) -> some View {
    if skin == .doodle {
      SectionLabel(title)
    } else {
      Text(title)
    }
  }

  private func row(_ host: PairedHost) -> some View {
    let status = hub.status(of: host.deviceId)
    return HStack(spacing: 12) {
      OwlAvatar(speaker: status == .offline ? .dreaming : .router, working: status == .online && hub.stores[host.deviceId]?.workers.contains(where: \.isWorking) == true, size: 40)
      VStack(alignment: .leading, spacing: 3) {
        Text(host.name).font(.body.weight(skin == .doodle ? .heavy : .semibold))
        Text(statusLine(host, status)).font(.caption).foregroundStyle(status == .online ? Theme.success : Theme.secondary)
        if status == .offline, let error = hub.lastError[host.deviceId] {
          Text(describe(error)).font(.caption2).foregroundStyle(Theme.tertiary).lineLimit(3)
        }
      }
      Spacer()
      if host.deviceId == hub.selectedHost?.deviceId {
        Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(Theme.accent)
          .accessibilityLabel(Text("Shown"))
      }
    }
    .contentShape(Rectangle())
    .padding(.vertical, 4)
  }

  private func statusLine(_ host: PairedHost, _ status: RemoteHub.LinkStatus) -> String {
    let place = host.address ?? String(localized: "through the relay")
    switch status {
    case .online:
      switch hub.paths[host.deviceId] {
      case .relay: return String(localized: "Online · through the relay")
      default: return String(localized: "Online · direct · \(place)")
      }
    case .connecting: return String(localized: "Connecting · \(place)")
    case .offline:
      if let seen = host.lastSeenAt {
        let formatter = RelativeDateTimeFormatter()
        return String(localized: "Offline · last connected \(formatter.localizedString(for: seen, relativeTo: Date()))")
      }
      return String(localized: "Offline · \(place)")
    }
  }
}

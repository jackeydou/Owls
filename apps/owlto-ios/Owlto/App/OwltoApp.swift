import SwiftUI

@main
struct OwltoApp: App {
  @State private var hub = RemoteHub()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(hub)
        .tint(Theme.accent)
    }
    .onChange(of: scenePhase, initial: true) { _, phase in
      switch phase {
      case .active: hub.activate()
      case .background: hub.deactivate()
      default: break
      }
    }
  }
}

struct RootView: View {
  @Environment(RemoteHub.self) private var hub
  @State private var tab: Tab = .threads
  @AppStorage(Skin.storageKey) private var skin: Skin = .standard

  enum Tab: Hashable {
    case threads, inbox, devices
  }

  var body: some View {
    // Before any child resolves a color: Theme's UIColors read `Skin.current`, and UIKit
    // bars read their appearance when created. The id then rebuilds every view for a new
    // skin; `tab` lives out here, so the selected tab stays.
    let _ = Skin.activate(skin)
    content
      .id(skin)
      .environment(\.skin, skin)
    #if DEBUG
      .task { await DevLaunch.run(hub: hub, tab: $tab) }
    #endif
  }

  @ViewBuilder
  private var content: some View {
    if hub.hosts.isEmpty {
      NavigationStack { PairView(onPaired: { tab = .threads }) }
    } else {
      TabView(selection: $tab) {
        ThreadsView()
          .tabItem { Label("Threads", systemImage: "bubble.left.and.text.bubble.right") }
          .tag(Tab.threads)
        NavigationStack { InboxView() }
          .tabItem { Label("Needs You", systemImage: "tray") }
          .badge(hub.attention.count)
          .tag(Tab.inbox)
        NavigationStack { DevicesView() }
          .tabItem { Label("Devices", systemImage: "desktopcomputer") }
          .tag(Tab.devices)
      }
    }
  }
}

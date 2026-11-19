#if DEBUG
import SwiftUI

/// Debug-only launch arguments for driving the app from the command line against
/// `scripts/dev-host.mjs`, where nothing can tap the screen:
///
///   -OwltoDevPairAddress 127.0.0.1:47330 -OwltoDevPairCode ABCD-EFGH   pair on launch
///   -OwltoDevTab threads|inbox|devices                                  open a tab
///   -OwltoDevOpen thread|worker|sheet                                   open the first thread,
///                                                                       its first worker, or the
///                                                                       first inbox item
///   -skin standard|doodle                                               override the Style setting
enum DevLaunch {
  static var pendingOpen: String? = UserDefaults.standard.string(forKey: "OwltoDevOpen")

  @MainActor
  static func run(hub: RemoteHub, tab: Binding<RootView.Tab>) async {
    let defaults = UserDefaults.standard
    if hub.hosts.isEmpty, let address = defaults.string(forKey: "OwltoDevPairAddress"), let code = defaults.string(forKey: "OwltoDevPairCode") {
      do {
        _ = try await hub.pair(address: address, code: code)
      } catch {
        print("DevLaunch pairing failed: \(describe(error))")
      }
    }
    switch defaults.string(forKey: "OwltoDevTab") {
    case "inbox": tab.wrappedValue = .inbox
    case "devices": tab.wrappedValue = .devices
    default: break
    }
  }
}
#endif

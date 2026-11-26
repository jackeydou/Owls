import SwiftUI
import UIKit

/// Light, dark, or following the system, as the desktop's Theme setting names them. The phone
/// keeps its own choice; it is not synced from the Mac.
enum ColorMode: String, CaseIterable, Identifiable {
  case system, light, dark

  static let storageKey = "colorMode"

  var id: String { rawValue }

  var label: LocalizedStringKey {
    switch self {
    case .system: return "System"
    case .light: return "Light"
    case .dark: return "Dark"
    }
  }

  private var interfaceStyle: UIUserInterfaceStyle {
    switch self {
    case .system: return .unspecified
    case .light: return .light
    case .dark: return .dark
    }
  }

  /// Overrides the style on every window rather than using `preferredColorScheme`, so sheets,
  /// alerts, and UIKit's bars follow too, and `.system` hands control back to the system.
  /// `Theme`'s colors are trait-based, so they resolve again on their own.
  @MainActor
  func apply() {
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      for window in windowScene.windows {
        window.overrideUserInterfaceStyle = interfaceStyle
      }
    }
  }
}

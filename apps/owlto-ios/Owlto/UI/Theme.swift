import SwiftUI
import UIKit

/// Colors from the desktop app's tokens (`assets/main.css`): near-black ink on white in light
/// mode, white on #181818 in dark, with the brighter 300 shades for status in dark mode.
enum Theme {
  static let accent = dynamic(light: 0x1A1C1F, dark: 0xFFFFFF)
  static let background = dynamic(light: 0xFFFFFF, dark: 0x181818)
  static let groupedBackground = dynamic(light: 0xF2F2F2, dark: 0x0D0D0D)
  static let elevated = dynamic(light: 0xFFFFFF, dark: 0x212121)
  static let foreground = dynamic(light: 0x1A1C1F, dark: 0xFFFFFF)
  static let secondary = dynamic(light: 0x5F6062, dark: 0xB4B4B4)
  static let tertiary = dynamic(light: 0x6B6C6E, dark: 0x9C9C9C)
  static let fill = dynamic(light: 0x1A1C1F, dark: 0xFFFFFF, lightAlpha: 0.05, darkAlpha: 0.07)
  static let border = dynamic(light: 0x1A1C1F, dark: 0xFFFFFF, lightAlpha: 0.1, darkAlpha: 0.12)
  static let userBubble = dynamic(light: 0xF1F1F1, dark: 0x2A2A2A)
  static let code = dynamic(light: 0xF5F5F5, dark: 0x242424)
  static let connector = dynamic(light: 0xAFAFAF, dark: 0x5D5D5D)

  static let success = dynamic(light: 0x007A30, dark: 0x5FD68E)
  static let successDot = dynamic(light: 0x00A240, dark: 0x40C977)
  static let warning = dynamic(light: 0x9A3A04, dark: 0xFF9D6B)
  static let warningDot = dynamic(light: 0xE25507, dark: 0xFF8549)
  static let warningTint = dynamic(light: 0xFFFAF6, dark: 0x24170F)
  static let warningBorder = dynamic(light: 0xE25507, dark: 0xFF8549, lightAlpha: 0.22, darkAlpha: 0.32)
  static let danger = dynamic(light: 0xC4261F, dark: 0xFF7A77)
  static let info = dynamic(light: 0x0062C4, dark: 0x5CAFFF)
  static let infoDot = dynamic(light: 0x0285FF, dark: 0x339CFF)
  static let added = dynamic(light: 0xEEFAF2, dark: 0x12301E)
  static let removed = dynamic(light: 0xFDF0EF, dark: 0x3A1513)

  static func dynamic(light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> Color {
    Color(UIColor { traits in
      traits.userInterfaceStyle == .dark ? UIColor(hex: dark, alpha: darkAlpha) : UIColor(hex: light, alpha: lightAlpha)
    })
  }
}

extension UIColor {
  convenience init(hex: UInt32, alpha: CGFloat = 1) {
    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255,
      green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255,
      alpha: alpha
    )
  }
}

/// How a worker or thread is doing, for its dot and label.
enum Tone {
  case working, waiting, done, failed, idle

  var dot: Color? {
    switch self {
    case .waiting: return Theme.warningDot
    case .done: return Theme.successDot
    case .failed: return Theme.danger
    case .working, .idle: return nil
    }
  }

  var text: Color {
    switch self {
    case .waiting: return Theme.warning
    case .done: return Theme.success
    case .failed: return Theme.danger
    case .working, .idle: return Theme.secondary
    }
  }
}

extension Worker {
  /// The worker's state as the desktop's `workerState` words it.
  func tone(pendingRequests: Int) -> Tone {
    if pendingRequests > 0 { return .waiting }
    switch status {
    case .starting, .running: return .working
    case .waiting: return .waiting
    case .failed: return .failed
    case .reported, .idle:
      switch report?.status {
      case "done": return .done
      case "blocked": return .failed
      case "needs_input": return .waiting
      default: return .idle
      }
    default: return .idle
    }
  }

  func stateLabel(pendingRequests: Int) -> String {
    if pendingRequests > 0 { return String(localized: "Waiting for approval") }
    switch status {
    case .queued: return String(localized: "Queued")
    case .starting, .running: return String(localized: "Running")
    case .waiting: return String(localized: "Waiting for approval")
    case .stopped: return String(localized: "Stopped")
    case .failed: return String(localized: "Failed")
    case .reported, .idle:
      switch report?.status {
      case "done": return String(localized: "Done")
      case "blocked": return String(localized: "Blocked")
      case "needs_input": return String(localized: "Needs your decision")
      case "progress": return String(localized: "Making progress")
      default: return String(localized: "Idle")
      }
    case .removed: return String(localized: "Removed")
    case .unknown: return ""
    }
  }
}

/// A small status dot pinned to an avatar's corner, as the desktop's `WorkerAvatar` badges it.
struct StatusBadge: ViewModifier {
  let color: Color?
  let size: CGFloat

  func body(content: Content) -> some View {
    content.overlay(alignment: .bottomTrailing) {
      if let color {
        Circle()
          .fill(color)
          .frame(width: size, height: size)
          .overlay(Circle().stroke(Theme.background, lineWidth: 2))
          .offset(x: 2, y: 2)
      }
    }
  }
}

extension View {
  func statusBadge(_ color: Color?, size: CGFloat = 11) -> some View {
    modifier(StatusBadge(color: color, size: size))
  }
}

enum RelativeTime {
  private static let parser: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
  private static let fallback = ISO8601DateFormatter()

  static func date(_ iso: String) -> Date? { parser.date(from: iso) ?? fallback.date(from: iso) }

  static func short(_ iso: String, now: Date = Date()) -> String {
    guard let date = date(iso) else { return "" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .short
    return formatter.localizedString(for: date, relativeTo: now)
  }
}

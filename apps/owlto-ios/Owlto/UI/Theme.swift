import SwiftUI
import UIKit

/// Colors from the desktop app's tokens. Standard follows `assets/main.css`: near-black ink on
/// white in light mode, white on #181818 in dark, with the brighter 300 shades for status in
/// dark mode. Doodle follows `skin-doodle.css`: cream paper and ink lines in light mode, navy
/// paper in dark, amber for the main action, and the outlined status-pill colors.
enum Theme {
  static let accent = skinned(Swatch(0x1A1C1F, 0xFFFFFF), doodle: Swatch(0x151515, 0xFFF9EC))
  static let background = skinned(Swatch(0xFFFFFF, 0x181818), doodle: Swatch(0xFFFAF0, 0x1B2440))
  static let groupedBackground = skinned(Swatch(0xF2F2F2, 0x0D0D0D), doodle: Swatch(0xFFFAF0, 0x1B2440))
  static let elevated = skinned(Swatch(0xFFFFFF, 0x212121), doodle: Swatch(0xFFFFFF, 0x2A365E))
  static let foreground = skinned(Swatch(0x1A1C1F, 0xFFFFFF), doodle: Swatch(0x151515, 0xFFF9EC))
  static let secondary = skinned(Swatch(0x5F6062, 0xB4B4B4), doodle: Swatch(0x5F5A4E, 0xB3BCD6))
  static let tertiary = skinned(Swatch(0x6B6C6E, 0x9C9C9C), doodle: Swatch(0x6E685B, 0x99A2BF))
  static let fill = skinned(Swatch(0x1A1C1F, 0xFFFFFF, lightAlpha: 0.05, darkAlpha: 0.07), doodle: Swatch(0xFFF3CF, 0x33416F))
  /// Hairlines in Standard; the ink outline every Doodle card, pill, and bar is drawn with.
  static let border = skinned(Swatch(0x1A1C1F, 0xFFFFFF, lightAlpha: 0.1, darkAlpha: 0.12), doodle: Swatch(0x151515, 0x090C18))
  static let userBubble = skinned(Swatch(0xF1F1F1, 0x2A2A2A), doodle: Swatch(0xFFF3CF, 0x33416F))
  static let code = skinned(Swatch(0xF5F5F5, 0x242424), doodle: Swatch(0xFFFFFF, 0x2A365E))
  static let connector = skinned(Swatch(0xAFAFAF, 0x5D5D5D), doodle: Swatch(0x151515, 0x99A2BF))
  /// Doodle's top and bottom bars: a warmer paper than the page.
  static let chrome = skinned(Swatch(0xFFFFFF, 0x181818), doodle: Swatch(0xFFF3D9, 0x161E37))

  /// The main action: ink in Standard, amber with dark text in Doodle (both modes).
  static let primary = skinned(Swatch(0x1A1C1F, 0xFFFFFF), doodle: Swatch(0xFFB000, 0xFFB000))
  static let onPrimary = skinned(Swatch(0xFFFFFF, 0x181818), doodle: Swatch(0x151515, 0x151515))

  static let success = skinned(Swatch(0x007A30, 0x5FD68E), doodle: Swatch(0x17603A, 0xC9F2D6))
  static let successDot = skinned(Swatch(0x00A240, 0x40C977), doodle: Swatch(0x2E9E58, 0x2E9E58))
  static let warning = skinned(Swatch(0x9A3A04, 0xFF9D6B), doodle: Swatch(0x8A4300, 0xFFD2A3))
  static let warningDot = skinned(Swatch(0xE25507, 0xFF8549), doodle: Swatch(0xFFB000, 0xFFB000))
  static let warningTint = skinned(Swatch(0xFFFAF6, 0x24170F), doodle: Swatch(0xFFE0B8, 0x6B3D12))
  static let warningBorder = skinned(Swatch(0xE25507, 0xFF8549, lightAlpha: 0.22, darkAlpha: 0.32), doodle: Swatch(0x151515, 0x090C18))
  static let danger = skinned(Swatch(0xC4261F, 0xFF7A77), doodle: Swatch(0xA3241C, 0xFFC4BD))
  static let dangerDot = skinned(Swatch(0xC4261F, 0xFF7A77), doodle: Swatch(0xE0483E, 0xE0483E))
  static let dangerTint = skinned(Swatch(0xFDF0EF, 0x3A1513), doodle: Swatch(0xFFDCD6, 0x6E2620))
  static let info = skinned(Swatch(0x0062C4, 0x5CAFFF), doodle: Swatch(0x2A37A8, 0xCDD3FF))
  static let infoDot = skinned(Swatch(0x0285FF, 0x339CFF), doodle: Swatch(0x7C8CFF, 0x7C8CFF))
  static let infoTint = skinned(Swatch(0xF0F7FF, 0x0D2236), doodle: Swatch(0xDFE3FF, 0x2B3570))
  /// A worker that is running: plain secondary text in Standard, the amber "running" pill in Doodle.
  static let running = skinned(Swatch(0x5F6062, 0xB4B4B4), doodle: Swatch(0x7A4D00, 0xFFE3A1))
  static let runningTint = skinned(Swatch(0x1A1C1F, 0xFFFFFF, lightAlpha: 0.05, darkAlpha: 0.07), doodle: Swatch(0xFFF0C2, 0x5C4410))
  static let added = skinned(Swatch(0xEEFAF2, 0x12301E), doodle: Swatch(0xDCF2E3, 0x1F5A3A))
  static let removed = skinned(Swatch(0xFDF0EF, 0x3A1513), doodle: Swatch(0xFFDCD6, 0x6E2620))

  /// Doodle's playful accents, used for numbered steps the way the website colors them.
  static let doodleAmber = Color(UIColor(hex: 0xFFB000))
  static let doodleIndigo = Color(UIColor(hex: 0x7C8CFF))
  static let doodleTeal = Color(UIColor(hex: 0x5FB3A1))

  struct Swatch {
    var light: UInt32
    var dark: UInt32
    var lightAlpha: CGFloat = 1
    var darkAlpha: CGFloat = 1

    init(_ light: UInt32, _ dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) {
      self.light = light
      self.dark = dark
      self.lightAlpha = lightAlpha
      self.darkAlpha = darkAlpha
    }
  }

  static func skinned(_ standard: Swatch, doodle: Swatch) -> Color {
    Color(uiSkinned(standard, doodle: doodle))
  }

  /// A color that follows both light/dark mode and `Skin.current`.
  static func uiSkinned(_ standard: Swatch, doodle: Swatch) -> UIColor {
    UIColor { traits in
      let swatch = Skin.current == .doodle ? doodle : standard
      return traits.userInterfaceStyle == .dark
        ? UIColor(hex: swatch.dark, alpha: swatch.darkAlpha)
        : UIColor(hex: swatch.light, alpha: swatch.lightAlpha)
    }
  }

  static func dynamic(light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> Color {
    let swatch = Swatch(light, dark, lightAlpha: lightAlpha, darkAlpha: darkAlpha)
    return skinned(swatch, doodle: swatch)
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
    case .failed: return Theme.dangerDot
    case .working, .idle: return nil
    }
  }

  var text: Color {
    switch self {
    case .waiting: return Theme.warning
    case .done: return Theme.success
    case .failed: return Theme.danger
    case .working: return Theme.running
    case .idle: return Theme.secondary
    }
  }

  /// The fill of Doodle's outlined status pill.
  var tint: Color {
    switch self {
    case .waiting: return Theme.warningTint
    case .done: return Theme.added
    case .failed: return Theme.dangerTint
    case .working: return Theme.runningTint
    case .idle: return Theme.elevated
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
/// Doodle outlines it in ink instead of cutting it out of the page.
struct StatusBadge: ViewModifier {
  let color: Color?
  let size: CGFloat
  @Environment(\.skin) private var skin

  func body(content: Content) -> some View {
    content.overlay(alignment: .bottomTrailing) {
      if let color {
        Circle()
          .fill(color)
          .frame(width: size, height: size)
          .overlay(Circle().stroke(skin == .doodle ? Theme.border : Theme.background, lineWidth: 2))
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

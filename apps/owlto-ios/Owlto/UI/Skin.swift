import SwiftUI
import UIKit

/// The app's look, as the desktop's `settings.skin` names it. Standard follows the desktop's
/// `assets/main.css`; Doodle follows `skin-doodle.css` and the Owlto website: cream paper,
/// 2pt ink outlines, hard offset shadows, an amber main action, condensed titles, and outlined
/// status pills. Like on the desktop, a skin changes colors, outlines, shadows, and title
/// fonts, never the layout. The phone keeps its own choice; it is not synced from the Mac.
enum Skin: String, CaseIterable, Identifiable {
  case standard, doodle

  static let storageKey = "skin"

  var id: String { rawValue }

  var label: LocalizedStringKey {
    switch self {
    case .standard: return "Standard"
    case .doodle: return "Doodle"
    }
  }

  /// The skin `Theme`'s colors resolve with. UIColor providers cannot read the SwiftUI
  /// environment, so `RootView` mirrors the stored setting here (see `activate`) and rebuilds
  /// its views when it changes, which makes every color resolve again.
  nonisolated(unsafe) private(set) static var current: Skin =
    Skin(rawValue: UserDefaults.standard.string(forKey: storageKey) ?? "") ?? .standard

  /// Whether `SkinAppearance` has styled UIKit's bars in this process yet.
  @MainActor private static var appliedToBars = false

  /// Makes `skin` the one colors and bars draw with. Cheap and idempotent, so `RootView` can
  /// call it from `body`, before any child view resolves a color.
  @MainActor
  static func activate(_ skin: Skin) {
    guard skin != current || !appliedToBars else { return }
    let changed = skin != current
    current = skin
    // Standard keeps UIKit's own bars untouched unless Doodle restyled them earlier.
    if skin == .doodle || changed { SkinAppearance.apply(skin) }
    appliedToBars = true
  }
}

extension EnvironmentValues {
  @Entry var skin: Skin = .standard
}

/// Doodle's navigation and tab bars: warm paper with a 2pt ink rule and condensed titles.
/// UIKit bars read their appearance proxies when they are created, so this runs before
/// `RootView` rebuilds its views for a new skin.
@MainActor
enum SkinAppearance {
  static func apply(_ skin: Skin) {
    let navigation = UINavigationBar.appearance()
    let tabs = UITabBar.appearance()
    guard skin == .doodle else {
      navigation.standardAppearance = UINavigationBarAppearance()
      navigation.compactAppearance = nil
      navigation.scrollEdgeAppearance = nil
      tabs.standardAppearance = UITabBarAppearance()
      tabs.scrollEdgeAppearance = nil
      return
    }

    let ink = UIColor(Theme.foreground)
    let rule = ruleImage()

    let bar = UINavigationBarAppearance()
    bar.configureWithOpaqueBackground()
    bar.backgroundColor = UIColor(Theme.chrome)
    bar.shadowColor = UIColor(Theme.border)
    bar.shadowImage = rule
    bar.titleTextAttributes = [.font: scaled("AvenirNext-Bold", 17, .headline), .foregroundColor: ink]
    bar.largeTitleTextAttributes = [.font: scaled("AvenirNextCondensed-Heavy", 34, .largeTitle), .foregroundColor: ink]

    // At the top of a page the large title sits on the page's own paper, with no rule.
    let edge = UINavigationBarAppearance()
    edge.configureWithTransparentBackground()
    edge.titleTextAttributes = bar.titleTextAttributes
    edge.largeTitleTextAttributes = bar.largeTitleTextAttributes

    navigation.standardAppearance = bar
    navigation.compactAppearance = bar
    navigation.scrollEdgeAppearance = edge

    let tab = UITabBarAppearance()
    tab.configureWithOpaqueBackground()
    tab.backgroundColor = UIColor(Theme.chrome)
    tab.shadowColor = UIColor(Theme.border)
    tab.shadowImage = rule
    for item in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
      let font = scaled("AvenirNext-DemiBold", 10, .caption2)
      item.normal.iconColor = UIColor(Theme.secondary)
      item.normal.titleTextAttributes = [.font: font, .foregroundColor: UIColor(Theme.secondary)]
      item.selected.iconColor = ink
      item.selected.titleTextAttributes = [.font: scaled("AvenirNext-Heavy", 10, .caption2), .foregroundColor: ink]
      item.normal.badgeBackgroundColor = UIColor(Theme.primary)
      item.normal.badgeTextAttributes = [.foregroundColor: UIColor(Theme.onPrimary)]
    }
    tabs.standardAppearance = tab
    tabs.scrollEdgeAppearance = tab
  }

  /// A 2pt template line; the bar tints it with `shadowColor`, so it follows dark mode.
  private static func ruleImage() -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: 1, height: 2)).image { context in
      UIColor.black.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 1, height: 2))
    }
    .withRenderingMode(.alwaysTemplate)
  }

  private static func scaled(_ name: String, _ size: CGFloat, _ style: UIFont.TextStyle) -> UIFont {
    let font = UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: .bold)
    return UIFontMetrics(forTextStyle: style).scaledFont(for: font)
  }
}

/// A surface: in Standard a fill with an optional hairline; in Doodle the same fill with a 2pt
/// ink outline and a hard offset shadow. The shadow is drawn behind the view, so nothing grows.
struct OwlCard: ViewModifier {
  var fill: Color
  var radius: CGFloat
  /// Standard's outline; Doodle always outlines in ink.
  var stroke: Color?
  /// How far Doodle's hard shadow falls; 0 for none.
  var shadow: CGFloat
  var dashed: Bool
  @Environment(\.skin) private var skin

  func body(content: Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    if skin == .doodle {
      content
        .background(fill, in: shape)
        .overlay(shape.strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 2, dash: dashed ? [6, 4] : [])))
        .background(shape.fill(Theme.border).offset(x: shadow, y: shadow))
    } else {
      content
        .background(fill, in: shape)
        .overlay {
          if let stroke { shape.stroke(stroke) }
        }
    }
  }
}

extension View {
  func owlCard(_ fill: Color, radius: CGFloat = 12, stroke: Color? = nil, shadow: CGFloat = 3, dashed: Bool = false) -> some View {
    modifier(OwlCard(fill: fill, radius: radius, stroke: stroke, shadow: shadow, dashed: dashed))
  }

  /// A title in Doodle's condensed display face; `standard` otherwise.
  func displayFont(_ standard: Font, size: CGFloat, relativeTo style: Font.TextStyle) -> some View {
    modifier(DisplayFont(standard: standard, size: size, style: style))
  }

  /// Cream paper behind a list in Doodle, without row separators. Standard keeps the system list.
  func skinnedList(grouped: Bool = false) -> some View {
    modifier(SkinnedList(grouped: grouped))
  }

  /// A row's background for `skinnedList`; Standard keeps the system row.
  func skinnedRow(_ fill: Color = Theme.background) -> some View {
    modifier(SkinnedRow(fill: fill))
  }
}

private struct DisplayFont: ViewModifier {
  let standard: Font
  let size: CGFloat
  let style: Font.TextStyle
  @Environment(\.skin) private var skin

  func body(content: Content) -> some View {
    if skin == .doodle {
      content.font(.custom("AvenirNextCondensed-Heavy", size: size, relativeTo: style)).tracking(0.3)
    } else {
      content.font(standard)
    }
  }
}

private struct SkinnedList: ViewModifier {
  let grouped: Bool
  @Environment(\.skin) private var skin

  func body(content: Content) -> some View {
    if skin == .doodle {
      content
        .scrollContentBackground(.hidden)
        .background(grouped ? Theme.groupedBackground : Theme.background)
    } else {
      content
    }
  }
}

private struct SkinnedRow: ViewModifier {
  let fill: Color
  @Environment(\.skin) private var skin

  func body(content: Content) -> some View {
    if skin == .doodle {
      content.listRowBackground(fill).listRowSeparatorTint(Theme.border)
    } else {
      content
    }
  }
}

/// A worker's or Mac's state: colored text in Standard, an outlined pill in Doodle.
struct StatusText: View {
  let text: String
  let color: Color
  var tint: Color = Theme.elevated
  var font: Font = .caption
  @Environment(\.skin) private var skin

  init(_ text: String, tone: Tone, font: Font = .caption) {
    self.text = text
    self.color = tone.text
    self.tint = tone.tint
    self.font = font
  }

  init(_ text: String, color: Color, tint: Color, font: Font = .caption) {
    self.text = text
    self.color = color
    self.tint = tint
    self.font = font
  }

  var body: some View {
    if skin == .doodle {
      Text(text)
        .font(.caption2.weight(.heavy))
        .foregroundStyle(color)
        .lineLimit(1)
        .padding(.horizontal, 8)
        .frame(height: 20)
        .background(tint, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1.5))
        .fixedSize()
    } else {
      Text(text).font(font).foregroundStyle(color)
    }
  }
}

/// A small heading over a group of rows or a section of a page. Doodle sets it heavy and
/// letter-spaced in the muted ink.
struct SectionLabel: View {
  let text: Text
  var font: Font = .caption.weight(.semibold)
  var color: Color = Theme.tertiary
  @Environment(\.skin) private var skin

  init(_ key: LocalizedStringKey, font: Font = .caption.weight(.semibold), color: Color = Theme.tertiary) {
    self.text = Text(key)
    self.font = font
    self.color = color
  }

  init(verbatim string: String, font: Font = .caption.weight(.semibold), color: Color = Theme.tertiary) {
    self.text = Text(string)
    self.font = font
    self.color = color
  }

  var body: some View {
    if skin == .doodle {
      text.font(.footnote.weight(.heavy)).tracking(0.8).foregroundStyle(Theme.secondary).textCase(nil)
    } else {
      text.font(font).foregroundStyle(color)
    }
  }
}

/// A round icon button: a hairline circle in Standard, an outlined card with a hard shadow in Doodle.
struct RoundIcon: View {
  let systemName: String
  var size: CGFloat = 30
  var iconSize: CGFloat = 10
  @Environment(\.skin) private var skin

  var body: some View {
    let icon = Image(systemName: systemName)
      .font(.system(size: iconSize, weight: .bold))
      .foregroundStyle(Theme.foreground)
      .frame(width: size, height: size)
    if skin == .doodle {
      icon
        .background(Theme.elevated, in: Circle())
        .overlay(Circle().strokeBorder(Theme.border, lineWidth: 2))
        .background(Circle().fill(Theme.border).offset(x: 2, y: 2))
    } else {
      icon.overlay(Circle().stroke(Theme.border))
    }
  }
}

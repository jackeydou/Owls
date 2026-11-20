import SwiftUI

/// Hands its content whether the system has moved this view's bars into a vertical column at
/// the side of the screen, as iPhone Duo does in most poses with the iOS 27.1 SDK. Earlier
/// systems never do.
struct VerticalBarReader<Content: View>: View {
  @ViewBuilder var content: (Bool) -> Content

  var body: some View {
    if #available(iOS 27.1, *) {
      VerticalBarProbe(content: content)
    } else {
      content(false)
    }
  }
}

@available(iOS 27.1, *)
private struct VerticalBarProbe<Content: View>: View {
  @Environment(\.toolbarVerticalEdge) private var edge
  var content: (Bool) -> Content

  var body: some View {
    content(edge != nil)
  }
}

/// Leaves the thread a split view's detail column shows, since `dismiss` cannot pop a column's
/// root. Every instance compares equal: the action only clears the split view's selection, so
/// a fresh closure never needs to re-render its readers.
struct LeaveThreadAction: Equatable {
  let action: () -> Void

  func callAsFunction() { action() }

  static func == (lhs: Self, rhs: Self) -> Bool { true }
}

extension EnvironmentValues {
  @Entry var leaveThread: LeaveThreadAction?
}

extension View {
  /// Pins bar content, such as a composer, to the bottom of the safe area. `safeAreaBar` also
  /// gives the scroll view behind it the scroll edge effect; earlier systems get the same
  /// placement from `safeAreaInset`.
  @ViewBuilder
  func bottomBar<Bar: View>(@ViewBuilder _ bar: () -> Bar) -> some View {
    if #available(iOS 26.0, *) {
      safeAreaBar(edge: .bottom) { bar() }
    } else {
      safeAreaInset(edge: .bottom) { bar() }
    }
  }
}

import SwiftUI

/// A button for async work: it shows a spinner and disables itself until the work settles,
/// keeps the spinner up briefly so a fast reply still registers, and reports a failure.
struct AsyncButton<Label: View>: View {
  var role: ButtonRole?
  var action: () async throws -> Void
  var onError: (Error) -> Void
  @ViewBuilder var label: () -> Label
  @State private var pending = false

  init(role: ButtonRole? = nil, action: @escaping () async throws -> Void, onError: @escaping (Error) -> Void, @ViewBuilder label: @escaping () -> Label) {
    self.role = role
    self.action = action
    self.onError = onError
    self.label = label
  }

  var body: some View {
    Button(role: role) {
      guard !pending else { return }
      pending = true
      Task {
        let started = Date()
        do {
          try await action()
        } catch {
          onError(error)
        }
        let elapsed = Date().timeIntervalSince(started)
        if elapsed < 0.35 { try? await Task.sleep(nanoseconds: UInt64((0.35 - elapsed) * 1_000_000_000)) }
        pending = false
      }
    } label: {
      ZStack {
        label().opacity(pending ? 0 : 1)
        if pending { ProgressView().controlSize(.small) }
      }
    }
    .disabled(pending)
  }
}

/// Primary and secondary button looks from the desktop app: ink fill, or a quiet tinted fill.
/// Doodle draws them as outlined cards with a hard shadow that the press pushes into, with
/// amber for the main action.
struct OwltoButtonStyle: ButtonStyle {
  enum Kind { case primary, secondary, danger }
  var kind: Kind = .primary
  var height: CGFloat = 48
  var font: Font = .body.weight(.semibold)
  @Environment(\.skin) private var skin
  @Environment(\.isEnabled) private var isEnabled

  @ViewBuilder
  func makeBody(configuration: Configuration) -> some View {
    if skin == .doodle {
      doodle(configuration)
    } else {
      configuration.label
        .font(font)
        .frame(maxWidth: .infinity, minHeight: height)
        .foregroundStyle(foreground)
        .background(background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
          if kind == .danger {
            RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.danger.opacity(0.35), lineWidth: 1)
          }
        }
        .scaleEffect(configuration.isPressed ? 0.97 : 1)
        .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
  }

  private func doodle(_ configuration: Configuration) -> some View {
    let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
    let pressed = configuration.isPressed
    return configuration.label
      .font(font.weight(kind == .primary ? .heavy : .bold))
      .frame(maxWidth: .infinity, minHeight: height)
      .foregroundStyle(doodleForeground)
      .background(doodleBackground, in: shape)
      .overlay(shape.strokeBorder(Theme.border, lineWidth: 2))
      .offset(x: pressed ? 2 : 0, y: pressed ? 2 : 0)
      .background(shape.fill(Theme.border).offset(x: 3, y: 3))
      .opacity(isEnabled ? 1 : 0.5)
      .animation(.easeOut(duration: 0.08), value: pressed)
  }

  private var foreground: Color {
    switch kind {
    case .primary: return Theme.background
    case .secondary: return Theme.foreground
    case .danger: return Theme.danger
    }
  }

  private var background: Color {
    switch kind {
    case .primary: return Theme.accent
    case .secondary: return Theme.fill
    case .danger: return .clear
    }
  }

  private var doodleForeground: Color {
    switch kind {
    case .primary: return Theme.onPrimary
    case .secondary: return Theme.foreground
    case .danger: return Theme.danger
    }
  }

  private var doodleBackground: Color {
    switch kind {
    case .primary: return Theme.primary
    case .secondary: return Theme.elevated
    case .danger: return Theme.dangerTint
    }
  }
}

/// A one-line message about something that failed (or, as a notice, something that is
/// waiting), shown until dismissed.
struct ErrorToast: ViewModifier {
  @Binding var message: String?
  @Environment(\.skin) private var skin
  var systemImage = "exclamationmark.circle.fill"
  var tint = Theme.danger

  func body(content: Content) -> some View {
    content.overlay(alignment: .top) {
      if let message {
        HStack(alignment: .top, spacing: 10) {
          Image(systemName: systemImage).foregroundStyle(tint)
          Text(message).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
          Button {
            self.message = nil
          } label: {
            Image(systemName: "xmark").font(.footnote.weight(.semibold))
          }
          .accessibilityLabel(Text("Dismiss"))
        }
        .padding(12)
        .owlCard(Theme.elevated, stroke: Theme.border)
        .shadow(color: .black.opacity(skin == .doodle ? 0 : 0.12), radius: 12, y: 4)
        .padding(.horizontal, 12)
        .transition(.move(edge: .top).combined(with: .opacity))
        .task(id: message) {
          try? await Task.sleep(nanoseconds: 6_000_000_000)
          if self.message == message { self.message = nil }
        }
      }
    }
    .animation(.easeOut(duration: 0.2), value: message)
  }
}

extension View {
  func errorToast(_ message: Binding<String?>) -> some View {
    modifier(ErrorToast(message: message))
  }

  /// A message that did not fail but is waiting, such as one left for a Mac that is away.
  func noticeToast(_ message: Binding<String?>) -> some View {
    modifier(ErrorToast(message: message, systemImage: "clock.fill", tint: Theme.secondary))
  }
}

func describe(_ error: Error) -> String {
  (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
}

/// The message box at the bottom of a conversation.
struct Composer: View {
  @Binding var text: String
  var placeholder: LocalizedStringKey
  var sendLabel: LocalizedStringKey
  var send: () async throws -> Void
  var onError: (Error) -> Void
  /// Files to send along; nil where a message cannot carry any (the Router's own thread).
  var attachments: Binding<[PendingAttachment]>?
  @FocusState private var focused: Bool
  @Environment(\.skin) private var skin

  var body: some View {
    VStack(spacing: 0) {
      if let attachments { AttachmentStrip(attachments: attachments) }
      field
    }
  }

  private var field: some View {
    HStack(alignment: .bottom, spacing: 8) {
      if let attachments { AttachmentMenu(attachments: attachments, onError: onError) }
      TextField(placeholder, text: $text, axis: .vertical)
        .lineLimit(1...6)
        .focused($focused)
        .padding(.vertical, 8)
      AsyncButton(action: {
        try await send()
      }, onError: onError) {
        sendIcon
      }
      .disabled(!canSend)
      .accessibilityLabel(Text(sendLabel))
    }
    .padding(.leading, 14)
    .padding(.trailing, 6)
    .padding(.vertical, 4)
    .owlCard(Theme.elevated, radius: 16, stroke: Theme.border)
    .shadow(color: .black.opacity(skin == .doodle ? 0 : 0.04), radius: 6, y: 2)
    .tint(skin == .doodle ? Theme.doodleAmber : nil)
    .padding(.horizontal, 12)
    .padding(.bottom, 8)
  }

  @ViewBuilder
  private var sendIcon: some View {
    let icon = Image(systemName: "arrow.up")
      .font(.system(size: 15, weight: .bold))
      .frame(width: 34, height: 34)
    if skin == .doodle {
      icon
        .foregroundStyle(canSend ? Theme.onPrimary : Theme.secondary)
        .background(canSend ? Theme.primary : Theme.elevated, in: Circle())
        .overlay(Circle().strokeBorder(Theme.border, lineWidth: 2))
        .background(Circle().fill(Theme.border).offset(x: 2, y: 2))
    } else {
      icon
        .foregroundStyle(canSend ? Theme.background : Theme.secondary)
        .background(canSend ? Theme.accent : Theme.fill, in: Circle())
    }
  }


  private var canSend: Bool {
    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !(attachments?.wrappedValue.isEmpty ?? true)
  }
}

/// A centered owl with a line of explanation, for lists with nothing in them.
struct EmptyState<Actions: View>: View {
  var speaker: OwlSpeaker = .router
  var title: LocalizedStringKey
  var message: LocalizedStringKey?
  @ViewBuilder var actions: () -> Actions

  var body: some View {
    VStack(spacing: 14) {
      OwlAvatar(speaker: speaker, size: 72)
      Text(title).font(.headline)
      if let message {
        Text(message).font(.subheadline).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
      }
      actions()
    }
    .padding(32)
    .frame(maxWidth: .infinity)
  }
}

extension EmptyState where Actions == EmptyView {
  init(speaker: OwlSpeaker = .router, title: LocalizedStringKey, message: LocalizedStringKey? = nil) {
    self.init(speaker: speaker, title: title, message: message, actions: { EmptyView() })
  }
}

/// A Mac that is not connected: why, and a way to try again now.
struct ConnectionBanner: View {
  @Environment(RemoteHub.self) private var hub
  let host: PairedHost

  var body: some View {
    let status = hub.status(of: host.deviceId)
    if status != .online {
      HStack(alignment: .top, spacing: 12) {
        if status == .connecting {
          ProgressView().controlSize(.small).padding(.top, 2)
        } else {
          OwlAvatar(speaker: .dreaming, size: 30)
        }
        VStack(alignment: .leading, spacing: 3) {
          Text(status == .connecting ? "Connecting to \(host.name)…" : "\(host.name) is not connected")
            .font(.subheadline.weight(.semibold))
          if status == .offline, let error = hub.lastError[host.deviceId] {
            Text(describe(error)).font(.footnote).foregroundStyle(Theme.secondary)
          }
        }
        Spacer(minLength: 0)
        if status == .offline {
          Button("Retry") { hub.reconnect(host.deviceId) }
            .font(.subheadline.weight(.semibold))
        }
      }
      .padding(12)
      .owlCard(Theme.fill)
    }
  }
}

/// A small rounded label.
struct Chip: View {
  let text: String
  var color: Color = Theme.secondary
  var monospaced = false
  @Environment(\.skin) private var skin

  var body: some View {
    let doodle = skin == .doodle
    Text(text)
      .font((monospaced ? Font.caption.monospaced() : .caption).weight(doodle ? .bold : .regular))
      .foregroundStyle(color)
      .lineLimit(1)
      .padding(.horizontal, 8)
      .frame(height: 22)
      .background(doodle ? Theme.elevated : Theme.fill, in: Capsule())
      .overlay {
        if doodle { Capsule().strokeBorder(Theme.border, lineWidth: 1.5) }
      }
  }
}

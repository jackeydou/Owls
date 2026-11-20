import SwiftUI

/// Pairs with a Mac: its address and the one-time code it shows in Settings → Devices.
struct PairView: View {
  @Environment(RemoteHub.self) private var hub
  @Environment(\.dismiss) private var dismiss
  var onPaired: () -> Void = {}
  /// Shown as a sheet from Devices, with a Cancel button.
  var cancellable = false

  @State private var address = ""
  @State private var code = ""
  @State private var error: String?
  @FocusState private var field: Field?
  @Environment(\.skin) private var skin

  enum Field { case address, code }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        HStack(spacing: -8) {
          OwlAvatar(speaker: .router, size: 44).owlRing()
          OwlAvatar(speaker: .claudeCode, working: true, size: 44).owlRing()
          OwlAvatar(speaker: .codex, working: true, size: 44).owlRing()
          OwlAvatar(speaker: .cursor, working: true, size: 44).owlRing()
        }
        VStack(alignment: .leading, spacing: 10) {
          Text("Connect your Mac").displayFont(.title.bold(), size: 32, relativeTo: .title)
          Text("Messages go to the Router on your Mac; workers run there with its agents, and the results show up here. This phone keeps no threads of its own.")
            .font(.subheadline)
            .foregroundStyle(Theme.secondary)
        }
        VStack(alignment: .leading, spacing: 12) {
          step(1, "On the Mac, open Owlto → Settings → Devices and turn on “Let paired devices use this Mac”.")
          step(2, "Click Show code. The code works for 5 minutes.")
          step(3, "Enter one of the Mac's addresses and the code below.")
        }
        .padding(16)
        .owlCard(skin == .doodle ? Theme.elevated : Theme.fill)

        VStack(alignment: .leading, spacing: 14) {
          labeled("Address of the Mac", focused: field == .address) {
            TextField("192.168.1.20 or mac-mini.tail1234.ts.net", text: $address)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .keyboardType(.URL)
              .focused($field, equals: .address)
              .submitLabel(.next)
              .onSubmit { field = .code }
          }
          labeled("Pairing code", focused: field == .code) {
            TextField("ABCD-EFGH", text: $code)
              .font(.title3.monospaced())
              .textInputAutocapitalization(.characters)
              .autocorrectionDisabled()
              .focused($field, equals: .code)
              .submitLabel(.go)
          }
          AsyncButton(action: pair, onError: { error = describe($0) }) {
            Text("Pair")
          }
          .buttonStyle(OwltoButtonStyle())
          .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || !PairingCode.isValid(code))
          if let error {
            Label(error, systemImage: "exclamationmark.circle")
              .font(.footnote)
              .foregroundStyle(Theme.danger)
          }
        }

        Label("On the same Wi-Fi the Mac's local address works as is; away from home, use its Tailscale address. The connection is encrypted end to end and goes through no server.", systemImage: "lock")
          .font(.footnote)
          .foregroundStyle(Theme.tertiary)
      }
      .padding(24)
    }
    .background(Theme.background)
    .scrollDismissesKeyboard(.interactively)
    .toolbar {
      if cancellable {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
    }
  }

  private func pair() async throws {
    error = nil
    field = nil
    _ = try await hub.pair(address: address, code: code)
    onPaired()
    if cancellable { dismiss() }
  }

  @ViewBuilder
  private func step(_ number: Int, _ text: LocalizedStringKey) -> some View {
    HStack(alignment: .top, spacing: 12) {
      if skin == .doodle {
        // The website numbers its steps in amber, indigo, and teal.
        let colors = [Theme.doodleAmber, Theme.doodleIndigo, Theme.doodleTeal]
        Text("\(number)")
          .font(.caption.weight(.heavy))
          .foregroundStyle(Theme.onPrimary)
          .frame(width: 22, height: 22)
          .background(colors[(number - 1) % colors.count], in: Circle())
          .overlay(Circle().strokeBorder(Theme.border, lineWidth: 2))
      } else {
        Text("\(number)")
          .font(.caption.weight(.bold))
          .foregroundStyle(Theme.background)
          .frame(width: 22, height: 22)
          .background(Theme.accent, in: Circle())
      }
      Text(text).font(.subheadline)
    }
  }

  private func labeled<Content: View>(_ title: LocalizedStringKey, focused: Bool, @ViewBuilder content: () -> Content) -> some View {
    let doodle = skin == .doodle
    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
    return VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.footnote.weight(doodle ? .heavy : .medium)).foregroundStyle(Theme.secondary)
      content()
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .owlCard(Theme.elevated, radius: 10, stroke: Theme.border, shadow: 0)
        .overlay {
          // Doodle shows focus on the field's border in amber, never a black ring.
          if doodle && focused {
            shape.strokeBorder(Theme.doodleAmber, lineWidth: 2)
              .background(shape.stroke(Theme.doodleAmber.opacity(0.3), lineWidth: 6))
          }
        }
        .tint(doodle ? Theme.doodleAmber : nil)
    }
  }
}

extension View {
  /// A ring in the background color, so overlapping avatars stay apart.
  func owlRing(_ width: CGFloat = 3) -> some View {
    padding(width).background(Theme.background, in: Circle())
  }
}

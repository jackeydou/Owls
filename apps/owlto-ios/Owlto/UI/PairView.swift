import SwiftUI

/// Pairs with a Mac: by scanning the QR code it shows in Settings → Devices, by its long code
/// from anywhere, or by its address and short code on the same network.
struct PairView: View {
  @Environment(RemoteHub.self) private var hub
  @Environment(\.dismiss) private var dismiss
  var onPaired: () -> Void = {}
  /// Shown as a sheet from Devices, with a Cancel button.
  var cancellable = false

  @State private var address = ""
  @State private var code = ""
  @State private var error: String?
  @State private var scanning = false
  /// In the sheet from Devices, the safety code shows here instead of over the whole app.
  @State private var paired: PairResult?
  @FocusState private var field: Field?
  @Environment(\.skin) private var skin

  enum Field { case address, code }

  /// What the first field holds: a relay code or an invite pairs on its own, an address
  /// needs the short code too.
  private var target: PairTarget? {
    let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
    if let invite = RemoteInvite(text) { return .invite(invite) }
    if let relayCode = RelayCode(text) { return .relayCode(relayCode) }
    guard RemoteAddress(text) != nil, PairingCode.isValid(code) else { return nil }
    return .address(text, code: code)
  }

  private var needsCode: Bool {
    let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
    return RemoteInvite(text) == nil && RelayCode(text) == nil
  }

  var body: some View {
    if let paired {
      SafetyCodeView(result: paired)
    } else {
      form
    }
  }

  private var form: some View {
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
          step(3, "Scan the QR code, or type the long code. On the same network, the address and short code work too.")
        }
        .padding(16)
        .owlCard(skin == .doodle ? Theme.elevated : Theme.fill)

        Button {
          scanning = true
        } label: {
          Label("Scan QR code", systemImage: "qrcode.viewfinder")
        }
        .buttonStyle(OwltoButtonStyle())

        VStack(alignment: .leading, spacing: 14) {
          labeled("Code or address of the Mac", focused: field == .address) {
            TextField("K7Q2-ABCD-EFGH or 192.168.1.20", text: $address)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .keyboardType(.asciiCapable)
              .focused($field, equals: .address)
              .submitLabel(needsCode ? .next : .go)
              .onSubmit { if needsCode { field = .code } }
          }
          if needsCode {
            labeled("Pairing code", focused: field == .code) {
              TextField("ABCD-EFGH", text: $code)
                .font(.title3.monospaced())
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .focused($field, equals: .code)
                .submitLabel(.go)
            }
          }
          AsyncButton(action: pair, onError: { error = describe($0) }) {
            Text("Pair")
          }
          .buttonStyle(OwltoButtonStyle())
          .disabled(target == nil)
          if let error {
            Label(error, systemImage: "exclamationmark.circle")
              .font(.footnote)
              .foregroundStyle(Theme.danger)
          }
        }

        Label("The connection is encrypted end to end. On the same network it goes straight to the Mac; from elsewhere it passes through the Owlto relay, which only sees ciphertext.", systemImage: "lock")
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
    .fullScreenCover(isPresented: $scanning) {
      NavigationStack {
        QRScannerView { scanned in
          address = scanned
          error = RemoteInvite(scanned) == nil ? String(localized: "That QR code is not an Owlto pairing code.") : nil
          if let invite = RemoteInvite(scanned) {
            Task { await pairScanned(invite) }
          }
        }
      }
    }
  }

  private func pairScanned(_ invite: RemoteInvite) async {
    do {
      finish(try await hub.pair(.invite(invite)))
    } catch {
      self.error = describe(error)
    }
  }

  private func pair() async throws {
    error = nil
    field = nil
    guard let target else { throw RemoteError.invalidAddress }
    finish(try await hub.pair(target))
  }

  private func finish(_ result: PairResult) {
    onPaired()
    if cancellable {
      hub.justPaired = nil
      paired = result
    }
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

/// Shown right after pairing: the six digits both screens show. Matching digits mean nobody
/// sat between the phone and the Mac; different ones mean the pairing should be undone.
struct SafetyCodeView: View {
  @Environment(RemoteHub.self) private var hub
  @Environment(\.dismiss) private var dismiss
  let result: PairResult

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Image(systemName: "checkmark.shield").font(.largeTitle).foregroundStyle(Theme.success)
      Text("Paired with \(result.host.name)").font(.title2.bold())
      Text("Check that the Mac shows the same safety code:").font(.subheadline).foregroundStyle(Theme.secondary)
      Text(formatted)
        .font(.system(size: 40, weight: .semibold, design: .monospaced))
        .accessibilityLabel(Text(result.safetyCode.map(String.init).joined(separator: " ")))
      Text("If the numbers differ, someone may be in the middle. Remove the Mac and pair again.")
        .font(.footnote)
        .foregroundStyle(Theme.tertiary)
      Spacer()
      Button {
        hub.justPaired = nil
        dismiss()
      } label: {
        Text("They match")
      }
      .buttonStyle(OwltoButtonStyle())
      Button(role: .destructive) {
        hub.remove(result.host.deviceId)
        hub.justPaired = nil
        dismiss()
      } label: {
        Text("Remove it").frame(maxWidth: .infinity)
      }
      .frame(minHeight: 44)
    }
    .padding(24)
    .background(Theme.background)
    .interactiveDismissDisabled()
  }

  private var formatted: String {
    "\(result.safetyCode.prefix(3)) \(result.safetyCode.suffix(3))"
  }
}

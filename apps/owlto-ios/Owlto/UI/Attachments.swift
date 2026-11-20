import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A photo or file picked on the phone, waiting to go out with a worker message. It is copied
/// to the Mac with `stageAttachment` just before the message is sent.
struct PendingAttachment: Identifiable, Equatable {
  /// How many files one message can carry, and the largest one; `ATTACHMENT_LIMIT` and
  /// `ATTACHMENT_MAX_BYTES` in the desktop's `shared/attachments.ts`.
  static let limit = 8
  static let maxBytes = 20 * 1024 * 1024

  let id = UUID()
  let name: String
  let mimeType: String
  let data: Data

  var stageParams: [String: Any] {
    ["name": name, "mimeType": mimeType, "data": data.base64EncodedString()]
  }
}

enum AttachmentError: LocalizedError {
  case tooLarge(String)
  case unreadable

  var errorDescription: String? {
    switch self {
    case .tooLarge(let name): return String(localized: "\(name) is larger than 20 MB.")
    case .unreadable: return String(localized: "That file could not be read.")
    }
  }
}

/// The paperclip menu in a worker's composer: a photo from the library, or any file.
struct AttachmentMenu: View {
  @Binding var attachments: [PendingAttachment]
  var onError: (Error) -> Void
  @State private var photos: [PhotosPickerItem] = []
  @State private var pickingPhotos = false
  @State private var pickingFiles = false

  var body: some View {
    Menu {
      Button("Photo library", systemImage: "photo") { pickingPhotos = true }
      Button("Files", systemImage: "folder") { pickingFiles = true }
    } label: {
      Image(systemName: "paperclip")
        .font(.system(size: 17, weight: .medium))
        .frame(width: 34, height: 34)
        .foregroundStyle(Theme.secondary)
    }
    .accessibilityLabel(Text("Attach files"))
    .disabled(attachments.count >= PendingAttachment.limit)
    .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: PendingAttachment.limit - attachments.count, matching: .images)
    .fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
      do {
        for url in try result.get() { try add(file: url) }
      } catch {
        onError(error)
      }
    }
    .onChange(of: photos) { _, items in
      guard !items.isEmpty else { return }
      photos = []
      Task { await add(photos: items) }
    }
  }

  private func add(file url: URL) throws {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let data: Data
    do { data = try Data(contentsOf: url) } catch { throw AttachmentError.unreadable }
    let type = UTType(filenameExtension: url.pathExtension)
    try append(PendingAttachment(name: url.lastPathComponent, mimeType: type?.preferredMIMEType ?? "application/octet-stream", data: data))
  }

  @MainActor
  private func add(photos items: [PhotosPickerItem]) async {
    for (index, item) in items.enumerated() {
      do {
        guard let data = try await item.loadTransferable(type: Data.self) else { throw AttachmentError.unreadable }
        let type = item.supportedContentTypes.first { $0.conforms(to: .image) } ?? .jpeg
        let name = "Photo \(attachments.count + index + 1).\(type.preferredFilenameExtension ?? "jpg")"
        try append(PendingAttachment(name: name, mimeType: type.preferredMIMEType ?? "image/jpeg", data: data))
      } catch {
        onError(error)
      }
    }
  }

  private func append(_ attachment: PendingAttachment) throws {
    guard attachment.data.count <= PendingAttachment.maxBytes else { throw AttachmentError.tooLarge(attachment.name) }
    guard attachments.count < PendingAttachment.limit else { return }
    attachments.append(attachment)
  }
}

/// The picked files above the composer, each with a button to take it off.
struct AttachmentStrip: View {
  @Binding var attachments: [PendingAttachment]

  var body: some View {
    if !attachments.isEmpty {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(attachments) { attachment in
            HStack(spacing: 6) {
              Image(systemName: attachment.mimeType.hasPrefix("image/") ? "photo" : "doc")
                .foregroundStyle(Theme.secondary)
              Text(attachment.name).font(.footnote).lineLimit(1)
              Button {
                attachments.removeAll { $0.id == attachment.id }
              } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.tertiary)
              }
              .accessibilityLabel(Text("Remove \(attachment.name)"))
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(Theme.fill, in: Capsule())
          }
        }
        .padding(.horizontal, 12)
      }
      .padding(.bottom, 6)
    }
  }
}

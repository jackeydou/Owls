import SwiftUI
import UIKit

/// One file's part of a unified diff.
struct DiffFile: Identifiable {
  enum LineKind { case context, added, removed, hunk }
  struct Line: Identifiable {
    let id: Int
    let kind: LineKind
    let text: String
  }

  let id: Int
  let path: String
  let lines: [Line]
  var added: Int { lines.filter { $0.kind == .added }.count }
  var removed: Int { lines.filter { $0.kind == .removed }.count }

  static func parse(_ diff: String) -> [DiffFile] {
    var files: [DiffFile] = []
    var path: String?
    var lines: [Line] = []
    var counter = 0
    func flush() {
      if let path { files.append(DiffFile(id: files.count, path: path, lines: lines)) }
      lines = []
    }
    for raw in diff.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = String(raw)
      if line.hasPrefix("diff --git ") {
        flush()
        path = line.components(separatedBy: " b/").last ?? line
        continue
      }
      if line.hasPrefix("+++ ") {
        let target = String(line.dropFirst(4))
        if target != "/dev/null" { path = target.hasPrefix("b/") ? String(target.dropFirst(2)) : target }
        continue
      }
      if line.hasPrefix("--- ") || line.hasPrefix("index ") || line.hasPrefix("new file") || line.hasPrefix("deleted file") || line.hasPrefix("similarity") || line.hasPrefix("rename ") {
        continue
      }
      guard path != nil else { continue }
      counter += 1
      if line.hasPrefix("@@") {
        lines.append(Line(id: counter, kind: .hunk, text: line))
      } else if line.hasPrefix("+") {
        lines.append(Line(id: counter, kind: .added, text: String(line.dropFirst())))
      } else if line.hasPrefix("-") {
        lines.append(Line(id: counter, kind: .removed, text: String(line.dropFirst())))
      } else {
        lines.append(Line(id: counter, kind: .context, text: line.hasPrefix(" ") ? String(line.dropFirst()) : line))
      }
    }
    flush()
    return files
  }
}

/// A worker's uncommitted changes, file by file.
struct DiffView: View {
  let title: String
  let diff: String
  @State private var collapsed: Set<Int> = []
  @Environment(\.skin) private var skin

  var body: some View {
    let files = DiffFile.parse(diff)
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12, pinnedViews: [.sectionHeaders]) {
        if files.isEmpty {
          EmptyState(title: "No changes")
        }
        ForEach(files) { file in
          Section {
            if !collapsed.contains(file.id) {
              ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                  ForEach(file.lines) { line in
                    HStack(spacing: 6) {
                      Text(sign(line.kind)).foregroundStyle(signColor(line.kind)).frame(width: 12)
                      Text(line.text.isEmpty ? " " : line.text)
                    }
                    .font(.caption.monospaced())
                    .padding(.horizontal, 10)
                    .padding(.vertical, 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(background(line.kind))
                  }
                }
              }
              .background(skin == .doodle ? Theme.elevated : Theme.background)
              .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
              .owlCard(.clear, radius: 10, stroke: Theme.border)
            }
          } header: {
            Button {
              if collapsed.contains(file.id) { collapsed.remove(file.id) } else { collapsed.insert(file.id) }
            } label: {
              HStack(spacing: 8) {
                Image(systemName: collapsed.contains(file.id) ? "chevron.right" : "chevron.down").font(.caption2.weight(.bold))
                Text(file.path).font(.footnote.monospaced().weight(skin == .doodle ? .bold : .medium)).lineLimit(1).truncationMode(.head)
                Spacer()
                Text("+\(file.added)").foregroundStyle(Theme.success)
                Text("−\(file.removed)").foregroundStyle(Theme.danger)
              }
              .font(.caption.monospaced())
              .foregroundStyle(Theme.foreground)
              .padding(.vertical, 8)
              .background(Theme.background)
            }
          }
        }
      }
      .padding(16)
    }
    .background(Theme.background)
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
  }

  private func sign(_ kind: DiffFile.LineKind) -> String {
    switch kind {
    case .added: return "+"
    case .removed: return "−"
    default: return ""
    }
  }

  private func signColor(_ kind: DiffFile.LineKind) -> Color {
    kind == .added ? Theme.success : (kind == .removed ? Theme.danger : Theme.tertiary)
  }

  private func background(_ kind: DiffFile.LineKind) -> Color {
    switch kind {
    case .added: return Theme.added
    case .removed: return Theme.removed
    case .hunk: return Theme.fill
    case .context: return .clear
    }
  }
}

/// A file a worker pointed at, read on the Mac and shown read-only.
struct FilePreviewView: View {
  let route: FileRoute
  @Environment(RemoteHub.self) private var hub
  @State private var result: FilePreviewResult?
  @State private var error: String?

  var body: some View {
    Group {
      if let result {
        content(result)
      } else if let error {
        EmptyState(speaker: .dreaming, title: "Could not open the file", message: LocalizedStringKey(error))
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(Theme.background)
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
    .task {
      do {
        var base: [String: Any] = ["kind": "thread", "routerId": route.routerId]
        if let workerId = route.workerId { base = ["kind": "worker", "routerId": route.routerId, "workerId": workerId] }
        result = try await hub.request(route.hostId, "previewFile", ["ref": route.ref, "base": base])
      } catch {
        self.error = describe(error)
      }
    }
  }

  private var title: String {
    switch result {
    case .text(let name, _, _, _, _), .image(let name, _, _), .folder(let name, _, _), .binary(let name, _): return name
    default: return (route.ref as NSString).lastPathComponent
    }
  }

  @ViewBuilder
  private func content(_ result: FilePreviewResult) -> some View {
    switch result {
    case .text(_, let label, let text, let truncated, _):
      ScrollView([.vertical, .horizontal]) {
        VStack(alignment: .leading, spacing: 8) {
          Text(label).font(.caption).foregroundStyle(Theme.tertiary)
          let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
              HStack(alignment: .top, spacing: 10) {
                Text("\(index + 1)").foregroundStyle(Theme.tertiary).frame(minWidth: 28, alignment: .trailing)
                Text(line.isEmpty ? " " : String(line))
              }
              .font(.caption.monospaced())
            }
          }
          .textSelection(.enabled)
          if truncated { Text("Only the start of this file is shown.").font(.caption).foregroundStyle(Theme.tertiary) }
        }
        .padding(16)
      }
    case .image(_, _, let dataURL):
      if let comma = dataURL.firstIndex(of: ","), let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])), let image = UIImage(data: data) {
        ScrollView { Image(uiImage: image).resizable().scaledToFit().padding(16) }
      } else {
        EmptyState(speaker: .dreaming, title: "This image cannot be shown")
      }
    case .folder(_, _, let entries):
      List(entries, id: \.name) { entry in
        Label(entry.name, systemImage: entry.folder ? "folder" : "doc")
      }
      .listStyle(.plain)
    case .binary:
      EmptyState(speaker: .dreaming, title: "This file cannot be previewed", message: "Open it on the Mac.")
    case .missing(let ref):
      EmptyState(speaker: .dreaming, title: "File not found", message: LocalizedStringKey(ref))
    case .outside:
      EmptyState(speaker: .dreaming, title: "Outside your projects", message: "Owlto only reads files in your projects, workspace, and worker folders.")
    }
  }
}

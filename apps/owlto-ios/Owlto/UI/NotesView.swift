import SwiftUI

struct NoteRoute: Hashable {
  let url: URL
}

/// The notes in Owlto's iCloud folder, the same files the Mac shows once iCloud sync is on
/// there (Settings → Experiments). Newest first, with search and a button for a new note.
struct NotesView: View {
  @Environment(NotesStore.self) private var store
  @State private var search = ""
  @State private var composing = false
  @State private var path = NavigationPath()

  var body: some View {
    NavigationStack(path: $path) {
      content
        .navigationTitle("Notes")
        .navigationDestination(for: NoteRoute.self) { NoteDetailView(url: $0.url) }
        .toolbar {
          if store.state == .ready {
            ToolbarItem(placement: .primaryAction) {
              Button {
                composing = true
              } label: {
                Image(systemName: "square.and.pencil")
              }
              .accessibilityLabel(Text("New note"))
            }
          }
        }
        .sheet(isPresented: $composing) {
          NoteEditorView(mode: .new) { path.append(NoteRoute(url: $0)) }
        }
    }
    .task { await store.start() }
  }

  @ViewBuilder
  private var content: some View {
    switch store.state {
    case .loading:
      ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
    case .unavailable:
      ScrollView {
        EmptyState(speaker: .dreaming, title: "iCloud is off", message: "Sign in to iCloud and turn on iCloud Drive for Owlto in Settings to see your notes.") {
          AsyncButton(action: { await store.start() }, onError: { _ in }) { Text("Try again") }
            .buttonStyle(OwltoButtonStyle(kind: .secondary, height: 44))
            .frame(maxWidth: 200)
        }
      }
    case .ready:
      list
    }
  }

  private var list: some View {
    let notes = filtered
    return List {
      if store.notes.isEmpty {
        EmptyState(speaker: .dreaming, title: "No notes yet", message: "Turn on iCloud sync in Owlto for Mac (Settings → Experiments), and your notes show up here.")
          .listRowSeparator(.hidden)
          .skinnedRow()
      } else if notes.isEmpty {
        Text("No matching notes").font(.subheadline).foregroundStyle(Theme.secondary)
          .frame(maxWidth: .infinity).padding(.vertical, 24)
          .listRowSeparator(.hidden)
          .skinnedRow()
      }
      ForEach(notes) { note in
        NavigationLink(value: NoteRoute(url: note.url)) { NoteRow(note: note) }
          .disabled(!note.isDownloaded)
          .skinnedRow()
      }
    }
    .listStyle(.plain)
    .skinnedList()
    .searchable(text: $search, prompt: Text("Search notes"))
  }

  private var filtered: [NoteItem] {
    let query = search.trimmingCharacters(in: .whitespaces)
    guard !query.isEmpty else { return store.notes }
    return store.notes.filter { note in
      note.title.localizedCaseInsensitiveContains(query)
        || (note.file?.body.localizedCaseInsensitiveContains(query) ?? false)
        || (note.file?.tags.contains { $0.localizedCaseInsensitiveContains(query) } ?? false)
    }
  }
}

private struct NoteRow: View {
  let note: NoteItem
  @Environment(\.skin) private var skin

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .firstTextBaseline) {
        Text(note.title).font(.body.weight(skin == .doodle ? .heavy : .semibold)).lineLimit(1)
        Spacer(minLength: 8)
        if let updated = note.updated {
          Text(updated, format: .relative(presentation: .numeric)).font(.caption).foregroundStyle(Theme.tertiary)
        }
      }
      if note.isDownloaded {
        let preview = note.preview
        if !preview.isEmpty {
          Text(preview).font(.subheadline).foregroundStyle(Theme.secondary).lineLimit(1)
        }
      } else {
        HStack(spacing: 6) {
          ProgressView().controlSize(.mini)
          Text("Downloading from iCloud…").font(.subheadline).foregroundStyle(Theme.secondary)
        }
      }
    }
    .padding(.vertical, 4)
  }
}

/// One note, rendered as Markdown, with an Edit button.
struct NoteDetailView: View {
  let url: URL
  @Environment(NotesStore.self) private var store
  @State private var editing = false

  var body: some View {
    Group {
      if let note = store.note(url), let file = note.file {
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            Text(note.title)
              .displayFont(.title2.weight(.semibold), size: 26, relativeTo: .title2)
              .textSelection(.enabled)
            if !file.tags.isEmpty || note.updated != nil {
              HStack(spacing: 6) {
                ForEach(file.tags, id: \.self) { Chip(text: "#\($0)") }
                if let updated = note.updated {
                  Text(updated, format: .dateTime.month().day().hour().minute()).font(.caption).foregroundStyle(Theme.tertiary)
                }
              }
            }
            MarkdownText(text: file.body).textSelection(.enabled)
          }
          .padding(20)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.background)
      } else {
        EmptyState(speaker: .dreaming, title: "This note is no longer in iCloud")
      }
    }
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if store.note(url)?.file != nil {
        ToolbarItem(placement: .primaryAction) {
          Button("Edit") { editing = true }
        }
      }
    }
    .sheet(isPresented: $editing) { NoteEditorView(mode: .edit(url)) }
  }
}

/// A title and a Markdown body. Saving an existing note changes only its title, body, and
/// `updated`; a note that changed elsewhere meanwhile is not overwritten.
struct NoteEditorView: View {
  enum Mode: Equatable {
    case new
    case edit(URL)
  }

  let mode: Mode
  var onCreated: (URL) -> Void = { _ in }
  @Environment(NotesStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.skin) private var skin
  @State private var title = ""
  @State private var text = ""
  @State private var original: String?
  @State private var loaded = false
  @State private var error: String?
  @FocusState private var focus: Field?

  private enum Field { case title, body }

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 0) {
        TextField("Title", text: $title, axis: .vertical)
          .displayFont(.title3.weight(.semibold), size: 22, relativeTo: .title3)
          .focused($focus, equals: .title)
          .submitLabel(.next)
          .onSubmit { focus = .body }
          .padding(.horizontal, 20)
          .padding(.vertical, 12)
        Divider().overlay(Theme.border)
        TextEditor(text: $text)
          .font(.body)
          .focused($focus, equals: .body)
          .scrollContentBackground(.hidden)
          .padding(.horizontal, 15)
          .padding(.top, 8)
      }
      .background(Theme.background)
      .tint(skin == .doodle ? Theme.doodleAmber : nil)
      .navigationTitle(mode == .new ? Text("New note") : Text("Edit note"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          AsyncButton(action: save, onError: { error = describe($0) }) { Text("Save").fontWeight(.semibold) }
            .disabled(!loaded || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
      .errorToast($error)
    }
    .interactiveDismissDisabled(isDirty)
    .task { await load() }
  }

  private var isDirty: Bool {
    guard loaded else { return false }
    if case .edit(let url) = mode, let note = store.note(url) {
      return title != note.title || text != (note.file?.body ?? "")
    }
    return !title.isEmpty || !text.isEmpty
  }

  private func load() async {
    guard !loaded else { return }
    switch mode {
    case .new:
      focus = .title
    case .edit(let url):
      do {
        let content = try await store.content(of: url)
        let file = NoteFile(parsing: content)
        original = content
        title = NoteFile.displayTitle(file, fileName: url.lastPathComponent)
        text = file.body
      } catch {
        self.error = describe(error)
        return
      }
    }
    loaded = true
  }

  private func save() async throws {
    let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    switch mode {
    case .new:
      let url = try await store.create(title: title, body: text)
      dismiss()
      onCreated(url)
    case .edit(let url):
      try await store.save(url, original: original, title: title, body: text)
      dismiss()
    }
  }
}

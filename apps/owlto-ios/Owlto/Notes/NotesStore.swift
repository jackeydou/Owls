import Foundation
import Observation

/// Owlto's iCloud container, shared with the Mac app (`NOTES_ICLOUD_CONTAINER` in
/// `apps/owlto-client/src/main/cards/icloud.ts`). iCloud Drive shows its Documents folder
/// as "Owlto"; notes are the Markdown files directly in `Documents/Notes`.
enum NotesICloud {
  static let container = "iCloud.dev.owlto.app"

  static func notesFolder(in container: URL) -> URL {
    container.appendingPathComponent("Documents", isDirectory: true).appendingPathComponent("Notes", isDirectory: true)
  }
}

/// A note in the iCloud folder. `file` is nil until iCloud has downloaded it.
struct NoteItem: Identifiable, Equatable {
  let url: URL
  var fileName: String { url.lastPathComponent }
  var file: NoteFile?
  var modified: Date?

  var id: URL { url }
  var title: String { NoteFile.displayTitle(file, fileName: fileName) }
  var isDownloaded: Bool { file != nil }
  /// The time the list sorts by and shows: the note's own `updated`, else the file's.
  var updated: Date? { file?.updated ?? modified }

  /// The first line of text in the body, for the list.
  var preview: String {
    guard let body = file?.body else { return "" }
    for line in body.split(whereSeparator: \.isNewline) {
      let text = line.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "#>-*` "))
      if !text.isEmpty, text != title { return text }
    }
    return ""
  }
}

enum NotesError: LocalizedError {
  case unavailable
  case changedElsewhere
  case missing

  var errorDescription: String? {
    switch self {
    case .unavailable: return String(localized: "iCloud is not available.")
    case .changedElsewhere: return String(localized: "This note changed on another device while you were editing. Copy your text, then open the note again.")
    case .missing: return String(localized: "This note is no longer in iCloud.")
    }
  }
}

/// The notes in Owlto's iCloud folder, kept current with an `NSMetadataQuery`, which also
/// lists notes iCloud has not downloaded yet; the store asks iCloud for those. Files are
/// read and written through `NSFileCoordinator`, as iCloud requires. The phone keeps no
/// copy of its own: iCloud Drive holds the files, and the Mac indexes them.
@MainActor
@Observable
final class NotesStore {
  enum State: Equatable {
    case loading
    /// Signed out of iCloud, iCloud Drive off for Owlto, or a build without the entitlement.
    case unavailable
    case ready
  }

  private(set) var state: State = .loading
  /// Newest first.
  private(set) var notes: [NoteItem] = []

  @ObservationIgnored private var folder: URL?
  @ObservationIgnored private var query: NSMetadataQuery?
  @ObservationIgnored private var observers: [NSObjectProtocol] = []
  @ObservationIgnored private var requested: Set<URL> = []
  @ObservationIgnored private var reading: Set<URL> = []
  @ObservationIgnored private var items: [URL: NoteItem] = [:]

  func note(_ url: URL) -> NoteItem? { items[url] }

  /// Finds the container and starts watching the folder. Calling it again after iCloud was
  /// unavailable checks again (the user may have signed in meanwhile).
  func start() async {
    guard query == nil else { return }
    guard FileManager.default.ubiquityIdentityToken != nil else {
      state = .unavailable
      return
    }
    // The first call sets the container up and can take a while; Apple asks for it off the
    // main thread.
    let container = await Task.detached { FileManager.default.url(forUbiquityContainerIdentifier: NotesICloud.container) }.value
    guard let container else {
      state = .unavailable
      return
    }
    folder = NotesICloud.notesFolder(in: container).resolvingSymlinksInPath()
    startQuery()
  }

  private func startQuery() {
    let query = NSMetadataQuery()
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(format: "%K LIKE[c] '*.md'", NSMetadataItemFSNameKey)
    query.notificationBatchingInterval = 0.5
    let center = NotificationCenter.default
    for name in [Notification.Name.NSMetadataQueryDidFinishGathering, .NSMetadataQueryDidUpdate] {
      observers.append(center.addObserver(forName: name, object: query, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.refresh() }
      })
    }
    self.query = query
    query.start()
  }

  private func refresh() {
    guard let query, let folder else { return }
    query.disableUpdates()
    defer { query.enableUpdates() }
    var seen: [URL: NoteItem] = [:]
    for case let item as NSMetadataItem in query.results {
      guard let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL else { continue }
      let resolved = url.resolvingSymlinksInPath()
      // Only Markdown files directly in Notes, as the Mac reads them; hidden files are temp
      // files or placeholders.
      guard resolved.deletingLastPathComponent().path == folder.path, !resolved.lastPathComponent.hasPrefix(".") else { continue }
      let modified = item.value(forAttribute: NSMetadataItemFSContentChangeDateKey) as? Date
      let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
      let current = status == nil || status == NSMetadataUbiquitousItemDownloadingStatusCurrent
      var note = items[resolved] ?? NoteItem(url: resolved, file: nil, modified: modified)
      if !current {
        if !requested.contains(resolved) {
          requested.insert(resolved)
          try? FileManager.default.startDownloadingUbiquitousItem(at: resolved)
        }
      } else if note.file == nil || note.modified != modified {
        read(resolved, modified: modified)
      }
      if note.file == nil { note.modified = modified }
      seen[resolved] = note
    }
    items = seen
    requested.formIntersection(seen.keys)
    publish()
    state = .ready
  }

  private func read(_ url: URL, modified: Date?) {
    guard !reading.contains(url) else { return }
    reading.insert(url)
    Task {
      let content = await Task.detached { try? Self.coordinatedRead(url) }.value
      reading.remove(url)
      guard items[url] != nil, let content else { return }
      items[url]?.file = NoteFile(parsing: content)
      items[url]?.modified = modified
      publish()
    }
  }

  private func publish() {
    notes = items.values.sorted { ($0.updated ?? .distantPast, $1.title) > ($1.updated ?? .distantPast, $0.title) }
  }

  /// Saves a new title and body. Refuses when the file changed since `original` was read, so
  /// an edit on another device is never overwritten.
  func save(_ url: URL, original: String?, title: String, body: String) async throws {
    let now = Date()
    let written = try await Task.detached { () throws -> String in
      let current = try Self.coordinatedRead(url)
      if let original, current != original { throw NotesError.changedElsewhere }
      let next = NoteFile.edited(current, title: title, body: body, now: now)
      try Self.coordinatedWrite(next, to: url)
      return next
    }.value
    items[url]?.file = NoteFile(parsing: written)
    items[url]?.modified = now
    publish()
  }

  /// Writes a new note into the folder and returns its file.
  func create(title: String, body: String) async throws -> URL {
    guard let folder else { throw NotesError.unavailable }
    let taken = Set(items.keys.map { $0.lastPathComponent.lowercased() })
    let stem = NoteFile.fileStem(title)
    let now = Date()
    let content = NoteFile.new(id: NoteFile.newId(), title: title, body: body, now: now)
    let url = try await Task.detached { () throws -> URL in
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      // Names in the folder too: placeholders and files the query has not reported yet.
      let listed = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
      let names = taken.union(listed.map { name in
        let lower = name.lowercased()
        // `.<name>.icloud` holds a note iCloud keeps only in the cloud.
        if lower.hasPrefix("."), lower.hasSuffix(".icloud") { return String(lower.dropFirst().dropLast(7)) }
        return lower
      })
      let url = folder.appendingPathComponent(NoteFile.uniqueName(stem, taken: names))
      try Self.coordinatedWrite(content, to: url)
      return url
    }.value
    items[url] = NoteItem(url: url, file: NoteFile(parsing: content), modified: now)
    publish()
    state = .ready
    return url
  }

  /// The file as it is now, for an editor to compare against when it saves.
  func content(of url: URL) async throws -> String {
    try await Task.detached { try Self.coordinatedRead(url) }.value
  }

  nonisolated private static func coordinatedRead(_ url: URL) throws -> String {
    var coordinationError: NSError?
    var result: Result<String, Error> = .failure(NotesError.missing)
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { url in
      result = Result { try String(contentsOf: url, encoding: .utf8) }
    }
    if let coordinationError { throw coordinationError }
    return try result.get()
  }

  nonisolated private static func coordinatedWrite(_ content: String, to url: URL) throws {
    var coordinationError: NSError?
    var result: Result<Void, Error> = .success(())
    NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { url in
      result = Result { try Data(content.utf8).write(to: url, options: .atomic) }
    }
    if let coordinationError { throw coordinationError }
    try result.get()
  }
}

import Foundation

/// One note file as the Mac writes it (`apps/owlto-client/src/main/cards/note-file.ts`):
/// YAML frontmatter, then the Markdown body. The phone reads the few keys it shows and, when
/// it saves, changes only `title`, `updated`, and the body, so the Mac's other keys stay as
/// they were. Every key may be missing in a file the user wrote by hand.
struct NoteFile: Equatable {
  var id: String?
  var title: String?
  var tags: [String]
  var updated: Date?
  var body: String

  /// The frontmatter block: `---`, the YAML, `---`, at the very start of the file.
  private static let frontmatter = try! NSRegularExpression(pattern: "\\A---\\r?\\n([\\s\\S]*?)\\r?\\n---[ \\t]*(?:\\r?\\n|\\z)")
  /// Ids the Mac hands out, and the only ones it accepts from a file (`NOTE_ID`).
  static let idPattern = try! NSRegularExpression(pattern: "\\Ac_[0-9a-z]{1,40}\\z")

  init(id: String? = nil, title: String? = nil, tags: [String] = [], updated: Date? = nil, body: String) {
    self.id = id
    self.title = title
    self.tags = tags
    self.updated = updated
    self.body = body
  }

  /// Reads a note file. A file with no frontmatter, or frontmatter that is not a map of keys,
  /// is all body, as on the Mac.
  init(parsing content: String) {
    guard case let (yaml, rest)? = Self.split(content), let keys = Self.keys(yaml) else {
      self.init(body: content)
      return
    }
    let id = keys["id"].flatMap(Self.scalar)
    self.init(
      id: id.flatMap { Self.matches(Self.idPattern, $0) ? $0 : nil },
      title: keys["title"].flatMap(Self.scalar),
      tags: keys["tags"].map(Self.list) ?? [],
      updated: keys["updated"].flatMap(Self.scalar).flatMap(Self.date),
      body: rest
    )
  }

  /// The title shown for a file: its own, or the file name as the Mac falls back to.
  static func displayTitle(_ note: NoteFile?, fileName: String) -> String {
    if let title = note?.title { return title }
    let stem = fileName.lowercased().hasSuffix(".md") ? String(fileName.dropLast(3)) : fileName
    return stem.trimmingCharacters(in: .whitespaces)
  }

  /// A new note file, keys in the Mac's order (`serializeNote`).
  static func new(id: String, title: String, body: String, now: Date) -> String {
    let time = timestamp(now)
    return "---\nid: \(id)\ntitle: \(yamlString(title))\ncreated: \(time)\nupdated: \(time)\n---\n\(body)"
  }

  /// `content` with a new title and body, `updated` set to `now`, and every other key and
  /// line of the frontmatter left as it was.
  static func edited(_ content: String, title: String, body: String, now: Date) -> String {
    let titleLine = "title: \(yamlString(title))"
    let updatedLine = "updated: \(timestamp(now))"
    guard case let (yaml, _)? = split(content), keys(yaml) != nil else {
      return "---\n\(titleLine)\n\(updatedLine)\n---\n\(body)"
    }
    var lines: [String] = []
    var skipping = false
    var wroteTitle = false
    var wroteUpdated = false
    for line in yaml.components(separatedBy: .newlines) {
      // A key's value may continue on indented lines; they go with the key they belong to.
      if skipping, line.first == " " || line.first == "\t" || line.isEmpty { continue }
      skipping = false
      switch key(of: line) {
      case "title":
        lines.append(titleLine)
        wroteTitle = true
        skipping = true
      case "updated":
        lines.append(updatedLine)
        wroteUpdated = true
        skipping = true
      default:
        lines.append(line)
      }
    }
    if !wroteTitle {
      let at = lines.firstIndex { key(of: $0) == "id" }.map { $0 + 1 } ?? 0
      lines.insert(titleLine, at: at)
    }
    if !wroteUpdated { lines.append(updatedLine) }
    return "---\n\(lines.joined(separator: "\n"))\n---\n\(body)"
  }

  /// A new id in the Mac's form (`newNoteId`: `c_` and 12 hex digits).
  static func newId() -> String {
    "c_" + (0..<6).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
  }

  /// A file name stem for a title (`fileStem`): characters file systems reject become
  /// spaces, and the name is kept to 80 code points.
  static func fileStem(_ title: String) -> String {
    let rejected = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
    var cleaned = String(String.UnicodeScalarView(title.precomposedStringWithCanonicalMapping.unicodeScalars.map { rejected.contains($0) ? " " : $0 }))
    cleaned = cleaned.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    while cleaned.hasPrefix(".") { cleaned.removeFirst() }
    while let last = cleaned.last, last == "." || last == " " { cleaned.removeLast() }
    let short = String(String.UnicodeScalarView(cleaned.unicodeScalars.prefix(80))).trimmingCharacters(in: .whitespaces)
    return short.isEmpty ? "Untitled" : short
  }

  /// `<stem>.md`, or `<stem> 2.md` and so on when taken. `taken` holds lowercased names.
  static func uniqueName(_ stem: String, taken: Set<String>) -> String {
    var n = 1
    while true {
      let name = n == 1 ? "\(stem).md" : "\(stem) \(n).md"
      if !taken.contains(name.lowercased()) { return name }
      n += 1
    }
  }

  // MARK: - Reading the frontmatter

  private static func split(_ content: String) -> (yaml: String, body: String)? {
    let range = NSRange(content.startIndex..., in: content)
    guard let match = frontmatter.firstMatch(in: content, range: range),
          let whole = Range(match.range, in: content),
          let inner = Range(match.range(at: 1), in: content) else { return nil }
    return (String(content[inner]), String(content[whole.upperBound...]))
  }

  /// Top-level keys and their raw values (the rest of the key's line plus its indented
  /// lines), or nil when the YAML is not a plain map of keys.
  private static func keys(_ yaml: String) -> [String: String]? {
    var result: [String: String] = [:]
    var current: String?
    for line in yaml.components(separatedBy: .newlines) {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
      if line.first == " " || line.first == "\t" || line.hasPrefix("- ") || line == "-" {
        guard let key = current else { return nil }
        result[key, default: ""] += "\n" + line
        continue
      }
      guard let key = key(of: line) else { return nil }
      let colon = line.firstIndex(of: ":")!
      result[key] = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
      current = key
    }
    return result
  }

  private static func key(of line: String) -> String? {
    guard let first = line.first, first != " ", first != "\t", first != "-", first != "#",
          let colon = line.firstIndex(of: ":") else { return nil }
    let after = line.index(after: colon)
    guard after == line.endIndex || line[after] == " " || line[after] == "\t" else { return nil }
    let key = line[..<colon].trimmingCharacters(in: .whitespaces)
    return key.isEmpty ? nil : key
  }

  /// A one-line scalar: plain, single-quoted, or double-quoted. Empty means missing.
  private static func scalar(_ raw: String) -> String? {
    let firstLine = raw.components(separatedBy: "\n").first ?? ""
    let value = firstLine.trimmingCharacters(in: .whitespaces)
    var text: String
    if value.hasPrefix("\""), value.count >= 2, value.hasSuffix("\"") {
      text = unescapeDouble(String(value.dropFirst().dropLast()))
    } else if value.hasPrefix("'"), value.count >= 2, value.hasSuffix("'") {
      text = String(value.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'")
    } else {
      text = value
      // A comment after a plain value.
      if let hash = text.range(of: " #") { text = String(text[..<hash.lowerBound]) }
      if text == "~" || text == "null" { text = "" }
    }
    text = text.trimmingCharacters(in: .whitespaces)
    return text.isEmpty ? nil : text
  }

  /// `[a, b]`, a `- a` block list, or `a, b` (the Mac accepts a comma-separated string).
  /// Trimmed, deduplicated, and sorted, as the Mac keeps tags.
  private static func list(_ raw: String) -> [String] {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    var items: [String]
    if trimmed.hasPrefix("[") && trimmed.hasSuffix("]") {
      items = trimmed.dropFirst().dropLast().split(separator: ",").map(String.init)
    } else if trimmed.hasPrefix("-") {
      items = trimmed.components(separatedBy: .newlines).compactMap { line in
        let item = line.trimmingCharacters(in: .whitespaces)
        return item.hasPrefix("-") ? String(item.dropFirst()) : nil
      }
    } else {
      items = trimmed.split(separator: ",").map(String.init)
    }
    let tags = items.compactMap { scalar($0.trimmingCharacters(in: .whitespaces)) }
    return Array(Set(tags)).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
  }

  private static func unescapeDouble(_ text: String) -> String {
    var result = ""
    var iterator = text.makeIterator()
    while let character = iterator.next() {
      guard character == "\\", let next = iterator.next() else {
        result.append(character)
        continue
      }
      switch next {
      case "n": result.append("\n")
      case "t": result.append("\t")
      case "u":
        let hex = String((0..<4).compactMap { _ in iterator.next() })
        if let code = UInt32(hex, radix: 16), let scalar = Unicode.Scalar(code) { result.unicodeScalars.append(scalar) }
      default: result.append(next)
      }
    }
    return result
  }

  // MARK: - Writing

  /// A title as a YAML scalar: plain when it reads back as the same string, else double-quoted.
  static func yamlString(_ text: String) -> String {
    let special = CharacterSet(charactersIn: ":#{}[],&*!|>'\"%@`\\").union(.controlCharacters).union(.newlines)
    let reserved: Set<String> = ["true", "false", "yes", "no", "on", "off", "null", "~"]
    let plain = !text.isEmpty
      && text.unicodeScalars.allSatisfy { !special.contains($0) }
      && text.first?.isWhitespace == false && text.last?.isWhitespace == false
      && !text.hasPrefix("-") && !text.hasPrefix("?")
      && !reserved.contains(text.lowercased()) && Double(text) == nil
    if plain { return text }
    var quoted = "\""
    for scalar in text.unicodeScalars {
      switch scalar {
      case "\"": quoted += "\\\""
      case "\\": quoted += "\\\\"
      case "\n": quoted += "\\n"
      case "\t": quoted += "\\t"
      default:
        if CharacterSet.controlCharacters.contains(scalar) {
          quoted += String(format: "\\u%04x", scalar.value)
        } else {
          quoted.unicodeScalars.append(scalar)
        }
      }
    }
    return quoted + "\""
  }

  private static func timestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }

  private static func date(_ text: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: text) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: text)
  }

  private static func matches(_ pattern: NSRegularExpression, _ text: String) -> Bool {
    pattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
  }
}

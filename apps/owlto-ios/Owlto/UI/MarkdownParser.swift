import Foundation

/// The block structure of a Markdown message: what agents write (GitHub-flavored Markdown with
/// headings, lists, task lists, fenced code, quotes, tables, and rules). Inline syntax inside a
/// block stays as source text; the view hands it to Foundation's inline Markdown parser.
///
/// Messages stream in, so the parser never fails: an unclosed fence runs to the end, and anything
/// it does not recognize (HTML, indented code) is kept as a paragraph.
indirect enum MarkdownBlock: Equatable {
  case heading(level: Int, text: String)
  case paragraph(String)
  case list(MarkdownList)
  case code(language: String?, text: String)
  case quote([MarkdownBlock])
  case table(MarkdownTable)
  case rule
}

struct MarkdownList: Equatable {
  struct Item: Equatable {
    /// nil for a plain item, true/false for a task list item (`- [x]` / `- [ ]`).
    var checked: Bool?
    var blocks: [MarkdownBlock]
  }

  /// The first number of an ordered list; nil for a bullet list.
  var start: Int?
  var items: [Item]
}

struct MarkdownTable: Equatable {
  enum Alignment: Equatable { case leading, center, trailing }

  var header: [String]
  var alignments: [Alignment]
  /// Every row has exactly as many cells as the header.
  var rows: [[String]]
}

enum MarkdownParser {
  private final class Box {
    let blocks: [MarkdownBlock]
    init(_ blocks: [MarkdownBlock]) { self.blocks = blocks }
  }

  private static let cache: NSCache<NSString, Box> = {
    let cache = NSCache<NSString, Box>()
    cache.countLimit = 300
    return cache
  }()

  /// Parsed blocks for a message, cached because a thread re-renders its rows often.
  static func blocks(_ text: String) -> [MarkdownBlock] {
    let key = text as NSString
    if let hit = cache.object(forKey: key) { return hit.blocks }
    let blocks = parse(text)
    cache.setObject(Box(blocks), forKey: key)
    return blocks
  }

  static func parse(_ text: String) -> [MarkdownBlock] {
    let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map { expandTabs(String($0)) }
    return parseBlocks(lines)
  }

  // MARK: - Blocks

  private static func parseBlocks(_ lines: [String]) -> [MarkdownBlock] {
    var blocks: [MarkdownBlock] = []
    var index = 0
    var paragraph: [String] = []

    func flushParagraph() {
      guard !paragraph.isEmpty else { return }
      let text = paragraph.map { $0.trimmingLeadingSpaces() }.joined(separator: "\n").trimmingTrailingWhitespace()
      if !text.isEmpty { blocks.append(.paragraph(text)) }
      paragraph = []
    }

    while index < lines.count {
      let line = lines[index]

      if line.isBlank {
        flushParagraph()
        index += 1
        continue
      }

      // A setext underline turns the paragraph above it into a heading.
      if !paragraph.isEmpty, let level = setextLevel(line) {
        let text = paragraph.map { $0.trimmingLeadingSpaces() }.joined(separator: " ").trimmingTrailingWhitespace()
        paragraph = []
        blocks.append(.heading(level: level, text: text))
        index += 1
        continue
      }

      if let fence = openingFence(line) {
        flushParagraph()
        index += 1
        var body: [String] = []
        while index < lines.count {
          if isClosingFence(lines[index], fence) {
            index += 1
            break
          }
          body.append(lines[index].removingIndent(upTo: fence.indent))
          index += 1
        }
        blocks.append(.code(language: fence.language, text: body.joined(separator: "\n")))
        continue
      }

      if let heading = atxHeading(line) {
        flushParagraph()
        blocks.append(heading)
        index += 1
        continue
      }

      if isThematicBreak(line) {
        flushParagraph()
        blocks.append(.rule)
        index += 1
        continue
      }

      if quoteContent(line) != nil {
        flushParagraph()
        var inner: [String] = []
        while index < lines.count {
          if let content = quoteContent(lines[index]) {
            inner.append(content)
          } else if !lines[index].isBlank, let last = inner.last, !last.isBlank, startsBlock(lines[index]) == false {
            // A lazy continuation line of a quoted paragraph.
            inner.append(lines[index])
          } else {
            break
          }
          index += 1
        }
        blocks.append(.quote(parseBlocks(inner)))
        continue
      }

      if index + 1 < lines.count, let table = tableStart(lines, at: index) {
        flushParagraph()
        var rows: [[String]] = []
        index += 2
        while index < lines.count, !lines[index].isBlank, lines[index].contains("|"), !startsBlock(lines[index]) {
          rows.append(fit(splitRow(lines[index]), to: table.header.count))
          index += 1
        }
        blocks.append(.table(MarkdownTable(header: table.header, alignments: table.alignments, rows: rows)))
        continue
      }

      // A list may interrupt a paragraph only when it can't be a wrapped line of prose:
      // a bullet, or an ordered list that starts at 1 (as CommonMark has it).
      if let marker = listMarker(line), paragraph.isEmpty || marker.start == nil || marker.start == 1 {
        flushParagraph()
        let (list, next) = parseList(lines, from: index, first: marker)
        blocks.append(.list(list))
        index = next
        continue
      }

      paragraph.append(line)
      index += 1
    }
    flushParagraph()
    return blocks
  }

  /// Whether a line opens a block that ends a paragraph or a table.
  private static func startsBlock(_ line: String) -> Bool {
    openingFence(line) != nil || atxHeading(line) != nil || isThematicBreak(line) || quoteContent(line) != nil || listMarker(line) != nil
  }

  // MARK: Lists

  private struct ListMarker {
    /// nil for a bullet.
    var start: Int?
    /// The bullet character or the ordered delimiter, so a change of marker starts a new list.
    var symbol: Character
    var indent: Int
    /// Column where the item's content starts.
    var contentIndent: Int
    var content: String
  }

  private static func listMarker(_ line: String) -> ListMarker? {
    let indent = line.leadingSpaces
    guard indent < 4 else { return nil }
    let chars = Array(line)
    var i = indent
    guard i < chars.count else { return nil }
    var start: Int?
    let symbol: Character
    if "-*+".contains(chars[i]) {
      symbol = chars[i]
      i += 1
    } else {
      var digits = ""
      while i < chars.count, chars[i].isASCII, chars[i].isNumber, digits.count < 9 {
        digits.append(chars[i])
        i += 1
      }
      guard !digits.isEmpty, i < chars.count, chars[i] == "." || chars[i] == ")" else { return nil }
      start = Int(digits)
      symbol = chars[i]
      i += 1
    }
    // The marker must be followed by a space, or end the line (an empty item).
    if i == chars.count {
      return ListMarker(start: start, symbol: symbol, indent: indent, contentIndent: i + 1, content: "")
    }
    guard chars[i] == " " else { return nil }
    var spaces = 0
    while i + spaces < chars.count, chars[i + spaces] == " " { spaces += 1 }
    // Five or more spaces would be indented code inside the item; keep one as the separator.
    let gap = spaces > 4 ? 1 : spaces
    let content = String(chars[(i + gap)...])
    if start == nil, isThematicBreak(line) { return nil }
    return ListMarker(start: start, symbol: symbol, indent: indent, contentIndent: i + gap, content: content)
  }

  private static func parseList(_ lines: [String], from: Int, first: ListMarker) -> (MarkdownList, Int) {
    var items: [MarkdownList.Item] = []
    var index = from
    var marker: ListMarker? = first

    while let current = marker {
      var body: [String] = [current.content]
      index += 1
      var sawBlank = false
      var inFence: Fence? = openingFence(current.content)
      while index < lines.count {
        let line = lines[index]
        if line.isBlank {
          body.append("")
          sawBlank = true
          index += 1
          continue
        }
        let indent = line.leadingSpaces
        if indent >= current.contentIndent {
          let content = line.removingIndent(upTo: current.contentIndent)
          if let fence = inFence {
            if isClosingFence(content, fence) { inFence = nil }
          } else {
            inFence = openingFence(content)
          }
          body.append(content)
          sawBlank = false
          index += 1
          continue
        }
        if inFence != nil {
          // A fence that started in the item keeps going until it closes or the item clearly ends.
          if sawBlank { break }
          body.append(line.trimmingLeadingSpaces())
          index += 1
          continue
        }
        // A wrapped line of the item's last paragraph, written without indentation.
        if !sawBlank, !startsBlock(line), let last = body.last, !last.isBlank, !isFenceLine(last) {
          body.append(line.trimmingLeadingSpaces())
          index += 1
          continue
        }
        break
      }
      while body.last?.isBlank == true { body.removeLast() }

      var checked: Bool?
      if let first = body.first, let task = taskPrefix(first) {
        checked = task.checked
        body[0] = task.rest
      }
      items.append(MarkdownList.Item(checked: checked, blocks: parseBlocks(body)))

      marker = nil
      if index < lines.count, let next = listMarker(lines[index]), next.indent < current.contentIndent,
         next.symbol == current.symbol, (next.start == nil) == (current.start == nil) {
        marker = next
      }
    }
    return (MarkdownList(start: first.start, items: items), index)
  }

  private static func taskPrefix(_ line: String) -> (checked: Bool, rest: String)? {
    let chars = Array(line)
    guard chars.count >= 3, chars[0] == "[", chars[2] == "]" else { return nil }
    let checked: Bool
    switch chars[1] {
    case " ": checked = false
    case "x", "X": checked = true
    default: return nil
    }
    if chars.count == 3 { return (checked, "") }
    guard chars[3] == " " else { return nil }
    return (checked, String(chars[4...]))
  }

  // MARK: Fences

  private struct Fence {
    var char: Character
    var length: Int
    var indent: Int
    var language: String?
  }

  private static func openingFence(_ line: String) -> Fence? {
    let indent = line.leadingSpaces
    guard indent < 4 else { return nil }
    let rest = line.dropFirst(indent)
    guard let char = rest.first, char == "`" || char == "~" else { return nil }
    let length = rest.prefix { $0 == char }.count
    guard length >= 3 else { return nil }
    let info = rest.dropFirst(length).trimmingCharacters(in: .whitespaces)
    if char == "`", info.contains("`") { return nil }
    let language = info.split(separator: " ").first.map(String.init)
    return Fence(char: char, length: length, indent: indent, language: language?.isEmpty == false ? language : nil)
  }

  private static func isClosingFence(_ line: String, _ fence: Fence) -> Bool {
    let indent = line.leadingSpaces
    guard indent < 4 else { return false }
    let rest = line.dropFirst(indent)
    let length = rest.prefix { $0 == fence.char }.count
    return length >= fence.length && rest.dropFirst(length).allSatisfy { $0 == " " }
  }

  private static func isFenceLine(_ line: String) -> Bool { openingFence(line) != nil }

  // MARK: Headings, rules, quotes

  private static func atxHeading(_ line: String) -> MarkdownBlock? {
    let indent = line.leadingSpaces
    guard indent < 4 else { return nil }
    let rest = line.dropFirst(indent)
    let level = rest.prefix { $0 == "#" }.count
    guard (1...6).contains(level) else { return nil }
    let after = rest.dropFirst(level)
    guard after.isEmpty || after.first == " " else { return nil }
    var text = after.trimmingCharacters(in: .whitespaces)
    // An optional closing run of #s, separated by a space.
    if let range = text.range(of: #"(^|\s)#+$"#, options: .regularExpression) {
      text = String(text[..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
    }
    return .heading(level: level, text: text)
  }

  private static func setextLevel(_ line: String) -> Int? {
    guard line.leadingSpaces < 4 else { return nil }
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard let first = trimmed.first, first == "=" || first == "-", trimmed.allSatisfy({ $0 == first }) else { return nil }
    // A lone "-" is an empty list item, not an underline.
    if first == "-", trimmed.count < 2 { return nil }
    return first == "=" ? 1 : 2
  }

  private static func isThematicBreak(_ line: String) -> Bool {
    guard line.leadingSpaces < 4 else { return false }
    let chars = line.filter { $0 != " " }
    guard let first = chars.first, "-*_".contains(first), chars.count >= 3 else { return false }
    return chars.allSatisfy { $0 == first }
  }

  private static func quoteContent(_ line: String) -> String? {
    let indent = line.leadingSpaces
    guard indent < 4 else { return nil }
    let rest = line.dropFirst(indent)
    guard rest.first == ">" else { return nil }
    let after = rest.dropFirst()
    return String(after.first == " " ? after.dropFirst() : after)
  }

  // MARK: Tables

  private static func tableStart(_ lines: [String], at index: Int) -> (header: [String], alignments: [MarkdownTable.Alignment])? {
    let headerLine = lines[index]
    guard headerLine.contains("|"), headerLine.leadingSpaces < 4 else { return nil }
    guard let alignments = delimiterRow(lines[index + 1]) else { return nil }
    let header = splitRow(headerLine)
    guard header.count == alignments.count else { return nil }
    return (header, alignments)
  }

  private static func delimiterRow(_ line: String) -> [MarkdownTable.Alignment]? {
    guard line.leadingSpaces < 4 else { return nil }
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard trimmed.contains("-"), trimmed.allSatisfy({ "|:- ".contains($0) }) else { return nil }
    let cells = splitRow(trimmed)
    guard !cells.isEmpty else { return nil }
    // A delimiter row needs a pipe unless it has several cells; "---" alone is a rule.
    guard trimmed.contains("|") else { return nil }
    var alignments: [MarkdownTable.Alignment] = []
    for cell in cells {
      guard cell.contains("-"), cell.allSatisfy({ $0 == "-" || $0 == ":" }) else { return nil }
      let left = cell.hasPrefix(":")
      let right = cell.hasSuffix(":")
      alignments.append(left && right ? .center : right ? .trailing : .leading)
    }
    return alignments
  }

  /// Cells of a table row: split on pipes that are not escaped or inside code spans.
  static func splitRow(_ line: String) -> [String] {
    var trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("|") { trimmed.removeFirst() }
    if trimmed.hasSuffix("|"), !trimmed.hasSuffix("\\|") { trimmed.removeLast() }
    var cells: [String] = []
    var current = ""
    var inCode = false
    var escaped = false
    for char in trimmed {
      if escaped {
        // `\|` stands for a literal pipe; keep other escapes for the inline parser.
        if char != "|" { current.append("\\") }
        current.append(char)
        escaped = false
        continue
      }
      switch char {
      case "\\": escaped = true
      case "`":
        inCode.toggle()
        current.append(char)
      case "|" where !inCode:
        cells.append(current.trimmingCharacters(in: .whitespaces))
        current = ""
      default: current.append(char)
      }
    }
    if escaped { current.append("\\") }
    cells.append(current.trimmingCharacters(in: .whitespaces))
    return cells
  }

  private static func fit(_ cells: [String], to count: Int) -> [String] {
    if cells.count >= count { return Array(cells.prefix(count)) }
    return cells + Array(repeating: "", count: count - cells.count)
  }

  private static func expandTabs(_ line: String) -> String {
    guard line.contains("\t") else { return line }
    var out = ""
    for char in line {
      if char == "\t" {
        let spaces = 4 - out.count % 4
        out += String(repeating: " ", count: spaces)
      } else {
        out.append(char)
      }
    }
    return out
  }
}

private extension String {
  var isBlank: Bool { allSatisfy { $0 == " " } }

  var leadingSpaces: Int { prefix { $0 == " " }.count }

  func trimmingLeadingSpaces() -> String { String(drop { $0 == " " }) }

  func trimmingTrailingWhitespace() -> String {
    var copy = self
    while let last = copy.last, last.isWhitespace { copy.removeLast() }
    return copy
  }

  func removingIndent(upTo count: Int) -> String {
    String(dropFirst(min(leadingSpaces, count)))
  }
}

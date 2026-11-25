import SwiftUI
import UIKit

/// A message as agents write it: GitHub-flavored Markdown laid out the way the desktop thread
/// shows it (`.markdown-body` in `assets/main.css`): headings, lists and task lists, fenced code
/// with a copy button, quotes with a bar, tables, rules, and blue links without an underline.
struct MarkdownText: View {
  let text: String

  var body: some View {
    MarkdownBlocksView(blocks: MarkdownParser.blocks(text), depth: 0)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// Inline Markdown only (bold, italic, code, links), for short text such as a user's message.
  /// Inline code gets the code tint, and bare URLs become links.
  static func attributed(_ text: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    var attributed = (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    let codeRanges = attributed.runs.filter { $0.inlinePresentationIntent?.contains(.code) == true }.map(\.range)
    for range in codeRanges {
      attributed[range][AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute.self] = Theme.code
    }
    linkBareURLs(&attributed)
    return attributed
  }

  private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

  private static func linkBareURLs(_ attributed: inout AttributedString) {
    guard let detector else { return }
    let plain = String(attributed.characters)
    guard plain.contains("://") || plain.contains("www.") else { return }
    let matches = detector.matches(in: plain, range: NSRange(plain.startIndex..., in: plain))
    let characters = attributed.characters
    let ranges: [(Range<AttributedString.Index>, URL)] = matches.compactMap { match in
      guard let url = match.url, url.scheme == "http" || url.scheme == "https",
            let found = Range(match.range, in: plain) else { return nil }
      // Map by character offset: the detector ran on a copy of the same characters.
      let lower = plain.distance(from: plain.startIndex, to: found.lowerBound)
      let count = plain.distance(from: found.lowerBound, to: found.upperBound)
      let start = characters.index(characters.startIndex, offsetBy: lower)
      let end = characters.index(start, offsetBy: count)
      return (start..<end, url)
    }
    for (range, url) in ranges {
      // Leave existing links and code spans alone.
      let untouched = attributed[range].runs.allSatisfy { $0.link == nil && $0.inlinePresentationIntent?.contains(.code) != true }
      if untouched { attributed[range].link = url }
    }
  }
}

private struct MarkdownBlocksView: View {
  let blocks: [MarkdownBlock]
  let depth: Int

  var body: some View {
    VStack(alignment: .leading, spacing: depth > 0 ? 6 : 10) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
        MarkdownBlockView(block: block, depth: depth)
      }
    }
  }
}

private struct MarkdownBlockView: View {
  let block: MarkdownBlock
  let depth: Int

  var body: some View {
    switch block {
    case .heading(let level, let text):
      InlineText(text: text)
        .font(Self.headingFont(level))
        .foregroundStyle(Theme.foreground)
        .padding(.top, depth == 0 ? 4 : 0)
        .accessibilityAddTraits(.isHeader)
    case .paragraph(let text):
      InlineText(text: text)
    case .list(let list):
      MarkdownListView(list: list, depth: depth)
    case .code(let language, let text):
      MarkdownCodeBlock(language: language, text: text)
    case .quote(let blocks):
      HStack(alignment: .top, spacing: 10) {
        RoundedRectangle(cornerRadius: 1.5, style: .continuous)
          .fill(Theme.connector)
          .frame(width: 3)
        MarkdownBlocksView(blocks: blocks, depth: depth + 1)
          .foregroundStyle(Theme.secondary)
      }
      .fixedSize(horizontal: false, vertical: true)
    case .table(let table):
      MarkdownTableView(table: table)
    case .rule:
      Rectangle()
        .fill(Theme.border)
        .frame(height: 1)
        .padding(.vertical, 4)
    }
  }

  /// The desktop's heading scale (1.28em, 1.2em, 1.08em, then body size), all semibold.
  static func headingFont(_ level: Int) -> Font {
    switch level {
    case 1: return .title2.weight(.semibold)
    case 2: return .title3.weight(.semibold)
    case 3: return .headline
    default: return .body.weight(.semibold)
    }
  }
}

/// One run of inline Markdown, selectable, with links in the link color.
private struct InlineText: View {
  let text: String

  var body: some View {
    Text(MarkdownText.attributed(text))
      .textSelection(.enabled)
      .tint(Theme.link)
      .fixedSize(horizontal: false, vertical: true)
  }
}

private struct MarkdownListView: View {
  let list: MarkdownList
  let depth: Int

  var body: some View {
    let digits = list.start.map { String($0 + list.items.count - 1).count } ?? 1
    VStack(alignment: .leading, spacing: 4) {
      ForEach(Array(list.items.enumerated()), id: \.offset) { index, item in
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          marker(index: index, item: item)
            .frame(minWidth: list.start == nil ? 12 : CGFloat(digits) * 9 + 6, alignment: .trailing)
          MarkdownBlocksView(blocks: item.blocks, depth: depth + 1)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
  }

  @ViewBuilder
  private func marker(index: Int, item: MarkdownList.Item) -> some View {
    if let checked = item.checked {
      Text(Image(systemName: checked ? "checkmark.square.fill" : "square"))
        .foregroundStyle(checked ? Theme.success : Theme.tertiary)
        .accessibilityLabel(checked ? Text("Done") : Text("To do"))
    } else if let start = list.start {
      Text(verbatim: "\(start + index).")
        .monospacedDigit()
        .foregroundStyle(Theme.secondary)
    } else {
      Text(verbatim: Self.bullets[min(depth, Self.bullets.count - 1)])
        .foregroundStyle(Theme.secondary)
    }
  }

  private static let bullets = ["•", "◦", "▪"]
}

private struct MarkdownCodeBlock: View {
  let language: String?
  let text: String
  @State private var copied = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        if let language {
          Text(verbatim: language).font(.caption.monospaced()).foregroundStyle(Theme.tertiary)
        }
        Spacer(minLength: 0)
        Button(action: copy) {
          Image(systemName: copied ? "checkmark" : "doc.on.doc")
            .font(.caption.weight(.medium))
            .foregroundStyle(copied ? Theme.success : Theme.tertiary)
            .frame(width: 28, height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(copied ? Text("Copied") : Text("Copy code"))
      }
      .padding(.leading, 12)
      .padding(.trailing, 4)
      .padding(.top, 4)
      ScrollView(.horizontal, showsIndicators: false) {
        Text(verbatim: text)
          .font(.footnote.monospaced())
          .foregroundStyle(Theme.foreground)
          .textSelection(.enabled)
          .padding(.horizontal, 12)
          .padding(.bottom, 10)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .owlCard(Theme.code, radius: 8, stroke: Theme.border, shadow: 0)
  }

  private func copy() {
    UIPasteboard.general.string = text
    copied = true
    Task {
      try? await Task.sleep(nanoseconds: 1_500_000_000)
      copied = false
    }
  }
}

private struct MarkdownTableView: View {
  let table: MarkdownTable

  var body: some View {
    let wide: [Bool] = (0..<table.header.count).map { column in
      ([table.header] + table.rows).contains { Self.displayWidth($0[column]) > 40 }
    }
    ScrollView(.horizontal, showsIndicators: false) {
      Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
        GridRow {
          ForEach(Array(table.header.enumerated()), id: \.offset) { column, text in
            cell(text, column: column, wide: wide[column])
              .font(.subheadline.weight(.semibold))
              .background(Theme.fill)
              .gridColumnAlignment(alignment(column))
          }
        }
        ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
          Rectangle()
            .fill(Theme.border)
            .frame(height: 1)
            .gridCellUnsizedAxes(.horizontal)
          GridRow {
            ForEach(Array(row.enumerated()), id: \.offset) { column, text in
              cell(text, column: column, wide: wide[column])
                .font(.subheadline)
            }
          }
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      .owlCard(Theme.background, radius: 8, stroke: Theme.border, shadow: 0)
      .padding(1)
    }
  }

  @ViewBuilder
  private func cell(_ text: String, column: Int, wide: Bool) -> some View {
    let content = Text(MarkdownText.attributed(text))
      .tint(Theme.link)
      .multilineTextAlignment(textAlignment(column))
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
    // A horizontal scroll view offers unlimited width, so long columns get a fixed width to wrap in.
    let fill = Alignment(horizontal: alignment(column), vertical: .center)
    // Each cell then fills its column, so the header tint has no gaps.
    if wide {
      content
        .frame(width: 240, alignment: fill)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: fill)
    } else {
      content
        .fixedSize()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: fill)
    }
  }

  private func alignment(_ column: Int) -> HorizontalAlignment {
    switch table.alignments[column] {
    case .leading: return .leading
    case .center: return .center
    case .trailing: return .trailing
    }
  }

  private func textAlignment(_ column: Int) -> TextAlignment {
    switch table.alignments[column] {
    case .leading: return .leading
    case .center: return .center
    case .trailing: return .trailing
    }
  }

  /// Rough width in Latin characters: CJK and other wide characters count double.
  private static func displayWidth(_ text: String) -> Int {
    text.unicodeScalars.reduce(0) { $0 + ($1.value >= 0x1100 ? 2 : 1) }
  }
}

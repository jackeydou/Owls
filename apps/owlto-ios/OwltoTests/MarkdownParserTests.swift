import XCTest
@testable import Owlto

/// Block structure of agent messages; inline syntax stays as source for Foundation's parser.
final class MarkdownParserTests: XCTestCase {
  func testHeadingsAndParagraphs() {
    let blocks = MarkdownParser.parse("# Title\nSome **bold** text\nnext line\n\n## Sub ##\nTitle 2\n===")
    XCTAssertEqual(blocks, [
      .heading(level: 1, text: "Title"),
      .paragraph("Some **bold** text\nnext line"),
      .heading(level: 2, text: "Sub"),
      .heading(level: 1, text: "Title 2"),
    ])
  }

  func testHashtagIsNotAHeading() {
    XCTAssertEqual(MarkdownParser.parse("#hashtag"), [.paragraph("#hashtag")])
  }

  func testNestedAndTaskLists() {
    let blocks = MarkdownParser.parse("- one\n- two\n  - nested\n- [x] done\n- [ ] todo\n\n1. first\n2. second")
    XCTAssertEqual(blocks, [
      .list(MarkdownList(start: nil, items: [
        .init(checked: nil, blocks: [.paragraph("one")]),
        .init(checked: nil, blocks: [
          .paragraph("two"),
          .list(MarkdownList(start: nil, items: [.init(checked: nil, blocks: [.paragraph("nested")])])),
        ]),
        .init(checked: true, blocks: [.paragraph("done")]),
        .init(checked: false, blocks: [.paragraph("todo")]),
      ])),
      .list(MarkdownList(start: 1, items: [
        .init(checked: nil, blocks: [.paragraph("first")]),
        .init(checked: nil, blocks: [.paragraph("second")]),
      ])),
    ])
  }

  func testOrderedListKeepsItsStartAndCodeInsideItems() {
    let blocks = MarkdownParser.parse("3. Run:\n   ```sh\n   pnpm i\n   ```\n4. Done")
    XCTAssertEqual(blocks, [
      .list(MarkdownList(start: 3, items: [
        .init(checked: nil, blocks: [.paragraph("Run:"), .code(language: "sh", text: "pnpm i")]),
        .init(checked: nil, blocks: [.paragraph("Done")]),
      ])),
    ])
  }

  func testNumberInProseDoesNotStartAList() {
    XCTAssertEqual(MarkdownParser.parse("I counted\n2024. was a year"), [.paragraph("I counted\n2024. was a year")])
  }

  func testFencedCodeKeepsBlankLinesAndRunsToTheEndWhileStreaming() {
    XCTAssertEqual(MarkdownParser.parse("```swift title\nlet a = 1\n\n  b\n```\nafter"), [
      .code(language: "swift", text: "let a = 1\n\n  b"),
      .paragraph("after"),
    ])
    XCTAssertEqual(MarkdownParser.parse("Look:\n```\nabc"), [.paragraph("Look:"), .code(language: nil, text: "abc")])
  }

  func testQuoteWithLazyContinuation() {
    XCTAssertEqual(MarkdownParser.parse("> quoted **text**\n> - item\nlazy\n\nafter"), [
      .quote([
        .paragraph("quoted **text**"),
        .list(MarkdownList(start: nil, items: [.init(checked: nil, blocks: [.paragraph("item\nlazy")])])),
      ]),
      .paragraph("after"),
    ])
  }

  func testTable() {
    let blocks = MarkdownParser.parse("Intro\n| Name | Count |\n| :--- | ---: |\n| a \\| b | `x|y` |\n| c |\n\nafter")
    XCTAssertEqual(blocks, [
      .paragraph("Intro"),
      .table(MarkdownTable(
        header: ["Name", "Count"],
        alignments: [.leading, .trailing],
        rows: [["a | b", "`x|y`"], ["c", ""]]
      )),
      .paragraph("after"),
    ])
  }

  func testHalfStreamedTableIsAParagraph() {
    XCTAssertEqual(MarkdownParser.parse("| a | b |"), [.paragraph("| a | b |")])
  }

  func testRules() {
    XCTAssertEqual(MarkdownParser.parse("one\n\n---\n\n* * *\ntwo"), [.paragraph("one"), .rule, .rule, .paragraph("two")])
  }

  func testInlineMarkdownLinksBareURLsAndKeepsCode() {
    let attributed = MarkdownText.attributed("See https://owlto.dev and [docs](https://example.com) but not `https://code.example`")
    let links = attributed.runs.compactMap(\.link).map(\.absoluteString)
    XCTAssertEqual(links, ["https://owlto.dev", "https://example.com"])
  }
}

import XCTest
@testable import Owlto

/// Note files shared with the Mac through iCloud. The fixtures are what the Mac writes
/// (`serializeNote` in `apps/owlto-client/src/main/cards/note-file.ts`, the `yaml` package
/// with `lineWidth: 0` and flow tags), and every title the phone writes was checked to read
/// back the same with that package's `parse`.
final class NoteFileTests: XCTestCase {
  private let mac = "---\nid: c_0123456789ab\ntitle: 'Plan: Q4 \"launch\"'\ntags: [ ios, swift ui ]\nproject: p_1\nsource:\n  kind: thread\n  routerId: r1\n  messageId: m1\ncreated: 2026-11-20T10:00:00.000Z\nupdated: 2026-11-25T08:30:15.250Z\n---\n# Heading\n\nBody line\n"

  private func date(_ text: String) -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: text)!
  }

  func testReadsAMacNote() {
    let note = NoteFile(parsing: mac)
    XCTAssertEqual(note.id, "c_0123456789ab")
    XCTAssertEqual(note.title, "Plan: Q4 \"launch\"")
    XCTAssertEqual(note.tags, ["ios", "swift ui"])
    XCTAssertEqual(note.updated, date("2026-11-25T08:30:15.250Z"))
    XCTAssertEqual(note.body, "# Heading\n\nBody line\n")
  }

  func testAFileWithoutFrontmatterIsAllBody() {
    let note = NoteFile(parsing: "# Just text\n---\nnot frontmatter")
    XCTAssertNil(note.id)
    XCTAssertNil(note.title)
    XCTAssertEqual(note.body, "# Just text\n---\nnot frontmatter")
    XCTAssertEqual(NoteFile.displayTitle(note, fileName: "Shopping list.md"), "Shopping list")
  }

  func testRejectsIdsTheMacWouldNotAccept() {
    XCTAssertNil(NoteFile(parsing: "---\nid: note-1\n---\nx").id)
    XCTAssertEqual(NoteFile(parsing: "---\nid: \"c_ab12\"\n---\nx").id, "c_ab12")
  }

  func testReadsBlockAndCommaTags() {
    XCTAssertEqual(NoteFile(parsing: "---\ntags:\n  - b\n  - a\n  - b\n---\n").tags, ["a", "b"])
    XCTAssertEqual(NoteFile(parsing: "---\ntags: work, ideas\n---\n").tags, ["ideas", "work"])
  }

  func testEditKeepsEveryOtherKey() {
    let now = date("2026-11-26T05:00:00.000Z")
    let edited = NoteFile.edited(mac, title: "Plan: Q4 \"done\"", body: "New body", now: now)
    XCTAssertEqual(edited, "---\nid: c_0123456789ab\ntitle: \"Plan: Q4 \\\"done\\\"\"\ntags: [ ios, swift ui ]\nproject: p_1\nsource:\n  kind: thread\n  routerId: r1\n  messageId: m1\ncreated: 2026-11-20T10:00:00.000Z\nupdated: 2026-11-26T05:00:00.000Z\n---\nNew body")
    let reread = NoteFile(parsing: edited)
    XCTAssertEqual(reread.title, "Plan: Q4 \"done\"")
    XCTAssertEqual(reread.updated, now)
    XCTAssertEqual(reread.body, "New body")
  }

  func testEditAddsMissingKeys() {
    let now = date("2026-11-26T05:00:00.000Z")
    XCTAssertEqual(
      NoteFile.edited("---\nid: c_1\n---\nold", title: "周会 v2", body: "内容", now: now),
      "---\nid: c_1\ntitle: 周会 v2\nupdated: 2026-11-26T05:00:00.000Z\n---\n内容"
    )
    XCTAssertEqual(
      NoteFile.edited("no frontmatter", title: "T", body: "b", now: now),
      "---\ntitle: T\nupdated: 2026-11-26T05:00:00.000Z\n---\nb"
    )
  }

  func testNewNoteMatchesTheMacLayout() {
    let now = date("2026-11-26T05:00:00.000Z")
    XCTAssertEqual(
      NoteFile.new(id: "c_ff", title: "周会笔记", body: "内容", now: now),
      "---\nid: c_ff\ntitle: 周会笔记\ncreated: 2026-11-26T05:00:00.000Z\nupdated: 2026-11-26T05:00:00.000Z\n---\n内容"
    )
    let id = NoteFile.newId()
    XCTAssertEqual(id.count, 14)
    XCTAssertEqual(NoteFile(parsing: "---\nid: \(id)\n---\n").id, id)
  }

  func testTitlesThatNeedQuotes() {
    XCTAssertEqual(NoteFile.yamlString("Notes (draft)"), "Notes (draft)")
    XCTAssertEqual(NoteFile.yamlString("yes"), "\"yes\"")
    XCTAssertEqual(NoteFile.yamlString("12"), "\"12\"")
    XCTAssertEqual(NoteFile.yamlString("a\\b\nc"), "\"a\\\\b\\nc\"")
    XCTAssertEqual(NoteFile.yamlString("tab\u{1}"), "\"tab\\u0001\"")
    for title in ["Plan: Q4", "it's", "- dash", "#tag", " lead"] {
      XCTAssertEqual(NoteFile(parsing: "---\ntitle: \(NoteFile.yamlString(title))\n---\n").title, title.trimmingCharacters(in: .whitespaces))
    }
  }

  func testFileNamesFollowTheMac() {
    XCTAssertEqual(NoteFile.fileStem("a/b: c?"), "a b c")
    XCTAssertEqual(NoteFile.fileStem("..hidden. "), "hidden")
    XCTAssertEqual(NoteFile.fileStem("  "), "Untitled")
    XCTAssertEqual(NoteFile.fileStem(String(repeating: "长", count: 90)).unicodeScalars.count, 80)
    XCTAssertEqual(NoteFile.uniqueName("Plan", taken: ["plan.md", "plan 2.md"]), "Plan 3.md")
  }
}

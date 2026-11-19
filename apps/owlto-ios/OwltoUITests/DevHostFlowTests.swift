import XCTest

/// Drives the app against `scripts/dev-host.mjs`, the desktop's real Remote Router host with a
/// scripted Router. It runs only when told where the host is:
///
///   TEST_RUNNER_OWLTO_DEV_HOST=127.0.0.1:47330 [TEST_RUNNER_OWLTO_DEV_CODE=ABCD-EFGH] xcodebuild test …
///
/// The code is needed only when this simulator has not paired with that host yet. The dev host
/// must be freshly started, so its sample threads and requests are in their first state.
final class DevHostFlowTests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let host = environment["OWLTO_DEV_HOST"] else {
      throw XCTSkip("Set TEST_RUNNER_OWLTO_DEV_HOST to run against scripts/dev-host.mjs.")
    }
    continueAfterFailure = false
    app = XCUIApplication()
    if let code = environment["OWLTO_DEV_CODE"] {
      app.launchArguments += ["-OwltoDevPairAddress", host, "-OwltoDevPairCode", code]
    }
  }

  func testAnswerEverythingThenMessageTheRouter() throws {
    app.launchArguments += ["-OwltoDevTab", "inbox"]
    app.launch()

    // A command approval: open it, allow it, and it leaves the inbox.
    let command = button(containing: "为 remote-router 补集成测试")
    XCTAssertTrue(command.waitForExistence(timeout: 15), "the command request shows up")
    command.tap()
    app.buttons["Allow"].tap()
    XCTAssertTrue(command.waitForNonExistence(timeout: 10), "approving resolves the request")

    // A question: pick an option and answer.
    button(containing: "发布说明补 Highlights").tap()
    button(containing: "写，放第一条").tap()
    app.buttons["Answer"].tap()
    XCTAssertTrue(button(containing: "发布说明补 Highlights").waitForNonExistence(timeout: 10))

    // A batch whose delivery is unknown: resend it.
    button(containing: "Release 2026.11.1800").tap()
    app.buttons["Resend"].tap()
    XCTAssertTrue(app.staticTexts["Nothing needs you"].waitForExistence(timeout: 10), "the inbox is empty")

    // Message the Router; the scripted Router answers and dispatches a worker.
    app.tabBars.buttons["Threads"].tap()
    button(containing: "移动端配对后的消息转发").tap()
    let composer = app.textFields["Message the Router…"].exists ? app.textFields["Message the Router…"] : app.textViews.firstMatch
    composer.tap()
    composer.typeText("加一个暗色模式")
    app.buttons["Send to the Router"].tap()
    let reply = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "收到：「加一个暗色模式」")).firstMatch
    XCTAssertTrue(reply.waitForExistence(timeout: 15), "the Router's reply streams in")
    attachScreenshot("thread-after-send")

    // Open the worker the Router sent out earlier and steer its queued message in.
    button(containing: "为 remote-router 补集成测试").tap()
    XCTAssertTrue(app.buttons["Steer"].waitForExistence(timeout: 5))
    app.buttons["Steer"].tap()
    XCTAssertTrue(app.buttons["Steer"].waitForNonExistence(timeout: 10), "the queue empties")
    attachScreenshot("worker-after-steer")
  }

  private func button(containing text: String) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
  }

  private func attachScreenshot(_ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

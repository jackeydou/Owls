import UIKit
import UserNotifications

/// Notifications from a paired Mac while the app is closed: a worker waiting for an answer,
/// or a thread that finished. The Mac sends them through the relay, sealed with a key only
/// this phone holds (`Shared/PushShared.swift`); `OwltoNotify` opens them on arrival.
enum PushRegistration {
  /// Receives the APNs token as hex; set by the app before the first request.
  @MainActor static var onToken: (String) -> Void = { _ in }
  @MainActor private static var requested = false

  /// Asks once per launch; iOS shows its prompt only the first time.
  @MainActor
  static func request() {
    guard !requested else { return }
    requested = true
    Task {
      let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
      guard granted else { return }
      await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
    }
  }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    Task { @MainActor in PushRegistration.onToken(hex) }
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    // Without a token the Mac simply sends nothing; the app works the same in front.
  }

  /// The app is in front and connected, so the Mac's own events already show the change.
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
    []
  }
}

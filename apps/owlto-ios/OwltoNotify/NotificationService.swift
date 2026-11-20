import UserNotifications

/// Opens the sealed notifications a paired Mac sends through the relay. The push itself only
/// says "Owlto: open the app to see what changed" (`PUSH_FALLBACK_*` in Localizable); the real
/// title and text are in `e`, sealed with the key only this phone and the Mac hold.
final class NotificationService: UNNotificationServiceExtension {
  override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    if let payload = request.content.userInfo["e"] as? String,
       let key = PushShared.readKey(),
       let message = try? PushShared.open(payload, key: key) {
      content.title = message.title
      content.subtitle = message.subtitle
      content.body = message.body
      var info: [String: Any] = [:]
      if let routerId = message.routerId { info["routerId"] = routerId }
      if let workerId = message.workerId { info["workerId"] = workerId }
      content.userInfo = info
      content.threadIdentifier = message.routerId ?? ""
    }
    contentHandler(content)
  }

  /// Out of time: the fallback text stays, which says nothing about the work.
  override func serviceExtensionTimeWillExpire() {}
}

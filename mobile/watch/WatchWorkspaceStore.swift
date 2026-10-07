import Combine
import Foundation
import WatchConnectivity

@MainActor
final class WatchWorkspaceStore: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var snapshot: WorkspaceSnapshot?
  @Published private(set) var isRefreshing = false
  @Published private(set) var message: String?
  private(set) var isPreview = false
  private static let cacheKey = "orca.watch.workspaceSnapshot.v1"

  override init() {
    if let cached = UserDefaults.standard.data(forKey: Self.cacheKey) {
      snapshot = try? WorkspaceSnapshot.decode(cached)
    }
    super.init()
    #if DEBUG
    if let json = ProcessInfo.processInfo.environment["ORCA_WATCH_PREVIEW_SNAPSHOT"],
      let data = json.data(using: .utf8) {
      snapshot = try? WorkspaceSnapshot.decode(data)
      isPreview = true
      return
    }
    #endif
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func refresh() {
    guard !isPreview, !isRefreshing, WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else {
      message = "Open Orca on your iPhone to sync."
      return
    }
    isRefreshing = true
    message = nil
    session.sendMessage(["requestWorkspaces": true], replyHandler: { [weak self] reply in
      Task { @MainActor in
        self?.receive(reply)
        self?.isRefreshing = false
      }
    }, errorHandler: { [weak self] _ in
      Task { @MainActor in
        self?.isRefreshing = false
        self?.message = "Waiting for your iPhone. Sync will retry automatically."
      }
    })
  }

  private func receive(_ context: [String: Any]) {
    guard context["workspaceSnapshot"] != nil else {
      message = "Open Orca on your iPhone and connect a host."
      return
    }
    do {
      let (incoming, data) = try WorkspaceSnapshot.decode(context)
      guard incoming.generatedAt >= (snapshot?.generatedAt ?? 0) else { return }
      snapshot = incoming
      message = nil
      UserDefaults.standard.set(data, forKey: Self.cacheKey)
    } catch {
      message = "Couldn't read this update. Update Orca on your iPhone."
    }
  }

  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?) {
    let context = session.receivedApplicationContext
    Task { @MainActor [weak self] in
      if !context.isEmpty { self?.receive(context) }
      self?.refresh()
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    Task { @MainActor [weak self] in self?.receive(applicationContext) }
  }

  nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    Task { @MainActor [weak self] in self?.receive(message) }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    guard session.isReachable else { return }
    Task { @MainActor [weak self] in self?.refresh() }
  }
}

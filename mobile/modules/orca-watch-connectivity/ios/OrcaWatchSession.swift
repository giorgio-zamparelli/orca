import Foundation
import WatchConnectivity

final class OrcaWatchSession: NSObject, WCSessionDelegate {
  static let shared = OrcaWatchSession()
  private static let snapshotKey = "orca.watch.workspaceSnapshot.v1"
  private var latestJSON: String?
  var onRefresh: (() -> Void)?
  var cachedSnapshotJSON: String? { latestJSON }

  override init() {
    latestJSON = UserDefaults.standard.string(forKey: Self.snapshotKey)
    super.init()
  }

  var isAvailable: Bool {
    WCSession.isSupported() && WCSession.default.isPaired && WCSession.default.isWatchAppInstalled
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState != .activated { session.activate() }
  }

  func update(_ json: String) throws {
    guard let data = json.data(using: .utf8), data.count <= 60 * 1024,
      let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      envelope["version"] as? Int == 1, envelope["hosts"] is [[String: Any]]
    else { throw NSError(domain: "OrcaWatchConnectivity", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "Invalid workspace snapshot"]) }
    latestJSON = json
    UserDefaults.standard.set(json, forKey: Self.snapshotKey)
    publish()
  }

  private func publish() {
    let session = WCSession.default
    guard isAvailable, session.activationState == .activated,
      let json = latestJSON else { return }
    let context = ["workspaceSnapshot": Data(json.utf8)]
    // Keep a durable latest context; immediate messages update an open watch without delivery delay.
    try? session.updateApplicationContext(context)
    if session.isReachable {
      session.sendMessage(context, replyHandler: nil, errorHandler: nil)
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?) {
    DispatchQueue.main.async { [weak self] in
      self?.publish()
      self?.onRefresh?()
    }
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    DispatchQueue.main.async { [weak self] in
      self?.publish()
      self?.onRefresh?()
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    guard session.isReachable else { return }
    DispatchQueue.main.async { [weak self] in
      self?.publish()
      self?.onRefresh?()
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void) {
    DispatchQueue.main.async { [weak self] in
      guard message["requestWorkspaces"] as? Bool == true else {
        replyHandler([:])
        return
      }
      replyHandler(self?.latestJSON.map { ["workspaceSnapshot": Data($0.utf8)] } ?? [:])
      self?.onRefresh?()
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}

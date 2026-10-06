import ExpoModulesCore

public class OrcaWatchConnectivitySubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    OrcaWatchSession.shared.activate()
    return true
  }
}

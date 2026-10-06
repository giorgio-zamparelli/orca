import ExpoModulesCore

public class OrcaWatchConnectivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OrcaWatchConnectivity")
    Events("onRefreshRequested")

    OnCreate {
      DispatchQueue.main.async { OrcaWatchSession.shared.activate() }
    }
    OnStartObserving { [weak self] in
      DispatchQueue.main.async { [weak self] in
        OrcaWatchSession.shared.onRefresh = { [weak self] in
          self?.sendEvent("onRefreshRequested", [:])
        }
      }
    }
    OnStopObserving {
      DispatchQueue.main.async { OrcaWatchSession.shared.onRefresh = nil }
    }
    AsyncFunction("isAvailable") { () -> Bool in
      OrcaWatchSession.shared.isAvailable
    }.runOnQueue(.main)
    AsyncFunction("getWorkspaceSnapshot") { () -> String in
      OrcaWatchSession.shared.cachedSnapshotJSON ?? ""
    }.runOnQueue(.main)
    AsyncFunction("updateWorkspaceSnapshot") { (json: String) in
      try OrcaWatchSession.shared.update(json)
    }.runOnQueue(.main)
  }
}

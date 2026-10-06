import SwiftUI

@main
struct OrcaWatchApp: App {
  @StateObject private var store = WatchWorkspaceStore()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      WorkspaceListView(store: store)
        .onChange(of: scenePhase) { _, phase in
          if phase == .active { store.refresh() }
        }
    }
  }
}

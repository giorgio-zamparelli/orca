import SwiftUI

@main
struct OrcaWatchApp: App {
  @StateObject private var store = WatchWorkspaceStore()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      WorkspaceListView(store: store)
        .task(id: scenePhase) {
          guard scenePhase == .active else { return }
          while !Task.isCancelled {
            store.refresh()
            do {
              try await Task.sleep(nanoseconds: 15_000_000_000)
            } catch {
              return
            }
          }
        }
    }
  }
}

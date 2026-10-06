import SwiftUI

struct WorkspaceListView: View {
  @ObservedObject var store: WatchWorkspaceStore

  var body: some View {
    NavigationStack {
      TimelineView(.periodic(from: .now, by: 15)) { timeline in
        List {
          if let snapshot = store.snapshot, !snapshot.hosts.isEmpty {
            ForEach(snapshot.hosts) { host in
              hostSection(host, at: timeline.date)
            }
            if snapshot.omittedHostCount > 0 {
              Text("\(snapshot.omittedHostCount) more hosts on iPhone")
                .font(.caption).foregroundStyle(.secondary)
            }
          } else {
            Section {
              VStack(alignment: .leading, spacing: 8) {
                Label("Your workspaces", systemImage: "rectangle.stack")
                  .font(.headline)
                Text("Open Orca on iPhone and pair a desktop to see your workspaces.")
                  .font(.caption).foregroundStyle(.secondary)
              }
            }
          }
          if let message = store.message {
            Text(message).font(.caption).foregroundStyle(.secondary)
          }
        }
      }
      .navigationTitle(store.isPreview ? "Orca Preview" : "Orca")
      .toolbar {
        ToolbarItem(placement: .bottomBar) {
          Button(action: store.refresh) {
            if store.isRefreshing {
              ProgressView().accessibilityLabel("Syncing workspaces")
            } else {
              Label("Refresh", systemImage: "arrow.clockwise")
            }
          }
          .disabled(store.isRefreshing || store.isPreview)
          .accessibilityLabel("Refresh workspaces")
        }
      }
    }
  }

  private func hostSection(_ host: WorkspaceHost, at date: Date) -> some View {
    Section {
      if host.workspaces.isEmpty {
        Text(host.updatedAt == nil ? "Connect this host on your iPhone." :
          host.totalCount > 0 ? "See these workspaces on your iPhone." : "No workspaces")
          .font(.caption).foregroundStyle(.secondary)
      }
      ForEach(host.workspaces) { workspace in
        NavigationLink {
          WorkspaceDetailView(store: store, hostId: host.id, workspaceId: workspace.id)
        } label: {
          VStack(alignment: .leading, spacing: 4) {
            Text(workspace.name).font(.headline).lineLimit(2)
            if !workspace.repo.isEmpty {
              Text(workspace.repo).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Label(host.isFresh(at: date) ? workspace.status.label : "Last known · \(workspace.status.label)",
              systemImage: workspace.status.symbol)
              .font(.caption2).foregroundStyle(.secondary)
          }
        }
      }
      if host.totalCount > host.workspaces.count {
        Text("Showing \(host.workspaces.count) of \(host.totalCount). See all on iPhone.")
          .font(.caption2).foregroundStyle(.secondary)
      }
    } header: {
      VStack(alignment: .leading) {
        Text(host.name)
        if let updated = host.updatedDate {
          HStack(spacing: 3) {
            Text(host.isFresh(at: date) ? "Synced" : "Last sync")
            Text(updated, style: .relative)
          }.font(.caption2)
        } else {
          Text("Awaiting sync").font(.caption2)
        }
      }
    }
  }
}

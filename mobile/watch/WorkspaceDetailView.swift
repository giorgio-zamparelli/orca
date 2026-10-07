import SwiftUI

struct WorkspaceDetailView: View {
  @ObservedObject var store: WatchWorkspaceStore
  let hostId: String
  let workspaceId: String

  var body: some View {
    TimelineView(.periodic(from: .now, by: 15)) { timeline in
      ScrollView {
        if let host = store.snapshot?.hosts.first(where: { $0.id == hostId }),
          let workspace = host.workspaces.first(where: { $0.id == workspaceId }) {
          details(workspace, host: host, at: timeline.date)
        } else {
          Text("This workspace is no longer in the synced list. Check Orca on your iPhone.")
            .font(.caption).foregroundStyle(.secondary)
            .padding(.horizontal)
        }
      }
    }
    .navigationTitle("Workspace")
  }

  private func details(_ workspace: WatchWorkspace, host: WorkspaceHost, at date: Date) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(workspace.name).font(.headline)
      WorkspaceStatusView(status: workspace.status, isFresh: host.isFresh(at: date))
        .font(.subheadline)
      Text(host.name).font(.caption).foregroundStyle(.secondary)
      if !workspace.repo.isEmpty {
        Text(workspace.repo).font(.subheadline)
      }
      if !workspace.branch.isEmpty {
        Label(workspace.branch, systemImage: "arrow.triangle.branch")
          .font(.caption)
      }
      if !workspace.comment.isEmpty {
        Text(workspace.comment).font(.caption)
      }
      Text("\(workspace.terminalCount) \(host.isFresh(at: date) ? "live" : "last known") terminals")
        .font(.caption).foregroundStyle(.secondary)
      if let updated = host.updatedDate {
        Text("Last sync \(updated.formatted(date: .omitted, time: .shortened))")
          .font(.caption2).foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal)
  }
}

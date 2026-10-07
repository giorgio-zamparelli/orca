import Foundation

struct WorkspaceSnapshot: Codable {
  let version: Int
  let generatedAt: Double
  let omittedHostCount: Int
  let hosts: [WorkspaceHost]

  static func decode(_ context: [String: Any]) throws -> (snapshot: WorkspaceSnapshot, data: Data) {
    if let data = context["workspaceSnapshot"] as? Data {
      return (try decode(data), data)
    }
    if let json = context["workspaceSnapshot"] as? String {
      let data = Data(json.utf8)
      return (try decode(data), data)
    }
    throw SnapshotError.invalid
  }

  static func decode(_ data: Data) throws -> WorkspaceSnapshot {
    guard data.count <= 60 * 1024 else { throw SnapshotError.tooLarge }
    let snapshot = try JSONDecoder().decode(Self.self, from: data)
    guard snapshot.version == 1, snapshot.generatedAt.isFinite, snapshot.generatedAt >= 0,
      snapshot.omittedHostCount >= 0, snapshot.hosts.count <= 20,
      Set(snapshot.hosts.map(\.id)).count == snapshot.hosts.count
    else { throw SnapshotError.invalid }
    var rowCount = 0
    for host in snapshot.hosts {
      guard !host.id.isEmpty, host.totalCount >= host.workspaces.count,
        host.updatedAt.map({ $0.isFinite && $0 >= 0 && $0 <= snapshot.generatedAt }) ?? host.workspaces.isEmpty,
        Set(host.workspaces.map(\.id)).count == host.workspaces.count,
        host.workspaces.allSatisfy({ !$0.id.isEmpty && $0.terminalCount >= 0 })
      else { throw SnapshotError.invalid }
      rowCount += host.workspaces.count
    }
    guard rowCount <= 100 else { throw SnapshotError.tooLarge }
    return snapshot
  }

  enum SnapshotError: Error { case invalid, tooLarge }
}

struct WorkspaceHost: Codable, Identifiable {
  let id: String
  let name: String
  let available: Bool
  let updatedAt: Double?
  let totalCount: Int
  let workspaces: [WatchWorkspace]

  func isFresh(at date: Date) -> Bool {
    guard available, let updatedAt else { return false }
    let age = date.timeIntervalSince1970 * 1000 - updatedAt
    return age >= -5000 && age <= 60_000
  }

  var updatedDate: Date? { updatedAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
}

struct WatchWorkspace: Codable, Identifiable {
  let id: String
  let name: String
  let repo: String
  let branch: String
  let comment: String
  let status: WorkspaceStatus
  let terminalCount: Int
  let isPinned: Bool
}

enum WorkspaceStatus: String, Codable {
  case permission, working, done, active, inactive, unknown

  init(from decoder: Decoder) throws {
    let value = try decoder.singleValueContainer().decode(String.self)
    self = Self(rawValue: value) ?? .unknown
  }

  var label: String {
    switch self {
    case .permission: "Needs input"
    case .working: "Working"
    case .done: "Done"
    case .active: "Active"
    case .inactive: "Inactive"
    case .unknown: "Unknown"
    }
  }

  var symbol: String {
    switch self {
    case .permission: "exclamationmark.bubble"
    case .working: "arrow.triangle.2.circlepath"
    case .done, .active, .inactive: "circle.fill"
    case .unknown: "questionmark.circle"
    }
  }
}

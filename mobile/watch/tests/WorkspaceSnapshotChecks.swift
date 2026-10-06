import Foundation

@main
struct WorkspaceSnapshotChecks {
  static func main() throws {
    let json = """
      {"version":1,"generatedAt":1000,"omittedHostCount":0,"hosts":[{
        "id":"desktop","name":"Desktop","available":true,"updatedAt":1000,"totalCount":1,
        "workspaces":[{"id":"workspace","name":"Fix login","repo":"orca","branch":"fix",
          "comment":"Working on login","status":"working","terminalCount":1,"isPinned":true}]
      }]}
      """
    let snapshot = try WorkspaceSnapshot.decode(Data(json.utf8))
    let byteContext = try WorkspaceSnapshot.decode(["workspaceSnapshot": Data(json.utf8)])
    precondition(byteContext.snapshot.hosts[0].workspaces[0].name == "Fix login")
    precondition(byteContext.data == Data(json.utf8))
    let stringContext = try WorkspaceSnapshot.decode(["workspaceSnapshot": json])
    precondition(stringContext.snapshot.hosts[0].workspaces[0].status == .working)
    precondition(stringContext.data == Data(json.utf8))
    let largePayload = Data(("🦦" + String(repeating: "a", count: 60_000)).utf8)
    let serializedContext = try PropertyListSerialization.data(
      fromPropertyList: ["workspaceSnapshot": largePayload], format: .binary, options: 0)
    precondition(serializedContext.count < 64 * 1024)
    precondition(snapshot.hosts[0].workspaces[0].status == .working)
    precondition(snapshot.hosts[0].isFresh(at: Date(timeIntervalSince1970: 1)))
    precondition(!snapshot.hosts[0].isFresh(at: Date(timeIntervalSince1970: 62)))
    precondition(!snapshot.hosts[0].isFresh(at: Date(timeIntervalSince1970: -10)))
    let unavailable = json.replacingOccurrences(of: "\"available\":true", with: "\"available\":false")
    let unavailableSnapshot = try WorkspaceSnapshot.decode(Data(unavailable.utf8))
    precondition(!unavailableSnapshot.hosts[0]
      .isFresh(at: Date(timeIntervalSince1970: 1)))
    let futureStatus = json.replacingOccurrences(of: "\"working\"", with: "\"future-state\"")
    let futureSnapshot = try WorkspaceSnapshot.decode(Data(futureStatus.utf8))
    precondition(futureSnapshot.hosts[0].workspaces[0].status == .unknown)
    for invalid in [
      json.replacingOccurrences(of: "\"version\":1", with: "\"version\":2"),
      json.replacingOccurrences(of: "\"updatedAt\":1000", with: "\"updatedAt\":2000"),
      json.replacingOccurrences(of: "\"totalCount\":1", with: "\"totalCount\":0"),
      json.replacingOccurrences(of: "\"terminalCount\":1", with: "\"terminalCount\":-1"),
      "{invalid JSON}", String(repeating: " ", count: 60 * 1024 + 1)
    ] {
      do {
        _ = try WorkspaceSnapshot.decode(Data(invalid.utf8))
        fatalError("Invalid snapshot admitted")
      } catch {}
    }
    if CommandLine.arguments.count > 1 {
      let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
      let exported = try WorkspaceSnapshot.decode(data)
      precondition(!exported.hosts.isEmpty)
      print("TypeScript snapshot decoded: \(exported.hosts.reduce(0) { $0 + $1.workspaces.count }) workspaces")
    }
    print("Watch snapshot checks passed: wire bytes, decoding, versions, freshness, unknown status and invalid data")
  }
}

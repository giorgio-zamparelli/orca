import SwiftUI

struct WorkspaceStatusView: View {
  let status: WorkspaceStatus
  let isFresh: Bool
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.isLuminanceReduced) private var isLuminanceReduced
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var label: String {
    isFresh ? status.label : "Last known · \(status.label)"
  }

  private var animates: Bool {
    isFresh && scenePhase == .active && !isLuminanceReduced && !reduceMotion
  }

  var body: some View {
    Label {
      Text(label)
    } icon: {
      if status == .working {
        WorkingStatusRing(animates: animates)
      } else {
        Image(systemName: status.symbol)
          .frame(width: 12, height: 12)
      }
    }
    .foregroundStyle(isFresh ? status.color : .secondary)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
  }
}

private struct WorkingStatusRing: View {
  let animates: Bool
  @State private var rotating = false

  var body: some View {
    Circle()
      .trim(from: 0.15, to: 0.9)
      .stroke(lineWidth: 2)
      .frame(width: 8, height: 8)
      .rotationEffect(.degrees(rotating ? 360 : 0))
      .animation(animates ? .linear(duration: 1).repeatForever(autoreverses: false) : nil, value: rotating)
      .onAppear { rotating = animates }
      .onChange(of: animates) { _, active in rotating = active }
      .frame(width: 12, height: 12)
  }
}

extension WorkspaceStatus {
  // Match mobile AgentSpinner and desktop StatusIndicator's status palette.
  var color: Color {
    switch self {
    case .working: Color(red: 234 / 255, green: 179 / 255, blue: 8 / 255)
    case .active, .done: Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255)
    case .permission: Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255)
    case .inactive: Color(red: 115 / 255, green: 115 / 255, blue: 115 / 255).opacity(0.4)
    case .unknown: .secondary
    }
  }
}

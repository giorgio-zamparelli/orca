# Orca for Apple Watch

A native SwiftUI companion for watchOS 10 and later. Install it alongside Orca
on the paired iPhone. Pair desktops in the iPhone app and open their connections;
the watch lists those hosts' workspaces, including folder workspaces and work
running on SSH or remote Orca hosts. Tap a workspace for its repository, branch,
status, comment and terminal count.

## Sync

`src/watch/WatchWorkspaceSync.ios.tsx` runs under the existing RPC provider on
every iPhone screen. It reads each connected host through
`WorktreeCatalogSnapshotClient`; it doesn't open extra desktop connections.
It refreshes every 15 seconds while the iPhone app is active, on foreground,
when its client inventory changes and when the watch requests a refresh.
Android, web, Expo Go and older native iOS builds use the no-op adapter.

The local Expo module `modules/orca-watch-connectivity` activates
WatchConnectivity at native app launch. It publishes the latest snapshot with
`updateApplicationContext`, which coalesces updates and can deliver in the
background. It also answers a watch refresh with its persisted snapshot before
asking JavaScript to fetch a newer one. Refresh is a request, not proof of a
new desktop read. iOS can suspend JavaScript while the phone app is backgrounded;
open Orca on iPhone to obtain a fresh desktop snapshot.

Both devices retain the last snapshot across launches. The phone restores its
validated display cache before publishing its initial reconnecting hosts, with
their original read timestamps and full counts. The watch labels statuses
as **Last known** after 60 seconds or when a host is unavailable. A failed or
malformed RPC response preserves the proven rows and their timestamp; it cannot
claim the host has no workspaces. Removing a host or losing its credentials
removes its workspace data from subsequent snapshots. Archived workspaces are
excluded. Status presentation reuses the phone's `getWorktreeStatus` policy.

The version 1 JSON snapshot travels as UTF-8 `Data` in the native context and
refresh reply, so property-list string encoding cannot double its transfer size.
The watch also accepts JSON strings. It contains display metadata only, without pairing
credentials, connection endpoints, file paths or terminal output. It is bounded
to 60 KiB, 20 hosts and 100 workspace rows across those hosts, prioritizing rows
that need input or are working within each host. Omitted hosts and workspaces
are disclosed with their counts. Names, branches and comments have display
length limits. Host-qualified workspace IDs prevent same-name workspaces on
different execution hosts from colliding. Unknown future status values render
as Unknown; an unsupported snapshot version preserves the previous snapshot.

## Build and run

From `mobile/` on macOS with Xcode and CocoaPods installed (install the root
repository dependencies too, because mobile imports shared code):

```sh
pnpm install --frozen-lockfile
pnpm exec expo prebuild --platform ios --no-install
pod install --project-directory=ios
```

`plugins/with-orca-watch.js` creates the `OrcaWatch` Xcode target, embeds it into
the iPhone app and writes a shared `OrcaWatch` scheme. Sources under `watch/`
are authoritative; `ios/OrcaWatch/` is generated and ignored. Repeated prebuilds
update version/build settings without duplicating targets or embedding phases.
The watch uses the existing Orca app icon.

Open `ios/Orca.xcworkspace`, select `OrcaWatch` and a paired iPhone/Apple Watch
simulator or device, and run. Select a development team for both app targets.
The companion bundle ID is the configured iOS ID; the watch ID appends `.watch`.

For a physical watch, enable Developer Mode on both the paired iPhone and watch.
In Xcode's **Device Hub**, choose **+ → Pair Nearby Device**. Enable
**Settings → Privacy & Security → Developer Mode** on the watch and confirm
**Turn On** after the restart, accepting any **Trust** prompt. On watchOS 27,
return to that settings page, check **Devices / Paired Devices** and select the
Mac to initiate pairing while Device Hub is waiting; confirm the pairing code
when prompted. This watch-side step is described in an
[Apple Developer Forums report](https://developer.apple.com/forums/thread/829704).
Keep its paired iPhone connected and unlocked while setting up development.
See [Apple's device pairing guide](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub)
and [Developer Mode instructions](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).

Xcode 27 needs the iPhone deployment target applied to older CocoaPods resource
bundles too. This command builds the iPhone app with its embedded watch app,
preserving Orca's existing iOS 15.1 minimum:

```sh
xcodebuild -workspace ios/Orca.xcworkspace -scheme Orca \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath build/physical IPHONEOS_DEPLOYMENT_TARGET=15.1 \
  CODE_SIGNING_ALLOWED=NO build
```

This produces unsigned apps for build validation. For installation, use a paired
device destination, configure signing for both targets and enable code signing.
The pinned Expo Router patch guards its `UIAction.subtitle` assignment on iOS 16
and later, so Xcode 27 can compile it while retaining iOS 15.1 support. Avoid
`xcodebuild -quiet` with Xcode 27: during validation it reported failed Swift
commands with exit code 0, while the same build without `-quiet` succeeded.

To build the watch without CocoaPods or signing:

```sh
xcodebuild -project ios/Orca.xcodeproj -scheme OrcaWatch \
  -configuration Debug -sdk watchsimulator \
  -destination 'generic/platform=watchOS Simulator' \
  -derivedDataPath build/watch CODE_SIGNING_ALLOWED=NO build
```

Before the first App Store release, register the watch bundle identifier
`com.stably.orca.mobile.watch` in the existing Apple developer team. Both app
targets need their own distribution profile; the release lane must sign each
target with its matching profile and export both mappings. The existing
`build_and_upload` lane now fetches and applies those profiles per target.

## Validation

```sh
pnpm test src/watch scripts/watch-target.test.ts
swiftc watch/WorkspaceSnapshot.swift watch/tests/WorkspaceSnapshotChecks.swift \
  -o /tmp/orca-watch-snapshot-checks
/tmp/orca-watch-snapshot-checks
```

Debug builds can take an `ORCA_WATCH_PREVIEW_SNAPSHOT` launch environment value
containing version 1 JSON to inspect populated, empty and stale states without
a paired iPhone. The screen is explicitly labeled Preview; release builds
ignore this variable. This does not verify physical WatchConnectivity delivery;
[Apple's connectivity sample](https://developer.apple.com/documentation/watchconnectivity/transferring-data-with-watch-connectivity)
specifies a physical iPhone and Apple Watch for testing transfers.

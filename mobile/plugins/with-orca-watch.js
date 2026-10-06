const fs = require('node:fs')
const path = require('node:path')
const { withXcodeProject } = require('expo/config-plugins')

const WATCH_TARGET = 'OrcaWatch'
const WATCH_SOURCES = [
  'OrcaWatchApp.swift',
  'WorkspaceSnapshot.swift',
  'WatchWorkspaceStore.swift',
  'WorkspaceListView.swift',
  'WorkspaceDetailView.swift'
]

function addOrcaWatchTarget(project, { bundleIdentifier, version, buildNumber, team }) {
  // xcode silently skips target dependencies when these sections do not exist yet.
  project.hash.project.objects.PBXTargetDependency ??= {}
  project.hash.project.objects.PBXContainerItemProxy ??= {}
  let uuid = project.findTargetKey(WATCH_TARGET) ?? project.findTargetKey(`"${WATCH_TARGET}"`)
  if (!uuid) {
    const target = project.addTarget(
      WATCH_TARGET,
      'watch2_app',
      WATCH_TARGET,
      `${bundleIdentifier}.watch`
    )
    uuid = target.uuid
    // A modern SwiftUI watch app runs in one executable, without a WatchKit extension.
    target.pbxNativeTarget.productType = '"com.apple.product-type.application"'
    const group = project.addPbxGroup([], WATCH_TARGET, WATCH_TARGET)
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup)
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', uuid)
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', uuid)
    for (const file of WATCH_SOURCES) {
      project.addSourceFile(file, { target: uuid }, group.uuid)
    }
    for (const resource of ['Assets.xcassets', 'PrivacyInfo.xcprivacy']) {
      const file = project.addFile(resource, group.uuid)
      file.target = uuid
      file.uuid = project.generateUuid()
      project.addToPbxBuildFileSection(file)
      project.addToPbxResourcesBuildPhase(file)
    }
    project.addFile(`${WATCH_TARGET}-Info.plist`, group.uuid)
  }
  const phone = project.getFirstTarget()
  const dependencies = project.hash.project.objects.PBXTargetDependency
  if (
    !phone.firstTarget.dependencies.some(
      (dependency) => dependencies[dependency.value]?.target === uuid
    )
  ) {
    project.addTargetDependency(phone.uuid, [uuid])
  }
  const target = project.pbxNativeTargetSection()[uuid]
  const configurations =
    project.pbxXCConfigurationList()[target.buildConfigurationList].buildConfigurations
  for (const configuration of configurations) {
    const settings = project.pbxXCBuildConfigurationSection()[configuration.value].buildSettings
    Object.assign(settings, {
      ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
      CODE_SIGN_STYLE: 'Automatic',
      CURRENT_PROJECT_VERSION: String(buildNumber ?? '1'),
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${WATCH_TARGET}/${WATCH_TARGET}-Info.plist`,
      LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks"',
      MARKETING_VERSION: version ?? '1.0.0',
      PRODUCT_BUNDLE_IDENTIFIER: `${bundleIdentifier}.watch`,
      SDKROOT: 'watchos',
      SKIP_INSTALL: 'YES',
      SUPPORTED_PLATFORMS: '"watchos watchsimulator"',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '4',
      WATCHOS_DEPLOYMENT_TARGET: '10.0'
    })
    if (configuration.comment === 'Debug') {
      settings.SWIFT_ACTIVE_COMPILATION_CONDITIONS = '"$(inherited) DEBUG"'
      settings.SWIFT_OPTIMIZATION_LEVEL = '"-Onone"'
    }
    if (team) {
      settings.DEVELOPMENT_TEAM = team
    }
  }
  return uuid
}

function watchScheme(uuid, projectName) {
  const reference = `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${uuid}" BuildableName="OrcaWatch.app" BlueprintName="OrcaWatch" ReferencedContainer="container:${projectName}.xcodeproj"/>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
    <BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${reference}</BuildActionEntry></BuildActionEntries>
  </BuildAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES">
    <BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable>
  </LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES">
    <BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable>
  </ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`
}

function withOrcaWatch(config) {
  return withXcodeProject(config, (mod) => {
    const bundleIdentifier = mod.ios?.bundleIdentifier
    if (!bundleIdentifier || !/^[A-Za-z0-9.-]+$/.test(bundleIdentifier)) {
      throw new Error('Orca Watch requires a valid iOS bundle identifier')
    }
    const uuid = addOrcaWatchTarget(mod.modResults, {
      bundleIdentifier,
      version: mod.version,
      buildNumber: mod.ios?.buildNumber,
      team: mod.ios?.appleTeamId
    })
    const source = path.join(mod.modRequest.projectRoot, 'watch')
    const destination = path.join(mod.modRequest.platformProjectRoot, WATCH_TARGET)
    fs.mkdirSync(destination, { recursive: true })
    for (const file of [...WATCH_SOURCES, 'PrivacyInfo.xcprivacy']) {
      fs.copyFileSync(path.join(source, file), path.join(destination, file))
    }
    fs.cpSync(path.join(source, 'Assets.xcassets'), path.join(destination, 'Assets.xcassets'), {
      recursive: true
    })
    fs.copyFileSync(
      path.join(mod.modRequest.projectRoot, 'assets', 'icon.png'),
      path.join(destination, 'Assets.xcassets', 'AppIcon.appiconset', 'icon.png')
    )
    const plist = fs
      .readFileSync(path.join(source, `${WATCH_TARGET}-Info.plist`), 'utf8')
      .replace('__COMPANION_BUNDLE_IDENTIFIER__', bundleIdentifier)
    fs.writeFileSync(path.join(destination, `${WATCH_TARGET}-Info.plist`), plist)
    const projectName = mod.modRequest.projectName
    const schemes = path.join(
      mod.modRequest.platformProjectRoot,
      `${projectName}.xcodeproj`,
      'xcshareddata',
      'xcschemes'
    )
    fs.mkdirSync(schemes, { recursive: true })
    fs.writeFileSync(path.join(schemes, `${WATCH_TARGET}.xcscheme`), watchScheme(uuid, projectName))
    return mod
  })
}

module.exports = withOrcaWatch
module.exports.addOrcaWatchTarget = addOrcaWatchTarget

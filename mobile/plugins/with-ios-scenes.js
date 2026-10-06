const fs = require('node:fs')
const path = require('node:path')
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins')

const START = '// @generated begin orca-scene-delegate'
const END = '// @generated end orca-scene-delegate'

function adoptScenes(contents) {
  const start = contents.indexOf(START)
  if (start !== -1) {
    const end = contents.indexOf(END, start)
    if (end === -1) {
      throw new Error('Incomplete generated Orca scene delegate')
    }
    contents = contents.slice(0, start) + contents.slice(end + END.length)
  } else {
    const legacyWindow =
      /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\([\s\S]*?launchOptions: launchOptions\)\s+#endif/
    if (!legacyWindow.test(contents)) {
      throw new Error('Orca scene support requires the Expo 55 Swift AppDelegate template')
    }
    contents = contents
      .replace(legacyWindow, '')
      .replace(
        'var window: UIWindow?',
        'var window: UIWindow?\n  var reactNativeLaunchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]'
      )
      .replace(
        'reactNativeFactory = factory',
        'reactNativeFactory = factory\n    reactNativeLaunchOptions = launchOptions ?? [:]'
      )
  }
  const sceneDelegate = fs.readFileSync(path.join(__dirname, 'ios', 'SceneDelegate.swift'), 'utf8')
  return `${contents.trimEnd()}\n\n${START}\n${sceneDelegate.trimEnd()}\n${END}\n`
}

function withIosScenes(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Orca',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate'
          }
        ]
      }
    }
    return mod
  })
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('Orca scene support requires a Swift AppDelegate')
    }
    mod.modResults.contents = adoptScenes(mod.modResults.contents)
    return mod
  })
}

module.exports = withIosScenes
module.exports.adoptScenes = adoptScenes

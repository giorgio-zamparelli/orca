import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { adoptScenes } = require('../plugins/with-ios-scenes.js')
const template = `
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let factory = ExpoReactNativeFactory(delegate: ReactNativeDelegate())
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func customApplicationCallback() {}
}
`

describe('iOS scene prebuild migration', () => {
  it('preserves app callbacks and produces stable output on repeated prebuilds', () => {
    const first = adoptScenes(template)
    expect(adoptScenes(first)).toBe(first)
    expect(first).toContain('func customApplicationCallback() {}')
    expect(first).toContain(
      'return super.application(application, didFinishLaunchingWithOptions: launchOptions)'
    )
    expect(first).not.toContain('UIWindow(frame: UIScreen.main.bounds)')
    expect(first.match(/class SceneDelegate:/g)).toHaveLength(1)
    expect(first.match(/var reactNativeLaunchOptions:/g)).toHaveLength(1)
  })

  it('rejects an incompatible template or partial migration instead of generating a broken app', () => {
    expect(() => adoptScenes('class AppDelegate {}')).toThrow(/Expo 55/)
    expect(() => adoptScenes('// @generated begin orca-scene-delegate')).toThrow(/Incomplete/)
  })
})

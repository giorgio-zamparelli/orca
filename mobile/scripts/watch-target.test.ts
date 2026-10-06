import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const expoRequire = createRequire(require.resolve('expo/package.json'))
const pluginsRequire = createRequire(expoRequire.resolve('@expo/config-plugins/package.json'))
const xcode = pluginsRequire('xcode')
const { addOrcaWatchTarget } = require('../plugins/with-orca-watch.js')
const directories: string[] = []

function baseProject() {
  const directory = mkdtempSync(join(tmpdir(), 'orca-watch-target-'))
  directories.push(directory)
  const project = xcode.project(join(directory, 'project.pbxproj'))
  project.hash = {
    headComment: '!$*UTF8*$!',
    project: {
      archiveVersion: 1,
      classes: {},
      objectVersion: 54,
      rootObject: 'PROJECT',
      objects: {
        PBXProject: {
          PROJECT: {
            isa: 'PBXProject',
            mainGroup: 'ROOT',
            targets: [{ value: 'PHONE', comment: 'Orca' }]
          },
          PROJECT_comment: 'Project object'
        },
        PBXNativeTarget: {
          PHONE: {
            isa: 'PBXNativeTarget',
            name: 'Orca',
            productName: 'Orca',
            productType: '"com.apple.product-type.application"',
            productReference: 'PRODUCT',
            buildConfigurationList: 'CONFIG',
            buildPhases: [],
            dependencies: []
          },
          PHONE_comment: 'Orca'
        },
        PBXGroup: {
          ROOT: {
            isa: 'PBXGroup',
            sourceTree: '"<group>"',
            children: [{ value: 'PRODUCTS', comment: 'Products' }]
          },
          ROOT_comment: 'Main Group',
          PRODUCTS: {
            isa: 'PBXGroup',
            name: 'Products',
            sourceTree: '"<group>"',
            children: [{ value: 'PRODUCT', comment: 'Orca.app' }]
          },
          PRODUCTS_comment: 'Products'
        },
        PBXFileReference: {
          PRODUCT: { isa: 'PBXFileReference', path: 'Orca.app', sourceTree: 'BUILT_PRODUCTS_DIR' },
          PRODUCT_comment: 'Orca.app'
        },
        PBXBuildFile: {},
        XCConfigurationList: {
          CONFIG: {
            isa: 'XCConfigurationList',
            buildConfigurations: [
              { value: 'DEBUG', comment: 'Debug' },
              { value: 'RELEASE', comment: 'Release' }
            ]
          },
          CONFIG_comment: 'Phone Config'
        },
        XCBuildConfiguration: {
          DEBUG: {
            isa: 'XCBuildConfiguration',
            name: 'Debug',
            buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: 'com.test.orca', SDKROOT: 'iphoneos' }
          },
          DEBUG_comment: 'Debug',
          RELEASE: {
            isa: 'XCBuildConfiguration',
            name: 'Release',
            buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: 'com.test.orca', SDKROOT: 'iphoneos' }
          },
          RELEASE_comment: 'Release'
        }
      }
    }
  }
  return project
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true })
  }
})

describe('watch target generation', () => {
  it('embeds one native watch app and stays idempotent after an Xcode project round trip', () => {
    const project = baseProject()
    const options = {
      bundleIdentifier: 'com.test.orca',
      version: '1.2.3',
      buildNumber: '4',
      team: 'TEAM'
    }
    const uuid = addOrcaWatchTarget(project, options)
    writeFileSync(project.filepath, project.writeSync())
    const reparsed = xcode.project(project.filepath)
    reparsed.parseSync()
    expect(addOrcaWatchTarget(reparsed, { ...options, version: '1.2.4', buildNumber: '5' })).toBe(
      uuid
    )
    const targets = Object.values(reparsed.pbxNativeTargetSection()).filter(
      (value: unknown) =>
        typeof value === 'object' &&
        value !== null &&
        'isa' in value &&
        value.isa === 'PBXNativeTarget'
    )
    expect(targets).toHaveLength(2)
    const watch = reparsed.pbxNativeTargetSection()[uuid]
    expect(watch.productType).toBe('"com.apple.product-type.application"')
    const configurations =
      reparsed.pbxXCConfigurationList()[watch.buildConfigurationList].buildConfigurations
    for (const configuration of configurations) {
      expect(
        reparsed.pbxXCBuildConfigurationSection()[configuration.value].buildSettings
      ).toMatchObject({
        SDKROOT: 'watchos',
        TARGETED_DEVICE_FAMILY: '4',
        WATCHOS_DEPLOYMENT_TARGET: '10.0',
        PRODUCT_BUNDLE_IDENTIFIER: 'com.test.orca.watch',
        MARKETING_VERSION: '1.2.4',
        CURRENT_PROJECT_VERSION: '5'
      })
    }
    const embedPhases = Object.values(reparsed.hash.project.objects.PBXCopyFilesBuildPhase).filter(
      (value: unknown) =>
        typeof value === 'object' &&
        value !== null &&
        'isa' in value &&
        value.isa === 'PBXCopyFilesBuildPhase'
    )
    expect(embedPhases).toHaveLength(1)
    expect(embedPhases[0]).toMatchObject({
      dstSubfolderSpec: 16,
      dstPath: '"$(CONTENTS_FOLDER_PATH)/Watch"'
    })
    expect(reparsed.hash.project.objects.XCBuildConfiguration.DEBUG.buildSettings.SDKROOT).toBe(
      'iphoneos'
    )
    expect(reparsed.hash.project.objects.PBXNativeTarget.PHONE.dependencies).toHaveLength(1)
    expect(watch.buildPhases).toHaveLength(2)
    expect(readFileSync(project.filepath, 'utf8')).toContain('WorkspaceListView.swift')
  })
})
